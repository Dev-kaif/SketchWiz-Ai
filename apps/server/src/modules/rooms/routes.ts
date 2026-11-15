import { Router, type Router as ExpressRouter } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { client, joinPublicRoom, roomRoleForUser } from "@repo/db/access";
import { getCanvasSync } from "@repo/db/canvas";
import { RoomSchema } from "@repo/common/schemas";
import { auth } from "../../middleware/auth.js";
import { AppError } from "../../errors.js";

const router: ExpressRouter = Router();
router.use(auth);

function roomIdFrom(value: string) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1)
    throw new AppError(400, "Invalid room ID", "INVALID_ROOM_ID");
  return id;
}

async function requireRole(
  roomId: number,
  userId: number,
  allowed: Array<"OWNER" | "EDITOR" | "VIEWER">,
) {
  const role = await roomRoleForUser(roomId, userId);
  if (!role) throw new AppError(404, "Room not found", "ROOM_NOT_FOUND");
  if (!allowed.includes(role))
    throw new AppError(
      403,
      "You do not have permission to access this room",
      "ROOM_FORBIDDEN",
    );
  return role;
}

router.post("/room", async (req, res, next) => {
  const input = RoomSchema.safeParse(req.body);
  if (!input.success) {
    res
      .status(400)
      .json({ message: "Incorrect Inputs", errors: input.error.flatten() });
    return;
  }
  try {
    const userId = req.user!.id;
    const room = await client.room.create({
      data: {
        adminId: userId,
        slug: input.data.roomName,
        visibility: "PUBLIC",
        members: { create: { userId, role: "OWNER" } },
        canvas: { create: {} },
      },
    });
    res.status(200).json({ message: "Joined room", room });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    ) {
      res.status(403).json({ message: "Room ALready exist" });
      return;
    }
    next(error);
  }
});

router.get("/rooms", async (req, res, next) => {
  try {
    const rooms = await client.room.findMany({
      where: {
        OR: [
          { adminId: req.user!.id },
          { members: { some: { userId: req.user!.id } } },
        ],
      },
      orderBy: { createdAt: "desc" },
    });
    res.json({ rooms });
  } catch (error) {
    next(error);
  }
});

router.get("/room/slug/:slug", async (req, res, next) => {
  try {
    const room = await client.room.findUnique({
      where: { slug: req.params.slug },
    });
    if (!room) throw new AppError(404, "Room not found", "ROOM_NOT_FOUND");
    const role = await joinPublicRoom(room.id, req.user!.id);
    if (!role) throw new AppError(404, "Room not found", "ROOM_NOT_FOUND");
    res.json({ room, role });
  } catch (error) {
    next(error);
  }
});

router.get("/room/:roomId", async (req, res, next) => {
  try {
    const roomId = roomIdFrom(req.params.roomId);
    await requireRole(roomId, req.user!.id, ["OWNER", "EDITOR", "VIEWER"]);
    const messages = await client.chat.findMany({
      where: { roomId },
      orderBy: { id: "asc" },
      take: 2000,
      select: { id: true, message: true, roomId: true, userId: true },
    });
    res.json({ messages });
  } catch (error) {
    next(error);
  }
});

router.get("/room/:roomId/canvas", async (req, res, next) => {
  try {
    const roomId = roomIdFrom(req.params.roomId);
    await requireRole(roomId, req.user!.id, ["OWNER", "EDITOR", "VIEWER"]);
    const rawRevision = req.query.afterRevision;
    let afterRevision: number | undefined;
    if (rawRevision !== undefined) {
      if (typeof rawRevision !== "string" || !/^\d+$/.test(rawRevision))
        throw new AppError(400, "Invalid canvas revision", "INVALID_REVISION");
      afterRevision = Number(rawRevision);
      if (!Number.isSafeInteger(afterRevision))
        throw new AppError(400, "Invalid canvas revision", "INVALID_REVISION");
    }
    const canvas = await getCanvasSync(roomId, afterRevision);
    if (!canvas)
      throw new AppError(404, "Canvas not found", "CANVAS_NOT_FOUND");
    res.json(canvas);
  } catch (error) {
    next(error);
  }
});

router.delete("/room/delete/content/:roomId", async (req, res, next) => {
  try {
    const roomId = roomIdFrom(req.params.roomId);
    await requireRole(roomId, req.user!.id, ["OWNER"]);
    const response = await client.$transaction(async (tx) => {
      const [canvas] = await tx.$queryRaw<Array<{ id: number }>>`
        SELECT "id" FROM "Canvas" WHERE "roomId" = ${roomId} FOR UPDATE
      `;
      const deletedChat = await tx.chat.deleteMany({ where: { roomId } });
      if (canvas) {
        await tx.canvasElement.deleteMany({ where: { canvasId: canvas.id } });
        await tx.canvasSnapshot.deleteMany({ where: { canvasId: canvas.id } });
        const updated = await tx.canvas.update({
          where: { id: canvas.id },
          data: { revision: { increment: 1 } },
          select: { revision: true },
        });
        await tx.canvasOperation.create({
          data: {
            operationId: `clear-${randomUUID()}`,
            canvasId: canvas.id,
            revision: updated.revision,
            actorId: req.user!.id,
            kind: "clear",
            payload: {},
          },
        });
      }
      return deletedChat;
    });
    res.json({ message: "Content deleted successfully.", response });
  } catch (error) {
    next(error);
  }
});

router.delete("/room/delete/:roomId", async (req, res, next) => {
  try {
    const roomId = roomIdFrom(req.params.roomId);
    await requireRole(roomId, req.user!.id, ["OWNER"]);
    const room = await client.room.findUnique({ where: { id: roomId } });
    if (!room) throw new AppError(404, "Room not found", "ROOM_NOT_FOUND");
    await client.$transaction([
      client.chat.deleteMany({ where: { roomId } }),
      client.room.delete({ where: { id: roomId } }),
    ]);
    res.json({
      message: `Room ${room.slug} and data associated content items deleted successfully.`,
      room,
    });
  } catch (error) {
    next(error);
  }
});

router.patch("/room/:roomId/visibility", async (req, res, next) => {
  const body = z
    .object({ visibility: z.enum(["PUBLIC", "PRIVATE"]) })
    .safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ message: "Invalid visibility" });
    return;
  }
  try {
    const roomId = roomIdFrom(req.params.roomId);
    await requireRole(roomId, req.user!.id, ["OWNER"]);
    const room = await client.room.update({
      where: { id: roomId },
      data: body.data,
    });
    res.json({ room });
  } catch (error) {
    next(error);
  }
});

router.post("/room/:roomId/members", async (req, res, next) => {
  const body = z
    .object({
      userId: z.number().int().positive(),
      role: z.enum(["EDITOR", "VIEWER"]),
    })
    .safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ message: "Invalid member details" });
    return;
  }
  try {
    const roomId = roomIdFrom(req.params.roomId);
    await requireRole(roomId, req.user!.id, ["OWNER"]);
    const existing = await client.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId: body.data.userId } },
      select: { role: true },
    });
    if (existing?.role === "OWNER")
      throw new AppError(
        400,
        "The room owner role cannot be changed",
        "OWNER_REQUIRED",
      );
    const member = await client.roomMember.upsert({
      where: { roomId_userId: { roomId, userId: body.data.userId } },
      create: { roomId, userId: body.data.userId, role: body.data.role },
      update: { role: body.data.role },
      select: { roomId: true, userId: true, role: true, createdAt: true },
    });
    res.json({ member });
  } catch (error) {
    next(error);
  }
});

router.delete("/room/:roomId/members/:userId", async (req, res, next) => {
  try {
    const roomId = roomIdFrom(req.params.roomId);
    const userId = roomIdFrom(req.params.userId);
    await requireRole(roomId, req.user!.id, ["OWNER"]);
    const member = await client.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId } },
      select: { role: true },
    });
    if (!member)
      throw new AppError(404, "Room member not found", "MEMBER_NOT_FOUND");
    if (member.role === "OWNER")
      throw new AppError(
        400,
        "The room owner cannot be removed",
        "OWNER_REQUIRED",
      );
    await client.roomMember.delete({
      where: { roomId_userId: { roomId, userId } },
    });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export default router;

import { Router, type Router as ExpressRouter } from "express";
import { client } from "@repo/db/client";
import { RoomSchema } from "@repo/common/schemas";
import { auth } from "../../middleware/auth.js";
import { AppError } from "../../errors.js";

const router: ExpressRouter = Router();
router.use(auth);
router.post("/room", async (req, res, next) => {
  const input = RoomSchema.safeParse(req.body);
  if (!input.success) {
    res
      .status(400)
      .json({ message: "Incorrect Inputs", errors: input.error.flatten() });
    return;
  }
  try {
    const room = await client.room.create({
      data: {
        adminId: Number(req.userId),
        slug: input.data.roomName,
        members: { create: { userId: Number(req.userId), role: "OWNER" } },
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
      where: { adminId: Number(req.userId) },
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
    res.json({ room });
  } catch (error) {
    next(error);
  }
});
router.get("/room/:roomId", async (req, res, next) => {
  const roomId = Number(req.params.roomId);
  if (!Number.isSafeInteger(roomId) || roomId < 1) {
    res.status(400).json({ message: "Invalid room ID" });
    return;
  }
  try {
    const messages = await client.chat.findMany({
      where: { roomId },
      orderBy: { id: "asc" },
      take: 2000,
    });
    res.json({ messages });
  } catch (error) {
    next(error);
  }
});
router.delete("/room/delete/content/:roomId", async (req, res, next) => {
  const roomId = Number(req.params.roomId);
  if (!Number.isSafeInteger(roomId) || roomId < 1) {
    res.status(400).json({ message: "Invalid room ID" });
    return;
  }
  try {
    const room = await client.canvas.findUnique({
      where: { roomId },
      select: { id: true },
    });
    const [response] = await client.$transaction([
      client.chat.deleteMany({ where: { roomId } }),
      ...(room
        ? [
            client.canvasElement.deleteMany({ where: { canvasId: room.id } }),
            client.canvasOperation.deleteMany({ where: { canvasId: room.id } }),
            client.canvasSnapshot.deleteMany({ where: { canvasId: room.id } }),
          ]
        : []),
    ]);
    res.json({ message: "Content deleted successfully.", response });
  } catch (error) {
    next(error);
  }
});
router.delete("/room/delete/:roomId", async (req, res, next) => {
  const roomId = Number(req.params.roomId);
  if (!Number.isSafeInteger(roomId) || roomId < 1) {
    res.status(400).json({ message: "Invalid room ID" });
    return;
  }
  try {
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
export default router;

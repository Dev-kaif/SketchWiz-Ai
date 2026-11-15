import { WebSocketMessageSchema } from "@repo/common/schemas";
import { client, joinPublicRoom, type RoomRole } from "@repo/db/access";
import type { Connection, RoomMembership } from "./rooms.js";
import { broadcast } from "./broadcast.js";
import type { RawData } from "ws";

type RawQueryTransaction = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
};

function rawToString(raw: RawData) {
  if (typeof raw === "string") return raw;
  if (Buffer.isBuffer(raw)) return raw.toString("utf8");
  if (Array.isArray(raw)) return Buffer.concat(raw).toString("utf8");
  return Buffer.from(raw).toString("utf8");
}

export function parseSocketMessage(raw: string) {
  try {
    return WebSocketMessageSchema.safeParse(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function roomRoles(
  roomId: number,
  userIds: number[],
  transaction: RawQueryTransaction,
) {
  const placeholders = userIds.map((_, index) => `$${index + 2}`).join(", ");
  return transaction.$queryRawUnsafe<Array<{ userId: number; role: RoomRole }>>(
    `SELECT "userId", "role" FROM "RoomMember" WHERE "roomId" = $1 AND "userId" IN (${placeholders}) FOR SHARE`,
    roomId,
    ...userIds,
  );
}

function connectedUserIds(
  memberships: RoomMembership,
  roomId: number,
  senderId: number,
) {
  return [
    ...new Set([
      senderId,
      ...[...memberships.room(roomId)].map((connection) => connection.userId),
    ]),
  ];
}

function roleMap(rows: Array<{ userId: number; role: RoomRole }>) {
  return new Map(rows.map(({ userId, role }) => [userId, role]));
}

export async function handleMessage(
  connection: Connection,
  memberships: RoomMembership,
  raw: RawData,
) {
  const result = parseSocketMessage(rawToString(raw));
  if (!result?.success) return;

  const message = result.data;
  if (message.type === "join_room") {
    const role = await joinPublicRoom(message.roomId, connection.userId);
    if (!role) {
      memberships.leave(connection, message.roomId);
      return;
    }
    memberships.join(connection, message.roomId);
    connection.roles.set(message.roomId, role);
    return;
  }
  if (message.type === "leave_room") {
    memberships.leave(connection, message.roomId);
    return;
  }
  if (!connection.rooms.has(message.roomId)) return;

  const userIds = connectedUserIds(
    memberships,
    message.roomId,
    connection.userId,
  );
  if (message.type === "chat") {
    const storedMessage = JSON.stringify(message.message);
    const { roles, senderRole } = await client.$transaction(async (tx) => {
      const rows = await roomRoles(message.roomId, userIds, tx);
      const roles = roleMap(rows);
      const senderRole = roles.get(connection.userId) ?? null;
      if (!senderRole || senderRole === "VIEWER") return { roles, senderRole };

      const chat = await tx.chat.create({
        data: {
          roomId: message.roomId,
          message: storedMessage,
          userId: connection.userId,
        },
        select: { id: true },
      });
      const shape =
        message.message && typeof message.message === "object"
          ? (message.message as Record<string, unknown>)
          : null;
      if (
        shape &&
        typeof shape.id === "string" &&
        typeof shape.type === "string" &&
        !(
          shape.type === "image" &&
          typeof shape.src === "string" &&
          shape.src.startsWith("data:")
        )
      ) {
        const current = await tx.canvas.update({
          where: { roomId: message.roomId },
          data: { revision: { increment: 1 } },
          select: { id: true, revision: true },
        });
        const elementId = `${current.id}:${shape.id}`;
        await tx.canvasElement.upsert({
          where: { id: elementId },
          create: {
            id: elementId,
            canvasId: current.id,
            revision: current.revision,
            properties: shape as object,
          },
          update: { revision: current.revision, properties: shape as object },
        });
        await tx.canvasOperation.create({
          data: {
            operationId: `chat-${chat.id}`,
            canvasId: current.id,
            revision: current.revision,
            actorId: connection.userId,
            kind: "upsert_element",
            payload: shape as object,
          },
        });
      }
      return { roles, senderRole };
    });

    if (!senderRole) {
      memberships.leave(connection, message.roomId);
      return;
    }
    connection.roles.set(message.roomId, senderRole);
    if (senderRole === "VIEWER") return;
    broadcast(
      memberships,
      message.roomId,
      { type: "chat", message: message.message, roomId: message.roomId },
      roles,
      new Set(userIds),
      connection.socket,
    );
    return;
  }

  const rows = await client.$transaction((tx) =>
    roomRoles(message.roomId, userIds, tx),
  );
  const roles = roleMap(rows);
  const senderRole = roles.get(connection.userId);
  if (!senderRole) {
    memberships.leave(connection, message.roomId);
    return;
  }
  connection.roles.set(message.roomId, senderRole);
  broadcast(
    memberships,
    message.roomId,
    { type: "ai", message: message.message, roomId: message.roomId },
    roles,
    new Set(userIds),
  );
}

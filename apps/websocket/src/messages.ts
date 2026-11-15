import { WebSocketMessageSchema } from "@repo/common/schemas";
import { client } from "@repo/db/client";
import { logger } from "@repo/backend/logger";
import type { Connection, RoomMembership } from "./rooms.js";
import { broadcast } from "./broadcast.js";
import type { RawData } from "ws";

export function parseSocketMessage(raw: string) {
  try {
    return WebSocketMessageSchema.safeParse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function handleMessage(
  connection: Connection,
  memberships: RoomMembership,
  raw: RawData,
) {
  const result = parseSocketMessage(raw.toString());
  if (!result) {
    logger.warn("Invalid WebSocket JSON", { userId: connection.userId });
    return;
  }
  if (!result.success) {
    logger.warn("Invalid WebSocket message", {
      userId: connection.userId,
      issues: result.error.issues.length,
    });
    return;
  }
  const message = result.data;
  if (message.type === "join_room") {
    memberships.join(connection, message.roomId);
    return;
  }
  if (message.type === "leave_room") {
    memberships.leave(connection, message.roomId);
    return;
  }
  if (!connection.rooms.has(message.roomId)) return;
  if (message.type === "chat") {
    const storedMessage = JSON.stringify(message.message);
    await client.$transaction(async (tx) => {
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
        !shape ||
        typeof shape.id !== "string" ||
        typeof shape.type !== "string"
      )
        return;
      // Keep legacy compatibility for data URLs without tripling binary data in PostgreSQL.
      if (
        shape.type === "image" &&
        typeof shape.src === "string" &&
        shape.src.startsWith("data:")
      )
        return;
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
    });
    broadcast(
      memberships,
      message.roomId,
      { type: "chat", message: message.message, roomId: message.roomId },
      connection.socket,
    );
  } else {
    broadcast(memberships, message.roomId, {
      type: "ai",
      message: message.message,
      roomId: message.roomId,
    });
  }
}

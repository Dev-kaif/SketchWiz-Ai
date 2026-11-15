import { WebSocketMessageSchema } from "@repo/common/schemas";
import { client, joinPublicRoom, type RoomRole } from "@repo/db/access";
import {
  getCanvasSync,
  persistCanvasMutations,
  type CanvasMutation,
} from "@repo/db/canvas";
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

function connectedUserIds(
  memberships: RoomMembership,
  roomId: number,
  senderId: number,
) {
  return [
    ...new Set([
      senderId,
      ...[...memberships.room(roomId)].map((member) => member.userId),
    ]),
  ];
}

async function authorizedRoomRoles(
  roomId: number,
  userIds: number[],
  transaction: RawQueryTransaction,
) {
  const placeholders = userIds.map((_, index) => `$${index + 2}`).join(", ");
  const rows = await transaction.$queryRawUnsafe<
    Array<{ userId: number; role: RoomRole }>
  >(
    `SELECT "userId", "role" FROM "RoomMember" WHERE "roomId" = $1 AND "userId" IN (${placeholders}) FOR SHARE`,
    roomId,
    ...userIds,
  );
  return new Map(rows.map((row) => [row.userId, row.role]));
}

async function currentRoomRoles(roomId: number, userIds: number[]) {
  return client.$transaction((tx) => authorizedRoomRoles(roomId, userIds, tx));
}

function send(socket: Connection["socket"], payload: unknown) {
  if (socket.readyState === 1) socket.send(JSON.stringify(payload));
}

function throttleEphemeral(connection: Connection, roomId: number) {
  const now = Date.now();
  const last = connection.lastEphemeralAt.get(roomId) ?? 0;
  if (now - last < 50) return false;
  connection.lastEphemeralAt.set(roomId, now);
  return true;
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

  const activeUserIds = connectedUserIds(
    memberships,
    message.roomId,
    connection.userId,
  );

  if (message.type === "canvas:sync") {
    const roles = await currentRoomRoles(message.roomId, activeUserIds);
    const role = roles.get(connection.userId);
    if (!role) {
      memberships.leave(connection, message.roomId);
      return;
    }
    connection.roles.set(message.roomId, role);
    const state = await getCanvasSync(message.roomId, message.afterRevision);
    if (state)
      send(connection.socket, {
        type: "canvas:sync",
        roomId: message.roomId,
        ...state,
      });
    return;
  }

  if (message.type === "canvas:preview" || message.type === "presence:update") {
    if (!throttleEphemeral(connection, message.roomId)) return;
    const roles = await currentRoomRoles(message.roomId, activeUserIds);
    const role = roles.get(connection.userId);
    if (!role) {
      memberships.leave(connection, message.roomId);
      return;
    }
    connection.roles.set(message.roomId, role);
    if (message.type === "canvas:preview" && role === "VIEWER") return;
    const payload =
      message.type === "canvas:preview"
        ? {
            type: message.type,
            roomId: message.roomId,
            preview: message.preview,
            userId: connection.userId,
          }
        : {
            type: message.type,
            roomId: message.roomId,
            presence: message.presence,
            userId: connection.userId,
          };
    broadcast(
      memberships,
      message.roomId,
      payload,
      roles,
      new Set(activeUserIds),
    );
    return;
  }

  if (message.type === "ai") {
    const roles = await currentRoomRoles(message.roomId, activeUserIds);
    const role = roles.get(connection.userId);
    if (!role) {
      memberships.leave(connection, message.roomId);
      return;
    }
    connection.roles.set(message.roomId, role);
    broadcast(
      memberships,
      message.roomId,
      {
        type: "ai",
        message: message.message,
        roomId: message.roomId,
      },
      roles,
      new Set(activeUserIds),
    );
    return;
  }

  if (message.type === "chat") {
    const shape =
      message.message && typeof message.message === "object"
        ? (message.message as Record<string, unknown>)
        : null;
    const legacyMutation: CanvasMutation[] =
      shape &&
      typeof shape.id === "string" &&
      typeof shape.type === "string" &&
      !(
        shape.type === "image" &&
        typeof shape.src === "string" &&
        shape.src.startsWith("data:")
      )
        ? [{ kind: "update", operationId: "legacy-pending", element: shape }]
        : [];
    const persisted = await persistCanvasMutations({
      roomId: message.roomId,
      userId: connection.userId,
      activeUserIds,
      mutations: legacyMutation,
      legacyMessage: message.message,
    });
    if (!persisted.allowed) {
      if (!persisted.role) memberships.leave(connection, message.roomId);
      return;
    }
    connection.roles.set(message.roomId, persisted.role!);
    broadcast(
      memberships,
      message.roomId,
      {
        type: "chat",
        message: message.message,
        roomId: message.roomId,
      },
      persisted.roles,
      new Set(activeUserIds),
      connection.socket,
    );
    return;
  }

  let mutations: CanvasMutation[];
  if (message.type === "canvas:create" || message.type === "canvas:update") {
    mutations = [
      {
        kind: message.type === "canvas:create" ? "create" : "update",
        operationId: message.operationId,
        element: message.element,
      },
    ];
  } else if (message.type === "canvas:delete") {
    mutations = [
      {
        kind: "delete",
        operationId: message.operationId,
        elementId: message.elementId,
      },
    ];
  } else {
    mutations = message.operations;
  }

  const persisted = await persistCanvasMutations({
    roomId: message.roomId,
    userId: connection.userId,
    activeUserIds,
    mutations,
    expectedRevision:
      message.type === "canvas:batch" ? message.expectedRevision : undefined,
  });
  if (!persisted.allowed) {
    if (!persisted.role) memberships.leave(connection, message.roomId);
    if (persisted.conflict) {
      send(connection.socket, {
        type: "canvas:ack",
        roomId: message.roomId,
        error: "operation_conflict",
      });
    }
    return;
  }

  connection.roles.set(message.roomId, persisted.role!);
  send(connection.socket, {
    type: "canvas:ack",
    roomId: message.roomId,
    operationIds: persisted.results,
    revision: persisted.revision,
  });
  if (persisted.operations.length === 0) return;
  if (message.type === "canvas:batch") {
    broadcast(
      memberships,
      message.roomId,
      {
        type: "canvas:batch",
        roomId: message.roomId,
        operations: persisted.operations,
      },
      persisted.roles,
      new Set(activeUserIds),
      connection.socket,
    );
  } else {
    const operation = persisted.operations[0]!;
    const eventType =
      operation.kind === "delete"
        ? "canvas:delete"
        : operation.kind === "create"
          ? "canvas:create"
          : "canvas:update";
    broadcast(
      memberships,
      message.roomId,
      {
        type: eventType,
        roomId: message.roomId,
        ...operation,
      },
      persisted.roles,
      new Set(activeUserIds),
      connection.socket,
    );
  }
}

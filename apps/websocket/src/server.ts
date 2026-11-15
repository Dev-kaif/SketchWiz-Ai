import { WebSocket, WebSocketServer, type RawData } from "ws";
import { websocketEnv } from "@repo/backend/env";
import { logger } from "@repo/backend/logger";
import { FixedWindowLimiter } from "@repo/backend/config";
import { authenticate, closeUnauthenticated } from "./auth.js";
import { RoomMembership, type Connection } from "./rooms.js";
import { handleMessage } from "./messages.js";

const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_PENDING_BYTES = 20 * 1024 * 1024;

function closeAfterQueue(connection: Connection, code: number, reason: string) {
  if (connection.closingForBackpressure) return;
  connection.closingForBackpressure = true;
  connection.closeCode = code;
  connection.closeReason = reason;
  if (
    !connection.processing &&
    connection.queue.length === 0 &&
    connection.socket.readyState === WebSocket.OPEN
  ) {
    connection.socket.close(code, reason);
  }
}

function rawByteLength(raw: RawData) {
  if (Buffer.isBuffer(raw)) return raw.byteLength;
  if (Array.isArray(raw))
    return raw.reduce((total, chunk) => total + chunk.byteLength, 0);
  return raw.byteLength;
}

function enqueueMessage(
  connection: Connection,
  memberships: RoomMembership,
  raw: RawData,
) {
  if (connection.closingForBackpressure) return;
  const bytes = rawByteLength(raw);
  if (connection.queuedBytes + bytes > MAX_PENDING_BYTES) {
    // Drain this received frame and the existing queue, then request a resync.
    // At most one frame can take the queue over its configured byte ceiling.
    connection.closingForBackpressure = true;
    connection.closeCode = 1013;
    connection.closeReason = "Server busy; reconnect to sync";
  }
  connection.queue.push({ raw, bytes });
  connection.queuedBytes += bytes;
  if (connection.processing) return;
  connection.processing = true;

  void (async () => {
    while (connection.queue.length > 0) {
      if (connection.socket.readyState !== WebSocket.OPEN) {
        connection.queue.length = 0;
        connection.queuedBytes = 0;
        break;
      }
      const item = connection.queue.shift()!;
      connection.queuedBytes -= item.bytes;
      try {
        await handleMessage(connection, memberships, item.raw);
      } catch (error) {
        logger.error("WebSocket message handling failed", {
          userId: connection.userId,
          errorName: error instanceof Error ? error.name : "unknown",
        });
      }
    }
    connection.processing = false;
    if (connection.closingForBackpressure) {
      connection.socket.close(
        connection.closeCode ?? 1013,
        connection.closeReason ?? "Reconnect to sync",
      );
    }
  })();
}

export function createWebSocketServer(
  options: { port?: number; host?: string } = {},
) {
  const env = websocketEnv();
  const wss = new WebSocketServer({
    host: options.host ?? env.HOST,
    port: options.port ?? env.PORT,
    maxPayload: env.WS_MAX_PAYLOAD_BYTES,
  });
  const memberships = new RoomMembership();
  const messageLimiter = new FixedWindowLimiter(
    env.WS_MESSAGE_RATE_LIMIT,
    env.WS_MESSAGE_RATE_WINDOW_MS,
  );
  const alive = new WeakMap<WebSocket, boolean>();
  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      if (alive.get(socket) === false) {
        socket.terminate();
        continue;
      }
      alive.set(socket, false);
      try {
        socket.ping();
      } catch {
        socket.terminate();
      }
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();
  wss.on("close", () => clearInterval(heartbeat));
  wss.on("connection", (socket, request) => {
    const url = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? "localhost"}`,
    );
    const userId = authenticate(url.searchParams.get("token"));
    if (!userId) {
      closeUnauthenticated(socket);
      return;
    }
    const connection: Connection = {
      socket,
      userId,
      rooms: new Set(),
      roles: new Map(),
      queue: [],
      queuedBytes: 0,
      processing: false,
      closingForBackpressure: false,
    };
    alive.set(socket, true);
    socket.on("pong", () => alive.set(socket, true));
    logger.info("WebSocket connected", { userId });
    socket.on("message", (raw) => {
      if (connection.closingForBackpressure) return;
      if (!messageLimiter.consume(String(userId)).allowed) {
        closeAfterQueue(connection, 1008, "Message rate limit exceeded");
        return;
      }
      enqueueMessage(connection, memberships, raw);
    });
    socket.on("close", () => {
      connection.queue.length = 0;
      connection.queuedBytes = 0;
      memberships.remove(connection);
      logger.info("WebSocket disconnected", { userId });
    });
    socket.on("error", (error) =>
      logger.warn("WebSocket connection error", {
        userId,
        error: error.message,
      }),
    );
  });
  wss.on("listening", () => {
    const address = wss.address();
    logger.info("WebSocket server listening", {
      host: typeof address === "object" && address ? address.address : env.HOST,
      port: typeof address === "object" && address ? address.port : env.PORT,
    });
  });
  return wss;
}

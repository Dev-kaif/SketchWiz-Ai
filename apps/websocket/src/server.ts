import { WebSocketServer } from "ws";
import { websocketEnv } from "@repo/backend/env";
import { logger } from "@repo/backend/logger";
import { FixedWindowLimiter } from "@repo/backend/config";
import { authenticate, closeUnauthenticated } from "./auth.js";
import { RoomMembership, type Connection } from "./rooms.js";
import { handleMessage } from "./messages.js";

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
    };
    logger.info("WebSocket connected", { userId });
    socket.on("message", (raw) => {
      if (!messageLimiter.consume(String(userId)).allowed) {
        socket.close(1008, "Message rate limit exceeded");
        return;
      }
      void handleMessage(connection, memberships, raw).catch((error) =>
        logger.error("WebSocket message handling failed", {
          userId,
          errorName: error instanceof Error ? error.name : "unknown",
        }),
      );
    });
    socket.on("close", () => {
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

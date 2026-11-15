import { WebSocketServer } from "ws";
import { websocketEnv } from "@repo/backend/env";
import { logger } from "@repo/backend/logger";
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
    // Match ws's established 100 MiB default; legacy image messages can be data URLs.
    maxPayload: 100 * 1024 * 1024,
  });
  const memberships = new RoomMembership();
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
    const connection: Connection = { socket, userId, rooms: new Set() };
    logger.info("WebSocket connected", { userId });
    socket.on("message", (raw) => {
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
      host:
        typeof address === "object" && address ? address.address : env.HOST,
      port: typeof address === "object" && address ? address.port : env.PORT,
    });
  });
  return wss;
}

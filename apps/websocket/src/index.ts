import "@repo/backend/env";
import { createWebSocketServer } from "./server.js";
import { websocketEnv } from "@repo/backend/env";
import { logger } from "@repo/backend/logger";
import { client, disconnectDatabase } from "@repo/db/client";

const env = websocketEnv();
let wss: ReturnType<typeof createWebSocketServer> | undefined;
let closing = false;

async function start() {
  await client.$connect();
  wss = createWebSocketServer({ port: env.PORT, host: env.HOST });
}

async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  logger.info("WebSocket shutdown requested", { signal });
  for (const socket of wss?.clients ?? [])
    socket.close(1001, "Server shutting down");
  if (!wss) {
    await disconnectDatabase();
    process.exit(0);
  }
  wss.close(async () => {
    await disconnectDatabase();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
void start().catch((error) => {
  logger.error("WebSocket startup failed", {
    errorName: error instanceof Error ? error.name : "unknown",
  });
  process.exit(1);
});

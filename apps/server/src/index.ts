import "@repo/backend/env";
import { createApp } from "./app.js";
import { serverEnv } from "@repo/backend/env";
import { logger } from "@repo/backend/logger";
import { client, disconnectDatabase } from "@repo/db/client";

const env = serverEnv();
const app = createApp(env.CORS_ORIGINS);
let server: ReturnType<typeof app.listen> | undefined;
let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  logger.info("Shutdown requested", { signal });
  if (!server) {
    await disconnectDatabase();
    process.exit(0);
  }
  server.close(async (error) => {
    if (error)
      logger.error("HTTP server close failed", { error: error.message });
    await disconnectDatabase();
    process.exit(error ? 1 : 0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
void client
  .$connect()
  .then(() => {
    server = app.listen(env.PORT, env.HOST, () =>
      logger.info("HTTP server listening", { host: env.HOST, port: env.PORT }),
    );
  })
  .catch((error) => {
    logger.error("Database connection failed", {
      errorName: error instanceof Error ? error.name : "unknown",
    });
    process.exit(1);
  });

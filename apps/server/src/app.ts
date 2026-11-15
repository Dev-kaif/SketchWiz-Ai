import express, { type Express } from "express";
import cors from "cors";
import authRoutes from "./modules/auth/routes.js";
import roomRoutes from "./modules/rooms/routes.js";
import aiRoutes from "./modules/ai/routes.js";
import { errorHandler } from "./middleware/errors.js";
import { logger } from "@repo/backend/logger";

export function createApp(
  corsOrigins = process.env.CORS_ORIGINS ?? "*",
): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use(
    cors({
      origin:
        corsOrigins === "*"
          ? "*"
          : corsOrigins.split(",").map((value) => value.trim()),
    }),
  );
  app.use((req, res, next) => {
    const started = performance.now();
    res.on("finish", () =>
      logger.info("http request", {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Math.round(performance.now() - started),
      }),
    );
    next();
  });
  app.get("/api/ping", (_req, res) => {
    res.status(200).send("pong");
  });
  app.use("/api", authRoutes);
  app.use("/api", roomRoutes);
  app.use("/api", aiRoutes);
  app.use((_req, res) => {
    res.status(404).json({ message: "Not found" });
  });
  app.use(errorHandler);
  return app;
}

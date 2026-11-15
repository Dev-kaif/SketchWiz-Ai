import express, { type Express } from "express";
import cors from "cors";
import authRoutes from "./modules/auth/routes.js";
import roomRoutes from "./modules/rooms/routes.js";
import aiRoutes from "./modules/ai/routes.js";
import { errorHandler } from "./middleware/errors.js";
import { logger } from "@repo/backend/logger";
import { FixedWindowLimiter } from "@repo/backend/config";

export function createApp(
  corsOrigins = process.env.CORS_ORIGINS ?? "*",
): Express {
  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()",
    );
    if (process.env.NODE_ENV === "production") {
      res.setHeader(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains",
      );
    }
    next();
  });
  app.use(express.json({ limit: "1mb" }));
  app.use(
    cors({
      origin:
        corsOrigins.trim() === "*"
          ? "*"
          : corsOrigins
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean),
    }),
  );
  const authLimiter = new FixedWindowLimiter(20, 60_000);
  app.use((req, res, next) => {
    if (req.path !== "/api/signin" && req.path !== "/api/signup") return next();
    const result = authLimiter.consume(req.ip ?? "unknown");
    if (!result.allowed) {
      res.setHeader(
        "Retry-After",
        String(Math.ceil(result.retryAfterMs / 1000)),
      );
      res.status(429).json({ message: "Too many authentication attempts" });
      return;
    }
    next();
  });
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

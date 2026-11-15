import type { ErrorRequestHandler } from "express";
import { AppError } from "../errors.js";
import { logger } from "@repo/backend/logger";
export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  void _next;
  if (error instanceof AppError) {
    res.status(error.status).json({ message: error.message, code: error.code });
    return;
  }
  logger.error("Unhandled HTTP error", {
    errorName: error instanceof Error ? error.name : "unknown",
  });
  res.status(500).json({ message: "Internal server error" });
};

import type { ErrorRequestHandler } from "express";
import { AppError } from "../errors.js";
import { logger } from "@repo/backend/logger";
export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  void _next;
  if (error instanceof AppError) {
    res.status(error.status).json({ message: error.message, code: error.code });
    return;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === 413
  ) {
    res.status(413).json({
      message: "Request payload is too large",
      code: "PAYLOAD_TOO_LARGE",
    });
    return;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "MulterError" &&
    "code" in error &&
    error.code === "LIMIT_FILE_SIZE"
  ) {
    res.status(413).json({
      message: "Uploaded image exceeds the 10 MB limit",
      code: "PAYLOAD_TOO_LARGE",
    });
    return;
  }
  if (
    error instanceof SyntaxError &&
    "status" in error &&
    error.status === 400
  ) {
    res
      .status(400)
      .json({ message: "Malformed JSON request", code: "INVALID_JSON" });
    return;
  }
  const prismaError =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : undefined;
  const prismaTarget =
    typeof error === "object" && error !== null && "meta" in error
      ? (error.meta as { modelName?: unknown; target?: unknown } | undefined)
      : undefined;
  logger.error("Unhandled HTTP error", {
    errorName: error instanceof Error ? error.name : "unknown",
    ...(prismaError ? { errorCode: prismaError } : {}),
    ...(prismaTarget?.modelName
      ? { model: String(prismaTarget.modelName) }
      : {}),
    method: req.method,
    path: req.originalUrl.split("?")[0],
  });
  res.status(500).json({ message: "Internal server error" });
};

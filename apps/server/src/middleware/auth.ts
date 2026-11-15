import type { NextFunction, Request, Response } from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { serverEnv } from "@repo/backend/env";
declare global {
  // Express uses declaration merging to add authenticated request state.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}
export function auth(
  req: Request & { userId?: string },
  res: Response,
  next: NextFunction,
) {
  const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  if (!token) {
    res.status(401).json({ error: "No token provided" });
    return;
  }
  try {
    const decoded = jwt.verify(token, serverEnv().JWT_SECRET) as JwtPayload;
    if (decoded.id === undefined) {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }
    req.userId = String(decoded.id);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

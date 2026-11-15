import type { NextFunction, Request, Response } from "express";
import {
  verifyAccessToken,
  type AuthenticatedUser,
} from "@repo/backend/config";
import { serverEnv } from "@repo/backend/env";
declare global {
  // Express uses declaration merging to add authenticated request state.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}
export function auth(req: Request, res: Response, next: NextFunction) {
  const token = (req.headers.authorization ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!token) {
    res.status(401).json({ error: "No token provided" });
    return;
  }
  try {
    const user = verifyAccessToken(token, serverEnv().JWT_SECRET);
    if (!user) {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

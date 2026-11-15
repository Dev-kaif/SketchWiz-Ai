import jwt, { type JwtPayload } from "jsonwebtoken";
import type WebSocket from "ws";
import { websocketEnv } from "@repo/backend/env";
export function authenticate(token: string | null): number | null {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, websocketEnv().JWT_SECRET) as JwtPayload;
    const id = Number(payload.id);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}
export function closeUnauthenticated(socket: WebSocket) {
  socket.close(1008, "Authentication required");
}

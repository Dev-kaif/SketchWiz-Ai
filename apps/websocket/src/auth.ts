import type WebSocket from "ws";
import { websocketEnv } from "@repo/backend/env";
import { verifyAccessToken } from "@repo/backend/config";
export function authenticate(token: string | null): number | null {
  if (!token) return null;
  try {
    return verifyAccessToken(token, websocketEnv().JWT_SECRET)?.id ?? null;
  } catch {
    return null;
  }
}
export function closeUnauthenticated(socket: WebSocket) {
  socket.close(1008, "Authentication required");
}

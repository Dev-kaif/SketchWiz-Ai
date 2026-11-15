import WebSocket from "ws";
import type { RoomMembership } from "./rooms.js";
export function broadcast(
  memberships: RoomMembership,
  roomId: number,
  payload: unknown,
  except?: WebSocket,
) {
  const data = JSON.stringify(payload);
  for (const member of memberships.room(roomId))
    if (member.socket !== except && member.socket.readyState === WebSocket.OPEN)
      member.socket.send(data);
}

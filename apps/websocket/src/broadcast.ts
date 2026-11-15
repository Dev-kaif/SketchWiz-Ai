import WebSocket from "ws";
import type { RoomRole } from "@repo/db/access";
import type { RoomMembership } from "./rooms.js";

const MAX_BUFFERED_BYTES = 1024 * 1024;

export function broadcast(
  memberships: RoomMembership,
  roomId: number,
  payload: unknown,
  roles: ReadonlyMap<number, RoomRole>,
  checkedUserIds: ReadonlySet<number>,
  except?: WebSocket,
  exceptUserId?: number,
) {
  const recipients = [];
  for (const member of memberships.room(roomId)) {
    // A socket can join while a message is awaiting its DB transaction.
    // It was not part of this snapshot, so leave it for the next event.
    if (!checkedUserIds.has(member.userId)) continue;
    const role = roles.get(member.userId);
    if (!role) {
      memberships.leave(member, roomId);
      continue;
    }
    member.roles.set(roomId, role);
    if (
      member.socket === except ||
      member.userId === exceptUserId ||
      member.socket.readyState !== WebSocket.OPEN
    )
      continue;
    if (member.socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      memberships.leave(member, roomId);
      member.socket.close(1013, "Slow connection; reconnect to sync");
      continue;
    }
    recipients.push(member.socket);
  }
  if (recipients.length === 0) return;

  const data = JSON.stringify(payload);
  for (const socket of recipients) {
    try {
      socket.send(data, (error) => {
        if (error) socket.terminate();
      });
    } catch {
      socket.terminate();
    }
  }
}

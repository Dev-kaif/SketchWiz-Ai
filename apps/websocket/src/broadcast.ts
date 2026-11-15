import WebSocket from "ws";
import { client } from "@repo/db/client";
import type { RoomMembership } from "./rooms.js";
export async function broadcast(
  memberships: RoomMembership,
  roomId: number,
  payload: unknown,
  except?: WebSocket,
) {
  const data = JSON.stringify(payload);
  const connections = [...memberships.room(roomId)];
  if (connections.length === 0) return;
  const userIds = [
    ...new Set(connections.map((connection) => connection.userId)),
  ];
  const activeMembers = await client.roomMember.findMany({
    where: { roomId, userId: { in: userIds } },
    select: { userId: true, role: true },
  });
  const roles = new Map(
    activeMembers.map(({ userId, role }) => [userId, role]),
  );
  for (const member of connections) {
    const role = roles.get(member.userId);
    if (!role) {
      memberships.leave(member, roomId);
      continue;
    }
    member.roles.set(roomId, role);
    if (member.socket !== except && member.socket.readyState === WebSocket.OPEN)
      member.socket.send(data);
  }
}

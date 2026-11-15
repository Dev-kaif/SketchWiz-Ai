import type WebSocket from "ws";
import type { RawData } from "ws";
import type { RoomRole } from "@repo/db/access";
export type QueuedMessage = { raw: RawData; bytes: number };
export type Connection = {
  socket: WebSocket;
  userId: number;
  rooms: Set<number>;
  roles: Map<number, RoomRole>;
  queue: QueuedMessage[];
  queuedBytes: number;
  processing: boolean;
  closingForBackpressure: boolean;
  closeCode?: number;
  closeReason?: string;
};
export class RoomMembership {
  private members = new Map<number, Set<Connection>>();
  join(connection: Connection, roomId: number) {
    connection.rooms.add(roomId);
    let group = this.members.get(roomId);
    if (!group) {
      group = new Set();
      this.members.set(roomId, group);
    }
    group.add(connection);
  }
  leave(connection: Connection, roomId: number) {
    connection.rooms.delete(roomId);
    connection.roles.delete(roomId);
    const group = this.members.get(roomId);
    group?.delete(connection);
    if (group?.size === 0) this.members.delete(roomId);
  }
  remove(connection: Connection) {
    for (const id of connection.rooms) this.leave(connection, id);
  }
  room(roomId: number) {
    return this.members.get(roomId) ?? new Set<Connection>();
  }
}

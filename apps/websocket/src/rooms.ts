import type WebSocket from "ws";
export type Connection = {
  socket: WebSocket;
  userId: number;
  rooms: Set<number>;
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

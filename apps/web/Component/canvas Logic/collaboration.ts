type SocketMessage = Record<string, unknown> & { type?: string };

type PendingMessage = {
  message: SocketMessage;
  operationIds: Set<string>;
  sentOn: WebSocket | null;
};

function emitStatus(
  connection: "connected" | "reconnecting" | "offline",
  pending: number,
) {
  window.dispatchEvent(
    new CustomEvent("canvas:connection-status", {
      detail: { connection, pending },
    }),
  );
}

/** WebSocket lifecycle and durable operation retry live outside the canvas engine. */
export class CanvasCollaborationAdapter {
  private socket: WebSocket | null = null;
  private roomId: number | null = null;
  private revision = () => 0;
  private lastSyncRevision: number | null = null;
  private pending = new Map<string, PendingMessage>();
  private onMessage: (data: unknown) => void;

  constructor(onMessage: (data: unknown) => void) {
    this.onMessage = onMessage;
  }

  attach(socket: WebSocket | null) {
    if (this.socket === socket) return;
    this.lastSyncRevision = null;
    if (this.socket) {
      this.socket.removeEventListener("open", this.handleOpen);
      this.socket.removeEventListener("close", this.handleClose);
      this.socket.removeEventListener("message", this.handleMessage);
    }
    this.socket = socket;
    if (!socket) {
      emitStatus("reconnecting", this.pending.size);
      return;
    }
    socket.addEventListener("open", this.handleOpen);
    socket.addEventListener("close", this.handleClose);
    socket.addEventListener("message", this.handleMessage);
    if (socket.readyState === WebSocket.OPEN) this.handleOpen();
    else emitStatus("reconnecting", this.pending.size);
  }

  joinRoom(roomId: number, revision: () => number) {
    this.roomId = roomId;
    this.revision = revision;
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.sendControl({ type: "join_room", roomId });
    this.sync(roomId, revision());
    this.flush();
  }

  sync(roomId: number, afterRevision: number) {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    if (this.lastSyncRevision === afterRevision) return;
    this.lastSyncRevision = afterRevision;
    this.sendControl({ type: "canvas:sync", roomId, afterRevision });
  }

  syncCompleted() {
    this.lastSyncRevision = null;
  }

  sendPersistent(message: SocketMessage) {
    const operations = Array.isArray(message.operations)
      ? message.operations
      : [message];
    const operationIds = new Set(
      operations
        .map((operation) =>
          operation && typeof operation === "object"
            ? (operation as Record<string, unknown>).operationId
            : undefined,
        )
        .filter((id): id is string => typeof id === "string"),
    );
    if (!operationIds.size) return false;
    if (this.pending.size >= 200) {
      window.dispatchEvent(
        new CustomEvent("canvas:persistence-error", {
          detail:
            "Too many unsaved changes; wait for the connection to recover",
        }),
      );
      return false;
    }
    const key = [...operationIds][0]!;
    this.pending.set(key, { message, operationIds, sentOn: null });
    this.flush();
    emitStatus(
      this.socket?.readyState === WebSocket.OPEN ? "connected" : "reconnecting",
      this.pending.size,
    );
    return true;
  }

  sendEphemeral(message: SocketMessage) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.sendControl(message);
    return true;
  }

  acknowledge(operationIds: Array<{ operationId: string }>) {
    const acked = new Set(operationIds.map((item) => item.operationId));
    for (const [key, item] of this.pending) {
      for (const id of acked) item.operationIds.delete(id);
      if (!item.operationIds.size) this.pending.delete(key);
    }
    emitStatus(
      this.socket?.readyState === WebSocket.OPEN ? "connected" : "reconnecting",
      this.pending.size,
    );
  }

  reject(operationIds: string[]) {
    const rejected = new Set(operationIds);
    for (const [key, item] of this.pending)
      if ([...item.operationIds].some((id) => rejected.has(id)))
        this.pending.delete(key);
    emitStatus(
      this.socket?.readyState === WebSocket.OPEN ? "connected" : "reconnecting",
      this.pending.size,
    );
  }

  private sendControl(message: SocketMessage) {
    try {
      this.socket?.send(JSON.stringify(message));
    } catch {
      emitStatus("reconnecting", this.pending.size);
    }
  }

  private flush() {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    for (const item of this.pending.values()) {
      if (item.sentOn === this.socket) continue;
      try {
        item.sentOn = this.socket;
        this.socket.send(JSON.stringify(item.message));
      } catch {
        item.sentOn = null;
        break;
      }
    }
  }

  private handleOpen = () => {
    emitStatus("connected", this.pending.size);
    if (this.roomId !== null) {
      this.sendControl({ type: "join_room", roomId: this.roomId });
      this.sync(this.roomId, this.revision());
      this.flush();
    }
  };

  private handleClose = () => emitStatus("reconnecting", this.pending.size);

  private handleMessage = (event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data as string) as unknown;
      if (
        data &&
        typeof data === "object" &&
        (data as { type?: string }).type === "canvas:sync"
      )
        this.syncCompleted();
      this.onMessage(data);
    } catch {
      // Malformed frames are ignored; they do not interrupt canvas input.
    }
  };

  dispose() {
    this.attach(null);
    this.pending.clear();
  }
}

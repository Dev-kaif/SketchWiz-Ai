import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import WebSocket from "ws";
import jwt from "jsonwebtoken";
import { createWebSocketServer } from "../dist/server.js";
import { client } from "@repo/db/client";

let user;
let outsider;
let rooms = [];
let wss;
let sockets = [];
let endpoint;

function connect(roomToken) {
  const socket = new WebSocket(`${endpoint}?token=${roomToken}`);
  sockets.push(socket);
  return once(socket, "open").then(() => socket);
}

function nextMessage(socket, timeout = 5000) {
  return Promise.race([
    once(socket, "message").then(([data]) => JSON.parse(data.toString())),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("WebSocket message timeout")), timeout),
    ),
  ]);
}

before(async () => {
  await client.$connect();
  user = await client.user.create({
    data: {
      email: `ws-${Date.now()}@example.test`,
      username: `ws${Date.now()}`,
      name: "WS Test",
      password: "hash",
    },
  });
  for (let i = 0; i < 2; i++)
    rooms.push(
      await client.room.create({
        data: {
          slug: `ws-${Date.now()}-${i}`,
          adminId: user.id,
          members: { create: { userId: user.id, role: "OWNER" } },
          canvas: { create: {} },
        },
      }),
    );
  outsider = await client.user.create({
    data: {
      email: `ws-outsider-${Date.now()}@example.test`,
      username: `wsout${Date.now()}`,
      name: "WS outsider",
      password: "hash",
    },
  });
  wss = createWebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(wss, "listening");
  endpoint = `ws://127.0.0.1:${wss.address().port}`;
});

after(async () => {
  for (const socket of sockets) socket.terminate();
  if (wss) await new Promise((resolve) => wss.close(resolve));
  for (const room of rooms) {
    await client.chat.deleteMany({ where: { roomId: room.id } });
    await client.room.delete({ where: { id: room.id } }).catch(() => {});
  }
  if (user)
    await client.user.delete({ where: { id: user.id } }).catch(() => {});
  if (outsider)
    await client.user.delete({ where: { id: outsider.id } }).catch(() => {});
  await client.$disconnect();
});

test("auth, room isolation, safe parsing and serialized concurrent drawing writes", async () => {
  const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET);
  const [sender, sameRoom, otherRoom] = await Promise.all([
    connect(token),
    connect(token),
    connect(token),
  ]);
  sender.send(JSON.stringify({ type: "join_room", roomId: rooms[0].id }));
  sameRoom.send(JSON.stringify({ type: "join_room", roomId: rooms[0].id }));
  otherRoom.send(JSON.stringify({ type: "join_room", roomId: rooms[1].id }));
  await new Promise((resolve) => setTimeout(resolve, 30));

  const broadcast = nextMessage(sameRoom);
  sender.send(
    JSON.stringify({
      type: "chat",
      roomId: rooms[0].id,
      message: { id: "shape-shared", type: "line", x1: 0, y1: 0, x2: 3, y2: 4 },
    }),
  );
  assert.equal((await broadcast).type, "chat");
  const otherRoomMessage = nextMessage(otherRoom, 150);
  await assert.rejects(otherRoomMessage, /timeout/);

  sameRoom.send("{");
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(sameRoom.readyState, WebSocket.OPEN);

  const concurrentCount = 10;
  const received = new Promise((resolve, reject) => {
    let count = 0;
    const onMessage = () => {
      count++;
      if (count === concurrentCount) {
        clearTimeout(timeout);
        sameRoom.off("message", onMessage);
        resolve();
      }
    };
    const timeout = setTimeout(() => {
      sameRoom.off("message", onMessage);
      reject(
        new Error(`received ${count}/${concurrentCount} concurrent broadcasts`),
      );
    }, 5000);
    sameRoom.on("message", onMessage);
  });
  for (let i = 0; i < concurrentCount; i++) {
    sender.send(
      JSON.stringify({
        type: "chat",
        roomId: rooms[0].id,
        message: {
          id: "shape-shared",
          type: "line",
          x1: i,
          y1: 0,
          x2: 3,
          y2: 4,
        },
      }),
    );
  }
  await received;
  const canvas = await client.canvas.findUnique({
    where: { roomId: rooms[0].id },
    include: { elements: true, operations: true },
  });
  assert.equal(canvas.revision, BigInt(concurrentCount + 1));
  assert.equal(canvas.elements.length, 1);
  assert.equal(canvas.operations.length, concurrentCount + 1);
  assert.equal(
    await client.chat.count({ where: { roomId: rooms[0].id } }),
    concurrentCount + 1,
  );
});

test("a signed-in nonmember cannot join a private room or inject drawing events", async () => {
  const token = jwt.sign({ id: outsider.id }, process.env.JWT_SECRET);
  const socket = await connect(token);
  const before = await client.chat.count({ where: { roomId: rooms[0].id } });
  const canvas = await client.canvas.findUnique({
    where: { roomId: rooms[0].id },
  });
  const operationsBefore = await client.canvasOperation.count({
    where: { canvasId: canvas.id },
  });
  socket.send(JSON.stringify({ type: "join_room", roomId: rooms[0].id }));
  await new Promise((resolve) => setTimeout(resolve, 40));
  socket.send(
    JSON.stringify({
      type: "chat",
      roomId: rooms[0].id,
      message: {
        id: "unauthorized-shape",
        type: "line",
        x1: 0,
        y1: 0,
        x2: 1,
        y2: 1,
      },
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(
    await client.chat.count({ where: { roomId: rooms[0].id } }),
    before,
  );
  assert.equal(
    await client.canvasOperation.count({ where: { canvasId: canvas.id } }),
    operationsBefore,
  );

  await client.roomMember.create({
    data: { roomId: rooms[0].id, userId: outsider.id, role: "VIEWER" },
  });
  socket.send(JSON.stringify({ type: "join_room", roomId: rooms[0].id }));
  await new Promise((resolve) => setTimeout(resolve, 40));
  socket.send(
    JSON.stringify({
      type: "chat",
      roomId: rooms[0].id,
      message: { id: "viewer-shape", type: "line", x1: 0, y1: 0, x2: 1, y2: 1 },
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(
    await client.chat.count({ where: { roomId: rooms[0].id } }),
    before,
  );
  assert.equal(
    await client.canvasOperation.count({ where: { canvasId: canvas.id } }),
    operationsBefore,
  );
  await client.roomMember.delete({
    where: { roomId_userId: { roomId: rooms[0].id, userId: outsider.id } },
  });
  const ownerSocket = await connect(
    jwt.sign({ id: user.id }, process.env.JWT_SECRET),
  );
  ownerSocket.send(JSON.stringify({ type: "join_room", roomId: rooms[0].id }));
  await new Promise((resolve) => setTimeout(resolve, 40));
  const noRevokedMemberLeak = nextMessage(socket, 150);
  ownerSocket.send(
    JSON.stringify({
      type: "chat",
      roomId: rooms[0].id,
      message: {
        id: "private-after-removal",
        type: "line",
        x1: 0,
        y1: 0,
        x2: 1,
        y2: 1,
      },
    }),
  );
  await assert.rejects(noRevokedMemberLeak, /timeout/);
});

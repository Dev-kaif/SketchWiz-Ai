import { once } from "node:events";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { client as database } from "../packages/db/dist/index.js";
import { createApp } from "../apps/server/dist/app.js";
import { createWebSocketServer } from "../apps/websocket/dist/server.js";

const websocketRequire = createRequire(
  new URL("../apps/websocket/package.json", import.meta.url),
);
const WebSocket = websocketRequire("ws");
const jwt = websocketRequire("jsonwebtoken");

const secret = process.env.JWT_SECRET;
if (!secret || secret.length < 32)
  throw new Error("Set a local JWT_SECRET with at least 32 characters");
const stats = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p) =>
    sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
  return {
    n: sorted.length,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
  };
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const start = async (server) => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
};
const measure = async (fn, count) => {
  const values = [];
  const startTime = performance.now();
  for (let i = 0; i < count; i++) {
    const at = performance.now();
    await fn(i);
    values.push(performance.now() - at);
  }
  const durationMs = performance.now() - startTime;
  return {
    ...stats(values),
    durationMs: +durationMs.toFixed(2),
    throughputPerSecond: +((count * 1000) / durationMs).toFixed(2),
  };
};
const fixtureRooms = [];
const sockets = [];
const processBefore = {
  cpu: process.resourceUsage(),
  memory: process.memoryUsage(),
};
let user;
let httpServer;
let wss;

try {
  await database.$connect();
  console.error("benchmark: database connected");
  user = await database.user.create({
    data: {
      email: `bench-${Date.now()}@example.test`,
      username: `bench${Date.now()}`,
      name: "Local benchmark",
      password: "not-a-login-hash",
    },
  });
  const token = jwt.sign({ id: user.id }, secret);
  httpServer = createServer(createApp("*"));
  const httpPort = await start(httpServer);
  wss = createWebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(wss, "listening");
  const wsUrl = `ws://127.0.0.1:${wss.address().port}/?token=${token}`;
  const authHeaders = { authorization: token };

  const primaryRoom = await database.room.create({
    data: {
      slug: `bench-${Date.now()}`,
      adminId: user.id,
      canvas: { create: {} },
      members: { create: { userId: user.id, role: "OWNER" } },
    },
  });
  fixtureRooms.push(primaryRoom);
  const report = {
    localOnly: true,
    http: {},
    websocket: {},
    database: {},
    roomLoad: {},
    process: {},
  };

  report.http.ping = await measure(async () => {
    const response = await fetch(`http://127.0.0.1:${httpPort}/api/ping`);
    if (!response.ok) throw new Error(`HTTP ping returned ${response.status}`);
  }, 100);
  console.error("benchmark: HTTP complete");

  report.database.chatCreate = await measure(async (i) => {
    await database.chat.create({
      data: {
        roomId: primaryRoom.id,
        userId: user.id,
        message: JSON.stringify({ id: `db-${i}`, type: "line" }),
      },
    });
  }, 30);

  const canvas = await database.canvas.findUnique({
    where: { roomId: primaryRoom.id },
    select: { id: true },
  });
  report.database.drawingPersistenceTransaction = await measure(async (i) => {
    const payload = { id: `persist-db-${i}`, type: "line", x1: 0, y1: 0 };
    await database.$transaction(async (tx) => {
      const chat = await tx.chat.create({
        data: {
          roomId: primaryRoom.id,
          userId: user.id,
          message: JSON.stringify(payload),
        },
        select: { id: true },
      });
      const current = await tx.canvas.update({
        where: { roomId: primaryRoom.id },
        data: { revision: { increment: 1 } },
        select: { revision: true },
      });
      await tx.canvasElement.upsert({
        where: { id: `${canvas.id}:${payload.id}` },
        create: {
          id: `${canvas.id}:${payload.id}`,
          canvasId: canvas.id,
          revision: current.revision,
          properties: payload,
        },
        update: { revision: current.revision, properties: payload },
      });
      await tx.canvasOperation.create({
        data: {
          operationId: `chat-${chat.id}`,
          canvasId: canvas.id,
          revision: current.revision,
          actorId: user.id,
          kind: "upsert_element",
          payload,
        },
      });
    });
  }, 30);
  console.error("benchmark: database persistence complete");

  const loadSizes = [100, 1_000, 10_000];
  for (const size of loadSizes) {
    const room = await database.room.create({
      data: {
        slug: `bench-load-${size}-${Date.now()}`,
        adminId: user.id,
        canvas: { create: {} },
        members: { create: { userId: user.id, role: "OWNER" } },
      },
    });
    fixtureRooms.push(room);
    for (let offset = 0; offset < size; offset += 1000) {
      const end = Math.min(size, offset + 1000);
      await database.chat.createMany({
        data: Array.from({ length: end - offset }, (_, i) => ({
          roomId: room.id,
          userId: user.id,
          message: JSON.stringify({
            id: `shape-${offset + i}`,
            type: "line",
            x1: 0,
            y1: 0,
            x2: i,
            y2: i,
          }),
        })),
      });
    }
    report.roomLoad[`chatRows_${size}`] = await measure(async () => {
      const response = await fetch(
        `http://127.0.0.1:${httpPort}/api/room/${room.id}`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      if (!response.ok)
        throw new Error(`Room load returned ${response.status}`);
      await response.arrayBuffer();
    }, 15);
    if (size === 10_000) {
      const [plan] = await database.$queryRaw`
        EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
        SELECT "id", "message", "roomId", "userId"
        FROM "Chat"
        WHERE "roomId" = ${room.id}
        ORDER BY "id" ASC
        LIMIT 2000
      `;
      report.roomLoad.explainAnalyze_10kChatRows = plan["QUERY PLAN"][0];
    }
    console.error(`benchmark: room load ${size} complete`);
  }

  for (const clientCount of [1, 10, 50]) {
    const connectionLatencies = [];
    const clients = await Promise.all(
      Array.from({ length: clientCount }, async () => {
        const started = performance.now();
        const socket = new WebSocket(wsUrl);
        sockets.push(socket);
        await once(socket, "open");
        connectionLatencies.push(performance.now() - started);
        socket.send(
          JSON.stringify({ type: "join_room", roomId: primaryRoom.id }),
        );
        return socket;
      }),
    );
    report.websocket[`connection_${clientCount}_clients`] =
      stats(connectionLatencies);
    console.error(`benchmark: ${clientCount} WebSocket clients connected`);
    await sleep(50);
    const latency = [];
    const samples = 30;
    for (let i = 0; i < samples; i++) {
      const received = once(clients.at(-1), "message");
      const at = performance.now();
      clients[0].send(
        JSON.stringify({
          type: "ai",
          roomId: primaryRoom.id,
          message: `broadcast-${clientCount}-${i}`,
        }),
      );
      await received;
      latency.push(performance.now() - at);
    }
    report.websocket[`broadcast_${clientCount}_clients`] = {
      ...stats(latency),
      throughputPerSecond: +(
        (samples * 1000) /
        latency.reduce((sum, value) => sum + value, 0)
      ).toFixed(2),
    };
    if (clientCount > 1) {
      const endToEnd = [];
      const rounds = 20;
      for (let i = 0; i < rounds; i++) {
        const received = once(clients[1], "message");
        const at = performance.now();
        clients[0].send(
          JSON.stringify({
            type: "chat",
            roomId: primaryRoom.id,
            message: {
              id: `persist-${clientCount}-${i}`,
              type: "line",
              x1: 0,
              y1: 0,
              x2: i,
              y2: i,
            },
          }),
        );
        await received;
        endToEnd.push(performance.now() - at);
      }
      report.websocket[`persistedChatToBroadcast_${clientCount}_clients`] =
        stats(endToEnd);
    }
    for (const socket of clients) socket.close();
    await Promise.all(clients.map((socket) => once(socket, "close")));
  }

  await database.$queryRaw`SELECT 1`;
  report.process = {
    before: processBefore,
    after: { cpu: process.resourceUsage(), memory: process.memoryUsage() },
  };
  console.log(JSON.stringify(report, null, 2));
} finally {
  for (const socket of sockets) socket.terminate();
  if (wss) await new Promise((resolve) => wss.close(resolve));
  if (httpServer?.listening)
    await new Promise((resolve) => httpServer.close(resolve));
  for (const room of fixtureRooms) {
    await database.chat.deleteMany({ where: { roomId: room.id } });
    await database.room.delete({ where: { id: room.id } }).catch(() => {});
  }
  if (user)
    await database.user.delete({ where: { id: user.id } }).catch(() => {});
  await database.$disconnect();
}

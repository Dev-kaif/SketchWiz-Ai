import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { client as prisma } from "../dist/index.js";

const execFileAsync = promisify(execFile);
let user;
let room;

before(async () => {
  await prisma.$connect();
  user = await prisma.user.create({
    data: {
      email: `migration-${Date.now()}@example.test`,
      username: `migration${Date.now()}`,
      name: "Migration Fixture",
      password: "preserved-hash",
    },
  });
  room = await prisma.room.create({
    data: {
      slug: `migration-${Date.now()}`,
      adminId: user.id,
      members: { create: { userId: user.id, role: "OWNER" } },
      canvas: { create: {} },
    },
  });
  const values = [
    { id: "rectangle-1", type: "rectangle", x: 1, y: 2, width: 3, height: 4 },
    {
      id: "freehand-1",
      type: "freehand",
      points: [
        { x: 1, y: 2 },
        { x: 2, y: 3 },
      ],
    },
    { id: "text-1", type: "text", content: "preserve this" },
    { id: "image-1", type: "image", src: "https://example.test/image.png" },
    { id: "updated-1", type: "line", x1: 1, x2: 2 },
    { id: "updated-1", type: "line", x1: 1, x2: 99 },
    "malformed legacy payload",
    { id: "unsupported-1", type: "unknown-shape" },
    {
      id: "inline-image",
      type: "image",
      src: "data:image/png;base64,ZmFrZQ==",
    },
  ];
  for (const value of values)
    await prisma.chat.create({
      data: {
        roomId: room.id,
        userId: user.id,
        message: typeof value === "string" ? value : JSON.stringify(value),
      },
    });
});

after(async () => {
  if (room) {
    await prisma.chat.deleteMany({ where: { roomId: room.id } });
    await prisma.room.delete({ where: { id: room.id } }).catch(() => {});
  }
  if (user)
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  await prisma.$disconnect();
});

test("legacy backfill preserves history, imports supported shapes, skips repeats and retains unsupported payloads", async () => {
  const script = new URL(
    "../scripts/backfill-legacy-canvas.mjs",
    import.meta.url,
  );
  const args = [script.pathname, "--room-id", String(room.id)];
  const first = await execFileAsync(process.execPath, args, {
    env: process.env,
  });
  const firstStats = JSON.parse(first.stdout);
  assert.equal(firstStats.migrated, 6);
  assert.equal(firstStats.unsupported, 3);
  assert.equal(firstStats.failed, 0);

  const imported = await prisma.canvas.findUnique({
    where: { roomId: room.id },
    include: { elements: true, operations: true },
  });
  assert.equal(imported.elements.length, 5);
  assert.equal(imported.operations.length, 6);
  const updated = imported.elements.find((element) =>
    element.id.endsWith(":updated-1"),
  );
  assert.equal(updated.properties.x2, 99);
  assert.equal(await prisma.chat.count({ where: { roomId: room.id } }), 9);

  const second = await execFileAsync(process.execPath, args, {
    env: process.env,
  });
  const secondStats = JSON.parse(second.stdout);
  assert.equal(secondStats.migrated, 0);
  assert.equal(secondStats.skipped, 6);
  assert.equal(secondStats.failed, 0);
});

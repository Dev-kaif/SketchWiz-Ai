import { client as prisma } from "../dist/index.js";

// Replays historical completed-shape messages without deleting or editing Chat rows.
const supportedTypes = new Set([
  "rectangle",
  "circle",
  "line",
  "triangle",
  "freehand",
  "text",
  "eraser",
  "arrow",
  "image",
]);
const stats = { rooms: 0, migrated: 0, skipped: 0, unsupported: 0, failed: 0 };
const roomArg = process.argv.indexOf("--room-id");
const requestedRoomId =
  roomArg >= 0 ? Number(process.argv[roomArg + 1]) : undefined;
if (
  requestedRoomId !== undefined &&
  (!Number.isSafeInteger(requestedRoomId) || requestedRoomId < 1)
) {
  throw new Error("--room-id must be a positive integer");
}

try {
  let roomCursor;
  while (true) {
    const rooms = await prisma.room.findMany({
      where: requestedRoomId ? { id: requestedRoomId } : undefined,
      take: 100,
      ...(roomCursor ? { skip: 1, cursor: { id: roomCursor } } : {}),
      orderBy: { id: "asc" },
      select: { id: true },
    });
    if (!rooms.length) break;
    roomCursor = rooms.at(-1).id;
    for (const room of rooms) {
      stats.rooms++;
      const canvas = await prisma.canvas.upsert({
        where: { roomId: room.id },
        create: { roomId: room.id },
        update: {},
        select: { id: true },
      });
      let chatCursor;
      while (true) {
        const rows = await prisma.chat.findMany({
          where: { roomId: room.id },
          take: 500,
          ...(chatCursor ? { skip: 1, cursor: { id: chatCursor } } : {}),
          orderBy: { id: "asc" },
        });
        if (!rows.length) break;
        chatCursor = rows.at(-1).id;
        for (const row of rows) {
          let payload;
          try {
            payload = JSON.parse(row.message);
          } catch {
            payload = null;
          }
          const isShape =
            payload &&
            typeof payload === "object" &&
            !Array.isArray(payload) &&
            typeof payload.id === "string" &&
            supportedTypes.has(payload.type);
          const isInlineImage =
            isShape &&
            payload.type === "image" &&
            typeof payload.src === "string" &&
            payload.src.startsWith("data:");
          if (!isShape || isInlineImage) {
            stats.unsupported++;
            continue;
          }

          const operationId = `legacy-chat-${row.id}`;
          try {
            await prisma
              .$transaction(async (tx) => {
                const processed = await tx.canvasOperation.findUnique({
                  where: { operationId },
                  select: { id: true },
                });
                const liveWrite = await tx.canvasOperation.findUnique({
                  where: { operationId: `chat-${row.id}` },
                  select: { id: true },
                });
                if (processed || liveWrite) return false;
                const canvasState = await tx.canvas.update({
                  where: { id: canvas.id },
                  data: { revision: { increment: 1 } },
                  select: { revision: true },
                });
                const elementId = `${canvas.id}:${payload.id}`;
                await tx.canvasElement.upsert({
                  where: { id: elementId },
                  create: {
                    id: elementId,
                    canvasId: canvas.id,
                    revision: canvasState.revision,
                    properties: payload,
                  },
                  update: {
                    revision: canvasState.revision,
                    properties: payload,
                  },
                });
                await tx.canvasOperation.create({
                  data: {
                    operationId,
                    canvasId: canvas.id,
                    revision: canvasState.revision,
                    actorId: row.userId,
                    kind: "legacy_upsert_element",
                    payload,
                  },
                });
                return true;
              })
              .then((didMigrate) => {
                stats[didMigrate ? "migrated" : "skipped"]++;
              });
          } catch {
            stats.failed++;
          }
        }
      }
    }
  }
  console.log(JSON.stringify(stats));
  if (stats.failed > 0) process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

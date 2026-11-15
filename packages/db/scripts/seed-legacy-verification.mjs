import { client as prisma } from "../dist/index.js";

const suffix = Date.now();
try {
  const user = await prisma.user.create({
    data: {
      email: `legacy-${suffix}@example.test`,
      username: `legacy${suffix}`,
      password: "$2b$10$historical-password-hash-kept-as-is",
      name: "Legacy verification user",
    },
  });
  const room = await prisma.room.create({
    data: { slug: `legacy-room-${suffix}`, adminId: user.id },
  });
  const drawings = [
    {
      id: "rect-legacy",
      type: "rectangle",
      x: 10,
      y: 20,
      width: 30,
      height: 40,
    },
    {
      id: "freehand-legacy",
      type: "freehand",
      points: [
        { x: 1, y: 2 },
        { x: 4, y: 8 },
      ],
    },
    { id: "text-legacy", type: "text", content: "legacy words" },
    {
      id: "image-legacy",
      type: "image",
      src: "data:image/png;base64,ZmFrZQ==",
    },
    "malformed historical message retained verbatim",
  ];
  for (const drawing of drawings) {
    await prisma.chat.create({
      data: {
        roomId: room.id,
        userId: user.id,
        message:
          typeof drawing === "string" ? drawing : JSON.stringify(drawing),
      },
    });
  }
  console.log(
    JSON.stringify({
      userId: user.id,
      roomId: room.id,
      email: user.email,
      chatRows: drawings.length,
    }),
  );
} finally {
  await prisma.$disconnect();
}

import { PrismaClient } from "./generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to initialize the database client");
}

const adapter = new PrismaPg({ connectionString });

const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: PrismaClient;
};
export const client = globalForPrisma.prisma ?? new PrismaClient({ adapter });
globalForPrisma.prisma = client;
export const disconnectDatabase = () => client.$disconnect();

export type RoomRole = "OWNER" | "EDITOR" | "VIEWER";
export type RoomVisibility = "PUBLIC" | "PRIVATE";

export async function roomRoleForUser(roomId: number, userId: number) {
  const membership = await client.roomMember.findUnique({
    where: { roomId_userId: { roomId, userId } },
    select: { role: true },
  });
  return membership?.role ?? null;
}

/** Public rooms are joinable by signed-in users; private rooms require membership. */
export async function joinPublicRoom(roomId: number, userId: number) {
  return client.$transaction(async (tx) => {
    const rows = await tx.$queryRawUnsafe<
      Array<{ visibility: RoomVisibility }>
    >('SELECT "visibility" FROM "Room" WHERE "id" = $1 FOR SHARE', roomId);
    const room = rows[0];
    if (!room) return null;
    const existing = await tx.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId } },
      select: { role: true },
    });
    if (existing) return existing.role;
    if (room.visibility !== "PUBLIC") return null;
    const membership = await tx.roomMember.create({
      data: { roomId, userId, role: "EDITOR" },
      select: { role: true },
    });
    return membership.role;
  });
}

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

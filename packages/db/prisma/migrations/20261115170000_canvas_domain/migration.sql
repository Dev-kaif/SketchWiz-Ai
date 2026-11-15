-- Additive only: keep existing User, Room and Chat rows and identifiers intact.
CREATE TYPE "RoomRole" AS ENUM ('OWNER', 'EDITOR', 'VIEWER');
CREATE TYPE "RoomVisibility" AS ENUM ('PRIVATE', 'PUBLIC');
ALTER TABLE "Room" ADD COLUMN "visibility" "RoomVisibility" NOT NULL DEFAULT 'PRIVATE';

CREATE TABLE "RoomMember" (
  "id" SERIAL NOT NULL, "roomId" INTEGER NOT NULL, "userId" INTEGER NOT NULL,
  "role" "RoomRole" NOT NULL DEFAULT 'EDITOR', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RoomMember_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RoomMember_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RoomMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "RoomMember_roomId_userId_key" ON "RoomMember"("roomId", "userId");
CREATE INDEX "RoomMember_userId_roomId_idx" ON "RoomMember"("userId", "roomId");
INSERT INTO "RoomMember" ("roomId", "userId", "role") SELECT "id", "adminId", 'OWNER' FROM "Room" ON CONFLICT ("roomId", "userId") DO NOTHING;

CREATE TABLE "Canvas" (
  "id" SERIAL NOT NULL, "roomId" INTEGER NOT NULL, "revision" BIGINT NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Canvas_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Canvas_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Canvas_roomId_key" ON "Canvas"("roomId");
INSERT INTO "Canvas" ("roomId", "revision", "updatedAt") SELECT "id", 0, CURRENT_TIMESTAMP FROM "Room" ON CONFLICT ("roomId") DO NOTHING;

CREATE TABLE "CanvasElement" (
  "id" TEXT NOT NULL, "canvasId" INTEGER NOT NULL, "revision" BIGINT NOT NULL,
  "properties" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CanvasElement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CanvasElement_canvasId_fkey" FOREIGN KEY ("canvasId") REFERENCES "Canvas"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CanvasElement_canvasId_revision_key" ON "CanvasElement"("canvasId", "revision");
CREATE INDEX "CanvasElement_canvasId_updatedAt_idx" ON "CanvasElement"("canvasId", "updatedAt");

CREATE TABLE "CanvasOperation" (
  "id" SERIAL NOT NULL, "operationId" TEXT NOT NULL, "canvasId" INTEGER NOT NULL,
  "revision" BIGINT NOT NULL, "actorId" INTEGER NOT NULL, "kind" TEXT NOT NULL,
  "payload" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CanvasOperation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CanvasOperation_canvasId_fkey" FOREIGN KEY ("canvasId") REFERENCES "Canvas"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CanvasOperation_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CanvasOperation_operationId_key" ON "CanvasOperation"("operationId");
CREATE UNIQUE INDEX "CanvasOperation_canvasId_revision_key" ON "CanvasOperation"("canvasId", "revision");
CREATE INDEX "CanvasOperation_canvasId_revision_idx" ON "CanvasOperation"("canvasId", "revision");

CREATE TABLE "CanvasSnapshot" (
  "id" SERIAL NOT NULL, "canvasId" INTEGER NOT NULL, "revision" BIGINT NOT NULL,
  "state" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CanvasSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CanvasSnapshot_canvasId_fkey" FOREIGN KEY ("canvasId") REFERENCES "Canvas"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CanvasSnapshot_canvasId_revision_key" ON "CanvasSnapshot"("canvasId", "revision");
CREATE INDEX "CanvasSnapshot_canvasId_revision_idx" ON "CanvasSnapshot"("canvasId", "revision");

CREATE TABLE "Asset" (
  "id" TEXT NOT NULL, "ownerId" INTEGER NOT NULL, "storageKey" TEXT NOT NULL,
  "contentType" TEXT NOT NULL, "sizeBytes" BIGINT NOT NULL, "checksum" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Asset_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Asset_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Asset_storageKey_key" ON "Asset"("storageKey");
CREATE INDEX "Asset_ownerId_createdAt_idx" ON "Asset"("ownerId", "createdAt");
CREATE INDEX "Chat_roomId_id_idx" ON "Chat"("roomId", "id");

import { client } from "./index.js";
import { Prisma, type RoomRole } from "./generated/prisma/client.js";

export type CanvasMutation =
  | {
      kind: "create" | "update";
      operationId: string;
      element: Record<string, unknown>;
    }
  | { kind: "delete"; operationId: string; elementId: string };

type OperationResult = {
  operationId: string;
  revision: number;
  duplicate?: boolean;
  unchanged?: boolean;
};

export type PersistCanvasResult = {
  allowed: boolean;
  conflict?: boolean;
  role?: RoomRole;
  roles: Map<number, RoomRole>;
  revision: number;
  results: OperationResult[];
  operations: Array<CanvasMutation & { revision: number }>;
};

function elementId(canvasId: number, shapeId: string) {
  return `${canvasId}:${shapeId}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

export async function persistCanvasMutations(input: {
  roomId: number;
  userId: number;
  activeUserIds: number[];
  mutations: CanvasMutation[];
  expectedRevision?: number;
  legacyMessage?: unknown;
}) {
  const userIds = [...new Set([input.userId, ...input.activeUserIds])];
  const placeholders = userIds.map((_, index) => `$${index + 2}`).join(", ");

  return client.$transaction(async (tx): Promise<PersistCanvasResult> => {
    const rows = await tx.$queryRawUnsafe<
      Array<{
        canvasId: number;
        revision: bigint;
        userId: number;
        role: RoomRole;
      }>
    >(
      `SELECT c."id" AS "canvasId", c."revision", m."userId", m."role" FROM "Canvas" c JOIN "RoomMember" m ON m."roomId" = c."roomId" WHERE c."roomId" = $1 AND m."userId" IN (${placeholders}) FOR UPDATE OF c, m`,
      input.roomId,
      ...userIds,
    );
    const roles = new Map(rows.map((row) => [row.userId, row.role]));
    const canvas = rows[0];
    const senderRole = roles.get(input.userId);
    const initialRevision = canvas ? Number(canvas.revision) : 0;
    const result = (
      allowed: boolean,
      role?: RoomRole,
    ): PersistCanvasResult => ({
      allowed,
      role,
      roles,
      revision: initialRevision,
      results: [],
      operations: [],
    });
    if (!canvas || !senderRole) return result(false);
    if (senderRole === "VIEWER") return result(false, senderRole);
    if (
      input.expectedRevision !== undefined &&
      input.expectedRevision !== initialRevision
    )
      return { ...result(false, senderRole), conflict: true };

    let legacyOperationId: string | undefined;
    if (input.legacyMessage !== undefined) {
      const chat = await tx.chat.create({
        data: {
          roomId: input.roomId,
          userId: input.userId,
          message: JSON.stringify(input.legacyMessage),
        },
        select: { id: true },
      });
      legacyOperationId = `chat-${chat.id}`;
    }

    const mutations = [...input.mutations];
    if (legacyOperationId && mutations.length === 1) {
      mutations[0] = { ...mutations[0]!, operationId: legacyOperationId };
    }
    if (mutations.length === 0)
      return { ...result(true, senderRole), results: [] };

    const existingOperations = await tx.canvasOperation.findMany({
      where: {
        operationId: { in: mutations.map((mutation) => mutation.operationId) },
      },
      select: { operationId: true, canvasId: true, revision: true },
    });
    const operationById = new Map(
      existingOperations.map((operation) => [operation.operationId, operation]),
    );
    if (
      existingOperations.some(
        (operation) => operation.canvasId !== canvas.canvasId,
      )
    )
      return { ...result(false, senderRole), conflict: true };

    const touchedShapeIds = [
      ...new Set(
        mutations.flatMap((mutation) =>
          mutation.kind === "delete"
            ? [mutation.elementId]
            : [String(mutation.element.id)],
        ),
      ),
    ];
    const existingElements = await tx.canvasElement.findMany({
      where: {
        canvasId: canvas.canvasId,
        id: { in: touchedShapeIds.map((id) => elementId(canvas.canvasId, id)) },
      },
      select: { id: true, revision: true, properties: true },
    });
    const initial = new Map(
      existingElements.map((element) => [
        element.id,
        element.properties as Record<string, unknown>,
      ]),
    );
    const virtual = new Map(initial);
    const lastRevision = new Map<string, bigint>();
    const writes: Array<{
      operationId: string;
      revision: bigint;
      kind: string;
      payload: object;
    }> = [];
    const results: OperationResult[] = [];
    const operations: Array<CanvasMutation & { revision: number }> = [];
    let revision = canvas.revision;

    for (const mutation of mutations) {
      const existingOperation = operationById.get(mutation.operationId);
      if (existingOperation) {
        results.push({
          operationId: mutation.operationId,
          revision: Number(existingOperation.revision),
          duplicate: true,
        });
        continue;
      }

      const shapeId =
        mutation.kind === "delete"
          ? mutation.elementId
          : String(mutation.element.id);
      const before = virtual.get(elementId(canvas.canvasId, shapeId));
      const after = mutation.kind === "delete" ? undefined : mutation.element;
      if (
        mutation.kind === "create" &&
        before &&
        stableJson(before) !== stableJson(after)
      )
        return { ...result(false, senderRole), conflict: true };
      if (stableJson(before) === stableJson(after)) {
        results.push({
          operationId: mutation.operationId,
          revision: Number(revision),
          unchanged: true,
        });
        continue;
      }

      revision += 1n;
      lastRevision.set(shapeId, revision);
      if (after) virtual.set(elementId(canvas.canvasId, shapeId), after);
      else virtual.delete(elementId(canvas.canvasId, shapeId));
      const payload =
        mutation.kind === "delete"
          ? { id: shapeId }
          : { element: mutation.element };
      writes.push({
        operationId: mutation.operationId,
        revision,
        kind:
          mutation.kind === "delete"
            ? "delete_element"
            : `${mutation.kind}_element`,
        payload,
      });
      results.push({
        operationId: mutation.operationId,
        revision: Number(revision),
      });
      operations.push({ ...mutation, revision: Number(revision) });
    }

    if (writes.length === 0)
      return {
        allowed: true,
        role: senderRole,
        roles,
        revision: Number(revision),
        results,
        operations,
      };

    const toDelete: string[] = [];
    const toCreate: Array<{
      id: string;
      canvasId: number;
      revision: bigint;
      properties: Prisma.InputJsonValue;
    }> = [];
    const toUpdate: Array<{
      id: string;
      revision: bigint;
      properties: Prisma.InputJsonValue;
    }> = [];
    for (const shapeId of touchedShapeIds) {
      const key = elementId(canvas.canvasId, shapeId);
      const before = initial.get(key);
      const after = virtual.get(key);
      if (stableJson(before) === stableJson(after)) continue;
      if (!after) {
        if (before) toDelete.push(key);
        continue;
      }
      const row = {
        id: key,
        revision: lastRevision.get(shapeId) ?? revision,
        properties: after as Prisma.InputJsonValue,
      };
      if (before) toUpdate.push(row);
      else toCreate.push({ ...row, canvasId: canvas.canvasId });
    }

    await tx.canvas.update({
      where: { id: canvas.canvasId },
      data: { revision },
    });
    if (toDelete.length > 0) {
      await tx.canvasElement.deleteMany({
        where: { canvasId: canvas.canvasId, id: { in: toDelete } },
      });
    }
    if (toCreate.length > 0)
      await tx.canvasElement.createMany({ data: toCreate });
    for (const element of toUpdate) {
      await tx.canvasElement.update({
        where: { id: element.id },
        data: { revision: element.revision, properties: element.properties },
      });
    }
    await tx.canvasOperation.createMany({
      data: writes.map((operation) => ({
        ...operation,
        canvasId: canvas.canvasId,
        actorId: input.userId,
        payload: operation.payload as Prisma.InputJsonValue,
      })),
    });

    return {
      allowed: true,
      role: senderRole,
      roles,
      revision: Number(revision),
      results,
      operations,
    };
  });
}

export async function getCanvasSync(roomId: number, afterRevision?: number) {
  const canvas = await client.canvas.findUnique({
    where: { roomId },
    select: {
      id: true,
      revision: true,
      elements: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { properties: true },
      },
    },
  });
  if (!canvas) return null;
  const currentRevision = Number(canvas.revision);

  if (afterRevision !== undefined && afterRevision <= currentRevision) {
    const rows = await client.canvasOperation.findMany({
      where: { canvasId: canvas.id, revision: { gt: BigInt(afterRevision) } },
      orderBy: { revision: "asc" },
      take: 501,
      select: { operationId: true, revision: true, kind: true, payload: true },
    });
    let expected = BigInt(afterRevision) + 1n;
    const contiguous = rows.every((row) => {
      if (row.revision !== expected) return false;
      expected += 1n;
      return true;
    });
    if (
      contiguous &&
      (rows.length === 501 || expected - 1n === canvas.revision)
    ) {
      const operations = rows.slice(0, 500).map((row) => ({
        operationId: row.operationId,
        revision: Number(row.revision),
        kind: row.kind,
        payload: row.payload,
      }));
      return {
        mode: "operations" as const,
        revision: operations.at(-1)?.revision ?? afterRevision,
        currentRevision,
        hasMore:
          operations.length === 500 &&
          operations.at(-1)!.revision < currentRevision,
        operations,
      };
    }
  }

  let elements = canvas.elements.map((element) => element.properties);
  let legacy = false;
  if (canvas.revision === 0n && elements.length === 0) {
    const history = await client.chat.findMany({
      where: { roomId },
      orderBy: { id: "desc" },
      take: 2000,
      select: { message: true },
    });
    const byId = new Map<string, Record<string, unknown>>();
    for (const row of history.reverse()) {
      try {
        const element = JSON.parse(row.message) as Record<string, unknown>;
        if (
          element &&
          typeof element.id === "string" &&
          typeof element.type === "string"
        )
          byId.set(element.id, element);
      } catch {
        // Keep malformed legacy rows in Chat; skip only their canvas projection.
      }
    }
    elements = [...byId.values()] as Prisma.JsonValue[];
    legacy = elements.length > 0;
  }
  return {
    mode: "snapshot" as const,
    revision: currentRevision,
    elements,
    legacy,
  };
}

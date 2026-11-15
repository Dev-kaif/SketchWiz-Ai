import { z } from "zod";

export const CreateUserSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(30),
  name: z.string().min(3).max(30),
  photo: z.string().optional(),
  password: z.string().min(8),
});
export const SigninSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});
export const RoomSchema = z.object({ roomName: z.string().min(3).max(30) });
const socketPayload = z.union([
  z.string().min(1).max(100_000),
  z.record(z.string(), z.unknown()),
]);
const operationId = z.string().min(1).max(128);
const canvasElement = z
  .record(z.string(), z.unknown())
  .refine(
    (value) => typeof value.id === "string" && typeof value.type === "string",
    "Canvas elements require string id and type fields",
  );
const canvasMutation = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("create"), operationId, element: canvasElement }),
  z.object({ kind: z.literal("update"), operationId, element: canvasElement }),
  z.object({
    kind: z.literal("delete"),
    operationId,
    elementId: z.string().min(1).max(512),
  }),
]);
export const WebSocketMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("join_room"),
    roomId: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("leave_room"),
    roomId: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("chat"),
    roomId: z.number().int().positive(),
    message: socketPayload,
  }),
  z.object({
    type: z.literal("ai"),
    roomId: z.number().int().positive(),
    message: socketPayload,
  }),
  z.object({
    type: z.literal("canvas:create"),
    roomId: z.number().int().positive(),
    operationId,
    element: canvasElement,
  }),
  z.object({
    type: z.literal("canvas:update"),
    roomId: z.number().int().positive(),
    operationId,
    element: canvasElement,
  }),
  z.object({
    type: z.literal("canvas:delete"),
    roomId: z.number().int().positive(),
    operationId,
    elementId: z.string().min(1).max(512),
  }),
  z.object({
    type: z.literal("canvas:batch"),
    roomId: z.number().int().positive(),
    clear: z.boolean().optional(),
    expectedRevision: z.number().int().nonnegative().safe().optional(),
    operations: z
      .array(canvasMutation)
      .min(1)
      .max(100)
      .superRefine((ops, ctx) => {
        const ids = new Set<string>();
        ops.forEach((op, index) => {
          if (ids.has(op.operationId)) {
            ctx.addIssue({
              code: "custom",
              message: "Duplicate operationId in batch",
              path: [index, "operationId"],
            });
          }
          ids.add(op.operationId);
        });
      }),
  }),
  z.object({
    type: z.literal("canvas:preview"),
    roomId: z.number().int().positive(),
    preview: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal("canvas:sync"),
    roomId: z.number().int().positive(),
    afterRevision: z.number().int().nonnegative().safe().optional(),
  }),
  z.object({
    type: z.literal("presence:update"),
    roomId: z.number().int().positive(),
    presence: z.record(z.string(), z.unknown()),
  }),
]);

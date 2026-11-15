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
]);

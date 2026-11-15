import test from "node:test";
import assert from "node:assert/strict";
import { CreateUserSchema, RoomSchema } from "@repo/common/schemas";
import { errorHandler } from "../dist/middleware/errors.js";
import { AppError } from "../dist/errors.js";

test("shared request schemas accept valid signup and room inputs", () => {
  assert.equal(
    CreateUserSchema.safeParse({
      email: "a@b.com",
      username: "artist",
      name: "Artist",
      password: "longpassword",
    }).success,
    true,
  );
  assert.equal(RoomSchema.safeParse({ roomName: "my-room" }).success, true);
});

test("shared request schemas reject invalid inputs", () => {
  assert.equal(
    CreateUserSchema.safeParse({
      email: "bad",
      username: "x",
      name: "x",
      password: "short",
    }).success,
    false,
  );
  assert.equal(RoomSchema.safeParse({ roomName: "x" }).success, false);
});

test("HTTP error middleware returns safe application and internal error responses", () => {
  const response = {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  errorHandler(
    new AppError(404, "Room not found", "ROOM_NOT_FOUND"),
    {},
    response,
    () => {},
  );
  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.body, {
    message: "Room not found",
    code: "ROOM_NOT_FOUND",
  });
  errorHandler(new Error("private stack detail"), {}, response, () => {});
  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body, { message: "Internal server error" });
});

import test from "node:test";
import assert from "node:assert/strict";
import { CreateUserSchema, RoomSchema } from "@repo/common/schemas";
import { errorHandler } from "../dist/middleware/errors.js";
import { AppError } from "../dist/errors.js";
import {
  signAccessToken,
  verifyAccessToken,
  FixedWindowLimiter,
} from "@repo/backend/config";
import jwt from "jsonwebtoken";

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

test("access tokens reject expiry, tampering and invalid identities while accepting signed legacy tokens", () => {
  const secret = "test-secret-that-is-at-least-thirty-two-characters";
  const token = signAccessToken(42, secret);
  assert.deepEqual(verifyAccessToken(token, secret), { id: 42 });
  assert.equal(verifyAccessToken(`${token.slice(0, -1)}x`, secret), null);
  assert.equal(
    verifyAccessToken(
      signAccessToken(42, "different-test-secret-that-is-long-enough"),
      secret,
    ),
    null,
  );
  const expired = jwt.sign(
    { id: 42, exp: Math.floor(Date.now() / 1000) - 1 },
    secret,
  );
  assert.equal(verifyAccessToken(expired, secret), null);
  assert.deepEqual(verifyAccessToken(jwt.sign({ id: 42 }, secret), secret), {
    id: 42,
  });
  assert.equal(verifyAccessToken(jwt.sign({ id: "42" }, secret), secret), null);
});

test("fixed-window limiter expires counters and limits key growth", () => {
  const limiter = new FixedWindowLimiter(2, 100, 1);
  assert.equal(limiter.consume("first", 1000).allowed, true);
  assert.equal(limiter.consume("first", 1001).allowed, true);
  assert.equal(limiter.consume("first", 1002).allowed, false);
  assert.equal(limiter.consume("second", 1003).allowed, true);
  assert.equal(limiter.consume("second", 1104).allowed, true);
});

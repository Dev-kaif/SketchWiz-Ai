import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createApp } from "../dist/app.js";
import { client } from "@repo/db/client";
import jwt from "jsonwebtoken";

let httpServer;
let baseUrl;
let email;
let userId;
let roomId;
let token;
let outsider;

before(async () => {
  await client.$connect();
  email = `batch011-${Date.now()}@example.test`;
  httpServer = createApp("*").listen(0, "127.0.0.1");
  await once(httpServer, "listening");
  baseUrl = `http://127.0.0.1:${httpServer.address().port}`;
});

after(async () => {
  if (roomId)
    await client.room.delete({ where: { id: roomId } }).catch(() => {});
  if (userId)
    await client.user.delete({ where: { id: userId } }).catch(() => {});
  if (outsider)
    await client.user.delete({ where: { id: outsider.id } }).catch(() => {});
  if (httpServer) await new Promise((resolve) => httpServer.close(resolve));
  await client.$disconnect();
});

test("signup, signin, protected room APIs and content clearing retain API contracts", async () => {
  const signup = await fetch(`${baseUrl}/api/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      username: `u${Date.now()}`,
      name: "Test User",
      password: "local-test-password",
    }),
  });
  assert.equal(signup.status, 201);
  assert.equal((await signup.json()).message, "User created successfully");
  const user = await client.user.findUnique({ where: { email } });
  userId = user.id;

  const signin = await fetch(`${baseUrl}/api/signin`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "local-test-password" }),
  });
  assert.equal(signin.status, 200);
  token = (await signin.json()).token;
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };

  const unauthenticatedAi = await fetch(`${baseUrl}/api/analyze/ai`, {
    method: "POST",
  });
  assert.equal(unauthenticatedAi.status, 401);
  for (let attempt = 0; attempt < 10; attempt++) {
    const missingImage = await fetch(`${baseUrl}/api/analyze/ai`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(missingImage.status, 400);
  }
  const limitedAi = await fetch(`${baseUrl}/api/analyze/ai`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(limitedAi.status, 429);

  const created = await fetch(`${baseUrl}/api/room`, {
    method: "POST",
    headers,
    body: JSON.stringify({ roomName: `room-${Date.now()}` }),
  });
  assert.equal(created.status, 200);
  const roomBody = await created.json();
  roomId = roomBody.room.id;
  assert.equal(
    (
      await client.roomMember.findUnique({
        where: { roomId_userId: { roomId, userId } },
      })
    ).role,
    "OWNER",
  );
  assert.ok(await client.canvas.findUnique({ where: { roomId } }));

  const rooms = await fetch(`${baseUrl}/api/rooms`, { headers });
  assert.equal(
    (await rooms.json()).rooms.some((room) => room.id === roomId),
    true,
  );
  const bySlug = await fetch(`${baseUrl}/api/room/slug/${roomBody.room.slug}`, {
    headers,
  });
  assert.equal((await bySlug.json()).room.id, roomId);
  const history = await fetch(`${baseUrl}/api/room/${roomId}`, { headers });
  assert.deepEqual((await history.json()).messages, []);

  await client.chat.create({
    data: {
      roomId,
      userId,
      message: JSON.stringify({
        id: "clear-shape",
        type: "text",
        content: "cleanup",
      }),
    },
  });
  const canvas = await client.canvas.findUnique({ where: { roomId } });
  await client.canvasElement.create({
    data: {
      id: `${canvas.id}:clear-shape`,
      canvasId: canvas.id,
      revision: 1n,
      properties: { id: "clear-shape", type: "text" },
    },
  });
  await client.canvasOperation.create({
    data: {
      operationId: `clear-${Date.now()}`,
      canvasId: canvas.id,
      revision: 1n,
      actorId: userId,
      kind: "upsert_element",
      payload: { id: "clear-shape" },
    },
  });
  await client.canvasSnapshot.create({
    data: { canvasId: canvas.id, revision: 1n, state: { shapes: [] } },
  });
  const cleared = await fetch(`${baseUrl}/api/room/delete/content/${roomId}`, {
    method: "DELETE",
    headers,
  });
  assert.equal((await cleared.json()).response.count, 1);
  assert.equal(
    await client.canvasElement.count({ where: { canvasId: canvas.id } }),
    0,
  );
  assert.equal(
    await client.canvasOperation.count({ where: { canvasId: canvas.id } }),
    0,
  );
  assert.equal(
    await client.canvasSnapshot.count({ where: { canvasId: canvas.id } }),
    0,
  );
  const unauthorized = await fetch(`${baseUrl}/api/rooms`);
  assert.equal(unauthorized.status, 401);

  outsider = await client.user.create({
    data: {
      email: `outsider-${Date.now()}@example.test`,
      username: `outsider${Date.now()}`,
      name: "Room outsider",
      password: "test-hash",
    },
  });
  const outsiderHeaders = {
    authorization: `Bearer ${jwt.sign({ id: outsider.id }, process.env.JWT_SECRET)}`,
  };
  const makePrivate = await fetch(`${baseUrl}/api/room/${roomId}/visibility`, {
    method: "PATCH",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ visibility: "PRIVATE" }),
  });
  assert.equal(makePrivate.status, 200);
  const deniedSlug = await fetch(
    `${baseUrl}/api/room/slug/${roomBody.room.slug}`,
    {
      headers: outsiderHeaders,
    },
  );
  assert.equal(deniedSlug.status, 404);
  const deniedHistory = await fetch(`${baseUrl}/api/room/${roomId}`, {
    headers: outsiderHeaders,
  });
  assert.equal(deniedHistory.status, 404);
  const deniedClear = await fetch(
    `${baseUrl}/api/room/delete/content/${roomId}`,
    { method: "DELETE", headers: outsiderHeaders },
  );
  assert.equal(deniedClear.status, 404);
  const deniedDelete = await fetch(`${baseUrl}/api/room/delete/${roomId}`, {
    method: "DELETE",
    headers: outsiderHeaders,
  });
  assert.equal(deniedDelete.status, 404);

  const addedViewer = await fetch(`${baseUrl}/api/room/${roomId}/members`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ userId: outsider.id, role: "VIEWER" }),
  });
  assert.equal(addedViewer.status, 200);
  assert.equal((await addedViewer.json()).member.role, "VIEWER");
  const viewerClear = await fetch(
    `${baseUrl}/api/room/delete/content/${roomId}`,
    { method: "DELETE", headers: outsiderHeaders },
  );
  assert.equal(viewerClear.status, 403);
  const allowedHistory = await fetch(`${baseUrl}/api/room/${roomId}`, {
    headers: outsiderHeaders,
  });
  assert.equal(allowedHistory.status, 200);
  const removeViewer = await fetch(
    `${baseUrl}/api/room/${roomId}/members/${outsider.id}`,
    {
      method: "DELETE",
      headers: outsiderHeaders,
    },
  );
  assert.equal(removeViewer.status, 403);
});

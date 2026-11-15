import test from "node:test";
import assert from "node:assert/strict";
import { parseSocketMessage } from "../dist/messages.js";

test("accepts existing join and drawing chat messages", () => {
  assert.equal(
    parseSocketMessage(JSON.stringify({ type: "join_room", roomId: 7 }))
      .success,
    true,
  );
  assert.equal(
    parseSocketMessage(
      JSON.stringify({
        type: "chat",
        roomId: 7,
        message: { id: "shape-1", type: "line" },
      }),
    ).success,
    true,
  );
});

test("rejects invalid JSON, unknown event types, and malformed room IDs", () => {
  assert.equal(parseSocketMessage("{"), null);
  assert.equal(
    parseSocketMessage(JSON.stringify({ type: "erase_everything", roomId: 7 }))
      .success,
    false,
  );
  assert.equal(
    parseSocketMessage(JSON.stringify({ type: "join_room", roomId: -1 }))
      .success,
    false,
  );
});

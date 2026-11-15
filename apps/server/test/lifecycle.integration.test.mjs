import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function verifyShutdown(entry, port, readyLog, healthUrl) {
  const child = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      NODE_ENV: "test",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let timer;
  try {
    const startup = new Promise((resolve, reject) => {
      const onData = (chunk) => {
        output += chunk.toString();
        if (output.includes(readyLog)) resolve();
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      child.once("error", reject);
      child.once("exit", (code) =>
        reject(new Error(`service exited early (${code}): ${output}`)),
      );
      timer = setTimeout(
        () => reject(new Error(`service did not start: ${output}`)),
        10_000,
      );
    });
    await startup;
    clearTimeout(timer);
    if (healthUrl) {
      const response = await fetch(healthUrl);
      assert.equal(response.status, 200);
      assert.equal(await response.text(), "pong");
    }
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    const [code, signal] = await exited;
    assert.equal(signal, null);
    assert.equal(code, 0, output);
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}

test("HTTP and WebSocket services start and exit cleanly on SIGTERM", async () => {
  assert.ok(process.env.DATABASE_URL, "set DATABASE_URL to local PostgreSQL");
  const httpPort = await freePort();
  const wsPort = await freePort();
  const httpEntry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
  const websocketEntry = fileURLToPath(
    new URL("../../websocket/dist/index.js", import.meta.url),
  );

  await verifyShutdown(
    httpEntry,
    httpPort,
    "HTTP server listening",
    `http://127.0.0.1:${httpPort}/api/ping`,
  );
  await verifyShutdown(websocketEntry, wsPort, "WebSocket server listening");
});

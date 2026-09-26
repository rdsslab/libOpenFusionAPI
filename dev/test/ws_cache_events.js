import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { basicAuthHeader } from "./test_credentials.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "../..");
const BASE_URL = process.env.WS_CACHE_TEST_BASE_URL || "http://localhost:3000";
const WS_URL = process.env.WS_CACHE_TEST_WS_URL || "ws://localhost:3000/ws/system/websocket/server/prd";

const DEMO_IDAPP = "c4ca4238-a0b9-2382-0dcc-509a6f75849b";
const SYSTEM_LOGIN_PATH = "/api/system/system/login/prd";
const SYSTEM_CACHE_INVALIDATE_PATH = "/api/system/cache/invalidate/prd";
const CACHEABLE_DEMO_PATH = "/api/demo/ofapi/examples/js/echo_name/dev?name=ws_cache_probe_20260522";
const BASIC_AUTH_HEADER = basicAuthHeader();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function call(pathname, options = {}) {
  const response = await fetch(`${BASE_URL}${pathname}`, options);
  const text = await response.text();
  let data = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    data,
    text,
  };
}

async function waitForServer(maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i += 1) {
    try {
      const response = await call(SYSTEM_LOGIN_PATH, { method: "POST" });
      if ([200, 400, 401].includes(response.status)) {
        return true;
      }
    } catch {
      // Not ready yet.
    }

    await sleep(1500);
  }

  return false;
}

async function ensureServer() {
  if (await waitForServer(2)) {
    return { spawned: null };
  }

  // cwd = raíz del proyecto: `src/lib/index.js` hace `import "dotenv/config"`, que
  // busca el .env desde process.cwd(). Con cwd en dev/test el servidor arrancaba en
  // modo degradado (JWT_KEY sin definir) y respondía 503 a todo.
  const server = spawn("node", ["--max-old-space-size=4096", path.join(ROOT_DIR, "src/server.js")], {
    cwd: ROOT_DIR,
    stdio: "inherit",
    env: {
      ...process.env,
      PORT: new URL(BASE_URL).port || "3000",
      BUILD_DB: process.env.BUILD_DB || "true",
    },
  });

  const ready = await waitForServer(50);
  if (!ready) {
    server.kill();
    throw new Error("Server failed to start in time for websocket cache test.");
  }

  return { spawned: server };
}

async function loginAsAdmin() {
  const response = await call(SYSTEM_LOGIN_PATH, {
    method: "POST",
    headers: {
      Authorization: BASIC_AUTH_HEADER,
    },
  });

  assert.equal(response.status, 200, `Admin login failed: ${response.text}`);
  assert.ok(response.data?.token, "Admin login must return a bearer token.");
  return response.data.token;
}

function connectWebSocket() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function waitForSubscribeAck(ws, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.removeListener("message", onMessage);
      reject(new Error("Timeout waiting for websocket subscribe ack."));
    }, timeoutMs);

    const onMessage = (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg?.subscribed === true && msg?.channel === "/server/events") {
        clearTimeout(timeout);
        ws.removeListener("message", onMessage);
        resolve(msg);
      }
    };

    ws.on("message", onMessage);
  });
}

function waitForEvent(ws, matcher, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.removeListener("message", onMessage);
      reject(new Error("Timeout waiting for websocket event."));
    }, timeoutMs);

    const onMessage = (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (matcher(msg)) {
        clearTimeout(timeout);
        ws.removeListener("message", onMessage);
        resolve(msg);
      }
    };

    ws.on("message", onMessage);
  });
}

async function runTests() {
  console.log("=== WS Cache Events Validation Test ===");
  const serverState = await ensureServer();
  let ws = null;

  try {
    const token = await loginAsAdmin();
    const bearerHeaders = { Authorization: `Bearer ${token}` };

    console.log("[1/4] Connecting websocket and subscribing to /server/events...");
    ws = await connectWebSocket();
    ws.send(JSON.stringify({ channel: "/subscribe", payload: { channel: "/server/events" } }));
    const subscribed = await waitForSubscribeAck(ws);
    assert.equal(subscribed.subscribed, true, "Failed to subscribe websocket channel /server/events.");

    console.log("[2/4] Triggering cache_set by hitting a cacheable demo endpoint...");
    await call(SYSTEM_CACHE_INVALIDATE_PATH, {
      method: "POST",
      headers: {
        ...bearerHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ idapp: DEMO_IDAPP, environment: "dev", reason: "ws_cache_events_test_start" }),
    });

    const cacheSetPromise = waitForEvent(
      ws,
      (msg) => msg?.event_name === "cache_set" && msg?.data?.app === "demo" && msg?.data?.resource === "/ofapi/examples/js/echo_name",
      12000,
    );

    const first = await call(CACHEABLE_DEMO_PATH, { method: "GET" });
    const second = await call(CACHEABLE_DEMO_PATH, { method: "GET" });
    assert.equal(first.headers["x-cache"], "MISS", `Expected first cacheable call MISS, got: ${first.headers["x-cache"]}`);
    assert.equal(second.headers["x-cache"], "HIT", `Expected second cacheable call HIT, got: ${second.headers["x-cache"]}`);

    const cacheSetEvent = await cacheSetPromise;
    assert.ok(cacheSetEvent?.data?.idendpoint, "cache_set event did not include idendpoint.");

    console.log("[3/4] Triggering cache_released by invalidating that endpoint cache...");
    const targetIdendpoint = cacheSetEvent.data.idendpoint;

    const cacheReleasedPromise = waitForEvent(
      ws,
      (msg) =>
        msg?.event_name === "cache_released" &&
        msg?.data?.idendpoint === targetIdendpoint &&
        msg?.data?.app === "demo",
      12000,
    );

    const invalidate = await call(SYSTEM_CACHE_INVALIDATE_PATH, {
      method: "POST",
      headers: {
        ...bearerHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ idendpoint: targetIdendpoint, reason: "ws_cache_events_test_release" }),
    });
    assert.equal(invalidate.status, 200, `Cache invalidate call failed: ${invalidate.text}`);
    assert.ok(Number(invalidate.data?.removed ?? 0) > 0, `Expected invalidate removed > 0, got: ${JSON.stringify(invalidate.data)}`);

    const cacheReleasedEvent = await cacheReleasedPromise;
    assert.equal(cacheReleasedEvent.data.idendpoint, targetIdendpoint, "cache_released event endpoint mismatch.");

    console.log("[4/4] Verifying websocket cache events observed (cache_set + cache_released)...");
    assert.equal(cacheSetEvent.event_name, "cache_set");
    assert.equal(cacheReleasedEvent.event_name, "cache_released");

    console.log("=== WS cache events validation passed ===");
  } finally {
    if (ws) {
      try {
        ws.close();
      } catch {
        // ignore close error
      }
    }

    if (serverState.spawned) {
      serverState.spawned.kill();
    }
  }
}

runTests().catch((error) => {
  console.error("WS cache events validation failed.");
  console.error(error);
  process.exit(1);
});
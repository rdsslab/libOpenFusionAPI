import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TEST_BASE_URL, basicAuthHeader } from "./test_credentials.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "../..");
// `OFAPI_BASE_URL` es la convencion de este directorio. El nombre propio se conserva
// como repliegue y no como alternativa: hoy funciona, y quitarlo sin avisar costaria
// una hora a quien lo tenga puesto.
const BASE_URL = process.env.OFAPI_BASE_URL || process.env.CACHE_TEST_BASE_URL || TEST_BASE_URL;
const DEMO_IDAPP = "c4ca4238-a0b9-2382-0dcc-509a6f75849b";
const SYSTEM_LOGIN_PATH = "/api/system/system/login/prd";
const SYSTEM_CACHE_STATUS_PATH = "/api/system/cache/status/prd";
const SYSTEM_CACHE_INVALIDATE_PATH = "/api/system/cache/invalidate/prd";
const CACHEABLE_DEMO_PATH = "/api/demo/ofapi/examples/js/echo_name/dev?name=cache_probe_20260522";
const NO_CACHE_DEMO_PATH = "/api/demo/ofapi/examples/js/sum_numbers/dev?a=10&b=20";
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
    throw new Error("Server failed to start in time for cache validation.");
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
  assert.ok(response.data?.token, "Admin login must return token.");
  return response.data.token;
}

function getStatusEntries(payload) {
  if (Array.isArray(payload?.entries)) {
    return payload.entries;
  }
  if (Array.isArray(payload?.result)) {
    return payload.result;
  }
  if (Array.isArray(payload)) {
    return payload;
  }
  return [];
}

async function runTests() {
  console.log("=== Cache Validation Test ===");

  const serverState = await ensureServer();
  try {
    const token = await loginAsAdmin();
    const bearerHeaders = { Authorization: `Bearer ${token}` };

    // Ensure deterministic state when this test runs after other suites.
    await call(SYSTEM_CACHE_INVALIDATE_PATH, {
      method: "POST",
      headers: {
        ...bearerHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        idapp: DEMO_IDAPP,
        environment: "dev",
        reason: "cache_validation_test_start",
      }),
    });

    console.log("[1/6] Checking non-cache endpoint behavior...");
    const noCacheFirst = await call(NO_CACHE_DEMO_PATH, { method: "GET" });
    const noCacheSecond = await call(NO_CACHE_DEMO_PATH, { method: "GET" });
    assert.ok(
      !noCacheFirst.headers["x-cache"] && !noCacheSecond.headers["x-cache"],
      `Non-cache endpoint unexpectedly returned X-Cache header: first=${noCacheFirst.headers["x-cache"]}, second=${noCacheSecond.headers["x-cache"]}`,
    );

    console.log("[2/6] Checking cacheable endpoint MISS -> HIT...");
    const cacheFirst = await call(CACHEABLE_DEMO_PATH, { method: "GET" });
    const cacheSecond = await call(CACHEABLE_DEMO_PATH, { method: "GET" });
    assert.equal(cacheFirst.headers["x-cache"], "MISS", `Expected first cache call MISS, got: ${cacheFirst.headers["x-cache"]}`);
    assert.equal(cacheSecond.headers["x-cache"], "HIT", `Expected second cache call HIT, got: ${cacheSecond.headers["x-cache"]}`);

    console.log("[3/6] Reading cache status before invalidation...");
    const statusBefore = await call(
      `${SYSTEM_CACHE_STATUS_PATH}?idapp=${DEMO_IDAPP}&environment=dev`,
      {
        method: "GET",
        headers: bearerHeaders,
      },
    );
    assert.equal(statusBefore.status, 200, `Cache status before invalidation failed: ${statusBefore.text}`);
    const entriesBefore = getStatusEntries(statusBefore.data);
    const totalBefore = Number(statusBefore.data?.total ?? entriesBefore.length);
    assert.ok(totalBefore > 0, `Expected cached entries before invalidation, got total=${totalBefore}`);

    console.log("[4/6] Invalidating cache for demo/dev...");
    const invalidateResponse = await call(SYSTEM_CACHE_INVALIDATE_PATH, {
      method: "POST",
      headers: {
        ...bearerHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        idapp: DEMO_IDAPP,
        environment: "dev",
        reason: "dev/test/cache_validation.js",
      }),
    });
    assert.equal(invalidateResponse.status, 200, `Cache invalidate failed: ${invalidateResponse.text}`);

    console.log("[5/6] Reading cache status after invalidation...");
    const statusAfter = await call(
      `${SYSTEM_CACHE_STATUS_PATH}?idapp=${DEMO_IDAPP}&environment=dev`,
      {
        method: "GET",
        headers: bearerHeaders,
      },
    );
    assert.equal(statusAfter.status, 200, `Cache status after invalidation failed: ${statusAfter.text}`);
    const entriesAfter = getStatusEntries(statusAfter.data);
    const totalAfter = Number(statusAfter.data?.total ?? entriesAfter.length);
    assert.equal(totalAfter, 0, `Expected empty cache after invalidation, got total=${totalAfter}`);

    console.log("[6/6] Verifying cache rebuild starts with MISS then HIT...");
    const cacheThird = await call(CACHEABLE_DEMO_PATH, { method: "GET" });
    const cacheFourth = await call(CACHEABLE_DEMO_PATH, { method: "GET" });
    assert.equal(cacheThird.headers["x-cache"], "MISS", `Expected third cache call MISS after invalidation, got: ${cacheThird.headers["x-cache"]}`);
    assert.equal(cacheFourth.headers["x-cache"], "HIT", `Expected fourth cache call HIT after invalidation, got: ${cacheFourth.headers["x-cache"]}`);

    console.log("=== Cache validation passed ===");
  } finally {
    if (serverState.spawned) {
      serverState.spawned.kill();
    }
  }
}

runTests().catch((error) => {
  console.error("Cache validation test failed.");
  console.error(error);
  process.exit(1);
});
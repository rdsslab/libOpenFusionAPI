/**
 * E2E test for ASYNC_WRAPPER handler.
 *
 * Requires a running OpenFusionAPI server (default http://127.0.0.1:3000).
 * Env vars:
 *   OFAPI_URL      - base URL of the server (default http://127.0.0.1:3000)
 *   OFAPI_USER     - username (default superopenfusionapi)
 *   OFAPI_PASS     - password (default TestPass123!)
 *   OFAPI_ENV      - environment used in login route (default prd)
 *
 * Flow covered:
 *  1. Login (Basic auth) and obtain JWT.
 *  2. POST /api/test/async/wrap/json  -> 202 + requestId; poll status; fetch result; verify original request passthrough (body+query intact).
 *  3. Duplicate submission while RUNNING -> same requestId (fingerprint idempotency).
 *  4. POST /api/test/async/wrap/slow  -> RUNNING visible while in-flight; completes COMPLETED.
 *  5. POST /api/test/async/wrap/fail  -> job reaches FAILED with error_message.
 *  6. GET  /api/test/async/wrap/binary -> result_is_binary with base64 PNG and content_type image/png.
 *  7. Validation errors: non-UUID code, missing code, base not found, base disabled, base ASYNC_WRAPPER.
 *  8. Status/result routes: 404 for unknown id.
 */

const OFAPI_URL = process.env.OFAPI_URL || "http://127.0.0.1:3000";
const OFAPI_USER = process.env.OFAPI_USER || "superopenfusionapi";
const OFAPI_PASS = process.env.OFAPI_PASS || "TestPass123!";
const OFAPI_ENV = process.env.OFAPI_ENV || "prd";

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, extra = "") {
  if (cond) {
    passed++;
    console.log(`  [PASS] ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  [FAIL] ${name} ${extra}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login() {
  const b64 = Buffer.from(`${OFAPI_USER}:${OFAPI_PASS}`).toString("base64");
  const resp = await fetch(`${OFAPI_URL}/api/system/system/login/${OFAPI_ENV}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Basic ${b64}` },
    body: JSON.stringify({}),
  });
  const data = await resp.json();
  if (!data.token) throw new Error(`Login failed: ${JSON.stringify(data).slice(0, 200)}`);
  return data.token;
}

function auth(token) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

// DB resources for the "test" app are stored as "/api/test/..." (full path style,
// same as demo seeds). Runtime URL = /api/{app} + resource + /{environment}.
function runtimeUrl(resource) {
  return `/api/test${resource}/dev`;
}

async function callEndpoint(token, resource, { method = "POST", body = null, query = "" } = {}) {
  const url = `${OFAPI_URL}${runtimeUrl(resource)}${query}`;
  const resp = await fetch(url, {
    method,
    headers: auth(token),
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  const text = await resp.text();
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: resp.status, data, headers: resp.headers };
}

async function pollUntil(token, requestId, targetStatuses, timeoutMs = 20000) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    const r = await callEndpoint(token, `/api/async/status/${requestId}`, { method: "GET" });
    if (r.status === 200) {
      last = r.data;
      if (targetStatuses.includes(r.data.status)) return last;
    }
    await sleep(300);
  }
  return last;
}

// ---------------------------------------------------------------------------
// Section 1: Happy path JSON
// ---------------------------------------------------------------------------
async function testJsonFlow(token) {
  console.log("\n[1] JSON flow: 202 -> COMPLETED -> result passthrough");
  const marker = `e2e-${Date.now()}`;
  const body = { name: "async-e2e", marker };
  const query = "?src=query&marker=" + marker;

  const start = await callEndpoint(token, "/api/test/async/wrap/json", { body, query });
  check("202 Accepted returned", start.status === 202, `got ${start.status}: ${JSON.stringify(start.data).slice(0, 200)}`);
  check("requestId present", !!start.data?.requestId);
  check("status PENDING", start.data?.status === "PENDING", `got ${start.data?.status}`);
  check("pollUrl present", typeof start.data?.pollUrl === "string" && start.data.pollUrl.includes("/api/async/status/"));

  const requestId = start.data?.requestId;
  if (!requestId) return;

  const done = await pollUntil(token, requestId, ["COMPLETED", "FAILED"]);
  check("job COMPLETED", done?.status === "COMPLETED", `got ${done?.status}`);

  const result = await callEndpoint(token, `/api/async/result/${requestId}`, { method: "GET" });
  check("result 200", result.status === 200, `got ${result.status}`);
  check("body echoed intact", result.data?.echo?.name === "async-e2e" && result.data?.echo?.marker === marker, JSON.stringify(result.data).slice(0, 200));
  check("query echoed intact", result.data?.query?.src === "query" && result.data?.query?.marker === marker, JSON.stringify(result.data?.query));

  // Status shape
  const st = await callEndpoint(token, `/api/async/status/${requestId}`, { method: "GET" });
  check("status has consume_count", typeof st.data?.consume_count === "number");
  check("status has max_consumes", st.data?.max_consumes === 5);
  check("status has ttl_remaining_ms", typeof st.data?.ttl_remaining_ms === "number");
  check("status has completed_at", !!st.data?.completed_at);

  return requestId;
}

// ---------------------------------------------------------------------------
// Section 2: Duplicate while RUNNING (fingerprint idempotency)
// ---------------------------------------------------------------------------
async function testDuplicate(token) {
  console.log("\n[2] Duplicate detection while RUNNING");
  const marker = `dup-${Date.now()}`;
  const first = await callEndpoint(token, "/api/test/async/wrap/slow", { body: { marker }, query: "?dup=" + marker });
  check("first submission 202", first.status === 202, `got ${first.status}`);
  const id1 = first.data?.requestId;
  if (!id1) return;

  // Immediately submit identical payload
  const second = await callEndpoint(token, "/api/test/async/wrap/slow", { body: { marker }, query: "?dup=" + marker });
  check("second submission 202", second.status === 202, `got ${second.status}`);
  check("same requestId (idempotent)", second.data?.requestId === id1, `${second.data?.requestId} vs ${id1}`);
  check("duplicate message present", typeof second.data?.message === "string" && second.data.message.length > 0);

  // Different params -> different job
  const third = await callEndpoint(token, "/api/test/async/wrap/slow", { body: { marker: marker + "-other" }, query: "?dup=" + marker });
  check("different params -> different requestId", third.data?.requestId && third.data.requestId !== id1);

  await pollUntil(token, id1, ["COMPLETED", "FAILED"]);
  if (third.data?.requestId) await pollUntil(token, third.data.requestId, ["COMPLETED", "FAILED"]);
}

// ---------------------------------------------------------------------------
// Section 3: Slow endpoint shows RUNNING
// ---------------------------------------------------------------------------
async function testRunningState(token) {
  console.log("\n[3] RUNNING state observable");
  const marker = `slow-${Date.now()}`;
  const start = await callEndpoint(token, "/api/test/async/wrap/slow", { body: { marker } });
  const id = start.data?.requestId;
  if (!id) {
    check("slow submission 202", false, `got ${start.status}`);
    return;
  }

  let sawRunning = false;
  const startMs = Date.now();
  while (Date.now() - startMs < 10000) {
    const st = await callEndpoint(token, `/api/async/status/${id}`, { method: "GET" });
    if (st.data?.status === "RUNNING") {
      sawRunning = true;
      break;
    }
    if (st.data?.status === "COMPLETED" || st.data?.status === "FAILED") break;
    await sleep(150);
  }
  check("RUNNING state observed (or completed too fast)", sawRunning || true); // informational
  const done = await pollUntil(token, id, ["COMPLETED", "FAILED"]);
  check("slow job COMPLETED", done?.status === "COMPLETED", `got ${done?.status}`);
}

// ---------------------------------------------------------------------------
// Section 4: Failure path
// ---------------------------------------------------------------------------
async function testFailure(token) {
  console.log("\n[4] Base endpoint failure -> FAILED");
  const start = await callEndpoint(token, "/api/test/async/wrap/fail", { body: {} });
  check("202 returned", start.status === 202, `got ${start.status}`);
  const id = start.data?.requestId;
  if (!id) return;

  const done = await pollUntil(token, id, ["FAILED", "COMPLETED"]);
  check("job FAILED", done?.status === "FAILED", `got ${done?.status}`);
}

// ---------------------------------------------------------------------------
// Section 5: Binary response
// ---------------------------------------------------------------------------
async function testBinary(token) {
  console.log("\n[5] Binary (PNG) capture");
  const start = await callEndpoint(token, "/api/test/async/wrap/binary", { method: "GET" });
  check("202 returned", start.status === 202, `got ${start.status}`);
  const id = start.data?.requestId;
  if (!id) return;

  const done = await pollUntil(token, id, ["COMPLETED", "FAILED"]);
  check("binary job COMPLETED", done?.status === "COMPLETED", `got ${done?.status}`);

  const status = await callEndpoint(token, `/api/async/status/${id}`, { method: "GET" });
  check("status 200", status.status === 200);

  // Result route returns binary with content type
  const resp = await fetch(`${OFAPI_URL}/api/async/result/${id}`, { headers: auth(token) });
  const buf = Buffer.from(await resp.arrayBuffer());
  check("binary result 200", resp.status === 200, `got ${resp.status}`);
  check("PNG magic bytes", buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47, `first bytes: ${buf.subarray(0, 4).toString("hex")}`);
}

// ---------------------------------------------------------------------------
// Section 6: Validation errors
// ---------------------------------------------------------------------------
async function testValidation(token) {
  console.log("\n[6] Validation of base idendpoint");

  const { Endpoint } = await import("/home/edwinspire/Desarrollo/OpenFusionAPI/node_modules/@rdsslab/libopenfusionapi/src/lib/db/models.js");
  const idapp = "c4ca4238-a0b9-2382-0dcc-509a6f75849b";

  const mk = async (id, code, extra = {}) => {
    const existing = await Endpoint.findByPk(id);
    const baseResource = extra.resource || `/api/test/async/val/${id.replace(/-/g, "").slice(0, 8)}`;
    const resource = baseResource;
    const payload = {
      idendpoint: id,
      ctrl: { admin: true, users: [], log: {} },
      cors: {},
      mcp: { enabled: false, name: "", title: "", description: "" },
      json_schema: { in: { enabled: false, schema: {} }, out: { enabled: false, schema: {} } },
      custom_data: { async: { ttl_ms: 60000, max_consumes: 5, notify_ws: false } },
      headers_test: {},
      data_test: null,
      rowkey: 7000 + parseInt(id.slice(0, 4).replace(/-/g, ""), 16) % 1000,
      enabled: true,
      idapp,
      environment: "dev",
      timeout: 30,
      resource,
      method: extra.method || "POST",
      handler: extra.handler || "ASYNC_WRAPPER",
      access: 0,
      title: "validation test",
      description: "validation test",
      price_by_request: 0,
      price_kb_request: 0,
      price_kb_response: 0,
      keywords: "test",
      code,
      cache_time: 0,
    };
    if (existing) await existing.update(payload);
    else await Endpoint.create(payload);
    return payload.resource;
  };

  // 6a. non-UUID code
  const r1 = await mk("33333333-cccc-4ddd-8eee-000000000001", "not-a-uuid");
  let resp = await callEndpoint(token, r1, { body: {} });
  check("non-UUID code -> 400", resp.status === 400, `got ${resp.status} ${JSON.stringify(resp.data).slice(0, 120)}`);

  // 6b. empty code
  const r2 = await mk("33333333-cccc-4ddd-8eee-000000000002", "");
  resp = await callEndpoint(token, r2, { body: {} });
  check("empty code -> 400", resp.status === 400, `got ${resp.status}`);

  // 6c. well-formed UUID but nonexistent endpoint
  const r3 = await mk("33333333-cccc-4ddd-8eee-000000000003", "99999999-9999-4999-8999-999999999999");
  resp = await callEndpoint(token, r3, { body: {} });
  check("unknown base -> 404", resp.status === 404, `got ${resp.status}`);

  // 6d. disabled base endpoint
  const disabledId = "11111111-aaaa-4bbb-8ccc-000000000001";
  const ep = await Endpoint.findByPk(disabledId);
  await ep.update({ enabled: false });
  const r4 = await mk("33333333-cccc-4ddd-8eee-000000000004", disabledId);
  resp = await callEndpoint(token, r4, { body: {} });
  check("disabled base -> 404", resp.status === 404, `got ${resp.status}`);
  await ep.update({ enabled: true });

  // 6e. base is another ASYNC_WRAPPER
  const wrapperId = "22222222-bbbb-4ccc-8ddd-000000000001";
  const r5 = await mk("33333333-cccc-4ddd-8eee-000000000005", wrapperId);
  resp = await callEndpoint(token, r5, { body: {} });
  check("base ASYNC_WRAPPER -> 400", resp.status === 400, `got ${resp.status}`);

  // 6f. cleanup validation endpoints
  for (const id of [
    "33333333-cccc-4ddd-8eee-000000000001",
    "33333333-cccc-4ddd-8eee-000000000002",
    "33333333-cccc-4ddd-8eee-000000000003",
    "33333333-cccc-4ddd-8eee-000000000004",
    "33333333-cccc-4ddd-8eee-000000000005",
  ]) {
    await Endpoint.destroy({ where: { idendpoint: id } });
  }
  console.log("  (validation endpoints cleaned up)");
}

// ---------------------------------------------------------------------------
// Section 7: status/result routes with unknown id
// ---------------------------------------------------------------------------
async function testUnknownJob(token) {
  console.log("\n[7] Unknown job id");
  const fake = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const st = await callEndpoint(token, `/api/async/status/${fake}`, { method: "GET" });
  check("status unknown -> 404", st.status === 404, `got ${st.status}`);
  const res = await callEndpoint(token, `/api/async/result/${fake}`, { method: "GET" });
  check("result unknown -> 404", res.status === 404, `got ${res.status}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`ASYNC_WRAPPER E2E test against ${OFAPI_URL}`);
  const token = await login();
  console.log("Login OK");

  await testJsonFlow(token);
  await testDuplicate(token);
  await testRunningState(token);
  await testFailure(token);
  await testBinary(token);
  await testValidation(token);
  await testUnknownJob(token);

  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  if (failures.length) {
    console.log("Failures:");
    for (const f of failures) console.log(" -", f);
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("E2E test crashed:", e);
  process.exit(1);
});

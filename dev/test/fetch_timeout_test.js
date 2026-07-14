import assert from "node:assert";
import { fetchFunction } from "../../src/lib/handler/fetchFunction.js";

const baseUrl = "http://localhost:3000";
const authHeader = "Basic " + Buffer.from("admin:admin@admin").toString("base64");

const call = async (url, options = {}) => {
  const res = await fetch(url, options);
  let data;
  try {
    data = await res.json();
  } catch (error) {
    data = null;
  }
  return { status: res.status, data };
};

const callWithRetry = async (url, options = {}, retries = 5, delay = 600) => {
  for (let i = 0; i < retries; i++) {
    const result = await call(url, options);
    if (result.status !== 404) {
      return result;
    }

    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  return call(url, options);
};

async function login() {
  const loginRes = await call(`${baseUrl}/api/system/system/login/prd`, {
    method: "POST",
    headers: { Authorization: authHeader },
  });

  assert.strictEqual(loginRes.status, 200, `Login failed: ${JSON.stringify(loginRes.data)}`);
  assert.ok(loginRes.data?.token, "Login token was not returned.");

  return {
    Authorization: `Bearer ${loginRes.data.token}`,
    "Content-Type": "application/json",
  };
}

async function getDemoIdapp(headers) {
  const listAppsRes = await call(`${baseUrl}/api/system/api/apps/catalog/prd`, {
    method: "POST",
    headers,
    body: JSON.stringify({}),
  });

  assert.strictEqual(listAppsRes.status, 200, "Unable to list applications.");
  const demoApp = listAppsRes.data.find((a) => a.app === "demo");
  assert.ok(demoApp?.idapp, "Demo app not found in catalog.");
  return demoApp.idapp;
}

async function upsertEndpoint(headers, payload) {
  const res = await call(`${baseUrl}/api/system/api/endpoint/prd`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  assert.strictEqual(res.status, 200, `Endpoint upsert failed: ${JSON.stringify(res.data)}`);
  return res.data?.result?.idendpoint;
}

async function deleteEndpoint(headers, idendpoint) {
  if (!idendpoint) {
    return;
  }

  await call(`${baseUrl}/api/system/api/endpoint/prd`, {
    method: "DELETE",
    headers,
    body: JSON.stringify({ idendpoint }),
  });
}

async function runIntegration504Test() {
  console.log("[FETCH timeout] Running integration test for endpoint timeout propagation (504)...");

  const headers = await login();
  const idapp = await getDemoIdapp(headers);

  const ts = Date.now();
  const sourceResource = `/test_fetch_timeout_source_${ts}`;
  const proxyResource = `/test_fetch_timeout_proxy_${ts}`;

  let sourceIdendpoint = null;
  let proxyIdendpoint = null;

  try {
    sourceIdendpoint = await upsertEndpoint(headers, {
      idapp,
      resource: sourceResource,
      method: "GET",
      environment: "dev",
      handler: "JS",
      timeout: 30,
      access: 0,
      enabled: true,
      code: "await new Promise((resolve) => setTimeout(resolve, 2500)); $_RETURN_DATA_ = { ok: true, source: 'slow-endpoint' };",
    });

    proxyIdendpoint = await upsertEndpoint(headers, {
      idapp,
      resource: proxyResource,
      method: "GET",
      environment: "dev",
      handler: "FETCH",
      timeout: 1,
      access: 0,
      enabled: true,
      code: `${baseUrl}/api/demo${sourceResource}/dev`,
    });

    const proxyRes = await callWithRetry(`${baseUrl}/api/demo${proxyResource}/dev`, {
      method: "GET",
    });

    assert.strictEqual(proxyRes.status, 504, `Expected 504 timeout, got ${proxyRes.status}.`);
    assert.ok(proxyRes.data?.error, "Expected error payload for timeout.");
    assert.ok(proxyRes.data?.detail?.message, "Expected original timeout detail in payload.");
  } finally {
    await deleteEndpoint(headers, proxyIdendpoint);
    await deleteEndpoint(headers, sourceIdendpoint);
  }
}

async function runInvalidTimeout400Test() {
  console.log("[FETCH timeout] Running handler-level invalid timeout test (400)...");

  const request = {
    method: "GET",
    body: undefined,
    query: undefined,
    headers: {},
  };

  const replyState = {
    statusCode: null,
    payload: null,
  };

  const reply = {
    code(statusCode) {
      replyState.statusCode = statusCode;
      return this;
    },
    send(payload) {
      replyState.payload = payload;
      return this;
    },
  };

  await fetchFunction({
    request,
    reply,
    method: {
      timeout: "not-a-number",
      code: "https://example.com",
      custom_data: {},
    },
    endpoint: {
      environment: "dev",
    },
  });

  assert.strictEqual(replyState.statusCode, 400, "Invalid timeout must return HTTP 400.");
  assert.ok(
    String(replyState.payload?.error || "").toLowerCase().includes("invalid endpoint timeout"),
    "Expected invalid timeout error message in payload.",
  );
}

async function main() {
  await runInvalidTimeout400Test();
  await runIntegration504Test();
  console.log("[FETCH timeout] All dedicated timeout tests passed.");
}

main().catch((error) => {
  console.error("[FETCH timeout] Test suite failed:", error);
  process.exit(1);
});

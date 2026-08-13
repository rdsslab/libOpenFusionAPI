import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "../..");
const BASE_URL = process.env.OWASP_BASE_URL || "http://localhost:3000";
const SERVER_PATH = path.resolve(__dirname, "../../src/server.js");
const SYSTEM_LOGIN_PATH = "/api/system/system/login/prd";
const SYSTEM_ENDPOINT_PATH = "/api/system/api/endpoint/prd";
const SYSTEM_APPS_CATALOG_PATH = "/api/system/api/apps/catalog/prd";
const AUTH_HEADER = `Basic ${Buffer.from("admin:admin@admin").toString("base64")}`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function call(pathname, options = {}) {
  const response = await fetch(`${BASE_URL}${pathname}`, options);
  const responseText = await response.text();
  let data = null;

  if (responseText) {
    try {
      data = JSON.parse(responseText);
    } catch {
      data = responseText;
    }
  }

  return {
    status: response.status,
    ok: response.ok,
    headers: Object.fromEntries(response.headers.entries()),
    data,
    text: responseText,
  };
}

async function waitForServer(maxAttempts = 30) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await call(SYSTEM_LOGIN_PATH, { method: "POST" });
      if ([200, 400, 401].includes(response.status)) {
        return true;
      }
    } catch {
      // The server is still booting.
    }

    await sleep(2000);
  }

  return false;
}

async function ensureServer() {
  if (await waitForServer(2)) {
    return { spawned: null };
  }

  const server = spawn("node", ["--max-old-space-size=4096", SERVER_PATH], {
    cwd: __dirname,
    stdio: "inherit",
    env: {
      ...process.env,
      PORT: new URL(BASE_URL).port || "3000",
      BUILD_DB: process.env.BUILD_DB || "true",
    },
  });

  const ready = await waitForServer(30);
  if (!ready) {
    server.kill();
    throw new Error("OWASP suite could not start the local server.");
  }

  return { spawned: server };
}

async function loginAsAdmin() {
  const response = await call(SYSTEM_LOGIN_PATH, {
    method: "POST",
    headers: {
      Authorization: AUTH_HEADER,
    },
  });

  assert.equal(response.status, 200, `Admin login failed: ${response.text}`);
  assert.equal(response.data?.login, true, "Admin login should return login=true.");
  assert.ok(response.data?.token, "Admin login should return a bearer token.");

  return response.data.token;
}

async function getDemoAppId(token) {
  const response = await call(SYSTEM_APPS_CATALOG_PATH, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  assert.equal(response.status, 200, `Apps catalog failed: ${response.text}`);
  const demoApp = response.data?.find?.((item) => item.app === "demo");
  assert.ok(demoApp?.idapp, "Demo application must exist for OWASP probes.");
  return demoApp.idapp;
}

async function upsertEndpoint(token, payload) {
  const response = await call(SYSTEM_ENDPOINT_PATH, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  assert.equal(response.status, 200, `Endpoint upsert failed: ${response.text}`);
  const idendpoint = response.data?.result?.idendpoint;
  assert.ok(idendpoint, "Endpoint upsert must return idendpoint.");
  return idendpoint;
}

async function deleteEndpoint(token, idendpoint) {
  await call(SYSTEM_ENDPOINT_PATH, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ idendpoint }),
  });
}

async function createProbeEndpoints(token, idapp) {
  const publicEndpointId = await upsertEndpoint(token, {
    idapp,
    resource: "/owasp_public_echo",
    method: "GET",
    environment: "dev",
    handler: "JS",
    code: "$_RETURN_DATA_ = { ok: true, query: request.query ?? {}, origin: request.headers.origin ?? null };",
    enabled: true,
    access: 0,
  });

  await sleep(3000);

  return { publicEndpointId };
}

// Busca la clave en cualquier nivel: desde que $_EXCEPTION_ puede devolver `data.public`,
// una fuga ya no tiene por qué estar en la raíz del cuerpo.
function findLeakedKey(value, keys, depth = 0) {
  if (!value || typeof value !== "object" || depth > 6) return null;

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findLeakedKey(item, keys, depth + 1);
      if (found) return found;
    }
    return null;
  }

  for (const [key, child] of Object.entries(value)) {
    if (keys.includes(key)) return key;
    const found = findLeakedKey(child, keys, depth + 1);
    if (found) return found;
  }

  return null;
}

function assertNoStackLeak(response, message) {
  assert.equal(typeof response.data, "object", `${message}: expected JSON body.`);
  const leaked = findLeakedKey(response.data, ["stack", "trace"]);
  assert.ok(!leaked, `${message}: '${leaked}' leaked in the response body.`);
}

async function loadPackageJson() {
  const content = await fs.readFile(path.join(ROOT_DIR, "package.json"), "utf8");
  return JSON.parse(content);
}

async function runCategory(id, title, check) {
  try {
    await check();
    console.log(`[PASS] ${id} ${title}`);
    return { id, title, status: "PASS" };
  } catch (error) {
    console.error(`[FAIL] ${id} ${title}`);
    console.error(error instanceof Error ? error.message : String(error));
    return { id, title, status: "FAIL", error: error instanceof Error ? error.message : String(error) };
  }
}

async function main() {
  console.log("=== OWASP Top 10 audit suite ===");
  const serverState = await ensureServer();
  let token;
  let probes;

  try {
    token = await loginAsAdmin();
    const idapp = await getDemoAppId(token);
    probes = await createProbeEndpoints(token, idapp);

    const categories = [];

    categories.push(await runCategory("A01", "Broken Access Control", async () => {
      const anonymous = await call(SYSTEM_APPS_CATALOG_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.equal(anonymous.status, 401, `System catalog should reject anonymous access: ${anonymous.text}`);

      const authorized = await call(SYSTEM_APPS_CATALOG_PATH, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      assert.equal(authorized.status, 200, `System catalog should accept a valid bearer token: ${authorized.text}`);
    }));

    categories.push(await runCategory("A02", "Cryptographic Failures", async () => {
      const tamperedToken = `${token.slice(0, -2)}xx`;
      const response = await call(SYSTEM_APPS_CATALOG_PATH, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tamperedToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      assert.equal(response.status, 401, `Tampered JWT should be rejected: ${response.text}`);
      assertNoStackLeak(response, "Tampered JWT rejection");
    }));

    categories.push(await runCategory("A03", "Injection", async () => {
      const payload = Buffer.from("admin' OR 1=1 -- :bad").toString("base64");
      const response = await call(SYSTEM_LOGIN_PATH, {
        method: "POST",
        headers: { Authorization: `Basic ${payload}` },
      });
      assert.notEqual(response.status, 500, "Login must not crash on SQLi payload.");
      assert.ok([400, 401].includes(response.status), `SQLi payload must be rejected: ${response.text}`);
    }));

    categories.push(await runCategory("A04", "Insecure Design", async () => {
      const response = await call(SYSTEM_APPS_CATALOG_PATH, {
        method: "POST",
        headers: { Authorization: AUTH_HEADER, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.equal(response.status, 401, `System API should require bearer auth, not basic auth: ${response.text}`);
    }));

    categories.push(await runCategory("A05", "Security Misconfiguration", async () => {
      const response = await call("/api/demo/owasp_public_echo/dev", {
        method: "GET",
        headers: { Origin: "https://evil.example" },
      });
      assert.equal(response.status, 200, `Public probe should remain reachable: ${response.text}`);
      assert.equal(response.headers["access-control-allow-origin"], "https://evil.example", "CORS should reflect the caller origin instead of using a wildcard.");
      assert.equal(response.headers["access-control-allow-credentials"], "true", "Credentialed CORS responses should explicitly opt in when an origin is reflected.");
      assert.equal(response.headers["x-content-type-options"], "nosniff", "Missing X-Content-Type-Options header.");
      assert.equal(response.headers["x-frame-options"], "DENY", "Missing X-Frame-Options header.");
      assert.equal(response.headers["referrer-policy"], "no-referrer", "Missing Referrer-Policy header.");
    }));

    categories.push(await runCategory("A06", "Vulnerable and Outdated Components", async () => {
      const packageJson = await loadPackageJson();
      assert.equal(packageJson.overrides?.minimatch, ">=10.2.1", "Expected transitive minimatch override is missing.");
      assert.equal(packageJson.overrides?.tar, ">=7.5.8", "Expected transitive tar override is missing.");
      const jsonwebtokenVersion = packageJson.dependencies?.jsonwebtoken;
      const major = Number(String(jsonwebtokenVersion).replace(/^[^0-9]*/, "").split(".")[0]);
      assert.ok(major >= 9, `jsonwebtoken should stay on a hardened major version, found: ${jsonwebtokenVersion}`);
    }));

    categories.push(await runCategory("A07", "Identification and Authentication Failures", async () => {
      const invalid = await call(SYSTEM_APPS_CATALOG_PATH, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token.slice(0, -3)}bad`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      assert.equal(invalid.status, 401, `Bearer auth should reject invalid credentials: ${invalid.text}`);

      const valid = await call(SYSTEM_APPS_CATALOG_PATH, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      assert.equal(valid.status, 200, `Bearer auth should accept valid credentials: ${valid.text}`);
    }));

    categories.push(await runCategory("A08", "Software and Data Integrity Failures", async () => {
      const response = await call(SYSTEM_ENDPOINT_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idapp,
          resource: "/owasp_unsigned_write",
          method: "GET",
          environment: "dev",
          handler: "JS",
          code: "$_RETURN_DATA_ = { ok: true };",
          enabled: true,
          access: 0,
        }),
      });
      assert.equal(response.status, 401, `Unsigned endpoint mutation must be rejected: ${response.text}`);
      assertNoStackLeak(response, "Unsigned mutation rejection");
    }));

    categories.push(await runCategory("A09", "Security Logging and Monitoring Failures", async () => {
      const response = await call(SYSTEM_APPS_CATALOG_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.equal(response.status, 401, `Unauthorized request should be rejected: ${response.text}`);
      assert.equal(response.data?.url, SYSTEM_APPS_CATALOG_PATH, "Unauthorized response should include the request URL.");
      assertNoStackLeak(response, "Unauthorized response body");
    }));

    categories.push(await runCategory("A10", "Server-Side Request Forgery", async () => {
      const response = await call(SYSTEM_ENDPOINT_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idapp,
          resource: "/owasp_ssrf_probe",
          method: "GET",
          environment: "dev",
          handler: "FETCH",
          code: "http://127.0.0.1:3000/",
          enabled: true,
          access: 0,
        }),
      });
      assert.equal(response.status, 401, `Anonymous creation of SSRF-capable handlers must be rejected: ${response.text}`);
    }));

    const failed = categories.filter((item) => item.status === "FAIL");
    console.log("\n=== OWASP Summary ===");
    for (const category of categories) {
      console.log(`${category.status.padEnd(4)} ${category.id} ${category.title}`);
    }

    if (failed.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    if (probes && token) {
      await deleteEndpoint(token, probes.publicEndpointId);
    }

    if (serverState.spawned) {
      serverState.spawned.kill();
    }
  }
}

main().catch((error) => {
  console.error("OWASP suite failed with an unhandled error.");
  console.error(error);
  process.exit(1);
});
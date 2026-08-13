/**
 * @file exception_payload_test.js
 * @description Contrato de la respuesta de error de los endpoints.
 *
 * El `data` de `$_EXCEPTION_` nació como contexto de log y muchos endpoints meten ahí el
 * body o las variables de aplicación, así que NUNCA debe salir solo. Solo viaja lo que el
 * autor pone en `data.public` con la firma de objeto.
 *
 * Requiere el servidor levantado en http://localhost:3000 (igual que fetch_timeout_test).
 */

import assert from "node:assert";

const baseUrl = process.env.OFAPI_TEST_URL || "http://localhost:3000";
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
    if (result.status !== 404) return result;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  return call(url, options);
};

async function login() {
  const loginRes = await call(`${baseUrl}/api/system/system/login/prd`, {
    method: "POST",
    headers: { Authorization: authHeader },
  });

  assert.strictEqual(
    loginRes.status,
    200,
    `Login failed: ${JSON.stringify(loginRes.data)}`,
  );
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

  assert.strictEqual(
    res.status,
    200,
    `Endpoint upsert failed: ${JSON.stringify(res.data)}`,
  );
  return res.data?.result?.idendpoint;
}

async function deleteEndpoint(headers, idendpoint) {
  if (!idendpoint) return;

  await call(`${baseUrl}/api/system/api/endpoint/prd`, {
    method: "DELETE",
    headers,
    body: JSON.stringify({ idendpoint }),
  });
}

const SECRET = "no-debe-salir-jamas";

const CASES = [
  {
    name: "positional (deprecated)",
    code: `$_EXCEPTION_("boom positional", { secreto: "${SECRET}" }, 400);`,
    status: 400,
    message: "boom positional",
    expectsData: false,
  },
  {
    name: "object without public",
    code: `$_EXCEPTION_({ message: "boom log", statusCode: 400, data: { log: { secreto: "${SECRET}" } } });`,
    status: 400,
    message: "boom log",
    expectsData: false,
  },
  {
    name: "object with public",
    code: `$_EXCEPTION_({ message: "boom public", statusCode: 422, data: { log: { secreto: "${SECRET}" }, public: { campo: "Correo", valor: "davi88-@hotmail.com" } } });`,
    status: 422,
    message: "boom public",
    expectsData: { campo: "Correo", valor: "davi88-@hotmail.com" },
  },
  {
    name: "object with data but no envelope",
    code: `$_EXCEPTION_({ message: "boom bare", statusCode: 400, data: { secreto: "${SECRET}" } });`,
    status: 400,
    message: "boom bare",
    expectsData: false,
  },
  {
    name: "ofapi.throw positional (deprecated)",
    code: `ofapi.throw("boom throw positional", 409, { secreto: "${SECRET}" });`,
    status: 409,
    message: "boom throw positional",
    expectsData: false,
  },
  {
    name: "ofapi.throw with public",
    code: `ofapi.throw({ message: "boom throw public", statusCode: 409, data: { log: { secreto: "${SECRET}" }, public: { motivo: "duplicado" } } });`,
    status: 409,
    message: "boom throw public",
    expectsData: { motivo: "duplicado" },
  },
  {
    name: "native error (no data ever)",
    code: `throw new Error("boom native");`,
    status: 500,
    message: "boom native",
    expectsData: false,
  },
];

async function run() {
  console.log("[exception payload] Running error contract tests...");

  const headers = await login();
  const idapp = await getDemoIdapp(headers);
  const ts = Date.now();
  const created = [];

  try {
    for (const [index, testCase] of CASES.entries()) {
      const resource = `/test_exception_${index}_${ts}`;

      created.push(
        await upsertEndpoint(headers, {
          idapp,
          resource,
          method: "GET",
          environment: "dev",
          handler: "JS",
          timeout: 30,
          access: 0,
          enabled: true,
          code: testCase.code,
        }),
      );

      const res = await callWithRetry(`${baseUrl}/api/demo${resource}/dev`);
      const body = JSON.stringify(res.data);

      assert.strictEqual(
        res.status,
        testCase.status,
        `${testCase.name}: expected ${testCase.status}, got ${res.status} (${body}).`,
      );
      assert.strictEqual(
        res.data?.error,
        testCase.message,
        `${testCase.name}: unexpected error message (${body}).`,
      );
      assert.ok(
        "trace_id" in (res.data || {}),
        `${testCase.name}: trace_id missing (${body}).`,
      );
      assert.ok(
        !body.includes(SECRET),
        `${testCase.name}: log-only context leaked to the client (${body}).`,
      );

      if (testCase.expectsData === false) {
        assert.ok(
          !("data" in (res.data || {})),
          `${testCase.name}: response must not carry 'data' (${body}).`,
        );
      } else {
        assert.deepStrictEqual(
          res.data?.data,
          testCase.expectsData,
          `${testCase.name}: unexpected public data (${body}).`,
        );
      }

      console.log(`[PASS] ${testCase.name}`);
    }
  } finally {
    for (const idendpoint of created) {
      await deleteEndpoint(headers, idendpoint);
    }
  }

  console.log("[exception payload] All error contract tests passed.");
}

run().catch((error) => {
  console.error("[exception payload] Test suite failed:", error);
  process.exit(1);
});

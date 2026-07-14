import assert from "node:assert/strict";
import { EndpointLoader } from "../../src/lib/server/endpoint/EndpointLoader.js";

async function runTests() {
  console.log("=== Endpoint Loader VM Contract Test ===");

  const capturedArgs = [];
  const internalEndpoint = {};
  const loadingPromises = new Map();

  const loader = new EndpointLoader(internalEndpoint, {}, loadingPromises, {
    dbFetcher: async () => null,
    endpointFetcher: async () => ({
      idapp: "demo-idapp",
      app: "demo",
      enabled: true,
      jwt_key: "jwt-demo",
      vrs: [
        { name: "GLOBAL_FLAG", value: "enabled" },
        { name: "APP_MODE", value: "dev-mode", environment: "dev" },
        { name: "APP_MODE", value: "prd-mode", environment: "prd" },
      ],
      endpoints: [
        {
          enabled: true,
          handler: "JS",
          resource: "/loader-contract",
          environment: "dev",
          method: "GET",
          code: "$_RETURN_DATA_ = { ok: true };",
          timeout: 7,
          custom_data: {
            token: "bot-token",
            baseUrl: "https://example.test",
          },
        },
      ],
    }),
    vmFactory: async (...args) => {
      capturedArgs.push(args);
      return async () => ({
        data: { ok: true },
        headers: {},
      });
    },
    mcpBuilder: async () => ({})
  });

  const loaded = await loader.getEndpoint({
    app: "demo",
    resource: "/loader-contract",
    environment: "dev",
    method: "GET",
  });

  assert.ok(loaded, "Loader must return a cached endpoint object.");
  assert.equal(capturedArgs.length, 1, "vmFactory should be called exactly once.");
  assert.equal(capturedArgs[0].length, 3, "vmFactory must receive exactly 3 arguments.");
  assert.equal(capturedArgs[0][0], "$_RETURN_DATA_ = { ok: true };", "First argument should be the endpoint code.");
  assert.deepEqual(
    capturedArgs[0][1],
    {
      GLOBAL_FLAG: "enabled",
      APP_MODE: "dev-mode",
    },
    "Second argument should be the resolved app vars object for the request environment."
  );
  assert.equal(capturedArgs[0][2], 7000, "Third argument should be the timeout in milliseconds.");
  assert.deepEqual(
    loaded.handler.params.custom_data,
    {
      token: "bot-token",
      baseUrl: "https://example.test",
    },
    "custom_data must remain attached to the endpoint params."
  );
  assert.equal(typeof loaded.handler.params.jsFn, "function", "jsFn must be compiled and cached on the handler.");

  console.log("=== Endpoint loader VM contract passed ===");
}

runTests().catch((error) => {
  console.error("Endpoint loader VM contract test failed.");
  console.error(error);
  process.exit(1);
});
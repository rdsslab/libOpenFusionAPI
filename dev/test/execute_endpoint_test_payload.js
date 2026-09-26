import assert from "node:assert/strict";

import { fnEndpointTest } from "../../src/lib/server/functions/system/prd/endpoint/index.js";
import { Application, Endpoint } from "../../src/lib/db/models.js";
import { closeDb } from "./close_db.js";

const originalFetch = globalThis.fetch;
const originalApplicationFindOne = Application.findOne;
const originalEndpointFindOne = Endpoint.findOne;

function createResponse({ status = 200, headers = { "content-type": "application/json" }, data = { ok: true } } = {}) {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), String(value)]),
  );

  return {
    status,
    headers: {
      get(name) {
        return normalizedHeaders[String(name).toLowerCase()] || null;
      },
    },
    async json() {
      return data;
    },
    async text() {
      return typeof data === "string" ? data : JSON.stringify(data);
    },
  };
}

async function run() {
  try {
    let fetchCalled = false;
    globalThis.fetch = async () => {
      fetchCalled = true;
      return createResponse();
    };

    const missingMethodResult = await fnEndpointTest({
      request: {
        body: {
          app: "demo",
          resource: "/echo",
          payload: { hello: "world" },
        },
      },
    });

    assert.equal(missingMethodResult.code, 400, "Explicit payload without method should fail when idendpoint is omitted.");
    assert.equal(missingMethodResult.data?.error_type, "missing_method_for_payload");
    assert.equal(fetchCalled, false, "No HTTP call should be executed when method is missing for explicit payload tests.");

    let metadataLookupWhere = null;
    Application.findOne = async () => ({ idapp: "app-demo-id" });
    Endpoint.findOne = async (query) => {
      metadataLookupWhere = query?.where || null;
      return {
        toJSON() {
          return {
            idapp: "app-demo-id",
            headers_test: {},
            data_test: { query: [], body: { json: { code: null } } },
          };
        },
      };
    };

    globalThis.fetch = async () => createResponse();
    const lookupResult = await fnEndpointTest({
      request: {
        body: {
          app: "demo",
          resource: "/echo",
          method: "POST",
        },
      },
    });

    assert.equal(lookupResult.code, 200);
    assert.deepEqual(
      metadataLookupWhere,
      {
        idapp: "app-demo-id",
        environment: "prd",
        resource: "/echo",
        method: "POST",
      },
      "Metadata lookup must be scoped to the resolved application idapp.",
    );

    let noFallbackFetchOptions = null;
    Endpoint.findOne = async () => ({
      toJSON() {
        return {
          idapp: "app-demo-id",
          headers_test: { "X-Saved": "yes" },
          data_test: {
            query: [{ key: "saved", value: "1", enabled: true }],
            body: {
              json: {
                code: "{\"from\":\"data_test\"}",
              },
            },
          },
        };
      },
    });
    globalThis.fetch = async (_url, options) => {
      noFallbackFetchOptions = options;
      return createResponse();
    };

    const noFallbackResult = await fnEndpointTest({
      request: {
        body: {
          app: "demo",
          resource: "/echo",
          method: "POST",
        },
      },
    });

    assert.equal(noFallbackResult.code, 200);
    assert.equal(noFallbackFetchOptions?.body, undefined, "Saved payload must not be inherited unless use_data_test_fallback=true.");
    assert.ok(
      noFallbackResult.data?.resolved_inputs?.warnings?.some((entry) =>
        entry.includes("use_data_test_fallback=false"),
      ),
      "Expected a warning when saved metadata exists but fallback is disabled.",
    );
    assert.deepEqual(noFallbackResult.data?.resolved_inputs?.query_params, {});
    assert.equal(noFallbackResult.data?.resolved_inputs?.from_data_test?.payload, false);
    assert.equal(noFallbackResult.data?.resolved_inputs?.from_data_test?.query_params, false);
    assert.equal(noFallbackResult.data?.resolved_inputs?.from_data_test?.headers, false);

    let capturedFetchOptions = null;
    Endpoint.findOne = async () => ({
      toJSON() {
        return {
          idapp: "app-demo-id",
          headers_test: { "Content-Type": "text/plain" },
          data_test: {
            query: [],
            body: {
              json: {
                code: "{\"from\":\"data_test\"}",
              },
            },
          },
        };
      },
    });
    globalThis.fetch = async (_url, options) => {
      capturedFetchOptions = options;
      return createResponse();
    };

    const inheritedPayloadResult = await fnEndpointTest({
      request: {
        body: {
          app: "demo",
          resource: "/echo",
          method: "POST",
          use_data_test_fallback: true,
        },
      },
    });

    assert.equal(inheritedPayloadResult.code, 200);
    assert.equal(capturedFetchOptions?.headers?.["Content-Type"], "application/json");
    assert.equal(capturedFetchOptions?.body, '{"from":"data_test"}');
    assert.equal(inheritedPayloadResult.data?.resolved_inputs?.payload_source, "data_test");
    assert.ok(
      inheritedPayloadResult.data?.resolved_inputs?.warnings?.some((entry) =>
        entry.includes("Structured payload from data_test forced Content-Type to application/json"),
      ),
      "Expected a warning explaining the forced JSON serialization for inherited structured payloads.",
    );

    let nullPayloadFetchOptions = null;
    globalThis.fetch = async (_url, options) => {
      nullPayloadFetchOptions = options;
      return createResponse();
    };

    const nullPayloadResult = await fnEndpointTest({
      request: {
        body: {
          app: "demo",
          resource: "/echo",
          method: "POST",
          payload: null,
          use_data_test_fallback: true,
        },
      },
    });

    assert.equal(nullPayloadResult.code, 200);
    assert.equal(nullPayloadFetchOptions?.body, undefined, "Explicit payload:null must suppress data_test body fallback.");
    assert.equal(nullPayloadResult.data?.resolved_inputs?.payload_source, "explicit");
    assert.equal(nullPayloadResult.data?.resolved_inputs?.from_data_test?.payload, false);

    let getFetchUrl = null;
    let getFetchOptions = null;
    Endpoint.findOne = async () => ({
      toJSON() {
        return {
          idapp: "app-demo-id",
          headers_test: {},
          data_test: {
            query: [{ key: "saved", value: "42", enabled: true }],
            body: { json: { code: "{\"ignored\":true}" } },
          },
        };
      },
    });
    globalThis.fetch = async (url, options) => {
      getFetchUrl = url;
      getFetchOptions = options;
      return createResponse();
    };

    const getResult = await fnEndpointTest({
      request: {
        body: {
          app: "demo",
          resource: "/echo",
          method: "GET",
          use_data_test_fallback: true,
        },
      },
    });

    assert.equal(getResult.code, 200);
    assert.ok(String(getFetchUrl).includes("saved=42"), "Saved query params should be inherited when use_data_test_fallback=true.");
    assert.equal(getFetchOptions?.body, undefined, "GET requests must not send a request body.");
    assert.ok(
      getResult.data?.resolved_inputs?.warnings?.some((entry) =>
        entry.includes("does not use a request body"),
      ),
      "Expected a warning when a payload exists but the resolved method does not use request bodies.",
    );

    let explicitHeadersFetchOptions = null;
    globalThis.fetch = async (_url, options) => {
      explicitHeadersFetchOptions = options;
      return createResponse();
    };

    const explicitHeadersResult = await fnEndpointTest({
      request: {
        body: {
          app: "demo",
          resource: "/echo",
          method: "POST",
          headers: { "X-Explicit": "ok" },
        },
      },
    });

    assert.equal(explicitHeadersResult.code, 200);
    assert.equal(explicitHeadersFetchOptions?.headers?.["X-Explicit"], "ok");
    assert.equal(explicitHeadersFetchOptions?.headers?.["X-Saved"], undefined, "Explicit headers should not inherit saved headers_test unless fallback is enabled.");

    console.log("execute_endpoint_test payload regression checks passed.");
  } finally {
    globalThis.fetch = originalFetch;
    Application.findOne = originalApplicationFindOne;
    Endpoint.findOne = originalEndpointFindOne;
  }
}

run()
  .then(closeDb)
  .catch(async (error) => {
    console.error(error);
    await closeDb();
    process.exit(1);
  });
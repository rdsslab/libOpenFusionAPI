import assert from "node:assert";

async function runTests() {
  const baseUrl = "http://localhost:3000";
  const authHeader = "Basic " + Buffer.from("admin:admin@admin").toString("base64");
  
  console.log("--- Starting System Integration Tests ---");

  const call = async (url, options = {}) => {
    const res = await fetch(url, options);
    let data;
    try {
      let text = await res.text();
      let cleanText = text.trim();

      // If it looks like SSE ("data: {...}"), extract the JSON part
      if (cleanText.startsWith("data: ")) {
          const match = cleanText.match(/data:\s*(\{.*\}|\[.*\])/s);
          if (match) cleanText = match[1];
      } else {
          // Even if not SSE, it might have trailing junk. 
          // Find the first occurrence of '{' or '['
          const firstBrace = cleanText.indexOf('{');
          const firstBracket = cleanText.indexOf('[');
          let start = -1;
          let endChar = '';

          if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
              start = firstBrace;
              endChar = '}';
          } else if (firstBracket !== -1) {
              start = firstBracket;
              endChar = ']';
          }

          if (start !== -1) {
              const lastChar = cleanText.lastIndexOf(endChar);
              if (lastChar !== -1 && lastChar > start) {
                  cleanText = cleanText.substring(start, lastChar + 1);
              }
          }
      }

      try {
        data = JSON.parse(cleanText);
      } catch (e) {
        data = text; // Fallback to raw text
      }
    } catch (e) {
      data = null;
    }
    return { status: res.status, data, headers: res.headers };
  };

  const callWithRetry = async (url, options = {}, retries = 5, delay = 2000) => {
    for (let i = 0; i < retries; i++) {
        const res = await call(url, options);
        if (res.status === 200) return res;
        console.warn(`[RETRY ${i+1}/${retries}] ${url} returned ${res.status}. Waiting ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
    }
    return await call(url, options);
  };

  // 1. Authentication
  console.log("[STEP 1/5] Authentication: Logging in as admin...");
  const loginRes = await callWithRetry(`${baseUrl}/api/system/system/login/prd`, {
    method: "POST",
    headers: { "Authorization": authHeader }
  });
  assert.strictEqual(loginRes.status, 200, `Login failed with status ${loginRes.status}. Data: ${JSON.stringify(loginRes.data)}`);
  assert.ok(loginRes.data.login, "Login response 'login' field should be true");
  const token = loginRes.data.token;
  const headers = {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json"
  };
  console.log("-> Authentication successful.");

  // 2. App Management
  console.log("[STEP 2/5] App Discovery: Listing applications...");
  const listAppsRes = await callWithRetry(`${baseUrl}/api/system/api/apps/catalog/prd`, {
    method: "POST",
    headers,
    body: JSON.stringify({})
  });
  assert.strictEqual(listAppsRes.status, 200, "List apps catalog failed");
  const demoApp = listAppsRes.data.find(a => a.app === 'demo');
  assert.ok(demoApp, "Demo app should exist in the catalog");
  const idapp_demo = demoApp.idapp;
  console.log(`-> Found demo app ID: ${idapp_demo}`);

  // 3. Endpoint Creation & Modification
  console.log("[STEP 3/5] CRUD Operations: Creating, verifying, and modifying an endpoint...");
  const resourcePath = "/test_integration_" + Date.now();
  const endpointData = {
    idapp: idapp_demo,
    resource: resourcePath,
    method: "POST",
    environment: "dev",
    handler: "JS",
    code: `
      const map = new Map();
      map.set('test', 'ok');
      const set = new Set();
      set.add('ok');
      const url = new URL('https://example.com/api?a=1');
      const params = new URLSearchParams(url.search);
      const encoder = new TextEncoder();
      const bytes = encoder.encode('hello');
      const decoder = new TextDecoder();
      const str = decoder.decode(bytes);
      const encodedUri = encodeURIComponent('a=b');
      const decodedUri = decodeURIComponent(encodedUri);
      const base64 = btoa('hello');
      const decodedBase64 = atob(base64);
      const arrayBuffer = new ArrayBuffer(8);
      const uint8 = new Uint8Array(arrayBuffer);
      
      $_RETURN_DATA_ = { 
        status: 'created', 
        mapVal: map.get('test'),
        setHas: set.has('ok'),
        urlHost: url.host,
        paramVal: params.get('a'),
        decodedString: str,
        decodedUri,
        decodedBase64,
        uint8Length: uint8.length,
        hasSetInterval: typeof setInterval === 'function'
      };
    `,
    enabled: true,
    access: 0,
    title: "Integration Test Endpoint"
  };

  console.log(`   - Creating endpoint at ${resourcePath}...`);
  const createRes = await callWithRetry(`${baseUrl}/api/system/api/endpoint/prd`, {
    method: "POST",
    headers,
    body: JSON.stringify(endpointData)
  });
  assert.strictEqual(createRes.status, 200, `Endpoint creation failed with status ${createRes.status}`);
  const idendpoint = createRes.data.result.idendpoint;
  console.log(`   - Endpoint created (ID: ${idendpoint}). Verifying execution...`);

  const verifyRes = await callWithRetry(`${baseUrl}/api/demo${resourcePath}/dev`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ test: "data" })
  });
  assert.strictEqual(verifyRes.status, 200, `Created endpoint verification failed (Status ${verifyRes.status}). Data: ${JSON.stringify(verifyRes.data)}`);
  assert.strictEqual(verifyRes.data.status, "created", "Endpoint returned unexpected data");
  assert.strictEqual(verifyRes.data.mapVal, 'ok');
  assert.strictEqual(verifyRes.data.setHas, true);
  assert.strictEqual(verifyRes.data.urlHost, 'example.com');
  assert.strictEqual(verifyRes.data.paramVal, '1');
  assert.strictEqual(verifyRes.data.decodedString, 'hello');
  assert.strictEqual(verifyRes.data.decodedUri, 'a=b');
  assert.strictEqual(verifyRes.data.decodedBase64, 'hello');
  assert.strictEqual(verifyRes.data.uint8Length, 8);
  assert.strictEqual(verifyRes.data.hasSetInterval, true);

  console.log("   - Modifying endpoint code...");
  const updatedData = {
    ...endpointData,
    idendpoint: idendpoint,
    code: "$_RETURN_DATA_ = { status: 'updated' };"
  };
  const updateRes = await callWithRetry(`${baseUrl}/api/system/api/endpoint/prd`, {
    method: "POST",
    headers,
    body: JSON.stringify(updatedData)
  });
  assert.strictEqual(updateRes.status, 200, "Endpoint modification call failed");

  console.log("   - Verifying modified endpoint execution...");
  const verifyUpdateRes = await callWithRetry(`${baseUrl}/api/demo${resourcePath}/dev`, {
    method: "POST"
  });
  assert.strictEqual(verifyUpdateRes.status, 200, `Modified endpoint verification failed (Status ${verifyUpdateRes.status})`);
  assert.strictEqual(verifyUpdateRes.data.status, "updated", "Endpoint returned old or wrong data after update");
  console.log("-> CRUD operations successful.");

  // 4. MCP Tools
  console.log("[STEP 4/5] MCP Discovery: Requesting tools/list...");
  const mcpRes = await callWithRetry(`${baseUrl}/api/system/mcp/server/prd`, {
    method: "POST",
    headers: {
      ...headers,
      "Accept": "application/json, text/event-stream"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/list",
      params: {},
      id: 1
    })
  });
  
  if (mcpRes.status !== 200) {
    console.error("-> MCP Tool Discovery failed with status", mcpRes.status);
    console.error("   Response data:", JSON.stringify(mcpRes.data, null, 2));
    process.exit(1);
  }
  
  if (!mcpRes.data || !mcpRes.data.result || !mcpRes.data.result.tools) {
    console.error("-> Invalid MCP tools list response structure.");
    console.error("   Response data:", JSON.stringify(mcpRes.data, null, 2));
    process.exit(1);
  }
  console.log(`-> MCP Tool Discovery successful. Found ${mcpRes.data.result.tools.length} tools.`);

  // 5. Cleanup
  console.log("[STEP 5/5] Cleanup: Deleting test endpoint...");
  const deleteRes = await callWithRetry(`${baseUrl}/api/system/api/endpoint/prd`, {
    method: "DELETE",
    headers,
    body: JSON.stringify({ idendpoint })
  });
  assert.strictEqual(deleteRes.status, 200, "Endpoint deletion failed during cleanup");
  console.log("-> Cleanup successful.");

  console.log("\n--- All Integration Tests Passed Successfully! ---");
}

runTests().catch(err => {
  console.error("\nIntegration test suite failed with error:");
  console.error(err);
  process.exit(1);
});

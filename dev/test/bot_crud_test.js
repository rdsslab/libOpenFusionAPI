import assert from "node:assert";

async function runTests() {
  const baseUrl = "http://localhost:3000";
  const authHeader = "Basic " + Buffer.from("admin:admin@admin").toString("base64");

  console.log("--- Starting Bot CRUD Tests ---");

  const call = async (url, options = {}) => {
    const res = await fetch(url, options);
    let data;
    try {
      let text = await res.text();
      let cleanText = text.trim();

      if (cleanText.startsWith("data: ")) {
        const match = cleanText.match(/data:\s*(\{.*\}|\[.*\])/s);
        if (match) cleanText = match[1];
      } else {
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
        data = text;
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
  console.log("[STEP 1/6] Authentication: Logging in as admin...");
  const loginRes = await callWithRetry(`${baseUrl}/api/system/system/login/prd`, {
    method: "POST",
    headers: { "Authorization": authHeader }
  });
  assert.strictEqual(loginRes.status, 200, `Login failed with status ${loginRes.status}`);
  assert.ok(loginRes.data.login, "Login response 'login' field should be true");
  const token = loginRes.data.token;
  const headers = {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json"
  };
  console.log("-> Authentication successful.");

  // 2. Discover demo app
  console.log("[STEP 2/6] App Discovery: Finding demo app...");
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

  // 3. List bots (should be empty or array)
  console.log("[STEP 3/6] List bots for demo app...");
  const listRes = await callWithRetry(`${baseUrl}/api/system/bots/prd?idapp=${idapp_demo}`, {
    method: "GET",
    headers
  });
  assert.strictEqual(listRes.status, 200, `List bots failed with status ${listRes.status}: ${JSON.stringify(listRes.data)}`);
  assert.ok(listRes.data.success, "List bots should return success: true");
  assert.ok(Array.isArray(listRes.data.data), "List bots data should be an array");
  console.log(`-> Listed ${listRes.data.data.length} bots.`);

  // 4. Create bot
  console.log("[STEP 4/6] Create bot...");
  const botPayload = {
    idapp: idapp_demo,
    name: `test-bot-${Date.now()}`,
    provider: "telegram",
    token: "123456:ABC-DEF1234ghIJKLmnop",
    code: "console.log('test bot');",
    environment: "prd",
    enabled: false,
    description: "Test bot for automated CRUD validation",
    params: { test: true }
  };

  const createRes = await callWithRetry(`${baseUrl}/api/system/bots/prd`, {
    method: "POST",
    headers,
    body: JSON.stringify(botPayload)
  });
  assert.strictEqual(createRes.status, 200, `Create bot failed with status ${createRes.status}: ${JSON.stringify(createRes.data)}`);
  assert.ok(createRes.data.success, "Create bot should return success: true");
  assert.ok(createRes.data.created, "Create bot should indicate created: true");
  const createdBot = createRes.data.data;
  assert.ok(createdBot.idbot, "Created bot should have idbot");
  assert.strictEqual(createdBot.provider, "telegram", "Provider should default to telegram");
  assert.strictEqual(createdBot.name, botPayload.name);
  const idbot = createdBot.idbot;
  console.log(`-> Created bot with idbot: ${idbot}`);

  // 5. Get bot by id
  console.log("[STEP 5/6] Get bot by id...");
  const getRes = await callWithRetry(`${baseUrl}/api/system/bots/prd?idbot=${idbot}`, {
    method: "GET",
    headers
  });
  assert.strictEqual(getRes.status, 200, `Get bot failed with status ${getRes.status}: ${JSON.stringify(getRes.data)}`);
  assert.ok(getRes.data.success, "Get bot should return success: true");
  assert.strictEqual(getRes.data.data.idbot, idbot, "Retrieved bot idbot mismatch");
  console.log("-> Get bot successful.");

  // 6. Update bot
  console.log("[STEP 6/6] Update bot...");
  const updatePayload = {
    idbot: idbot,
    idapp: idapp_demo,
    name: `${botPayload.name}-updated`,
    provider: "whatsapp",
    token: "whatsapp-token-updated",
    code: "console.log('updated bot');",
    environment: "prd",
    enabled: false,
    description: "Updated test bot"
  };

  const updateRes = await callWithRetry(`${baseUrl}/api/system/bots/prd`, {
    method: "POST",
    headers,
    body: JSON.stringify(updatePayload)
  });
  assert.strictEqual(updateRes.status, 200, `Update bot failed with status ${updateRes.status}: ${JSON.stringify(updateRes.data)}`);
  assert.ok(updateRes.data.success, "Update bot should return success: true");
  assert.strictEqual(updateRes.data.data.provider, "whatsapp", "Provider should be updated to whatsapp");
  assert.strictEqual(updateRes.data.data.name, updatePayload.name);
  console.log("-> Update bot successful.");

  // 7. Enable bot
  console.log("[STEP 7/8] Enable bot...");
  const enableRes = await callWithRetry(`${baseUrl}/api/system/bots/status/prd?idbot=${idbot}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ enabled: true })
  });
  assert.strictEqual(enableRes.status, 200, `Enable bot failed with status ${enableRes.status}: ${JSON.stringify(enableRes.data)}`);
  assert.ok(enableRes.data.success, "Enable bot should return success: true");
  assert.strictEqual(enableRes.data.enabled, true, "Enable bot should return enabled: true");
  console.log("-> Enable bot successful.");

  // 8. Delete bot
  console.log("[STEP 8/8] Delete bot...");
  const deleteRes = await callWithRetry(`${baseUrl}/api/system/bots/prd?idbot=${idbot}`, {
    method: "DELETE",
    headers,
    body: JSON.stringify({ idbot })
  });
  assert.strictEqual(deleteRes.status, 200, `Delete bot failed with status ${deleteRes.status}: ${JSON.stringify(deleteRes.data)}`);
  assert.ok(deleteRes.data.success, "Delete bot should return success: true");
  console.log("-> Delete bot successful.");

  // 9. Verify deletion
  console.log("[VERIFY] Ensure deleted bot is not found...");
  const getAfterDeleteRes = await call(`${baseUrl}/api/system/bots/prd?idbot=${idbot}`, {
    method: "GET",
    headers
  });
  assert.strictEqual(getAfterDeleteRes.status, 404, "Deleted bot should return 404");
  console.log("-> Deleted bot correctly returns 404.");

  console.log("\n--- All Bot CRUD Tests Passed Successfully! ---");
}

runTests().catch(err => {
  console.error("\nBot CRUD test suite failed with error:");
  console.error(err);
  process.exit(1);
});

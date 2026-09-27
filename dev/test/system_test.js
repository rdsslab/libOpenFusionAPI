import assert from "node:assert";
import { basicAuthHeader } from "./test_credentials.js";

// El endpoint MCP no contesta JSON: contesta SSE (`content-type:
// text/event-stream`), con un bloque `event: message` y el JSON-RPC entero en la
// linea `data:`. Leerlo con res.json() reventaba, el helper se tragaba el
// error y dejaba `data` en null, asi que la suite moria con
// `Cannot read properties of null (reading 'result')`: un sintoma que parece un
// MCP roto y es un test roto. Se lee el texto y se saca el payload de las
// lineas `data:`, que es donde va el JSON-RPC.
const parseSseJson = (text) => {
  const payloads = text
    .split("\n")
    .map((linea) => (linea.startsWith("data:") ? linea.slice(5).trim() : ""))
    .filter((linea) => linea.length > 0);
  // Del ultimo al primero: el que cierra la respuesta es el que vale, y si uno
  // esta truncado a medias por un corte de conexion se nota en vez de devolver
  // el de un evento anterior que ya no describe lo que se pidio.
  for (let i = payloads.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(payloads[i]);
    } catch (e) {
      // Payload no parseable: se prueba el anterior.
    }
  }
  return null;
};

async function runTests() {
  const baseUrl = "http://localhost:3000";
  const authHeader = basicAuthHeader();
  
  console.log("--- Starting System Integration Tests ---");

  const call = async (url, options = {}) => {
    const res = await fetch(url, options);
    const contentType = res.headers.get("content-type") || "";
    let data;
    if (contentType.includes("text/event-stream")) {
      data = parseSseJson(await res.text());
    } else {
      try {
        data = await res.json();
      } catch (e) {
        data = null;
      }
    }
    return { status: res.status, data };
  };

  // 1. Login
  console.log("Testing Login...");
  const loginRes = await call(`${baseUrl}/api/system/system/login/prd`, {
    method: "POST",
    headers: { "Authorization": authHeader }
  });
  
  if (loginRes.status !== 200) {
    console.error("Login failed:", loginRes.status, loginRes.data);
    process.exit(1);
  }
  assert.ok(loginRes.data.login, "Login should be successful");
  const token = loginRes.data.token;
  console.log("Login OK. Token obtained.");

  const headers = {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json"
  };

  // 2. List Applications (Catalog)
  console.log("Testing List Applications Catalog...");
  const listAppsRes = await call(`${baseUrl}/api/system/api/apps/catalog/prd`, {
    method: "POST",
    headers,
    body: JSON.stringify({})
  });
  
  if (listAppsRes.status !== 200) {
    console.error("List Apps failed:", listAppsRes.status, listAppsRes.data);
    process.exit(1);
  }
  assert.ok(Array.isArray(listAppsRes.data), "Apps catalog should be an array");
  const demoApp = listAppsRes.data.find(a => a.app === 'demo');
  const idapp = demoApp ? demoApp.idapp : null;
  assert.ok(idapp, "Demo app should exist in catalog");
  console.log(`Found demo app. ID: ${idapp}`);

  // 3. Create an Endpoint in Demo App using JS handler
  console.log("Testing Endpoint Upsert (JS handler) in 'demo' app...");
  const endpointData = {
    idapp: idapp,
    resource: "/test_ping_js",
    method: "GET",
    environment: "dev",
    handler: "JS",
    code: "$_RETURN_DATA_ = { status: 'ok', message: 'JS Handler Working' };",
    enabled: true,
    access: 0 // Public
  };
  const upsertEndpointRes = await call(`${baseUrl}/api/system/api/endpoint/prd`, {
    method: "POST",
    headers,
    body: JSON.stringify(endpointData)
  });
  
  if (upsertEndpointRes.status !== 200) {
    console.error("Endpoint upsert failed:", upsertEndpointRes.status, upsertEndpointRes.data);
    process.exit(1);
  }
  const idendpoint = upsertEndpointRes.data.result.idendpoint;
  console.log(`Endpoint '/test_ping_js' created/updated. ID: ${idendpoint}`);

  // 4. Verify Endpoint Works
  console.log("Verifying new endpoint functionality...");
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  const testPingRes = await call(`${baseUrl}/api/demo/test_ping_js/dev`, {
    method: "GET"
  });
  
  if (testPingRes.status !== 200) {
    console.error("New endpoint verification failed:", testPingRes.status, testPingRes.data);
    process.exit(1);
  }
  console.log("New endpoint verified OK.");

  // 5. MCP Tool Discovery
  console.log("Testing MCP Tool Discovery...");
  const mcpRes = await call(`${baseUrl}/api/system/mcp/server/prd`, {
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
    console.error("MCP Tool Discovery failed:", mcpRes.status, mcpRes.data);
    process.exit(1);
  }
  // Si el payload no se pudo sacar, el aviso tiene que decir cual de las dos
  // cosas fallo: el transporte (no hay JSON-RPC legible) o el MCP (viene sin
  // `result`). Un `Cannot read properties of null` no distingue los dos casos y
  // por eso este paso llevaba anos sin poder aislarse.
  assert.ok(mcpRes.data, "MCP response should be readable as SSE (event: message / data: {...})");
  assert.ok(mcpRes.data.result && mcpRes.data.result.tools, "MCP should return a list of tools");
  console.log(`MCP Discovery OK. Found ${mcpRes.data.result.tools.length} tools.`);

  // 6. Clean up - Delete Endpoint
  console.log("Cleaning up: Deleting endpoint...");
  const deleteEndpointRes = await call(`${baseUrl}/api/system/api/endpoint/prd`, {
    method: "DELETE",
    headers,
    body: JSON.stringify({ idendpoint })
  });
  
  if (deleteEndpointRes.status !== 200) {
    console.error("Endpoint deletion failed:", deleteEndpointRes.status, deleteEndpointRes.data);
    process.exit(1);
  }
  console.log("Endpoint deleted.");

  console.log("--- All integration tests passed successfully! ---");
}

runTests().catch(err => {
  console.error("Unhandled test error:", err);
  process.exit(1);
});

import assert from "node:assert";
import { TEST_BASE_URL, basicAuthHeader } from "./test_credentials.js";

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
  // La URL viene de `test_credentials.js`, que es la misma que usan las otras 11
  // suites que se autentican con el par `admin`. Estaba escrita a pelo aqui, y
  // eso hacia una cosa peor que no funcionar en otro sitio: `OFAPI_BASE_URL`
  // apuntando a otra instancia se ignoraba en silencio y la suite pasaba igual
  // contra el servidor de siempre. Un fallo que se prueba contra el sitio
  // equivocado no es un fallo: es una garantia falsa.
  const baseUrl = TEST_BASE_URL;
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
    // Aqui el `process.exit` si es legitimo: sin un 200 no hay endpoint creado y
    // por tanto no hay nada que limpiar. El id se lee YA DENTRO del `try` de
    // abajo, no aqui: un `data` o un `result` ausente reventaba con un TypeError
    // en esta linea, y al estar fuera de la limpieza el endpoint se quedaba
    // puesto sin dejar rastro.
    console.error("Endpoint upsert failed:", upsertEndpointRes.status, upsertEndpointRes.data);
    process.exit(1);
  }

  // A partir de aqui el endpoint existe, asi que todo lo que viene va dentro de un
  // `try` con la limpieza en el `finally`. Antes, un fallo en cualquiera de estos
  // pasos se llevaba por delante el borrado: `/test_ping_js` se quedaba en la app
  // `demo` para siempre, y la siguiente pasada lo encontraba ahi y no volvia a
  // borrarlo nunca, porque el borrado seguia sin ejecutarse.
  //
  // Los `process.exit(1)` de dentro del `try` son `throw` a proposito:
  // `process.exit()` NO ejecuta el `finally`, asi que con ellos dentro el
  // `finally` daria una sensacion de seguridad que no tiene. Los dos que quedan
  // fuera (login y catalogo de apps) si pueden salir, porque todavia no hay nada
  // que limpiar.
  let errorTest = null;
  let errorLimpieza = null;
  let idendpoint = null;

  try {
    const id = upsertEndpointRes.data?.result?.idendpoint;
    if (!id) {
      throw new Error(
        `Endpoint upsert returned 200 without an idendpoint: ${JSON.stringify(upsertEndpointRes.data)}`
      );
    }
    idendpoint = id;
    console.log(`Endpoint '/test_ping_js' created/updated. ID: ${idendpoint}`);

    // 4. Verify Endpoint Works
    console.log("Verifying new endpoint functionality...");
    await new Promise(resolve => setTimeout(resolve, 3000));

    const testPingRes = await call(`${baseUrl}/api/demo/test_ping_js/dev`, {
      method: "GET"
    });

    if (testPingRes.status !== 200) {
      throw new Error(
        `New endpoint verification failed: ${testPingRes.status} ${JSON.stringify(testPingRes.data)}`
      );
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
      throw new Error(`MCP Tool Discovery failed: ${mcpRes.status} ${JSON.stringify(mcpRes.data)}`);
    }
    // Si el payload no se pudo sacar, el aviso tiene que decir cual de las dos
    // cosas fallo: el transporte (no hay JSON-RPC legible) o el MCP (viene sin
    // `result`). Un `Cannot read properties of null` no distingue los dos casos y
    // por eso este paso llevaba anos sin poder aislarse.
    assert.ok(mcpRes.data, "MCP response should be readable as SSE (event: message / data: {...})");
    assert.ok(mcpRes.data.result && mcpRes.data.result.tools, "MCP should return a list of tools");
    console.log(`MCP Discovery OK. Found ${mcpRes.data.result.tools.length} tools.`);
  } catch (err) {
    // Se guarda y se relanza despues, para que el `finally` de abajo se ejecute
    // entero. Relanzar aqui seria lo mismo que no tener `finally`.
    errorTest = err;
  } finally {
    // 6. Clean up - Delete Endpoint
    if (!idendpoint) {
      // Unico punto donde el endpoint existe y no se puede borrar: el DELETE va
      // por `idendpoint`, no por recurso, asi que sin id no hay nada que hacer.
      // Se dice en voz alta en vez de fingir que la limpieza se hizo, porque un
      // `/test_ping_js` huerfano en la app `demo` no se ve en ninguna salida.
      console.error(
        "NO SE PUDO LIMPIAR: '/test_ping_js' en la app 'demo' puede seguir sin borrar, " +
        "porque el upsert no devolvio idendpoint. Borralo a mano si se repite."
      );
    } else {
      console.log("Cleaning up: Deleting endpoint...");
      const deleteEndpointRes = await call(`${baseUrl}/api/system/api/endpoint/prd`, {
        method: "DELETE",
        headers,
        body: JSON.stringify({ idendpoint })
      });

      if (deleteEndpointRes.status !== 200) {
        // Un fallo de la limpieza no puede tapar el fallo del test: se guardan los
        // dos y se relanza primero el del test, que es la causa. Si el test pasaba y
        // lo que falla es el borrado, ese si es el fallo que hay que reportar,
        // porque deja el endpoint puesto.
        const err = new Error(
          `Endpoint deletion failed: ${deleteEndpointRes.status} ${JSON.stringify(deleteEndpointRes.data)}`
        );
        if (errorTest) console.error("Ademas, la limpieza fallo:", err.message);
        else errorLimpieza = err;
      } else {
        console.log("Endpoint deleted.");
      }
    }
  }

  if (errorTest) throw errorTest;
  if (errorLimpieza) throw errorLimpieza;

  console.log("--- All integration tests passed successfully! ---");
}

runTests().catch(err => {
  console.error("Unhandled test error:", err);
  process.exit(1);
});

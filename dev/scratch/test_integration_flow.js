import ServerAPI from "../../src/lib/index.js";
import assert from "node:assert";

async function run() {
  console.log("Starting debug server...");
  const server = new ServerAPI();
  
  // Wait for server to start
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  console.log("Making local request to test endpoint...");
  
  // We can inject a mock route or use the API client to insert one,
  // but to test the JS handler execution directly, we can compile a function and call it!
  const { functionsVars } = await import("../../src/lib/server/functionVars.js");
  const { createFunctionVM } = await import("../../src/lib/server/createFunctionVM.js");
  
  const fnVars = functionsVars(null, null, "dev");
  
  const code = `
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
  `;
  
  try {
    const fn = await createFunctionVM(code, {});
    const result = await fn(fnVars);
    console.log("SUCCESS!", JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("FAILURE!", error);
  }
  
  // Close fastify server
  await server.fastify.close();
}

run().catch(console.error);

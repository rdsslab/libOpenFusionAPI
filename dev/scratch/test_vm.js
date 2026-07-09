import { createFunctionVM } from "../../src/lib/server/createFunctionVM.js";
import { functionsVars } from "../../src/lib/server/functionVars.js";

async function run() {
  const vars = functionsVars(null, null, "dev");
  const code = `
    try {
      $_RETURN_DATA_ = {
        URL_type: typeof URL,
        Map_type: typeof Map,
        Set_type: typeof Set,
        keys: Object.keys(globalThis)
      };
    } catch (e) {
      $_RETURN_DATA_ = { error: e.message, stack: e.stack };
    }
  `;
  const fn = await createFunctionVM(code, {});
  const res = await fn(vars);
  console.log("Result:", JSON.stringify(res, null, 2));
}

run().catch(console.error);

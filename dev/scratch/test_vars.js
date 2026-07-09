import { functionsVars } from "../../src/lib/server/functionVars.js";

async function run() {
  const vars = functionsVars(null, null, "dev");
  console.log("Keys in functionsVars:");
  for (const key of Object.keys(vars)) {
    console.log(`- ${key}: ${typeof vars[key]}`);
  }
}

run().catch(console.error);

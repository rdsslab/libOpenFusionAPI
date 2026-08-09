// Convierte el json_schema.in de TODAS las tools publicadas en el seed a Zod con
// el mismo pipeline que usa el servidor (normalizacion -> jsonSchemaToZod ->
// serializacion MCP) y avisa de las que se degradan a un objeto abierto.
//
// Es el complemento offline de mcp_contract_audit.js: aquel comprueba que la
// documentacion sea coherente, este que el schema llegue de verdad al agente en
// lugar de convertirse en `{}` por una construccion no soportada.
//
// Uso: node dev/test/mcp_schema_smoke.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as z from "zod";
import { jsonSchemaToZod } from "../../src/lib/server/mcp/server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED = path.resolve(__dirname, "..", "..", "src", "lib", "db", "default", "system.js");

const UNSUPPORTED_JSON_SCHEMA_KEYS = new Set([
  "if", "then", "else", "dependentSchemas",
  "unevaluatedProperties", "patternProperties", "prefixItems", "contains",
]);

// Misma normalizacion que handlerBuild/mcp.js aplica antes de convertir.
const normalizeSchemaForZod = (schema) => {
  const visit = (node) => {
    if (Array.isArray(node)) return node.map(visit);
    if (!node || typeof node !== "object") return node;
    if (node.$ref && (node.$ref === "#/$defs/jsonValue" || node.$ref.endsWith("jsonValue"))) {
      return { description: node.description || "Any JSON value" };
    }
    const out = {};
    for (const [key, value] of Object.entries(node)) {
      if (UNSUPPORTED_JSON_SCHEMA_KEYS.has(key)) continue;
      out[key] = visit(value);
    }
    if (out.type === "object") {
      if (!out.properties || typeof out.properties !== "object") out.properties = {};
      if (Array.isArray(out.required) && out.required.length > 0) {
        out.required = out.required.filter((k) => out.properties?.[k]);
        if (out.required.length === 0) delete out.required;
      }
    }
    return out;
  };
  return visit(schema);
};

const source = fs.readFileSync(SEED, "utf8");
const app = JSON.parse(source.slice(source.indexOf("{")));

const tools = app.endpoints.filter(
  (e) => e.method !== "WS" && e.handler !== "MCP" && e?.mcp?.enabled === true
);

const problems = [];
let converted = 0;

for (const endpoint of tools) {
  const name = endpoint.mcp.name;
  const schema = endpoint?.json_schema?.in?.schema;

  if (!endpoint?.json_schema?.in?.enabled || !schema) {
    problems.push(`${name}: sin json_schema.in habilitado; publicaria un inputSchema vacio.`);
    continue;
  }

  let zodSchema;
  try {
    zodSchema = jsonSchemaToZod(normalizeSchemaForZod(schema));
  } catch (error) {
    problems.push(`${name}: jsonSchemaToZod lanzo "${error?.message || error}"; el servidor caeria a un objeto abierto.`);
    continue;
  }

  let serialized;
  try {
    serialized = z.toJSONSchema(zodSchema);
  } catch (error) {
    problems.push(`${name}: el schema convertido no serializa ("${error?.message || error}").`);
    continue;
  }

  const declaredProps = Object.keys(schema.properties || {});
  const survivingProps = Object.keys(serialized.properties || {});
  if (declaredProps.length > 0 && survivingProps.length === 0) {
    problems.push(`${name}: declara ${declaredProps.length} propiedades pero ninguna sobrevive a la conversion.`);
    continue;
  }

  const lostRequired = (schema.required || []).filter(
    (field) => !(serialized.required || []).includes(field)
  );
  if (lostRequired.length > 0) {
    problems.push(`${name}: pierde campos requeridos al convertir: ${lostRequired.join(", ")}.`);
    continue;
  }

  converted += 1;
}

console.log(`Schemas convertidos correctamente: ${converted}/${tools.length}`);

if (problems.length > 0) {
  console.error("\nProblemas:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log("Todos los inputSchema llegan al agente sin degradarse.");

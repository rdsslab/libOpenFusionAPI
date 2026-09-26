/**
 * Regresión de los cuatro hallazgos críticos de la auditoría de la superficie MCP.
 *
 * Antes de este test los cuatro fallos eran silenciosos, y esa es exactamente la
 * razón de que nadie los notara: en todos los casos el servidor respondía con
 * normalidad y el agente se iba creyendo lo que le decían.
 *
 *   1. H1 — el `inputSchema` por defecto de las tools de endpoint era
 *      `z.object({})` sin `.passthrough()`. Zod hace STRIP en ese caso, así que los
 *      argumentos que enviaba el agente desaparecían antes de llegar al endpoint: la
 *      llamada se aceptaba, el endpoint recibía un body vacío y respondía 200. Un
 *      `POST /api/demo/probe/bulk/dev` con `{"data":[{"value":7}]}` devolvía por HTTP
 *      `{"inserted":1}` y por MCP `{"error":"fieldValueHashes is not iterable"}`, con
 *      las dos respuestas tomadas por buenas. Afectaba a 10 de las 20 tools de endpoint
 *      de la app de demostración.
 *
 *   2. H2 — `statusCode` y `mimeType` se ponían en el objeto del content block, pero
 *      `TextContentSchema` solo admite `type`, `text`, `annotations` y `_meta`, así que
 *      el SDK los eliminaba al validar: el cliente recibía el cuerpo sin ninguna pista
 *      del código HTTP. Y `isError` no se seteaba nunca, de modo que un 401 o un 500
 *      llegaban indistinguibles de un 200.
 *
 *   3. H3 — el conversor `jsonSchemaToZod` ignoraba `description`: de las 357
 *      propiedades documentadas en el seed de `system/prd`, cero llegaban a
 *      `tools/list`. Un agente veía los nombres de los parámetros y ninguna
 *      explicación de qué aceptaba cada uno.
 *
 *   4. H6 — las anotaciones solo miraban `mcp.meta.operation_mode`, pero la
 *      documentación pedía declarar el modo con el prefijo `READ ONLY:` /
 *      `WRITE OPERATION:` en la descripción. El prefijo no influía, así que 20 de las
 *      25 tools de la app de demostración se publicaban como `destructiveHint: true`,
 *      incluidas lecturas puras.
 *
 * No necesita servidor ni base de datos: importa los módulos reales.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as z from "zod";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

import { jsonSchemaToZod } from "../../src/lib/server/mcp/utils.js";
import {
  bodyLooksLikeError,
  buildToolResult,
  resolveOperationMode,
} from "../../src/lib/server/mcp/toolResult.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MCP_HANDLER_SOURCE = path.resolve(
  __dirname, "..", "..", "src", "lib", "server", "endpoint", "handlerBuild", "mcp.js",
);

// ---------------------------------------------------------------------------
// H1 — los argumentos del agente tienen que llegar al endpoint
// ---------------------------------------------------------------------------

test("H1: el inputSchema por defecto de las tools de endpoint conserva los argumentos", () => {
  // Se extrae la expresión real del source en vez de reescribirla aquí: reescribirla
  // haría que el test pasara aunque el source volviera a perder los argumentos.
  const source = fs.readFileSync(MCP_HANDLER_SOURCE, "utf8");
  const match = source.match(/let zod_inputSchema = (z\.object\(\{\}\)[^;]*);/);

  assert.ok(match, "no se encontró el inputSchema por defecto en handlerBuild/mcp.js");

  const defaultSchema = new Function("z", `return ${match[1]}`)(z);

  const parsed = defaultSchema.parse({
    data: [{ value: 7 }],
    nested: { deep: [1, 2, { deeper: true }] },
    note: "cualquier tipo de valor",
  });

  assert.deepEqual(
    parsed,
    {
      data: [{ value: 7 }],
      nested: { deep: [1, 2, { deeper: true }] },
      note: "cualquier tipo de valor",
    },
    "los argumentos del agente se están perdiendo: sin .passthrough() Zod hace strip y " +
    "el endpoint recibe un body vacío mientras la tool reporta éxito",
  );

  // Un body vacío sigue siendo válido: hay endpoints sin `json_schema.in` que no
  // esperan nada (por ejemplo los GET de ejemplo). Lo que no puede pasar es que
  // el body vacío sea lo único que sobreviva.
  assert.deepEqual(defaultSchema.parse({}), {});
});

test("H1: los tres caminos 'flexible' también usan passthrough", () => {
  // Los tres esquemas de reserva (conversión que devuelve algo que no es objeto,
  // conversión que lanza, y `ensureSerializableToolSchema`) ya usaban passthrough.
  // Este test fija que siguen usándolo, para que el default no quede como único
  // camino corregido.
  const source = fs.readFileSync(MCP_HANDLER_SOURCE, "utf8");
  const flexible = source.match(/z\.object\(\{\}\)(?!\.passthrough\(\))/g) ?? [];

  assert.equal(
    flexible.length,
    0,
    `quedan ${flexible.length} ocurrencias de z.object({}) sin .passthrough(): ` +
    "esas herramientas seguirían descartando los argumentos del agente en silencio",
  );
});

// ---------------------------------------------------------------------------
// H2 — isError y la metadata del transporte
// ---------------------------------------------------------------------------

test("H2: una respuesta 4xx/5xx se marca como error", () => {
  const result = buildToolResult({
    text: '{"message":"Unauthorized"}',
    mimeType: "application/json",
    statusCode: 401,
  });

  assert.equal(result.isError, true);
});

test("H2: la metadata del transporte viaja en _meta, no suelta en el content block", () => {
  // El esquema del SDK es la referencia contra la que hay que medir: es lo que
  // descartaba `statusCode`/`mimeType` al validar la respuesta.
  const result = buildToolResult({
    text: "ok",
    mimeType: "application/json",
    statusCode: 200,
  });

  const block = result.content[0];

  // Si se volvieran a poner sueltas, el SDK las borraría al validar la respuesta.
  assert.equal(block.statusCode, undefined);
  assert.equal(block.mimeType, undefined);

  assert.deepEqual(block._meta, { statusCode: 200, mimeType: "application/json" });

  // Y el resultado tiene que seguir siendo válido contra el esquema del SDK, que es
  // lo que descartaba las claves sueltas.
  assert.doesNotThrow(() => CallToolResultSchema.parse(result));
});

test("H2: los errores de negocio en HTTP 200 también se marcan como error", () => {
  // Es el caso mayoritario en OpenFusionAPI: `idendpoint is required`,
  // `Database is required`, `upsert_interval_task` sin fila que actualizar... todos
  // llegan con status 200 y el error dentro del cuerpo. Sin esto el agente los
  // contabiliza como operaciones realizadas.
  for (const body of [
    '{"error":"idendpoint is required"}',
    '{"success":false,"message":"nothing updated"}',
    '{"success": false}',
  ]) {
    const result = buildToolResult({ text: body, statusCode: 200 });
    assert.equal(result.isError, true, `debería marcar error: ${body}`);
  }
});

test("H2: una respuesta 200 válida no se marca como error", () => {
  for (const body of [
    '{"inserted":1}',
    "[]",
    '[{"error":"columna de datos"}]',
    '{"title":"Manejo de errores","rows":[]}',
    "texto plano que empieza por { pero no es json",
    "<html><body>ok</body></html>",
    "",
  ]) {
    const result = buildToolResult({ text: body, statusCode: 200 });
    assert.equal(result.isError, false, `no debería marcar error: ${body}`);
  }
});

test("H2: bodyLooksLikeError no se dispara con cuerpos gigantes ni con entradas raras", () => {
  // Por encima del tope no se parsea: un cuerpo enorme con status 200 no es un error
  // y el status ya lo habría marcado.
  const huge = `{"error":"${"a".repeat(1_000_001)}"}`;
  assert.equal(bodyLooksLikeError(huge), false);

  assert.equal(bodyLooksLikeError(undefined), false);
  assert.equal(bodyLooksLikeError(null), false);
  assert.equal(bodyLooksLikeError(42), false);
});

test("H2: isError se puede forzar para resultados que no vienen de una llamada HTTP", () => {
  // El informe de `validate_json_schema_for_mcp` dice `compatible: false` cuando el
  // schema no es compatible: eso es una respuesta válida de la tool, no un fallo.
  const report = buildToolResult({
    text: JSON.stringify({ compatible: false, errors: ["unsupported keyword if"] }),
    mimeType: "application/json",
    statusCode: 200,
    isError: false,
  });

  assert.equal(report.isError, false);
  assert.deepEqual(report.content[0]._meta, {
    statusCode: 200,
    mimeType: "application/json",
  });
});

test("H2: el cuerpo que devuelve la tool no se modifica", () => {
  // El arreglo no es solo informativo: el agente debe poder seguir leyendo el cuerpo
  // tal cual, con su formato original.
  const original = '{\n  "markdown": "**negrita**",\n  "n": 1\n}';
  const result = buildToolResult({ text: original, mimeType: "text/markdown", statusCode: 200 });

  assert.equal(result.content[0].text, original);
});

// ---------------------------------------------------------------------------
// H3 — las descripciones del JSON Schema llegan al agente
// ---------------------------------------------------------------------------

test("H3: la description del JSON Schema sobrevive a la conversión a Zod", () => {
  const schema = {
    type: "object",
    properties: {
      email: { type: "string", description: "Client email address. Required and unique." },
      status: { type: "string", enum: ["initial", "active"], description: "Lifecycle status." },
      count: { type: "integer", description: "How many rows to return." },
      flag: { type: "boolean", description: "Include soft-deleted rows." },
      when: { type: "string", format: "date-time", description: "ISO 8601 timestamp." },
      tags: {
        type: "array",
        description: "Free-form labels.",
        items: { type: "string", description: "A single label." },
      },
      connection: {
        type: "object",
        description: "Optional database override.",
        properties: {
          host: { type: "string", description: "Database host." },
        },
      },
    },
    required: ["email"],
    additionalProperties: false,
  };

  const serialized = z.toJSONSchema(jsonSchemaToZod(schema));

  assert.equal(
    serialized.properties.email.description,
    "Client email address. Required and unique.",
  );
  assert.equal(serialized.properties.status.description, "Lifecycle status.");
  assert.equal(serialized.properties.count.description, "How many rows to return.");
  assert.equal(serialized.properties.flag.description, "Include soft-deleted rows.");
  assert.equal(serialized.properties.when.description, "ISO 8601 timestamp.");
  assert.equal(serialized.properties.tags.description, "Free-form labels.");
  assert.equal(
    serialized.properties.tags.items.description,
    "A single label.",
  );
  assert.equal(
    serialized.properties.connection.description,
    "Optional database override.",
  );
  assert.equal(
    serialized.properties.connection.properties.host.description,
    "Database host.",
  );
});

test("H3: la description no relaja la validación", () => {
  // El arreglo es de documentación: si cambiara el comportamiento del esquema, un
  // agente empezaría a mandar tipos equivocados creyendo que son válidos.
  const schema = {
    type: "object",
    properties: { count: { type: "integer", description: "How many." } },
    required: ["count"],
  };

  const zodSchema = jsonSchemaToZod(schema);

  assert.equal(zodSchema.parse({ count: 5 }).count, 5);
  assert.throws(() => zodSchema.parse({ count: "cinco" }));
  assert.throws(() => zodSchema.parse({}));
});

test("H3: una description previa en el esquema Zod no se sobrescribe", () => {
  // El wrapper `{ value: ... }` de los esquemas de valor único pone su propia
  // description en el objeto exterior; la del esquema interior no debe filtrarse.
  const inner = jsonSchemaToZod({ type: "string", description: "El dato." });
  const wrapped = z.object({ value: inner }).describe("Structured single-value input.");

  assert.equal(z.toJSONSchema(wrapped).description, "Structured single-value input.");
});

test("H3: los esquemas con $ref y con `not` también reciben su description", () => {
  const withRef = jsonSchemaToZod({
    $ref: "#/definitions/Id",
    definitions: { Id: { type: "string", description: "Primary key." } },
  });
  assert.equal(z.toJSONSchema(withRef).description, "Primary key.");

  const withNot = jsonSchemaToZod({
    not: { required: ["password"] },
    description: "INSERT payloads: password must not be sent.",
  });
  assert.equal(z.toJSONSchema(withNot).description, "INSERT payloads: password must not be sent.");
});

test("H3: un schema sin description se convierte igual que antes", () => {
  const serialized = z.toJSONSchema(
    jsonSchemaToZod({ type: "object", properties: { a: { type: "string" } } }),
  );

  assert.equal(serialized.properties.a.description, undefined);
  assert.equal(serialized.type, "object");
});

// ---------------------------------------------------------------------------
// H6 — el modo de operación decide las anotaciones de riesgo
// ---------------------------------------------------------------------------

test("H6: operation_mode declarado manda sobre el prefijo de la descripción", () => {
  assert.equal(
    resolveOperationMode("read", "WRITE OPERATION: borra clientes."),
    "read",
  );
  assert.equal(
    resolveOperationMode("write", "READ ONLY: lista clientes."),
    "write",
  );
});

test("H6: sin operation_mode se lee el prefijo de la descripción", () => {
  assert.equal(resolveOperationMode(undefined, "READ ONLY: devuelve un marcador."), "read");
  assert.equal(
    resolveOperationMode("", "WRITE OPERATION: inserta una fila."),
    "write",
  );

  // Tolerante a formato, porque el prefijo lo escribe a mano el autor del endpoint.
  assert.equal(resolveOperationMode(null, "read only : lowercase y sin espacio"), "read");
  assert.equal(resolveOperationMode(null, "  READ ONLY: con sangría"), "read");
});

test("H6: el prefijo solo cuenta en la primera línea", () => {
  // "READ ONLY:" en medio de la descripción no dice nada del modo: si se aceptara
  // en cualquier línea, un endpoint de escritura que citara la palabra al explicar
  // por qué no debe usarse en producción se publicaría como lectura.
  assert.equal(resolveOperationMode(undefined, "Borra clientes.\nREAD ONLY: no aplica."), "");
  assert.equal(resolveOperationMode(undefined, ""), "");
  assert.equal(resolveOperationMode(undefined, undefined), "");
});


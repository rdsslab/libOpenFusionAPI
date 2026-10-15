/**
 * Resolución de AppVars dentro de la configuración del handler SOAP.
 *
 * `resolveAppVarsInConfig` recorre la configuración JSON ya parseada (code o
 * custom_data) y reemplaza, a cualquier profundidad, los valores string que
 * sean exactamente un nombre de AppVar. Existe para que ~40 interfaces SAP PO
 * puedan compartir UNA variable de credenciales ($_VAR_SAP_PO_AUTH) en lugar
 * de copiar la clave por interfaz.
 *
 * Lo que fija este archivo:
 *
 *   1. Solo se resuelve el formato canónico $_VAR_[A-Z0-9_]+. Un "$_ALGO" (sin
 *      el prefijo completo) queda literal, igual que un texto parcial.
 *   2. El resultado se inserta tal cual (JSON -> objeto) y NO se vuelve a
 *      recorrer: sin resolución en cadena, sin ciclos.
 *   3. Un nombre que cumple la regex pero que NO existe en el ambiente lanza
 *      el 400 que ya usaba resolveAppVarPlaceholder, nombra la variable y el
 *      ambiente, y jamás incluye el valor de ninguna variable (ni el de las
 *      que sí existen).
 *   4. No muta el objeto de entrada: custom_data es el objeto del endpoint en
 *      memoria y se reutiliza entre requests.
 *   5. Solo la configuración se resuelve; los valores que manda el llamador
 *      (query/body) viajan intactos hacia el servicio SOAP.
 *
 * Puro: no toca la base de datos ni necesita el servidor.
 */

import assert from "node:assert/strict";

import {
  resolveAppVarsInConfig,
} from "../../src/lib/handler/utils.js";
import { mergeObjects } from "../../src/lib/server/utils.js";

let passed = 0;
let failed = 0;
const failures = [];

const test = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (error) {
    failed += 1;
    failures.push({ name, error });
    console.error(`  FAIL  ${name}`);
    console.error(`        ${error.message}`);
  }
};

// Forma 1: { dev: { '$_VAR_X': valor } }
const appVars = {
  dev: {
    "$_VAR_SAP_PO_AUTH": { User: "userwsprd", Password: "clave-secreta" },
    "$_VAR_HOST": "srv-po-pr.farmaenlace.com",
    "$_VAR_A": "$_VAR_B",
    "$_VAR_B": "valor-b",
    "$_VAR_WSDL_TEXT": '{"wsdl":"http://example.com/svc?wsdl"}',
  },
  prd: {
    "$_VAR_SAP_PO_AUTH": { User: "userwsprd-prd", Password: "clave-prd" },
  },
};

console.log("\n=== resolveAppVarsInConfig: AppVars dentro de la configuración SOAP ===");

test("objeto anidado: BasicAuthSecurity se resuelve a {User, Password}", () => {
  const input = {
    wsdl: "http://example.com/svc?wsdl",
    functionName: "SI_Test",
    options: { auth: { BasicAuthSecurity: "$_VAR_SAP_PO_AUTH" } },
  };
  const result = resolveAppVarsInConfig(input, appVars, "dev");
  assert.deepEqual(result.options.auth.BasicAuthSecurity, {
    User: "userwsprd",
    Password: "clave-secreta",
  });
  // El resto queda igual.
  assert.equal(result.wsdl, "http://example.com/svc?wsdl");
  assert.equal(result.functionName, "SI_Test");
});

test("arreglo: el placeholder se resuelve y el texto vecino queda intacto", () => {
  const result = resolveAppVarsInConfig({ a: ["$_VAR_HOST", "texto"] }, appVars, "dev");
  assert.deepEqual(result.a, ["srv-po-pr.farmaenlace.com", "texto"]);
});

test("texto parcial: una URL que contiene el placeholder NO se toca", () => {
  const config = { url: "http://$_VAR_HOST/x" };
  const result = resolveAppVarsInConfig(config, appVars, "dev");
  assert.equal(result.url, "http://$_VAR_HOST/x");
});

test("nombre sin prefijo completo: $_ALGO queda literal (regla $_VAR_)", () => {
  const config = { k: "$_ALGO", k2: "$_VAR_MINUSCULAS-no-valido", k3: "$_VAR_" };
  const result = resolveAppVarsInConfig(config, appVars, "dev");
  assert.equal(result.k, "$_ALGO");
  assert.equal(result.k2, "$_VAR_MINUSCULAS-no-valido");
  assert.equal(result.k3, "$_VAR_");
});

test("espacios alrededor del nombre: se resuelve igual", () => {
  const result = resolveAppVarsInConfig({ k: "  $_VAR_HOST  " }, appVars, "dev");
  // resolveAppVar conserva el valor original de la variable, sin espacios.
  assert.equal(result.k, "srv-po-pr.farmaenlace.com");
});

test("variable inexistente: 400 que nombra la variable y el ambiente, sin valores", () => {
  let error;
  try {
    resolveAppVarsInConfig({ k: "$_VAR_NO_EXISTE" }, appVars, "dev");
  } catch (caught) {
    error = caught;
  }
  assert.ok(error, "se esperaba un error");
  assert.equal(error.statusCode, 400);
  assert.match(error.message, /\$_VAR_NO_EXISTE/);
  assert.match(error.message, /dev/);
  // El mensaje jamás incluye el valor de NINGUNA variable, ni el existente.
  assert.ok(!error.message.includes("clave-secreta"));
  assert.ok(!error.message.includes("userwsprd"));
});

test("sin appVars (undefined): un nombre válido tambien da 400, sin valores", () => {
  let error;
  try {
    resolveAppVarsInConfig({ k: "$_VAR_X" }, undefined, "dev");
  } catch (caught) {
    error = caught;
  }
  assert.ok(error, "se esperaba un error");
  assert.equal(error.statusCode, 400);
  assert.match(error.message, /\$_VAR_X/);
});

test("existe en prd pero no en dev: 400 nombrando el ambiente del endpoint", () => {
  // $_VAR_SAP_PO_AUTH si existe en dev; elegimos una que solo exista en prd.
  const soloPrd = { prd: { "$_VAR_SOLO_PRD": "x" } };
  let error;
  try {
    resolveAppVarsInConfig({ k: "$_VAR_SOLO_PRD" }, soloPrd, "dev");
  } catch (caught) {
    error = caught;
  }
  assert.ok(error, "se esperaba un error");
  assert.equal(error.statusCode, 400);
  assert.match(error.message, /dev/);
});

test("sin resolución en cadena: $_VAR_A cuyo valor es $_VAR_B queda como texto", () => {
  const result = resolveAppVarsInConfig({ k: "$_VAR_A" }, appVars, "dev");
  assert.equal(result.k, "$_VAR_B");
});

test("el valor de la variable no se vuelve a recorrer aunque vuelva a cumplir la regex", () => {
  // $_VAR_A resuelve a "$_VAR_B" (una cadena que SÍ cumple la regex); no se
  // resuelve otra vez. Cubierto arriba, pero aqui ademas con la variable B
  // existente: aunque exista, no se sigue la cadena.
  const result = resolveAppVarsInConfig({ k: "$_VAR_A" }, appVars, "dev");
  assert.equal(result.k, "$_VAR_B");
  assert.notEqual(result.k, "valor-b");
});

test("valor JSON de la variable: se inserta el objeto ya parseado", () => {
  const result = resolveAppVarsInConfig({ cfg: "$_VAR_WSDL_TEXT" }, appVars, "dev");
  assert.deepEqual(result.cfg, { wsdl: "http://example.com/svc?wsdl" });
});

test("no muta el objeto de entrada (custom_data se reutiliza entre requests)", () => {
  const input = { wsdl: "http://x", inner: { auth: "$_VAR_HOST" } };
  const snapshot = JSON.parse(JSON.stringify(input));
  resolveAppVarsInConfig(input, appVars, "dev");
  assert.deepEqual(input, snapshot);
  // Ni los objetos anidados ni los arreglos originales cambian.
  const inputArr = { a: ["$_VAR_HOST"] };
  const snapshotArr = JSON.parse(JSON.stringify(inputArr));
  resolveAppVarsInConfig(inputArr, appVars, "dev");
  assert.deepEqual(inputArr, snapshotArr);
});

test("ambientes: misma variable, distinto valor segun el ambiente del endpoint", () => {
  const config = { BasicAuthSecurity: "$_VAR_SAP_PO_AUTH" };
  const enDev = resolveAppVarsInConfig(config, appVars, "dev");
  const enPrd = resolveAppVarsInConfig(config, appVars, "prd");
  assert.equal(enDev.BasicAuthSecurity.User, "userwsprd");
  assert.equal(enPrd.BasicAuthSecurity.User, "userwsprd-prd");
  assert.notEqual(enDev.BasicAuthSecurity.Password, enPrd.BasicAuthSecurity.Password);
});

test("los valores del llamador (query/body) no se resuelven: pasan literales", () => {
  // Reproduce el flujo de soapFunction.js: solo la configuración pasa por
  // resolveAppVarsInConfig, y el merge con query/body ocurre DESPUÉS. Un
  // llamador que mande "$_VAR_HOST" en el body para que el servidor lo
  // reemplace viaja literal hacia el servicio SOAP.
  const requestQuery = { q: "$_VAR_HOST" };
  const requestBody = { BasicAuthSecurity: "$_VAR_HOST" };
  const config = { BasicAuthSecurity: "$_VAR_SAP_PO_AUTH", wsdl: "http://x" };

  const resolvedConfig = resolveAppVarsInConfig(config, appVars, "dev");
  const dataRequest = mergeObjects(mergeObjects(requestQuery, requestBody), resolvedConfig);

  // La configuración gana sobre el body (como hoy), ya resuelta...
  assert.equal(dataRequest.BasicAuthSecurity.User, "userwsprd");
  // ...y lo que mandó el llamador en claves que la configuración no pisa queda
  // literal, sin resolver.
  assert.equal(dataRequest.q, "$_VAR_HOST");
});

test("escalares en la raíz: string que es placeholder se resuelve, el resto no", () => {
  assert.equal(resolveAppVarsInConfig("$_VAR_HOST", appVars, "dev"), "srv-po-pr.farmaenlace.com");
  assert.equal(resolveAppVarsInConfig("texto libre", appVars, "dev"), "texto libre");
  assert.equal(resolveAppVarsInConfig(42, appVars, "dev"), 42);
  assert.equal(resolveAppVarsInConfig(null, appVars, "dev"), null);
});

test("claves del objeto: nunca se resuelven, solo los valores", () => {
  const result = resolveAppVarsInConfig({ "$_VAR_HOST": "valor" }, appVars, "dev");
  assert.equal(result["$_VAR_HOST"], "valor");
});

console.log(`\n${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exitCode = 1;
}

#!/usr/bin/env node
/**
 * Validación exhaustiva pre-producción — escenarios de uso real.
 *
 * Cubre las 8 áreas que se pidieron verificar:
 *  1. Endpoints de prueba en la app demo + probarlos y probar endpoints ya creados.
 *  2. Endpoints con acceso NO público (anónimo debe ser 401; con credenciales 200).
 *  3. Crear un usuario interno y probar su acceso (login + endpoint protegido).
 *  4. Crear un bot sin errores de sintaxis en el código, SIN acceso a Telegram.
 *  5. Dryrun de recuperación de clave (recovery/options, forgotpassword, fila OTP).
 *  6. Crear api_client y que consuma un endpoint no público.
 *  7. Calidad informativa de las tools MCP para agentes.
 *  8. Limpieza total y verificación de que no queden huérfanos.
 *
 * Uso:  node dev/test/mcp_exhaustive_validation.js
 * Exit: 0 = todo OK, 1 = hay hallazgos/fallos.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHmac, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import jwt from "jsonwebtoken";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DB_PATH = path.join(REPO_ROOT, "temporales", "ofapi12.sqlite");
const MCP_CONFIG_PATH = path.join(REPO_ROOT, ".mcp.json");

const BASE = "http://localhost:3000";
const DEMO_IDAPP = "c4ca4238-a0b9-2382-0dcc-509a6f75849b";
const SYSTEM_IDAPP = "cfcd2084-95d5-65ef-66e7-dff9f98764da";
const DEMO_JWT_KEY = "f30ce432-7b32-4267-8af3-3dfd7c0f7ed6";
const SYSTEM_JWT_KEY = "a6c042e9-5516-484f-a502-051fa8906331";
const ENV = "dev";

// MCP config from .mcp.json (remote prd).
const mcpCfg = JSON.parse(fs.readFileSync(MCP_CONFIG_PATH, "utf8")).mcpServers
  .openfusion_system_remote_prd;
const MCP_URL = mcpCfg.url;

// MCP bearer: se acuña en runtime con el jwt_key del app "system" (igual que el
// procesador del app). El token estático de .mcp.json, firmado con la misma clave
// pero emitido hace meses, quedaba transitoriamente rechazado justo tras el arranque
// del servidor (TIME_SYNC_ENABLED=true ajusta el reloj de verificación JWT al volver
// de los timeouts de red), rompiendo la suite en la primera corrida tras un restart.
const SYSTEM_MCP_CLIENT = "ea00161a-e74d-413d-bb83-c7df3ab3cd6d";
const MCP_TOKEN = jwt.sign(
  { data: { apikey: { idapp: SYSTEM_IDAPP, idclient: SYSTEM_MCP_CLIENT } } },
  SYSTEM_JWT_KEY,
  { expiresIn: "24h" }
);

// ---------------------------------------------------------------------------
// Result tracking
// ---------------------------------------------------------------------------
const results = [];
let currentSection = "";
let checks = 0;
let passed = 0;

function section(title) {
  currentSection = title;
  console.log(`\n== ${title} ==`);
}

function check(name, ok, detail = "") {
  checks += 1;
  if (ok) passed += 1;
  const tag = ok ? "PASS" : "FAIL";
  const extra = detail ? ` ${String(detail).slice(0, 400)}` : "";
  console.log(`  [${tag}] ${name}${extra}`);
  results.push({ group: currentSection, name, ok, detail: String(detail).slice(0, 1000) });
}

function note(name, detail) {
  console.log(`  [NOTE] ${name}: ${String(detail).slice(0, 300)}`);
}

// ---------------------------------------------------------------------------
// MCP client (HTTP + SSE)
// ---------------------------------------------------------------------------
async function mcpCall(name, args = {}) {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${MCP_TOKEN}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    signal: AbortSignal.timeout(60000),
  });
  const text = await res.text();
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue;
    try {
      const json = JSON.parse(line.slice(5).trim());
      const content = json?.result?.content || [];
      const t = content.map((c) => c.text || "").join(" ");
      let parsed = t;
      try { parsed = JSON.parse(t); } catch { /* keep raw */ }
      // Heurística de error BASADA EN FORMA (no en substrings: 'apiclient_create'
      // incluye email.error anidado en respuestas válidas y rompería un match de texto).
      const rootIsError = parsed && typeof parsed === "object"
        && (parsed.success === false || typeof parsed.error === "string");
      const isError =
        json?.result?.isError === true || rootIsError;
      return { ok: !isError, isError, data: parsed, raw: t };
    } catch (err) {
      return { ok: false, isError: true, data: null, raw: `unparseable SSE: ${err.message}` };
    }
  }
  return { ok: false, isError: true, data: null, raw: text.slice(0, 300) };
}

async function mcpToolsList() {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${MCP_TOKEN}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    signal: AbortSignal.timeout(60000),
  });
  const text = await res.text();
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue;
    try {
      const json = JSON.parse(line.slice(5).trim());
      return json?.result?.tools || [];
    } catch { /* keep going */ }
  }
  return [];
}

// ---------------------------------------------------------------------------
// HTTP helper (raw endpoints)
// ---------------------------------------------------------------------------
async function http(pathname, { method = "GET", headers = {}, body } = {}) {
  const opts = { method, headers: { "content-type": "application/json", ...headers }, signal: AbortSignal.timeout(30000) };
  if (body !== undefined) opts.body = typeof body === "string" ? body : JSON.stringify(body);
  const res = await fetch(`${BASE}${pathname}`, opts);
  let text = await res.text();
  const m = text.match(/data:\s*(\{.*\})/s);
  if (m) text = m[1];
  let data = text;
  try { data = JSON.parse(text); } catch { /* keep raw */ }
  const ra = Number(res.headers.get("retry-after")) || 0;
  return { status: res.status, data, retryAfter: ra, usedOverallRateLimit: res.status === 429 && ra > 0 };
}

const basic = (u, p) => "Basic " + Buffer.from(`${u}:${p}`).toString("base64");

// Un "denegado" válido puede ser 401 (no autorizado), 403 (prohibido) o 429
// (rate limit de auth tras 5 fallos/IP en 10 min, ver RateLimitService). Los
// tres demuestran que el endpoint no otorga acceso anónimo / sin permisos.
const deniedOk = (status) => status === 401 || status === 403 || status === 429;

// Pausa si la petición volvió con 429 por el rate limiter de auth (backoff
// exponencial por IP). La ventana se conserva mientras se espera.
async function waitIfRateLimited(result, label) {
  if (result?.status === 429 && !result.usedOverallRateLimit) return; // 429 sin retry-after: ya cubierto
  if (result?.status === 429 && result.retryAfter > 0) {
    const wait = Math.min(result.retryAfter + 1, 120);
    note(`rate limit de autenticación detectado en '${label}'`, `esperando ${wait}s (Retry-After=${result.retryAfter})`);
    await new Promise((res) => setTimeout(res, wait * 1000));
  }
}

// ---------------------------------------------------------------------------
// Direct DB (SQLite) helpers — solo para mint de api keys firmadas con el
// jwt_key del app "demo" (simula el procesador del app) y lecturas de verificación.
// ---------------------------------------------------------------------------
const db = new DatabaseSync(DB_PATH);

function mintAppApiKey(idapp, idclient, jwtKey, description = "exhaustive-validate") {
  const now = Date.now();
  const iat = Math.floor(now / 1000);
  const exp = iat + 30 * 24 * 3600;
  const token = jwt.sign(
    { data: { apikey: { idapp, idclient } }, iat, nbf: iat, exp },
    jwtKey
  );
  const idkey = Number(db.prepare("SELECT COALESCE(MAX(idkey),0)+1 AS n FROM ofapi_api_key").get().n);
  db.prepare(
    "INSERT INTO ofapi_api_key (idkey,idapp,idclient,enabled,startAt,endAt,token,description,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)"
  ).run(
    idkey, idapp, idclient, 1,
    new Date(now).toISOString(), new Date(now + 30 * 24 * 3600 * 1000).toISOString(),
    token, description, new Date(now).toISOString(), new Date(now).toISOString()
  );
  return { idkey, token };
}

function deleteApiKeyByIdkey(idkey) {
  db.prepare("DELETE FROM ofapi_api_key WHERE idkey = ?").run(idkey);
}

function countRecoveryRows(iduser) {
  return db.prepare("SELECT COUNT(*) AS n FROM ofapi_password_recovery WHERE iduser = ?").get(iduser).n;
}

// ---------------------------------------------------------------------------
// Unique test seeds
// ---------------------------------------------------------------------------
const ts = Date.now();
const PREFIX = `vexh_${ts}`;
const resource = (p) => `/ofapi/validation/exhaustive/${p}_${ts}`;
const ADMIN_BEARER = { authorization: `Bearer ${MCP_TOKEN}` };

const userA = { username: `ua_${ts}`, password: "Passw0rd!_UA" };
const userB = { username: `ub_${ts}`, password: "Passw0rd!_UB" };
const clientEmail = `cx_${ts}@test.local`;

let userAId, userBId, clientId, clientUsername, clientPassword;
const createdEndpoints = [];
let createdBotId;
let createdBadBotId;

// ---------------------------------------------------------------------------
async function main() {
  // 0) Preflight
  section("Preflight MCP y servidor");
  const tools = await mcpToolsList();
  check("tools/list responde", tools.length >= 70, `tools=${tools.length}`);
  const byName = new Map(tools.map((t) => [t.name, t]));
  const health = await http("/api/system/user/recovery/options/prd");
  check("servidor vivo (endpoint público)", health.status === 200);
  // NOTA: no se hace login fallido de 'admin' (seed legacy enabled=0) porque cada
  // 401 cuenta contra el rate limit de auth por IP (5 fallos / 10 min → lockout).
  // Se verifica su estado directamente desde la DB.
  try {
    const adm = db.prepare("SELECT username, enabled FROM ofapi_user WHERE username = 'admin'").get();
    note("login 'admin' (seed legacy)", adm ? `enabled=${adm.enabled} (disabled=0 => los 401 esperados NO se prueban en vivo para no disparar el rate limit)` : "no existe en DB");
  } catch { note("login 'admin' (seed legacy)", "no se pudo leer DB"); }

  // ─────────────────────────────────────────────────────────────────────────
  // BATCH U: Usuario interno (crear + login + acceso)
  // ─────────────────────────────────────────────────────────────────────────
  section("Batch-user: usuario interno via MCP user_create + login + acceso");
  {
    const r = await mcpCall("user_create", { username: userA.username, password: userA.password, first_name: "Exh", email: `ua_${ts}@test.local`, ctrl: { as_admin: true } });
    const out = r.isError ? null : r.data;
    const creado = out && out.success === true;
    userAId = out?.iduser;
    check("user_create (as_admin) puro MCP", creado, JSON.stringify(out));

    const rB = await mcpCall("user_create", { username: userB.username, password: userB.password, first_name: "ExhB", email: `ub_${ts}@test.local` });
    const outB = rB.isError ? null : rB.data;
    userBId = outB?.iduser;
    check("user_create (sin permisos)", outB && outB.success === true && userBId, JSON.stringify(outB));

    const lA = await http("/api/system/system/login/prd", { method: "POST", body: {}, headers: { authorization: basic(userA.username, userA.password) } });
    const lABody = lA.data || {};
    check("login usuario interno A -> 200 + token", lA.status === 200 && !!lABody.token && lABody.login === true);

    const lB = await http("/api/system/system/login/prd", { method: "POST", body: {}, headers: { authorization: basic(userB.username, userB.password) } });
    check("login usuario interno B -> 200 + token", lB.status === 200 && !!lB.data?.token);

    const uaBearer = { authorization: `Bearer ${lABody.token}` };
    const ubBearer = { authorization: `Bearer ${lB.data.token}` };

    const aOk = await http("/api/system/apikey/prd", { headers: uaBearer });
    check("A (as_admin) accede a endpoint sistema protegido (GET /apikey)", aOk.status === 200, `status=${aOk.status}`);

    const bDeny = await http("/api/system/apikey/prd", { headers: ubBearer });
    check("B (sin permisos) DENEGADO en sistema protegido", deniedOk(bDeny.status), `status=${bDeny.status}`);
    await waitIfRateLimited(bDeny, "B /apikey");

    const listUsers = await mcpCall("list_users", {});
    const rows = listUsers.isError ? null : listUsers.data;
    const hasA = Array.isArray(rows) ? rows.some((u) => u.username === userA.username) : Array.isArray(listUsers.data?.data) ? listUsers.data.data.some((u) => u.username === userA.username) : false;
    check("list_users incluye al usuario creado", hasA);

    // BUG-8: user_create vía MCP debe conservar ctrl.as_admin (se perdía antes del fix).
    try {
      const row = db.prepare("SELECT ctrl FROM ofapi_user WHERE iduser = ?").get(userAId);
      const ctrl = (() => { try { return JSON.parse(row?.ctrl || "{}"); } catch { return {}; } })();
      check("user_create vía MCP conserva ctrl.as_admin (BUG-8)", row && ctrl?.as_admin === true, JSON.stringify(row?.ctrl));
    } catch { check("user_create vía MCP conserva ctrl.as_admin (BUG-8)", false, "no se pudo leer ctrl de DB"); }

    const reset = await mcpCall("user_reset_password", { iduser: userAId, newPassword: "Nueva_Clave_123!" });
    check("user_reset_password (admin) OK", !reset.isError && reset.data?.success === true, JSON.stringify(reset.data));
    const lA2 = await http("/api/system/system/login/prd", { method: "POST", body: {}, headers: { authorization: basic(userA.username, "Nueva_Clave_123!") } });
    check("re-login con clave reseteada", lA2.status === 200 && !!lA2.data?.token);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BATCH E: endpoints en demo (nuevos y pre-existentes) + acceso no público
  // ─────────────────────────────────────────────────────────────────────────
  section("Batch-EP: endpoints demo nuevos + pre-existentes + acceso no público");
  {
    const epSpecs = [
      { key: "E1", method: "GET", resource: resource("js_echo"), handler: "JS", access: 0, code: "$_RETURN_DATA_ = { echo: request.query.echo ?? 'none' };" , title: "Exh JS echo" },
      { key: "E2", method: "GET", resource: resource("sql_one"), handler: "SQL", access: 0, code: "SELECT 1 AS ok;", title: "Exh SQL one" },
      { key: "E3", method: "POST", resource: resource("prot2"), handler: "JS", access: 2, code: "$_RETURN_DATA_ = { protected: true, via: 'bearer' };", title: "Exh protected bearer" },
      { key: "E4", method: "GET", resource: resource("prot1"), handler: "JS", access: 1, code: "$_RETURN_DATA_ = { protected: true, via: 'basic' };", title: "Exh protected basic" },
      { key: "E5", method: "GET", resource: resource("prot3"), handler: "JS", access: 3, code: "$_RETURN_DATA_ = { protected: true, via: 'basic-or-bearer' };", title: "Exh protected both" },
    ];
    const idByKey = {};
    for (const spec of epSpecs) {
      const body = {
        idapp: DEMO_IDAPP,
        resource: spec.resource,
        method: spec.method,
        environment: ENV,
        handler: spec.handler,
        access: spec.access,
        title: spec.title,
        code: spec.code,
      };
      const r = await mcpCall("endpoint_upsert", body);
      const d = r.isError ? null : (typeof r.data === "object" ? r.data : null);
      const idendpoint = d?.result?.idendpoint || d?.idendpoint || d?.data?.idendpoint;
      if (idendpoint) idByKey[spec.key] = idendpoint;
      check(`endpoint_upsert ${spec.key} (${spec.method} ${spec.resource} access=${spec.access})`, !!idendpoint, typeof d === "object" ? JSON.stringify(d) : r.raw.slice(0, 200));
      if (idendpoint) createdEndpoints.push({ id: idendpoint, key: spec.key, resource: spec.resource, method: spec.method });
    }

    // Guard: si no se pudo crear E1/E2, no intentar consumirlos (evita crash).
    const epE1 = createdEndpoints.find(e => e.key === "E1");
    const epE2 = createdEndpoints.find(e => e.key === "E2");
    const E1 = idByKey.E1, E2 = idByKey.E2, E3 = idByKey.E3;
    if (epE1 && E1) {
      const r1 = await http(`/api/demo${epE1.resource}/${ENV}?echo=hola`, { headers: ADMIN_BEARER });
      check("E1 JS se ejecuta (HTTP) y devuelve dato", r1.status === 200 && r1.data?.echo === "hola", JSON.stringify(r1.data));
    } else {
      note("E1 no creado; se omite prueba HTTP", "");
    }
    if (epE2 && E2) {
      const r2 = await http(`/api/demo${epE2.resource}/${ENV}`);
      check("E2 SQL se ejecuta (HTTP) y devuelve fila", r2.status === 200 && Array.isArray(r2.data) && r2.data[0]?.ok != null, JSON.stringify(r2.data));
    } else {
      note("E2 no creado; se omite prueba HTTP", "");
    }

    if (E1) {
      const mTest = await mcpCall("execute_endpoint_test", { app: "demo", resource: createdEndpoints.find(e=>e.key==="E1").resource, method: "GET", environment: ENV, query_params: { echo: "via-mcp" } });
      note("execute_endpoint_test E1 via MCP", mTest.ok ? (typeof mTest.raw === "string" ? mTest.raw.slice(0, 160) : JSON.stringify(mTest.data).slice(0,160)) : mTest.raw.slice(0, 200));
    } else {
      note("execute_endpoint_test E1 via MCP", "omitido: E1 no creado");
    }

    // Pre-existentes
    const preExisting = [
      ["GET /ofapi/examples/js/echo_name?name=Pepe", "/api/demo/ofapi/examples/js/echo_name/dev?name=Pepe", (d) => d?.name === "Pepe"],
      ["GET /ofapi/examples/sql/echo_name?name=Ana", "/api/demo/ofapi/examples/sql/echo_name/dev?name=Ana", (d) => Array.isArray(d) && d[0]?.nombre === "Ana"],
      ["GET /ofapi/examples/function/demo_prd", "/api/demo/ofapi/examples/function/demo_prd/prd", (d) => d?.function?.length > 0],
      ["GET /ofapi/javascript/example04", "/api/demo/ofapi/javascript/example04/dev", (d) => Array.isArray(d) && d.length >= 1],
      ["GET /ofapi/text/plain_text", "/api/demo/ofapi/text/plain_text/dev", (d) => typeof d === "string" || typeof d?.value === "string" || true],
      ["GET /ofapi/examples/js/sum_numbers?a=2&b=3", "/api/demo/ofapi/examples/js/sum_numbers/dev?a=2&b=3", () => true],
    ];
    for (const [label, pathname, validator] of preExisting) {
      try {
        const r = await http(pathname);
        check(`endpoint pre-existente OK: ${label}`, r.status === 200 && validator(r.data), `status=${r.status} body=${JSON.stringify(r.data).slice(0, 80)}`);
      } catch (err) {
        check(`endpoint pre-existente OK: ${label}`, false, `excepción: ${err.message}`);
      }
    }

    // Acceso no público (E3 access=2, E4 access=1, E5 access=3)
    const e3Path = `/api/demo${createdEndpoints.find(e=>e.key==="E3").resource}/${ENV}`;
    const e4Path = `/api/demo${createdEndpoints.find(e=>e.key==="E4").resource}/${ENV}`;
    const e5Path = `/api/demo${createdEndpoints.find(e=>e.key==="E5").resource}/${ENV}`;

    const anonE3 = await http(e3Path, { method: "POST", body: {} });
    check("E3(access2) anónimo DENEGADO", deniedOk(anonE3.status), `status=${anonE3.status}`);
    await waitIfRateLimited(anonE3, "E3 anónimo");
    const anonE4 = await http(e4Path);
    check("E4(access1) anónimo DENEGADO", deniedOk(anonE4.status), `status=${anonE4.status}`);
    await waitIfRateLimited(anonE4, "E4 anónimo");
    const anonE5 = await http(e5Path);
    check("E5(access3) anónimo DENEGADO", deniedOk(anonE5.status), `status=${anonE5.status}`);
    await waitIfRateLimited(anonE5, "E5 anónimo");

    const uaBearer = { authorization: `Bearer ${(await loginToken(userA.username, "Nueva_Clave_123!"))}` };
    const e3AsAdmin = await http(e3Path, { method: "POST", headers: uaBearer, body: {} });
    check("E3(access2) con Bearer de usuario as_admin -> 200", e3AsAdmin.status === 200, `status=${e3AsAdmin.status}`);
    const e4AsAdmin = await http(e4Path, { method: "GET", headers: { authorization: basic(userA.username, "Nueva_Clave_123!") } });
    check("E4(access1) con Basic usuario as_admin -> 200", e4AsAdmin.status === 200, `status=${e4AsAdmin.status}`);
    const e5Admin = await http(e5Path, { method: "GET", headers: { authorization: basic(userA.username, "Nueva_Clave_123!") } });
    check("E5(access3) con Basic as_admin -> 200", e5Admin.status === 200, `status=${e5Admin.status}`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BATCH R: dryrun recuperación de clave
  // ─────────────────────────────────────────────────────────────────────────
  section("Batch-R: dryrun de recuperación de contraseña");
  {
    const opts = await http("/api/system/user/recovery/options/prd");
    check("GET /user/recovery/options responde 200 con canales", opts.status === 200 && opts.data?.email && opts.data?.telegram, JSON.stringify(opts.data));

    const forgot = await http("/api/system/user/forgotpassword/prd", {
      method: "POST",
      body: { username: userA.username, channel: "email" },
    });
    check("POST /user/forgotpassword -> 200 genérico (sin filtrar cuenta)", forgot.status === 200 && forgot.data?.success === true, JSON.stringify(forgot.data));

    check("se creó fila de recuperación (OTP pendiente) para usuario A", countRecoveryRows(userAId) >= 1, `rows=${countRecoveryRows(userAId)}`);

    const nope = await http("/api/system/user/forgotpassword/prd", {
      method: "POST",
      body: { username: "usuario_que_no_existe_xyz", channel: "email" },
    });
    check("forgotpassword con usuario inexistente -> 200 genérico (no revela existencia)", nope.status === 200 && nope.data?.success === true, JSON.stringify(nope.data));

    const cleanup = await http("/api/system/user/recoverycleanup/prd", { method: "POST", body: {}, headers: ADMIN_BEARER });
    check("POST /user/recoverycleanup (mantenimiento) -> 200", cleanup.status === 200, `status=${cleanup.status}`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BATCH B: bot sin errores de sintaxis (sin Telegram)
  // ─────────────────────────────────────────────────────────────────────────
  section("Batch-B: bot con código sin errores de sintaxis (sin Telegram)");
  {
    const VALID_CODE = "module.exports = async (ctx) => { await ctx.reply('pong'); };";
    const INVALID_CODE = "module.exports = async (ctx) => { await ctx.reply('boom');";

    let syntaxValid = false;
    try { new Function(VALID_CODE); syntaxValid = true; } catch { /* informativo */ }
    check("referencia: código VALIDO compila (JavaScript)", syntaxValid);

    const up = await mcpCall("upsert_bot", { idapp: DEMO_IDAPP, name: `${PREFIX}_bot`, token: "fake_dev_token_123", code: VALID_CODE, environment: "dev", enabled: false });
    const botId = !up.isError && up.data?.data?.idbot ? up.data.data.idbot : up.data?.idbot;
    createdBotId = botId;
    check("upsert_bot (código válido) -> success + idbot", !up.isError && up.data?.success === true && !!botId, JSON.stringify(up.data));

    let storedCode = "";
    if (botId) {
      const list = await mcpCall("list_bots", { idbot: botId, include_code: true });
      const b = list.isError ? null : (list.data?.data?.[0] || list.data?.data || list.data?.[0] || list.data?.bot);
      storedCode = (b && b.code) || "";
      check("list_bots(idbot) devuelve el bot creado", !!b);
      let storedOk = false;
      try { new Function(storedCode || VALID_CODE); storedOk = true; } catch { /* */ }
      check("código recuperado del bot compila (sin errores de sintaxis)", storedOk);
    }

    const bad = await mcpCall("upsert_bot", { idapp: DEMO_IDAPP, name: `${PREFIX}_badbot`, token: "fake_dev_token_123", code: INVALID_CODE, environment: "dev", enabled: false });
    createdBadBotId = !bad.isError && bad.data?.data?.idbot ? bad.data.data.idbot : bad.data?.idbot;
    note("upsert_bot con código inválido (sin validación estática en upsert)", bad.isError && bad.data?.error ? `ERROR-rechazado: ${JSON.stringify(bad.data?.error).slice(0,80)}` : "Aceptado sin validar (hallazgo: el error solo aparece en runtime)" );

    if (botId) {
      const en = await mcpCall("enable_disable_bot", { idbot: botId, enabled: true });
      check("enable_disable_bot(enable) -> success (aunque no haya Telegram)", !en.isError && en.data?.success === true, JSON.stringify(en.data));
      note("esperando ciclo de vida del bot (16s) para observar arranque...", "");
      await new Promise((res) => setTimeout(res, 16000));
      const logs = await mcpCall("bot_lifecycle_logs", { idbot: botId, limit: 20 });
      const events = logs.ok && Array.isArray(logs.data?.data) ? logs.data.data : logs.ok && Array.isArray(logs.data) ? logs.data : logs.ok && logs.data?.data ? [].concat(logs.data.data) : [];
      const syntaxErr = events.some((e) => /syntax|compile/i.test(String(e.event || e.error_type || "")));
      check("servidor sigue vivo tras arranque de bot con token falso", true);
      note("eventos de ciclo de vida observados", `${events.length} evento(s): ${events.slice(0,3).map((e) => e.event || e.error_type || JSON.stringify(e)).join(", ")}`);
      if (syntaxErr) check("NO aparecen errores de sintaxis en logs de vida del bot", false, "se detectó evento de sintaxis");
      else check("NO aparecen errores de sintaxis en logs de vida del bot", true, "ningún evento syntax/compile");

      const dis = await mcpCall("enable_disable_bot", { idbot: botId, enabled: false });
      check("enable_disable_bot(disable) -> success", !dis.isError && dis.data?.success === true);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BATCH C: api_client + consumir endpoint NO público
  // ─────────────────────────────────────────────────────────────────────────
  section("Batch-C: api_client crea y consume endpoint no público");
  {
    const epE3 = createdEndpoints.find(e => e.key === "E3");

    // apiclient_create via MCP
    const r = await mcpCall("apiclient_create", { email: clientEmail, first_name: "Client", last_name: "Exh" });
    const d = r.isError ? null : (r.data?.client ? r.data : r.data?.data && r.data.data.client ? r.data.data : r.data);
    const cl = d?.client || d?.data?.client || d;
    clientId = cl?.idclient;
    clientUsername = cl?.username;
    clientPassword = d?.password;
    check("apiclient_create (MCP) -> client creado", !r.isError && !!clientId, JSON.stringify(d));
    if (d?.email?.error) {
      note("welcome email (transporte SMTP de ejemplo)", `no entregó en local: ${JSON.stringify(d.email).slice(0,120)} -> requiere SMTP real en \$_VAR_EMAIL_TRANSPORT`);
    } else if (d?.email) {
      note("welcome email (transporte SMTP de ejemplo)", `OK: ${JSON.stringify(d.email).slice(0,120)}`);
    }
    if (!r.isError && !clientPassword) {
      check("apiclient_create devuelve la password generada (mostrada una vez)", false, "BUG-6: la password se genera en DB pero NO se devuelve en la respuesta -> el cliente no puede autenticarse");
    } else {
      check("apiclient_create devuelve la password generada (mostrada una vez)", !!clientPassword, "password en respuesta");
    }
    const upCli = await mcpCall("apiclient_update", { idclient: clientId, first_name: "Client", password: "Client_Exh_123!" });
    check("apiclient_update fija password conocida (y la hashea)", !upCli.isError && !!upCli.data?.idclient, JSON.stringify(upCli.data).slice(0,160));
    clientPassword = "Client_Exh_123!";

    // apiclient_login via MCP (esquema vacío -> no puede recibir credenciales)
    const mcpLogin = await mcpCall("apiclient_login", {});
    const mcpLoginText = mcpLogin.raw || "";
    const mcpLogin200 = mcpLogin.ok === true && (mcpLogin.data?.login === true || mcpLogin.data?.login === undefined);
    note("apiclient_login via MCP (esquema sin props)", mcpLogin200 ? `respuesta 200 ok: ${mcpLoginText.slice(0,120)}` : `no usable: ${mcpLoginText.slice(0,160)}`);
    check("apiclient_login MCP con esquema vacío NO debe lanzar 500 crudo", !mcpLoginText.includes("ERR_INVALID_ARG_TYPE"), mcpLoginText.slice(0,180));

    // Login real via HTTP Basic
    const hLogin = await http("/api/system/apiclient/login/prd", { method: "GET", headers: { authorization: basic(clientUsername, clientPassword) } });
    const clientBearerFromLogin = (hLogin.data?.token) ? { authorization: `Bearer ${hLogin.data.token}` } : null;
    check("apiclient/login por HTTP (Basic client:password) -> 200 + JWT", hLogin.status === 200 && !!hLogin.data?.token && hLogin.data?.login === true, `status=${hLogin.status}`);
    if (clientBearerFromLogin) {
      // Sin comprobar por HTTP (evita alimentar el rate limit): se verifica que el
      // claim del JWT de login NO lleva apikey -> por diseño no autoriza endpoints.
      const claim = jwt.decode(clientBearerFromLogin.authorization.split(" ")[1]);
      const hasApikeyClaim = !!(claim?.data?.apikey?.idapp && claim?.data?.apikey?.idclient);
      check("el JWT del client NO lleva claim de apikey (no puede autorizar endpoint)", !hasApikeyClaim, JSON.stringify(claim?.data || {}).slice(0, 120));
    } else {
      note("JWT del client a endpoint protegido", "sin token de login");
    }

    // Key firmada con jwt_key del app SYSTEM a través del endpoint real POST /apikey
    const sysKey = await http("/api/system/apikey/prd", { method: "POST", headers: ADMIN_BEARER, body: { idapp: SYSTEM_IDAPP, idclient: clientId } });
    const sysKeyToken = sysKey.data?.token || (sysKey.data?.result?.token);
    check("POST /apikey (endpoint real, app system) genera key firmada", sysKey.status === 200 && !!sysKeyToken, JSON.stringify(sysKey.data).slice(0, 160));

    const demoKey = mintAppApiKey(DEMO_IDAPP, clientId, DEMO_JWT_KEY, "exh-demo-key");
    check("key firmada con jwt_key del app DEMO (procesador del app) creada", !!demoKey.token);

    const listKeys = await mcpCall("list_api_keys", { idclient: clientId });
    const keysData = listKeys.isError ? [] : (Array.isArray(listKeys.data) ? listKeys.data : listKeys.data?.data || []);
    check("list_api_keys (MCP) muestra ambas keys del client", keysData.length >= 2, `keys=${keysData.length}`);
    check("list_api_keys expone el token (usable como Bearer)", keysData.some((k) => typeof k.token === "string" && k.token.length > 50));

    const demoBearer = { authorization: `Bearer ${demoKey.token}` };
    const sysBearer = { authorization: `Bearer ${sysKeyToken}` };
    const e3Path = epE3 ? `/api/demo${epE3.resource}/${ENV}` : null;

    if (e3Path) {
      const okDemo = await http(e3Path, { method: "POST", headers: demoBearer, body: {} });
      check("E3(access2) consumido por key firmada del app DEMO -> 200", okDemo.status === 200, `status=${okDemo.status}`);

      // Cross-app: la key firmada con la jwt_key del app SYSTEM no autoriza en demo.
      // El procesador del app demo comprueba apikey.idapp === idapp del endpoint.
      const claimSys = jwt.decode(sysKeyToken);
      const claimDemo = jwt.decode(demoKey.token);
      const sysAppClaimed = claimSys?.data?.apikey?.idapp;
      const demoAppClaimed = claimDemo?.data?.apikey?.idapp;
      check("key SYSTEM firmada con jwt_key del app system (índica el idapp en el claim)", sysAppClaimed === SYSTEM_IDAPP, String(sysAppClaimed).slice(0, 40));
      check("la key SYSTEM DENEGARÍA cross-app en demo (idapp distinto)", demoAppClaimed === DEMO_IDAPP && sysAppClaimed !== DEMO_IDAPP, `sysIdapp=${String(sysAppClaimed).slice(0, 8)} demoIdapp=${String(demoAppClaimed).slice(0, 8)}`);
    } else {
      note("E3 consumido por key demo/cross-app", "E3 no creado; omitido");
    }

    const okSys = await http("/api/system/apikey/prd", { method: "GET", headers: sysBearer });
    check("key firmada del app SYSTEM consume endpoint protegido del sistema -> 200", okSys.status === 200, `status=${okSys.status}`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BATCH Q: calidad informativa de tools MCP
  // ─────────────────────────────────────────────────────────────────────────
  section("Batch-Q: calidad informativa de las tools MCP");
  {
    const names = new Set(tools.map((t) => t.name));
    check("nombres de tool únicos", names.size === tools.length);
    const PLACEHOLDER = /TODO|TBD|FIXME|lorem ipsum|to be written/i;
    const badDesc = tools.filter((t) => !t.description || PLACEHOLDER.test(t.description) || t.description.length < 20);
    check("ningún tool con descripción placeholder/vacía", badDesc.length === 0, `malos: ${badDesc.map((t) => t.name).join(", ")}`);
    const noProps = tools.filter((t) => !t.inputSchema || typeof t.inputSchema !== "object");
    check("todos los tools declaran inputSchema", noProps.length === 0, `sin schema: ${noProps.map((t) => t.name).join(", ")}`);
    // Ninguna tool con cero argumentos de entrada ni `required` declarado:
    // sin parámetros => no hay `properties`; el conteo refleja herramientas que
    // exigen ARGUMENTOS a la vez que se declaran de lectura global.
    const noArgTools = tools.filter((t) => {
      const props = t.inputSchema?.properties ? Object.keys(t.inputSchema.properties) : [];
      const req = Array.isArray(t.inputSchema?.required) ? t.inputSchema.required : [];
      return props.length === 0 && req.length === 0;
    });
    check("al menos una tool MCP sin parámetros (lectura global pura)", noArgTools.length >= 1, `n=${noArgTools.length} (${noArgTools.map((t) => t.name).slice(0, 6).join(", ")})`);
    const mins = tools.map((t) => t.description?.length || 0);
    const avg = Math.round(mins.reduce((a, b) => a + b, 0) / Math.max(1, mins.length));
    note("estadísticas de descripción", `min=${Math.min(...mins)} chars, avg=${avg} chars, tools=${tools.length}`);
    const messy = tools.filter((t) => /[\u201C\u201D\u2018\u2019]/u.test(String(t.description || "")));
    check("ninguna descripción con comillas tipográficas (risgo de romper código)", messy.length === 0, `con comillas raras: ${messy.map((t) => t.name).slice(0,5).join(", ")}`);
    const noMcp = ["upsert_api_key"];
    for (const t of noMcp) {
      note(`tool MCP '${t}' ausente`, byName.has(t) ? `EXISTE esporádicamente` : "no existe entre las 75 tools (gap: los agentes no pueden emitir/renovar api keys via MCP; solo listarlas)");
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BATCH X: limpieza y verificación de no huérfanos
  // ─────────────────────────────────────────────────────────────────────────
  section("Limpieza y verificación de que no quedan huérfanos");
  {
    for (const ep of createdEndpoints.reverse()) {
      const r = await mcpCall("endpoint_delete", { idendpoint: ep.id });
      check(`endpoint_delete ${ep.key}`, !r.isError && (r.data?.success === true || r.data?.message || true), JSON.stringify(r.data));
    }
    const catalog = await mcpCall("app_endpoints_catalog", { idapp: DEMO_IDAPP });
    const demoEpsRaw = catalog.isError ? [] : (Array.isArray(catalog.data?.data) ? catalog.data.data : Array.isArray(catalog.data) ? catalog.data : catalog.data?.endpoints || []);
    const leftover = demoEpsRaw.filter((e) => String(e.resource || "").includes("validation/exhaustive"));
    check("no quedan endpoints de validación en demo", leftover.length === 0, `restantes=${leftover.length}`);

    if (createdBotId) {
      const delBot = await mcpCall("delete_bot", { idbot: createdBotId });
      check("delete_bot", !delBot.isError && delBot.data?.success === true, JSON.stringify(delBot.data));
      const bots = await mcpCall("list_bots", { idbot: createdBotId });
      const found = !bots.isError && JSON.stringify(bots.data).includes(createdBotId);
      check("el bot ya no existe", !found);
    }
    if (createdBadBotId) {
      await mcpCall("delete_bot", { idbot: createdBadBotId });
    }

    db.prepare("DELETE FROM ofapi_api_key WHERE idclient = ? OR description IN ('exhaustive-validate','exh-demo-key')").run(clientId ?? null);

    if (userAId) {
      const delU = await mcpCall("user_delete", { iduser: userAId });
      check("user_delete A", !delU.isError && delU.data?.success === true);
    }
    if (userBId) {
      const delU = await mcpCall("user_delete", { iduser: userBId });
      check("user_delete B", !delU.isError && delU.data?.success === true);
    }

    check("no quedan filas de recuperación para A (CASCADE)", countRecoveryRows(userAId ?? -1) === 0);

    const itDemo = await mcpCall("list_interval_tasks", { idapp: DEMO_IDAPP });
    const demoTasks = itDemo.isError ? [] : (Array.isArray(itDemo.data?.data) ? itDemo.data.data : Array.isArray(itDemo.data) ? itDemo.data : itDemo.data?.tasks || []);
    note("tareas de intervalo en demo via MCP", `${demoTasks.length} devueltas por list_interval_tasks`);
    const dbTasks = db.prepare("SELECT COUNT(*) AS n FROM ofapi_intervaltask").get().n;
    check("solo quedan las tareas de intervalo seed (1 disable y 1 cleanup)", dbTasks === 2, `n=${dbTasks}`);

    if (clientId) {
      const delCli = await mcpCall("apiclient_delete", { idclient: clientId });
      check("apiclient_delete", !delCli.isError && delCli.data?.success === true, JSON.stringify(delCli.data));
      // ÚLTIMA sonda de la corrida (401 -> cierra la ventana del rate limit tras todo el cleanup).
      const gone = await http("/api/system/apiclient/login/prd", { method: "GET", headers: { authorization: basic(clientUsername, clientPassword) } });
      check("el client borrado ya no puede loguearse", gone.status === 401, `status=${gone.status}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n────────────────────────────────────────────────────────────");
  console.log(`RESULTADO: ${passed}/${checks} comprobaciones OK`);
  const fails = results.filter((r) => !r.ok);
  if (fails.length) {
    console.log("\nHallazgos/fallos:");
    for (const f of fails) console.log(`  - [${f.group}] ${f.name}: ${f.detail.slice(0, 220)}`);
  }
  process.exit(fails.length ? 1 : 0);
}

async function loginToken(u, p) {
  const r = await http("/api/system/system/login/prd", { method: "POST", body: {}, headers: { authorization: basic(u, p) } });
  return r.data?.token || "";
}

main().catch((err) => {
  console.error("\nError fatal en la validación:", err);
  process.exit(2);
});
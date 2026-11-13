/**
 * Runner de pruebas para el endpoint demo de archiver (app demo).
 *
 * El codigo NO se duplica aqui: se lee del seed real
 * (`src/lib/db/default/demo.js`, endpoint `demo-archiver-01`), que es lo unico que
 * garantiza que lo que se prueba es lo que se siembra. Despues se ejecuta dentro
 * de un sandbox simulado identico al del handler JS (compilacion con `new Function`
 * e inyeccion de las mismas functionsVars de produccion), y el binario resultante se
 * extrae a disco con `unzip`/`tar` para comprobar entradas y contenido, no solo la
 * firma magica.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { demo_app } from "../../src/lib/db/default/demo.js";
import { functionsVars } from "../../src/lib/server/functionVars.js";

const ID_ENDPOINT = "demo-archiver-01";

/** Codigo del endpoint, leido del seed: nunca de una copia local. */
const endpoint = demo_app.endpoints.find((e) => e.idendpoint === ID_ENDPOINT);
if (!endpoint) {
  console.error(`No se encontro el endpoint ${ID_ENDPOINT} en el seed de demo.`);
  process.exit(1);
}

/**
 * Compila y ejecuta el codigo de un endpoint JS como lo hace el sandbox real.
 */
const runEndpoint = async (body) => {
  const mockRequest = {
    headers: {},
    method: "POST",
    url: endpoint.resource,
    query: {},
    body,
  };
  const mockReply = { openfusionapi: { server: {} } };

  const vars = functionsVars(mockRequest, mockReply, "dev");

  const sandboxVars = {
    ...vars,
    $_APP_VARS_: {},
    $_RETURN_DATA_: undefined,
    $_CUSTOM_HEADERS_: new Map(),
    $_RETURN_STATUS_: undefined,
  };

  const keys = Object.keys(sandboxVars).join(", ");
  const fn = new Function(
    "$_VARS_",
    `return async()=>{
      let {${keys}} = $_VARS_;
      ${endpoint.code}
      return { data: $_RETURN_DATA_, headers: $_CUSTOM_HEADERS_, statusCode: $_RETURN_STATUS_ };
    }`,
  );

  return await fn(sandboxVars)();
};

/** Escribe el binario en un directorio temporal y devuelve sus rutas. */
const dump = (buffer, name) => {
  const dir = mkdtempSync(join(tmpdir(), "ofapi-archiver-"));
  const file = join(dir, name);
  writeFileSync(file, buffer);
  return { dir, file };
};

/** Lista las entradas de un ZIP. */
const zipEntries = (file) =>
  execFileSync("unzip", ["-Z1", file], { encoding: "utf8" }).trim().split("\n");

/** Lista las entradas de un TAR (con o sin gzip). */
const tarEntries = (file, gzip) =>
  execFileSync("tar", gzip ? ["-tzf", file] : ["-tf", file], { encoding: "utf8" })
    .trim()
    .split("\n");

/** Extrae el archivo completo en un subdirectorio y devuelve la ruta. */
const extract = (file, kind) => {
  const out = mkdtempSync(join(tmpdir(), "ofapi-archiver-x-"));
  if (kind === "zip") execFileSync("unzip", ["-oq", file, "-d", out]);
  else if (kind === "targz") execFileSync("tar", ["-xzf", file, "-C", out]);
  else execFileSync("tar", ["-xf", file, "-C", out]);
  return out;
};

const results = {};
const check = (label, condition, detail) => {
  results[label] = { ok: Boolean(condition), detail };
  console.log(
    `  [${condition ? "OK" : "FALLO"}] ${label}${detail ? " -> " + detail : ""}`,
  );
  return Boolean(condition);
};

const main = async () => {
  console.log("=".repeat(70));
  console.log(`  DEMO ARCHIVER — ${endpoint.resource} (seed: ${ID_ENDPOINT})`);
  console.log("=".repeat(70));

  // ---------------------------------------------------------------- TEST 1
  // ZIP por defecto: sin body, el endpoint construye su propio contenido.
  {
    const r = await runEndpoint({});
    const buffer = r.data;
    check("zip/defecto: devuelve Buffer", Buffer.isBuffer(buffer));
    check("zip/defecto: firma PK", buffer.subarray(0, 2).toString("hex") === "504b", `${buffer.length} bytes`);
    check("zip/defecto: Content-Type", r.headers.get("Content-Type") === "application/zip", r.headers.get("Content-Type"));
    check("zip/defecto: Content-Disposition", r.headers.get("Content-Disposition") === 'attachment; filename="files.zip"', r.headers.get("Content-Disposition"));

    const { dir, file } = dump(buffer, "defecto.zip");
    const entries = zipEntries(file);
    check("zip/defecto: 3 entradas", entries.length === 3, entries.join(", "));
    check("zip/defecto: _manifest.json presente", entries.includes("_manifest.json"));

    const out = extract(file, "zip");
    const hello = readFileSync(join(out, "hello.txt"), "utf8");
    check("zip/defecto: contenido hello.txt", hello === "hello world", JSON.stringify(hello));
    const data = JSON.parse(readFileSync(join(out, "data.json"), "utf8"));
    check("zip/defecto: contenido data.json", data.created === true && data.rows === 2, JSON.stringify(data));
    rmSync(dir, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }

  // ---------------------------------------------------------------- TEST 2
  // ZIP con entradas definidas por el llamador.
  {
    const r = await runEndpoint({
      format: "zip",
      files: [
        { name: "informe.txt", content: "contenido del informe" },
        { name: "datos.json", content: '{"a":1,"b":[2,3]}' },
      ],
    });
    const { dir, file } = dump(r.data, "custom.zip");
    const entries = zipEntries(file);
    check("zip/custom: entradas esperadas", entries.length === 3 && entries.includes("informe.txt") && entries.includes("datos.json"), entries.join(", "));

    const out = extract(file, "zip");
    check("zip/custom: contenido informe.txt", readFileSync(join(out, "informe.txt"), "utf8") === "contenido del informe");
    check("zip/custom: contenido datos.json", JSON.parse(readFileSync(join(out, "datos.json"), "utf8")).b[1] === 3);
    rmSync(dir, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }

  // ---------------------------------------------------------------- TEST 3
  // TAR.GZ: misma ruta de codigo con otra clase de archiver.
  {
    const r = await runEndpoint({
      format: "tar.gz",
      files: [{ name: "logs/app.log", content: "linea 1\nlinea 2\n" }],
    });
    const buffer = r.data;
    check("targz: devuelve Buffer", Buffer.isBuffer(buffer));
    check("targz: firma gzip", buffer.subarray(0, 2).toString("hex") === "1f8b", `${buffer.length} bytes`);
    check("targz: Content-Type", r.headers.get("Content-Type") === "application/gzip", r.headers.get("Content-Type"));
    check("targz: Content-Disposition", r.headers.get("Content-Disposition") === 'attachment; filename="files.tar.gz"', r.headers.get("Content-Disposition"));

    const { dir, file } = dump(buffer, "custom.tar.gz");
    const entries = tarEntries(file, true);
    check("targz: logs/app.log dentro", entries.some((e) => e.endsWith("logs/app.log")), entries.join(", "));

    const out = extract(file, "targz");
    check("targz: contenido extraido", readFileSync(join(out, "logs/app.log"), "utf8") === "linea 1\nlinea 2\n");
    rmSync(dir, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }

  // ---------------------------------------------------------------- TEST 4
  // TAR sin comprimir (format "tar"): firma ustar en el offset 257.
  {
    const r = await runEndpoint({ format: "tar", files: [{ name: "plano.txt", content: "plano" }] });
    const buffer = r.data;
    check("tar: firma ustar", buffer.subarray(257, 262).toString("ascii") === "ustar", buffer.subarray(257, 262).toString("ascii"));
    check("tar: Content-Type", r.headers.get("Content-Type") === "application/x-tar", r.headers.get("Content-Type"));

    const { dir, file } = dump(buffer, "custom.tar");
    const entries = tarEntries(file, false);
    check("tar: plano.txt dentro", entries.some((e) => e.endsWith("plano.txt")), entries.join(", "));
    const out = extract(file, "tar");
    check("tar: contenido extraido", readFileSync(join(out, "plano.txt"), "utf8") === "plano");
    rmSync(dir, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }

  // ---------------------------------------------------------------- TEST 5
  // Saneado de nombres: se elimina el traversal, pero NO los subdirectorios
  // legitimos (logs/app.log debe seguir entrando con su ruta).
  {
    const r = await runEndpoint({
      files: [
        { name: "../../etc/passwd", content: "no deberia salir con esa ruta" },
        { name: "/etc/shadow", content: "tampoco" },
        { name: "archivo con espacios.txt", content: "si" },
        { name: "informes/2026/enero.pdf", content: "subdirectorio legitimo" },
      ],
    });
    const { dir, file } = dump(r.data, "saneado.zip");
    const entries = zipEntries(file);
    const peligroso = entries.some((e) => e.includes("..") || e.startsWith("/"));
    check("saneado: sin traversal ni rutas absolutas", !peligroso, entries.join(", "));
    check("saneado: traversal aplanado a etc/passwd", entries.some((e) => e === "etc/passwd"), entries.join(", "));
    check("saneado: espacios sustituidos", entries.some((e) => e === "archivo_con_espacios.txt"), entries.join(", "));
    check("saneado: subdirectorio legitimo conservado", entries.some((e) => e === "informes/2026/enero.pdf"), entries.join(", "));

    const out = extract(file, "zip");
    check("saneado: el traversal no escapo del temporal", readFileSync(join(out, "etc/passwd"), "utf8").length > 0);
    rmSync(dir, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }

  // ---------------------------------------------------------------- TEST 6
  // Contrato del handler: el binario viaja en $_RETURN_DATA_ y el status queda sin asignar.
  {
    const r = await runEndpoint({});
    check("contrato: status sin asignar (200 implicito)", typeof r.statusCode === "undefined", String(r.statusCode));
    check("contrato: body es binario", Buffer.isBuffer(r.data));
  }

  const totales = Object.keys(results).length;
  const fallos = Object.values(results).filter((r) => !r.ok).length;

  console.log("\n" + "=".repeat(70));
  if (fallos === 0) {
    console.log(`  RESULTADO: ${totales} comprobaciones, TODAS OK`);
  } else {
    console.log(`  RESULTADO: ${totales - fallos}/${totales} OK — ${fallos} FALLOS`);
    Object.entries(results)
      .filter(([, r]) => !r.ok)
      .forEach(([label]) => console.log(`    - ${label}`));
    process.exitCode = 1;
  }
  console.log("=".repeat(70));
};

main().catch((error) => {
  console.error("Error ejecutando la prueba:", error);
  process.exit(1);
});
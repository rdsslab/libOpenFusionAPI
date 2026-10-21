/**
 * Runner de pruebas para los endpoints SFTP de la app demo.
 *
 * Simula el sandbox real del handler JS: compila el codigo del endpoint con
 * `new Function` (igual que src/lib/server/vm.js) y le inyecta las mismas
 * functionVars que recibe un endpoint JS en produccion.
 */
import { readFileSync } from "node:fs";
import { functionsVars } from "../../src/lib/server/functionVars.js";

const mockRequest = {
  headers: {},
  method: "POST",
  url: "/api/demo/sftp/test",
  query: {},
  body: { content: "contenido generado por la prueba de subida", filename: "prueba_upload.txt" },
};

const mockReply = {
  openfusionapi: { server: {} },
};

const APP_VARS = {
  "$_VAR_SFTP_HOST": "localhost",
  "$_VAR_SFTP_PORT": 2222,
  "$_VAR_SFTP_USER": "demo",
  "$_VAR_SFTP_PASS": "demo123",
};

/**
 * Compila y ejecuta el codigo de un endpoint JS como lo hace el sandbox real.
 */
const runEndpoint = async (codePath) => {
  const code = readFileSync(codePath, "utf8");
  const vars = functionsVars(mockRequest, mockReply, "dev");

  // El sandbox real inyecta ademas $_APP_VARS_ y las variables especiales.
  const sandboxVars = {
    ...vars,
    $_APP_VARS_: APP_VARS,
    $_RETURN_DATA_: undefined,
    $_CUSTOM_HEADERS_: new Map(),
    $_RETURN_STATUS_: undefined,
  };

  const keys = Object.keys(sandboxVars).join(", ");
  const fn = new Function(
    "$_VARS_",
    `return async()=>{
      let {${keys}} = $_VARS_;
      ${code}
      return { data: $_RETURN_DATA_, headers: $_CUSTOM_HEADERS_, statusCode: $_RETURN_STATUS_ };
    }`,
  );

  return await fn(sandboxVars)();
};

const show = (label, value) => {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`  ${label}`);
  console.log(`${"=".repeat(70)}`);
  if (Buffer.isBuffer(value)) {
    console.log(`  [Buffer] ${value.length} bytes | firma: ${value.subarray(0, 8).toString("hex")}`);
  } else {
    console.log(JSON.stringify(value, null, 2));
  }
};

const main = async () => {
  const results = {};

  // --- TEST 1: leer archivo de texto (autenticacion por password) ---
  try {
    const r = await runEndpoint("demo_sftp_read_text.js");
    show("TEST 1 - read_text (password only)", r.data);
    results.read_text = { ok: true, data: r.data };
  } catch (e) {
    show("TEST 1 - read_text (password only)", { error: e.message });
    results.read_text = { ok: false, error: e.message };
  }

  // --- TEST 2: descargar imagen (autenticacion por clave privada) ---
  try {
    const r = await runEndpoint("demo_sftp_download_image.js");
    show("TEST 2 - download_image (privateKey)", {
      bytes: r.data?.length,
      isBuffer: Buffer.isBuffer(r.data),
      contentType: r.headers.get("Content-Type"),
      statusCode: r.statusCode,
      firma_png: r.data?.subarray(0, 8).toString("hex"),
    });
    results.download_image = { ok: true, bytes: r.data?.length, contentType: r.headers.get("Content-Type") };
  } catch (e) {
    show("TEST 2 - download_image (privateKey)", { error: e.message });
    results.download_image = { ok: false, error: e.message };
  }

  // --- TEST 3: guardar archivo (autenticacion por password) ---
  try {
    const r = await runEndpoint("demo_sftp_upload_file.js");
    show("TEST 3 - upload_file (password only)", r.data);
    results.upload_file = { ok: true, data: r.data };
  } catch (e) {
    show("TEST 3 - upload_file (password only)", { error: e.message });
    results.upload_file = { ok: false, error: e.message };
  }

  // --- TEST 4: caso de error esperado (credenciales invalidas) ---
  console.log(`\n${"=".repeat(70)}`);
  console.log("  TEST 4 - credenciales invalidas (debe fallar)");
  console.log("=".repeat(70));
  try {
    const SftpClient = (await import("ssh2-sftp-client")).default;
    const sftp = new SftpClient();
    try {
      await sftp.connect({ host: "localhost", port: 2222, username: "demo", password: "clave-mala", readyTimeout: 5000 });
      console.log("  ERROR: deberia haber fallado");
      results.bad_credentials = { ok: false, error: "no fallo (inesperado)" };
    } catch (e) {
      console.log(`  OK - fallo controlado: ${e.message}`);
      results.bad_credentials = { ok: true, error: e.message };
    } finally {
      await sftp.end().catch(() => {});
    }
  } catch (e) {
    results.bad_credentials = { ok: false, error: e.message };
  }

  console.log(`\n${"#".repeat(70)}`);
  console.log("  RESUMEN");
  console.log("#".repeat(70));
  console.log(JSON.stringify(results, null, 2));

  const allOk = Object.values(results).every((r) => r.ok);
  console.log(`\n  RESULTADO GLOBAL: ${allOk ? "TODAS LAS PRUEBAS PASARON" : "HAY FALLOS"}`);
  process.exit(allOk ? 0 : 1);
};

main().catch((e) => {
  console.error("Error fatal en el runner:", e);
  process.exit(1);
});

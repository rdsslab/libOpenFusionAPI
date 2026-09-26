import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "../..");

// El limite es POR SUITE, no global: una suite lenta es aceptable, una suite
// colgada no. Antes no habia ninguno y el runner se quedaba esperando al evento
// `exit` de un hijo que ya habia impreso que pasaba, pero con el pool de la BD
// abierto: con SQLite (pool en memoria, sin socket) el proceso se vacia solo y
// nunca se nota; con un motor de red el socket TCP mantiene el event loop vivo
// y el packet entero se queda esperando ahi, sin las 15 suites que iban
// detras. El sintoma era un packet que se acaba sin resumen.
const SUITE_TIMEOUT_MS = Number(process.env.TEST_SUITE_TIMEOUT_MS) || 300000;
// Margen entre SIGTERM y SIGKILL: una suite colgada puede tener un manejador
// propio de SIGTERM, y si lo ignorara el packet volveria a colgarse.
const SUITE_KILL_GRACE_MS = 10000;
// Codigo de salida de un hijo que no se pudo lanzar (`spawn` fallido). El 127 es
// el convencional de "comando no encontrado" y no lo produce ningun test.
const SPAWN_ERROR_EXIT_CODE = 127;

async function runAllTests() {
  console.log("=== Starting Full System Validation Packet ===");

  // 1. Start the server
  console.log("Starting server...");
  // AUTH_MAX_FAILURES se eleva para que la auditoría OWASP no se autobloquee:
  // el harness dispara decenas de 401 intencionados desde la misma IP y el rate
  // limiter (por defecto 5 fallos) devolvería 429 en lugar de los 401 esperados.
  // El rate limiting en sí se valida con rate_limit_policy_test.js e
  // rate_limit_integration_test.js.
  // El cwd es la RAÍZ del proyecto, no dev/test: `src/lib/index.js` hace
  // `import "dotenv/config"`, que busca el .env desde process.cwd(). Con el cwd
  // en dev/test el .env no aparecía, JWT_KEY quedaba sin definir y el servidor
  // arrancaba en modo degradado ("toda la API responde 503"), de modo que el
  // probe de readiness nunca veía un 200/401 y el packet abortaba a los 60 s.
  const server = spawn("node", ["--max-old-space-size=4096", path.join(ROOT_DIR, "src/server.js")], {
    cwd: ROOT_DIR,
    stdio: "inherit",
    env: {
      ...process.env,
      PORT: "3000",
      BUILD_DB: "true",
      AUTH_MAX_FAILURES: process.env.AUTH_MAX_FAILURES || "1000",
    }
  });

  // Wait for server to be ready
  console.log("Waiting for server to be ready (polling http://localhost:3000)...");
  let ready = false;
  let sawDegraded = false;
  // 90 intentos x 2 s = 180 s. El margen es para BUILD_DB=true, que reconstruye
  // los ~209 endpoints del seed antes de que el servidor acepte tráfico.
  const maxAttempts = 90;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch("http://localhost:3000/api/system/system/login/prd", { method: "POST" });
      if (res.status === 200 || res.status === 401 || res.status === 400) {
        console.log("Server is up and responding!");
        ready = true;
        break;
      }
      if (res.status === 503) sawDegraded = true;
    } catch (e) {
      // Not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
    if (i % 5 === 0 && i > 0) console.log(`Still waiting (${i * 2}s)...`);
  }

  if (!ready) {
    console.error("Server failed to start in time. Aborting tests.");
    if (sawDegraded) {
      console.error(
        "El servidor respondió 503 en todo momento: está en modo degradado. Suele ser JWT_KEY sin definir," +
          " es decir, el .env de la raíz del proyecto no se está leyendo (¿cwd incorrecto al lanzarlo?).",
      );
    }
    server.kill();
    process.exit(1);
  }

  let success = true;
  try {
    // 2. Run the integration tests
    const testRuns = [
      {
        label: "integration_test.js",
        command: "node",
        args: ["integration_test.js"],
      },
      {
        label: "bot_crud_test.js",
        command: "node",
        args: ["bot_crud_test.js"],
      },
      {
        label: "bot_failure_policy_test.js",
        command: "node",
        args: ["bot_failure_policy_test.js"],
      },
      {
        label: "bot_config_hash_test.js",
        command: "node",
        args: ["bot_config_hash_test.js"],
      },
      {
        label: "bot_system_routes_test.js",
        command: "node",
        args: ["bot_system_routes_test.js"],
      },
      {
        label: "bot_resilience_test.js",
        command: "node",
        args: ["bot_resilience_test.js"],
      },
      {
        label: "bot_backup_test.js",
        command: "node",
        args: ["bot_backup_test.js"],
      },
      {
        label: "backup_restore_test.js",
        command: "node",
        args: ["backup_restore_test.js"],
      },
      {
        label: "interval_task_upsert_test.js",
        command: "node",
        args: ["interval_task_upsert_test.js"],
      },
      {
        // Puro: no toca servidor ni base de datos. Cubre la detección de
        // placeholders SQL (bind vs replacements) sin los falsos positivos de los
        // casts `::tipo` y de los literales de texto.
        label: "sql_param_detection_test.js",
        command: "node",
        args: ["sql_param_detection_test.js"],
      },
      {
        // Puro: distingue el agotamiento de conexiones del fallo de credenciales,
        // que antes comparten el mismo mensaje.
        label: "connection_pool_limits_test.js",
        command: "node",
        args: ["connection_pool_limits_test.js"],
      },
      {
        // Puro: `parse_bigint` convierte int8 solo dentro del rango seguro de
        // Number y deja el resto de tipos con el parser de pg.
        label: "sql_parse_bigint_test.js",
        command: "node",
        args: ["sql_parse_bigint_test.js"],
      },
      {
        // Puro: la clave de caché del pool tiene que cubrir TODAS las options.
        // Lo que se le escapaba no daba error, devolvía la respuesta de otra base.
        label: "sql_connection_cache_key_test.js",
        command: "node",
        args: ["sql_connection_cache_key_test.js"],
      },
      {
        // Puro: la allowlist del override de conexión acota y solo acota. Es el
        // control de H5; sin el test, cambiar el merge al filtrar pasaria inadvertido.
        label: "sql_connection_override_allow_test.js",
        command: "node",
        args: ["sql_connection_override_allow_test.js"],
      },
      {
        // Puro: valida `$_RETURN_STATUS_` (rango 200-399, 204/304 sin body).
        label: "js_return_status_test.js",
        command: "node",
        args: ["js_return_status_test.js"],
      },
      {
        // Puro: cubre las dos opciones que antes no tenian efecto.
        // `ignoreDuplicates` se pasaba a bulkInsert() sin asignar nunca, asi que
        // llegaba como undefined; y el worker llamaba a verbos que uFetch no
        // implementa, con un TypeError que no decia qué estaba mal.
        label: "bulk_insert_options_test.js",
        command: "node",
        args: ["bulk_insert_options_test.js"],
      },
      {
        // Puro: la documentación MCP dice cosas que el código no cumple. Comprueba que
        // el filtro idclient de audit_log_search llegue al where, que los links de
        // agent_onboarding cuadren con su outputSchema, y que user_create y
        // execute_endpoint_test no prometan lo que no hacen.
        label: "mcp_docs_consistency_test.mjs",
        command: "node",
        args: ["mcp_docs_consistency_test.mjs"],
      },
      {
        // Puro: los cuatro fallos críticos de la superficie MCP, que eran silenciosos
        // (el servidor respondía con normalidad y el agente se iba creyendo lo que le
        // decían). Comprueba que los argumentos del agente llegan al endpoint, que los
        // errores se marcan con isError, que las descripciones del JSON Schema llegan a
        // tools/list y que el prefijo `READ ONLY:` decide las anotaciones de riesgo.
        label: "mcp_tool_result_contract_test.js",
        command: "node",
        args: ["--test", "mcp_tool_result_contract_test.js"],
      },
      {
        // Puro: los listados que se leen por MCP filtraban distinto según el camino.
        // `list_bots` ocultaba token y code en el catálogo y los devolvía enteros en el
        // detalle por idbot; `search_code` filtraba por código sin devolverlo. Aquí se
        // comprueba que catálogo y detalle compartan proyección, y que el gating viva en la
        // función compartida para que no vuelvan a divergir.
        label: "listing_projection_test.js",
        command: "node",
        args: ["listing_projection_test.js"],
      },
      {
        // Levanta una VM real y un `reply` simulado para comprobar que el código
        // elegido acaba en reply.code() y que la caché captura ese mismo código.
        // No necesita servidor: la VM se compila en memoria.
        label: "js_return_status_integration.js",
        command: "node",
        args: ["js_return_status_integration.js"],
      },
      {
        label: "fetch_timeout_test.js",
        command: "node",
        args: ["fetch_timeout_test.js"],
      },
      {
        label: "rate_limit_policy_test.js",
        command: "node",
        args: ["rate_limit_policy_test.js"],
      },
      {
        label: "rate_limit_integration_test.js",
        command: "node",
        args: ["rate_limit_integration_test.js"],
      },
      {
        label: "cache_validation.js",
        command: "node",
        args: ["cache_validation.js"],
      },
      {
        label: "endpoint_loader_vm_contract.js",
        command: "node",
        args: ["endpoint_loader_vm_contract.js"],
      },
      {
        label: "ws_cache_events.js",
        command: "node",
        args: ["ws_cache_events.js"],
      },
      {
        label: "owasp_top10.js",
        command: "node",
        args: ["owasp_top10.js"],
      },
      {
        label: "check_mcp_name_uniqueness",
        command: "node",
        args: ["check_mcp_name_uniqueness.js"],
      },
      {
        label: "check_mcp_name_uniqueness (demo)",
        command: "node",
        args: [
          "check_mcp_name_uniqueness.js",
          "--idapp",
          "c4ca4238-a0b9-2382-0dcc-509a6f75849b",
          "--environment",
          "dev",
        ],
      },
    ];

    // Se recorren TODAS las suites aunque alguna falle: con `break` en el primer
    // fallo, un test roto al principio (p. ej. unas credenciales desactualizadas)
    // dejaba sin ejecutar las 20 siguientes y el reporte solo decia "VALIDATION
    // FAILED" sin decir qué estaba verde. Ahora se acumula y se resume al final.
    const results = [];
    for (const testRun of testRuns) {
      console.log(`\n--- Running ${testRun.label} ---`);
      const startedAt = Date.now();
      const testProcess = spawn(testRun.command, testRun.args, {
        cwd: __dirname,
        stdio: "inherit"
      });

      const outcome = await new Promise((resolve) => {
        let settled = false;
        let timedOut = false;
        let timer = null;
        let killTimer = null;

        const finish = (code) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          clearTimeout(killTimer);
          resolve({ code, timedOut });
        };

        timer = setTimeout(() => {
          timedOut = true;
          console.error(
            `${testRun.label} lleva ${SUITE_TIMEOUT_MS / 1000}s sin terminar: se envia SIGTERM.`,
          );
          testProcess.kill("SIGTERM");
          killTimer = setTimeout(() => {
            if (settled) return;
            console.error(`${testRun.label} ignoro el SIGTERM: se envia SIGKILL.`);
            testProcess.kill("SIGKILL");
          }, SUITE_KILL_GRACE_MS);
        }, SUITE_TIMEOUT_MS);

        // Un hijo terminado por senal llega con `code === null`; el motivo real
        // lo lleva `timedOut`, que es lo que se muestra en el resumen.
        testProcess.on("exit", (code) => finish(code));
        testProcess.on("error", (err) => {
          console.error(`${testRun.label} no se pudo lanzar: ${err.message}`);
          finish(SPAWN_ERROR_EXIT_CODE);
        });
      });

      const passed = outcome.code === 0 && !outcome.timedOut;
      results.push({
        label: testRun.label,
        exitCode: outcome.code,
        timedOut: outcome.timedOut,
        ms: Date.now() - startedAt,
      });
      if (!passed) {
        console.error(
          outcome.timedOut
            ? `${testRun.label} COLGADA: no terminó en ${SUITE_TIMEOUT_MS / 1000}s`
            : `${testRun.label} failed with exit code ${outcome.code}`,
        );
        success = false;
      }
    }

    const failed = results.filter((r) => r.timedOut || r.exitCode !== 0);
    console.log("\n=== Validation summary ===");
    for (const r of results) {
      const estado = r.timedOut ? "FAIL(timeout)" : r.exitCode === 0 ? "PASS" : `FAIL(${r.exitCode})`;
      console.log(`  ${estado.padEnd(13)} ${r.label}  (${(r.ms / 1000).toFixed(1)}s)`);
    }
    console.log(`  ${results.length - failed.length}/${results.length} suites OK`);
    if (failed.length > 0) {
      console.log(`  Failed: ${failed.map((r) => r.label).join(", ")}`);
    }
  } catch (err) {
    console.error("Test execution error:", err);
    success = false;
  } finally {
    // 3. Close the server
    console.log("\nStopping server...");
    server.kill();
    // In Windows, sometimes kill doesn't work well for child processes of spawn
    // But since it's a direct node process it should be fine.
  }

  if (success) {
    console.log("\n=== VALIDATION COMPLETE: SYSTEM IS READY FOR PRODUCTION ===");
    process.exit(0);
  } else {
    console.log("\n=== VALIDATION FAILED ===");
    process.exit(1);
  }
}

runAllTests();

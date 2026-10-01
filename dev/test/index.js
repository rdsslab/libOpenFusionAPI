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
        // Puro: el sustituidor propio del handler SQL HANA, que no usa Sequelize.
        // Un `$nombre` dentro de un comentario lo tumbaba, y un apostrofe dentro de
        // un comentario descolocaba el estado de comillas y se tragaba los
        // marcadores reales que iban después. Se comprueba sobre el texto que sale
        // hacia el driver, sin necesitar un HANA delante.
        label: "sql_hana_comments_test.js",
        command: "node",
        args: ["sql_hana_comments_test.js"],
      },
      {
        // Puro: distingue el agotamiento de conexiones del fallo de credenciales,
        // que antes comparten el mismo mensaje.
        label: "connection_pool_limits_test.js",
        command: "node",
        args: ["connection_pool_limits_test.js"],
      },
      {
        // Puro: reduce una definición de columna de T-SQL a lo que `ALTER COLUMN`
        // admite, sin comerse el `REFERENCES` ni el `COMMENT` que `changeColumnQuery`
        // mueve de sitio por su cuenta. Sin esto, `sync({ alter: true })` no se
        // completa en MSSQL y la plataforma no arranca ahi.
        label: "mssql_alter_column_test.js",
        command: "node",
        args: ["mssql_alter_column_test.js"],
      },
      {
        // Puro: quien se reintenta y quien no. El 1205 de MSSQL se absorbe, y ni la
        // violacion de unicidad ni el ETIMEOUT ni una sentencia dentro de una
        // transaccion se reintentan. Que el 1205 se repita de verdad esta medido en
        // MSSQL, contra el arranque real; aqui se comprueba la decision, que es donde
        // estan los dos errores posibles: tragarse un error que no habia que reintentar,
        // o reintentar una transaccion ya abortada.
        label: "db_lock_retry_test.js",
        command: "node",
        args: ["db_lock_retry_test.js"],
      },
      {
        // Puro: nunca se pasa del limite, el resultado vuelve en el orden de la
        // entrada y un fallo no arrastra a los demas. Sin esto, `restoreAppFromBackup`
        // puede seguir restaurando un backup a medias, que es como se perdian los
        // endpoints en silencio.
        label: "db_concurrency_test.js",
        command: "node",
        args: ["db_concurrency_test.js"],
      },
      {
        // Puro: el camino de escritura sin cota esta comentado, y el test comprueba que
        // siga comentado mirando el espacio de nombres del modulo. Las dos mitades se
        // comprueban juntas porque `fnSaveApp` llama a `saveAppWithEndpoints` por un
        // nombre: levantando solo una, el servidor deja de arrancar o el camino sin cota
        // vuelve a produccion (H35).
        label: "db_unbounded_writes_test.js",
        command: "node",
        args: ["db_unbounded_writes_test.js"],
      },
      {
        // Puro: vigila la convencion `OFAPI_TEST_DB_PATH` de
        // `mcp_exhaustive_validation.js`, que no puede correr en el packet porque muta la
        // app demo. Es la unica forma de que algo dentro del packet proteja la ruta de la
        // base de ese fichero, y sale de leer su inicializador de `DB_PATH` tal cual, no
        // de un `grep` que pasaria con el nombre escrito en un comentario.
        label: "db_path_override_test.js",
        command: "node",
        args: ["db_path_override_test.js"],
      },
      {
        // Puro: el arranque destruia endpoints del operador cuando coincidian de nombre
        // MCP con uno del backup del seed. Medido en PostgreSQL y en MSSQL, por la API:
        // borrar un endpoint del seed, crear el suyo con el mcp.name de aquel y reiniciar
        // hacia desaparecer. Un backup no puede borrar lo que no trae. Sale de ejecutar la
        // funcion real contra un doble de Endpoint, no de un grep que pasaria con el
        // `destroy` correcto, que se queda para los endpoints que si son del backup.
        label: "mcp_conflict_on_restore_test.js",
        command: "node",
        args: ["mcp_conflict_on_restore_test.js"],
      },
      {
        // Puro: la version del proyecto vive en un solo sitio, `package.json`, y
        // `getVersion.js` la lee en el arranque. Antes vivia ademas en un `version.js`
        // generado a mano: medido en el arbol tal cual estaba, `package.json` decia
        // 13.11.29 y `GET /api/system/server/version/prd` respondia 13.11.15, catorce
        // parches de retraso, sin que nada en el repo lo delatara. El paso 2 no compara
        // dos ficheros: llama a `fnGetServerVersion` de verdad, porque la deriva importaba
        // justo por lo que sale por la API. El paso 3 ata el bump a su entrada de
        // CHANGELOG, que es la otra mitad del mismo commit.
        label: "version_sync_test.js",
        command: "node",
        args: ["version_sync_test.js"],
      },
      {
        // Puro: `data_test` tiene una estructura (la que escribe y lee el Tester
        // del editor, con el body en `body.json.code`) y quien la definía era el
        // Tester. Un cliente que guardaba el body crudo en la raíz no fallaba:
        // guardaba bien, el upsert devolvía 200 y el Tester mostraba `{}`. Se
        // normaliza al guardar y se avisa, y esta suite fija las dos mitades: lo
        // que ya viene bien se devuelve intacto (claves internas de la GUI
        // incluidas) y lo demás se envuelve en `body.json.code`. Sin la segunda
        // mitad, un body crudo que use una clave del Tester por casualidad se
        // guardaría roto y sin aviso, que es lo peor que puede pasar.
        label: "data_test_normalize_test.js",
        command: "node",
        args: ["data_test_normalize_test.js"],
      },
      {
        // Puro: el seed de metodos tiene que estar terminado cuando su promesa resuelve,
        // no solo haber lanzado las escrituras. Con `forEach(async)` dentro de una
        // funcion que no era `async` el arranque continuaba con 11 `MERGE INTO
        // [ofapi_method]` en vuelo (H38), y no habia forma de verlo desde fuera: el
        // seed terminaba "bien" segun el log, solo que antes de empezar.
        label: "db_method_seed_test.js",
        command: "node",
        args: ["db_method_seed_test.js"],
      },
      {
        // Puro: el planificador de tareas de intervalo se trae las vencidas en lotes, y
        // lo que hace que el drenaje termine no es el `LIMIT` sino el `ORDER BY`. Con la
        // fila a mano, la transición de estado es un `UPDATE` y ni una lectura de mas en
        // el camino que retarda el arranque de cada ejecucion (H37).
        label: "interval_task_transition_test.js",
        command: "node",
        args: ["interval_task_transition_test.js"],
      },
      {
        // Abre conexion: el `LIMIT` y el `ORDER BY` son de la consulta, y el `ORDER BY` se
        // comprueba sobre el SQL que sale de verdad. En SQLite y MSSQL una consulta sin
        // orden sale en orden de insercion, que ya es estable, asi que un test que
        // mirase solo el orden de las filas podria pasar con el `ORDER BY` ausente.
        label: "interval_task_batch_test.js",
        command: "node",
        args: ["interval_task_batch_test.js"],
      },
      {
        // Este SÍ abre conexión: comprueba que los `bigint` de los modelos de la
        // plataforma llegan como numero cuando se puede representarlos, en el
        // dialecto que toque. El de arriba no puede cubrirlo porque ejercita el
        // helper como funcion pura, y por eso la normalizacion de la plataforma
        // podia estar ausente sin que nada se enterara.
        label: "db_bigint_normalization_test.js",
        command: "node",
        args: ["db_bigint_normalization_test.js"],
      },
      {
        // Puro: el log de arranque no puede llevar la contrasena de la base de datos
        // de la plataforma. Sequelize muta el objeto `options` y le anade las
        // credenciales ya resueltas, asi que un volcado que al leer el codigo
        // parece inocuo escribe el secreto dos veces, en cada reinicio.
        label: "db_startup_log_test.js",
        command: "node",
        args: ["db_startup_log_test.js"],
      },
      {
        // Puro: la clave de caché del pool tiene que cubrir TODO lo que distingue una
        // conexión de otra —las options, la forma de config de cada motor y la
        // credencial, hasheada—. Lo que se le escapaba no daba error, devolvía la
        // respuesta de otra base, con las credenciales de otro.
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
      {
        // Puro: el calculo de `next_run`, el backoff, el suelo y el techo del
        // retraso del planificador, el cron y el corte por fallos. Cubre
        // `src/lib/timer/schedule.js`, que es donde vive el `MIN/MAX_SCHEDULER_DELAY_MS`
        // que el drenaje del lote respeta a proposito. Sin esto, un cambio que
        // tocara uno de los dos topes pasaria inadvertido: el efecto se veria
        // semanas despues, como una tarea que no se ejecuta.
        label: "interval_task_schedule_test.js",
        command: "node",
        args: ["interval_task_schedule_test.js"],
      },
      {
        // Puro: como se lee el exito o el fallo de la respuesta de una tarea, que
        // es la distincion de la que depende que el interval task se marque DONE
        // o ERROR. Es el criterio que decide si la reprogramacion ocurre, asi que
        // un `success` mal classed postpone la tarea para siempre sin que nada lo
        // note.
        label: "interval_task_response_outcome_test.js",
        command: "node",
        args: ["interval_task_response_outcome_test.js"],
      },
      {
        // Puro: el supervisor que lanza el worker del planificador, con un worker
        // falso. Fija que se relanza cuando el worker muere y que no se relanza en
        // bucle cuando el worker no llega a arrancar, que es la diferencia entre
        // reintentar y martillear.
        label: "tasks_interval_supervisor_test.js",
        command: "node",
        args: ["tasks_interval_supervisor_test.js"],
      },
      {
        // Puro: la regla del validador que marca un `return` dentro de una cadena
        // de `await` en un handler de callbacks de grammy, parseando el codigo con
        // acorn. Es una regla de validacion de codigo de usuario, asi que un fallo
        // suyo acepta codigo que se cuelga en produccion.
        label: "code_validator_callback_chain_test.js",
        command: "node",
        args: ["code_validator_callback_chain_test.js"],
      },
      {
        // Puro: el contrato de los tipos de AppVar. `type` era un STRING(25) sin
        // validador, y por eso cuatro listas distintas se separaron —los seeds, el
        // switch de parseAppVar, el desplegable de la GUI y el modelo— sin que nada
        // lo notara. Ese desajuste produjo dos defectos reales: un `boolean` sembrado
        // como el string "true", que en JavaScript es truthy aunque valga "false", y
        // tres AppVars de tipo `string` en los seeds con 2 y 3 capas de comillas, la
        // huella del defecto de 13.12.1 escrita en un fichero fuente.
        //
        // Esta suite ata las tres listas entre si, de modo que un tipo nuevo tiene
        // que declararse en todas, y fija que `parseAppVar` entrega el valor SIN
        // entrecomillar: sin eso, volver a poner `JSON.stringify` en la rama
        // `default` pasaria inadvertido.
        label: "appvar_types_test.js",
        command: "node",
        args: ["appvar_types_test.js"],
      },
      {
        // Necesita la BD. Lo que la suite pura no puede ver: si el modelo y el
        // runtime se ponen de acuerdo de verdad. El caso central son tres ciclos
        // seguidos de backup y restore, que es la via por la que el defecto de
        // 13.12.1 se realimentaba —el backup serializa el arbol ya parseado y el
        // restore lo escribe de vuelta en la columna json—. Y que un boolean
        // almacenado como el string "false" llegue al runtime como false, no como
        // una cadena truthy.
        label: "appvar_end_to_end_test.js",
        command: "node",
        args: ["appvar_end_to_end_test.js"],
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

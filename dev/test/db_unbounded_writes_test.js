import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * H35: el unico camino de escritura que quedaba sin cota esta comentado, y se comprueba
 * que lo siga estando.
 *
 * ## Que se comprueba y por que con el espacio de nombres
 *
 * El hallazgo era que `saveAppWithEndpoints` tiene dos bucles sin cota, el segundo un
 * `Promise.allSettled` sobre todos los endpoints de la app. Con los 209 endpoints de la
 * app por defecto serian 209 `MERGE ... WITH(HOLDLOCK)` simultaneos, que es exactamente
 * el patron que produjo el error 1205 de MSSQL, y la puerta global de 13.11.12 no lo
 * cubre: esta funcion escribe con `Endpoint.upsert()` sin pasar por ella.
 *
 * Arreglarlo no era lo que se decidio. Se decidio commentingolo, y la razon de que eso
 * sea una correccion y no una evasion es que **no tiene ningun llamador vivo**: su
 * unico, `fnSaveApp`, ya estaba comentado. Es codigo inalcanzable, y un arreglo sobre
 * codigo inalcanzable no se puede probar.
 *
 * Por eso el test mira el espacio de nombres del modulo y no su texto. "No se exporta" es
 * un hecho exacto, y un hecho exacto no se rompe por un cambio de formato, por un
 * comentario reescrito o por un reformateo. Lo que se rompe es justo lo que interesa:
 * alguien levanta el comentario de `fnSaveApp` o vuelve a exportar la funcion, y el
 * camino sin cota vuelve a produccion sin que nadie lo note.
 *
 * Y se comprueban las dos mitades juntas a proposito. `fnSaveApp` llama a
 * `saveAppWithEndpoints` por un nombre, asi que una de las dos puede quedar descolgada:
 *   - Si `fnSaveApp` vuelve a existir y la otra no, el servidor no arranca, con un
 *     `saveAppWithEndpoints is not a function` que no dice nada del motivo real.
 *   - Si la otra vuelve a existir y `fnSaveApp` no, la funcion queda exportada y
 *     disponible, que es el caso peligroso: disponible es una palabra aqui.
 *
 * ## Y la nota, porque el "por que" es la mitad del arreglo
 *
 * Se comprueba tambien que la cabecera que explica el motivo siga ahi. Un bloque
 * comentado sin nota es codigo muerto sin contexto, y el siguiente que lo lea lo
 * borrara por limpieza.
 *
 * Puro: no abre conexion. Ninguna de estas afirmaciones necesita una base de datos, y
 * una que las metiera seria mas lenta sin ser mas honesta.
 */

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const APP_JS = join(RAIZ, "src", "lib", "db", "app.js");
const APP_PRD_JS = join(
  RAIZ,
  "src",
  "lib",
  "server",
  "functions",
  "system",
  "prd",
  "app",
  "index.js",
);

/** La marca de la cabecera que explica por que esta comentado. */
const MARCA = "DESHABILITADO (H35): saveAppWithEndpoints";

async function runTests() {
  console.log("--- Starting Unbounded Write Path Tests ---");

  const app = await import("../../src/lib/db/app.js");
  const prdApp = await import("../../src/lib/server/functions/system/prd/app/index.js");
  const exporta = (modulo, nombre) => Object.prototype.hasOwnProperty.call(modulo, nombre);

  // 1. El camino sin cota no es alcanzable
  console.log("[STEP 1/4] The unbounded path is not exported...");
  assert.equal(
    exporta(app, "saveAppWithEndpoints"),
    false,
    "saveAppWithEndpoints vuelve a estar exportada: sus dos bucles no tienen cota y el " +
      "segundo puede poner los 209 MERGE de una app en vuelo a la vez. Antes de volver " +
      "a exportarla, pasar sus escrituras por la puerta global (OFAPI_RESTORE_CONCURRENCY) " +
      "y meter el borrado y el guardado en la misma transaccion.",
  );

  // 2. Su unico llamador tampoco
  console.log("[STEP 2/4] Neither is its only caller...");
  assert.equal(
    exporta(prdApp, "fnSaveApp"),
    false,
    "fnSaveApp vuelve a estar exportada. Sin saveAppWithEndpoints el servidor no " +
      "arranca, y el error que sale no dice nada de por que; con ella, vuelve el " +
      "camino sin cota. Las dos van comentadas juntas a proposito.",
  );

  // 3. Lo que si se usa, sigue estando
  console.log("[STEP 3/4] What is still in use is still there...");
  for (const [modulo, nombre, donde] of [
    [app, "defaultApps", "app.js"],
    [app, "restoreAppFromBackup", "app.js"],
    [app, "upsertApp", "app.js"],
    [prdApp, "fnRestoreAppFromBackup", "prd/app/index.js"],
  ]) {
    assert.equal(
      exporta(modulo, nombre),
      true,
      `${donde} deberia seguir exportando ${nombre}: comentar lo muerto no puede romper ` +
        "lo vivo, y si esto falla es que se ha comentado de mas de lo debido",
    );
  }

  // 4. La nota se queda con el codigo
  console.log("[STEP 4/4] The reason stays with the code...");
  const fuenteApp = readFileSync(APP_JS, "utf8");
  const fuentePrd = readFileSync(APP_PRD_JS, "utf8");
  const apariciones = fuenteApp.split(MARCA).length - 1;
  assert.equal(
    apariciones,
    1,
    `la marca "${MARCA}" tiene que aparecer exactamente una vez; aparecen ${apariciones}. ` +
      "Si aparece en mas de un sitio es que se ha copiado el bloque, y si no aparece es " +
      "que el codigo comentado se ha limpiado sin dejar el motivo, que es la mitad del " +
      "arreglo.",
  );
  assert.match(
    fuentePrd,
    /\/\*[\s\S]{0,80}fnSaveApp/,
    "el bloque comentado de fnSaveApp deberia seguir siendo un comentario de bloque. Si " +
      "ha vuelto a ser codigo, el paso 2 lo dira, y si se ha reformateado a lineas este " +
      "es el aviso de que la nota de al lado hay que volver a escribirla.",
  );

  console.log("--- All Unbounded Write Path Tests Passed Successfully! ---");
}

runTests().catch((err) => {
  console.error("\nUnbounded write path test suite failed with error:");
  console.error(err);
  process.exit(1);
});

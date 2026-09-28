import assert from "node:assert/strict";
import fs from "node:fs";
import { version } from "../../src/lib/server/version.js";
import { fnGetServerVersion } from "../../src/lib/server/functions/system/prd/index.js";

/**
 * La version que se sirve iba catorce parches por detras de la que se instala.
 *
 * Hay tres sitios donde vive el numero de version y solo dos los regenera `set_version.js`:
 * `package.json`, que es de donde lo lee npm, y `src/lib/server/version.js`, que es un
 * fichero escrito a mano por ese script. El tercero es la entrada del CHANGELOG. Nada
 * comparaba los tres, asi que un bump de version en el arbol sin pasar por
 * `npm run set_version` no dejaba ninguna huella: el commit parecia completo y la plataforma
 * seguia diciendo otra cosa.
 *
 * Medido antes del arreglo, con el arbol tal cual estaba:
 *
 *   $ curl localhost:3999/api/system/server/version/prd
 *   {"version":"13.11.15","ddbb":"sqlite"}          <-- 14 parches atras
 *   $ node -p "require('./package.json').version"
 *   13.11.29
 *
 * Y lo que hace eso con un despliegue: el endpoint que el README documenta para comprobar
 * que se ha instalado la version correcta (`GET /api/system/server/version/prd`, el ejemplo
 * del "First login" sale de ahi) responde con una version que no es la del codigo que esta
 * corriendo. No es un problema de trazabilidad interior: es el numero que mira un operador
 * para decidir si reinstalar, y el que puede usar un script de despliegue para decidir si
 * continue.
 *
 * Los tests son puros —importan la version real y llaman a la funcion real del endpoint, sin
 * abrir conexion— porque lo que hay que fijar es que los tres sitios digan lo mismo, y eso se
 * puede comprobar sin base de datos. `fnGetServerVersion` solo lee `getDialect()`, que no
 * conecta: el `ddbb` que devuelve sale de la configuracion, no de la base.
 */

const PAQUETE = JSON.parse(
  fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
);

/** El patron de una version de este proyecto: tres numeros y nada mas. */
const FORMA_VERSION = /^\d+\.\d+\.\d+$/;

/**
 * La version mas reciente del CHANGELOG, que es la que tiene que existir para que el bump
 * quede documentado. Se busca la primera cabecera `## [x.y.z]` del fichero, que es donde el
 * CHANGELOG pone siempre la entrada nueva.
 */
function versionDeLaEntradaMasReciente() {
  const changelog = fs.readFileSync(
    new URL("../../CHANGELOG.md", import.meta.url),
    "utf8",
  );
  const cabecera = changelog.match(/^## \[(\d+\.\d+\.\d+)\]/m);
  return cabecera ? cabecera[1] : null;
}

async function runTests() {
  // ---------------------------------------------------------------- STEP 1
  console.log("[STEP 1/3] package.json and src/lib/server/version.js say the same...");

  assert.ok(
    FORMA_VERSION.test(PAQUETE.version),
    `package.json declares an unusable version: ${JSON.stringify(PAQUETE.version)}.`,
  );
  assert.ok(
    FORMA_VERSION.test(version),
    `src/lib/server/version.js exports an unusable version: ${JSON.stringify(version)}. ` +
      `It has to be a plain 'x.y.z' string, because that is what set_version.js writes and ` +
      `what every caller expects.`,
  );

  // La comparacion es la del fallo: hoy version.js va 14 parches atras y package.json no se
  // entera. El mensaje dice que se ve, porque la consecuencia es justamente la del despliegue.
  assert.equal(
    version,
    PAQUETE.version,
    `The served version is ${version} and package.json is ${PAQUETE.version}. ` +
      `GET /api/system/server/version/prd answers ${version} while the installed code is ` +
      `${PAQUETE.version}, so the endpoint an operator uses to check what is installed ` +
      `reports a version that is not the one running. Run 'npm run set_version' to rewrite ` +
      `src/lib/server/version.js from package.json.`,
  );

  // ---------------------------------------------------------------- STEP 2
  console.log("[STEP 2/3] ... and the /server/version endpoint answers with it...");

  // No basta con que los dos ficheros digan lo mismo: hay que comprobar que el numero que
  // sale por la API es ese. Si el endpoint dejara de usar la constante —o la leyera de otro
  // sitio— este paso caeria aunque los ficheros estuvieran sincronizados, que es el otro
  // modo de fallo de este hallazgo.
  const respuesta = await fnGetServerVersion({});

  assert.equal(
    respuesta.code,
    200,
    `fnGetServerVersion answered ${respuesta.code} instead of 200, with ${JSON.stringify(respuesta.data)}. ` +
      `The /server/version endpoint of the system app is what reports the installed version.`,
  );
  assert.ok(
    respuesta.data && typeof respuesta.data === "object",
    `fnGetServerVersion answered without a data object: ${JSON.stringify(respuesta)}.`,
  );
  assert.equal(
    respuesta.data.version,
    PAQUETE.version,
    `The /server/version endpoint answered ${JSON.stringify(respuesta.data.version)} while ` +
      `package.json is ${PAQUETE.version}. The constant is in sync but the endpoint does not ` +
      `report it, so an operator still cannot tell what is installed.`,
  );

  // ---------------------------------------------------------------- STEP 3
  console.log("[STEP 3/3] ... and the newest CHANGELOG entry documents it...");

  const documentada = versionDeLaEntradaMasReciente();

  assert.ok(
    documentada,
    `CHANGELOG.md has no '## [x.y.z]' heading. A version bump that is not in the CHANGELOG ` +
      `is invisible to whoever has to know what changed.`,
  );
  assert.equal(
    documentada,
    PAQUETE.version,
    `The newest CHANGELOG entry is ${documentada} and package.json is ${PAQUETE.version}. ` +
      `These are the two halves of the same bump, so they belong to the same commit.`,
  );

  console.log(`Version ${PAQUETE.version} is in sync in all three places.`);
}

runTests()
  .then(() => {
    console.log("--- All Version Sync Tests Passed Successfully! ---");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Version sync test suite failed with error:");
    console.error(error);
    process.exit(1);
  });

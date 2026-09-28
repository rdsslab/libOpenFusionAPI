import assert from "node:assert/strict";
import fs from "node:fs";
import { version } from "../../src/lib/server/getVersion.js";
import { fnGetServerVersion } from "../../src/lib/server/functions/system/prd/index.js";

/**
 * La version que se sirve debe ser la que se instala, siempre.
 *
 * La version vive en UN solo sitio, `package.json`. `getVersion.js` la lee en el arranque
 * y la exporta como constante, y ya no existe `src/lib/server/version.js` que pudiera
 * desincronizarse: no hay segundo fichero que mantener. Aqui ya no se puede "olvidar"
 * reescribir nada.
 *
 * Lo que esta suite sigue vigilando es que nadie vuelva a partir esa fuente:
 *   1. que la constante que exporta `getVersion.js` sea exactamente la de `package.json`
 *      y tenga forma usable;
 *   2. que el endpoint `/server/version` la sirva de verdad —si dejara de usar la
 *      constante, o la leyera de otro sitio, esto caeria aunque `package.json` estuviera
 *      bien—;
 *   3. que la entrada mas reciente del CHANGELOG documente ese numero, porque un bump que
 *      no se anota es invisible para quien tiene que saber que cambio.
 *
 * Es el mismo trio que ya vigilaba la version anterior de esta suite, pero en vez de
 * comparar dos ficheros ahora compara la fuente con lo que se sirve. Sigue siendo pura:
 * `fnGetServerVersion` solo lee `getDialect()`, que no conecta; el `ddbb` que devuelve
 * sale de la configuracion, no de la base.
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
  console.log("[STEP 1/3] getVersion.js serves exactly the package.json version...");

  assert.ok(
    FORMA_VERSION.test(PAQUETE.version),
    `package.json declares an unusable version: ${JSON.stringify(PAQUETE.version)}.`,
  );
  assert.ok(
    FORMA_VERSION.test(version),
    `getVersion.js exports an unusable version: ${JSON.stringify(version)}. ` +
      `It has to be a plain 'x.y.z' string, because that is what set_version.js writes and ` +
      `what every caller expects.`,
  );

  // La fuente es package.json y la constante se lee de ahi: si discrepan, alguien volvio a
  // meter una segunda fuente de verdad. El mensaje recuerda la consecuencia del modo de
  // fallo viejo: el endpoint servia una version que no era la del codigo instalado.
  assert.equal(
    version,
    PAQUETE.version,
    `The served version is ${version} and package.json is ${PAQUETE.version}. ` +
      `GET /api/system/server/version/prd answers ${version} while the installed code is ` +
      `${PAQUETE.version}. package.json is the only source of truth: run 'npm run set_version' ` +
      `to bump it, and check what getVersion.js imports.`,
  );

  // ---------------------------------------------------------------- STEP 2
  console.log("[STEP 2/3] ... and the /server/version endpoint answers with it...");

  // No basta con que la constante diga lo de package.json: hay que comprobar que el numero
  // que sale por la API es ese. Si el endpoint dejara de usar la constante —o la leyera de
  // otro sitio— este paso caeria, que es el otro modo de fallo de este hallazgo.
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
      `package.json is ${PAQUETE.version}. getVersion.js is in sync but the endpoint does not ` +
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

  console.log(`Version ${PAQUETE.version} is in sync: package.json, getVersion.js and the API.`);
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
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Colateral 6: `mcp_exhaustive_validation.js` leia la base de datos por una ruta escrita a
 * pelo que no es la de nadie, y `OFAPI_TEST_DB_PATH` no existia. Aqui se comprueba que la
 * convencion existe y resuelve como dice; que el fichero funcione de verdad lo mide
 * ejecutandolo, que necesita un servidor vivo y por eso no cabe aqui.
 *
 * ## Por que se ejecuta la expresion en vez de buscarla con un grep
 *
 * Un `assert.match(fuente, /OFAPI_TEST_DB_PATH/)` passaria con la variable escrita en un
 * comentario, en una cadena muerta, o en una rama que nunca se toma. Lo que se rompe aqui
 * no es la presencia del nombre: es que la ruta usada siga siendo la de antes. Asi que se
 * saca el inicializador de `DB_PATH` del fuente y **se evalua**, con un `process.env` de
 * mentira y el `path` de verdad, en las cuatro combinaciones que importan.
 *
 * Y se evalua el codigo real, no una reescritura de el en el test. Si alguien cambia la
 * forma de la expresion y la evaluacion deja de tener sentido, el fallo lo dice y hay que
 * actualizar el arnes, que es justo lo que se quiere: que este test no pueda seguir
 * [^(1) pasando sobre un fichero que ya no hace lo que dice hacer].
 *
 * [^1]: "no pueda seguir pasando" es la diferencia entre un test y una foto. Un `grep`
 *       sobre el fuente solo certifica el momento en que se escribio.
 *
 * ## Las cuatro combinaciones, y por que las cuatro
 *
 *   1. La variable puesta y absoluta -> se usa tal cual. Es el caso que arregla el fallo.
 *   2. La variable puesta y **relativa** -> se vuelve absoluta. Sin esto, una ruta
 *      relativa se resolveria contra el cwd de quien ejecuta, que en este directorio es
 *      el repo y en otro es el que toque: el mismo comando, dos ficheros distintos.
 *   3. La variable puesta y **vacia** -> cae al defecto. Es la misma regla que se aplico
 *      a los limites de `concurrency.js`: un valor invalido cae al por defecto, no a un
 *      valor degenerado. Un `""` que se cuela por un `||` ausente seria un path vacio, que
 *      es otra forma de `no such table` con un mensaje peor.
 *   4. La variable ausente -> el defecto de siempre, y el defecto tiene que seguir siendo
 *      **la ruta antigua, byte a byte**. Este es el otro anonimo del arreglo: cambiar el
 *      defecto en el mismo commit que lo introduce haria imposible distinguir "arreglado"
 *      de "cambiado de sitio".
 *
 * ## Y el motivo al lado
 *
 * Se comprueba tambien que la cabecera del fichero y el README del directorio nombren la
 * variable. Un override sin documentar es un override que nadie va a poner, y entonces la
 * ruta mala sigue mandando y nadie se entera de por que.
 *
 * Puro: no abre conexion, no arranca servidor y no lee la base. Todo lo que se afirma aqui
 * es sobre el fuente, y por eso puede correr dentro del packet aunque el fichero que vigila
 * no pueda correr nunca dentro del packet.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const OBJETIVO = path.join(HERE, "mcp_exhaustive_validation.js");
const README = path.join(HERE, "README.md");
const VAR = "OFAPI_TEST_DB_PATH";

/** El defecto de siempre, escrito aqui aparte para poder compararlo con el del fichero. */
const DEFECTO_ANTIGUO = path.join(REPO_ROOT, "temporales", "ofapi12.sqlite");

/**
 * Saca el inicializador de `DB_PATH` del fuente y lo devuelve como funcion evaluable.
 * Si la forma cambia, esto falla con un mensaje que lo dice, en vez de devolver `null` y
 * dejar que el llamante se entere mas tarde y mas lejos.
 */
function expresionDbPath(fuente) {
  const m = /^const DB_PATH = ([\s\S]*?);$/m.exec(fuente);
  assert.ok(
    m,
    "no se ha encontrado `const DB_PATH = ...;` en mcp_exhaustive_validation.js. Si la " +
      "declaracion se ha movido, se ha partido en varias lineas con `;` dentro, o se ha " +
      "reescrito con otro nombre, hay que actualizar este arnes. Lo que no puede hacer este " +
      "test es seguir pasando sin comprobar nada.",
  );
  // eslint-disable-next-line no-new-func
  const fn = new Function("process", "path", "REPO_ROOT", `return (${m[1]});`);
  return (env) => fn({ env }, path, REPO_ROOT);
}

/** Corre la expresion con un entorno concreto. `undefined` = variable no puesta. */
function resuelveDbPath(evalua, valor) {
  const env = valor === undefined ? {} : { [VAR]: valor };
  return evalua(env);
}

async function runTests() {
  const fuente = readFileSync(OBJETIVO, "utf8");
  const evalua = expresionDbPath(fuente);

  console.log("[STEP 1/4] The variable decides, when it is set and absolute...");
  const absoluta = path.join(path.sep, "datos", "ofapi.sqlite");
  assert.equal(
    resuelveDbPath(evalua, absoluta),
    absoluta,
    `con ${VAR}=${absoluta} tiene que abrir ese fichero. Si no, la variable se sigue ` +
      "ignorando y la suite vuelve a leer la base vacia de la ruta antigua.",
  );

  console.log("[STEP 2/4] A relative value becomes absolute...");
  const relativa = "datos/relativa.sqlite";
  const resuelta = resuelveDbPath(evalua, relativa);
  assert.ok(
    path.isAbsolute(resuelta),
    `con ${VAR}=${relativa} tiene que dar una ruta absoluta, y da ${resuelta}. Sin esto el ` +
      "mismo comando abre dos ficheros distintos segun el directorio desde el que se " +
      "llame, que es la forma silenciosa de este fallo.",
  );
  assert.ok(
    resuelta.endsWith(path.join("datos", "relativa.sqlite")),
    `con ${VAR}=${relativa} tiene que terminar en esa ruta, y da ${resuelta}`,
  );

  console.log("[STEP 3/4] An empty value falls back to the default...");
  assert.equal(
    resuelveDbPath(evalua, ""),
    DEFECTO_ANTIGUO,
    `con ${VAR}="" tiene que caer al defecto. Un "" que se cuela por un ` +
      "`||` ausente produce una ruta vacia, que es `no such table` otra vez pero con un " +
      "mensaje que no señala la ruta.",
  );
  assert.equal(
    resuelveDbPath(evalua, "   "),
    DEFECTO_ANTIGUO,
    `con ${VAR}="   " tambien cae al defecto: es el mismo caso que la cadena vacia y ` +
      "produce el mismo fallo.",
  );

  console.log("[STEP 4/4] Without the variable, nothing has moved...");
  assert.equal(
    resuelveDbPath(evalua, undefined),
    DEFECTO_ANTIGUO,
    "sin la variable tiene que seguir la ruta antigua, byte a byte. Este commit introduce " +
      "un override, no cambia el defecto: si las dos cosas se mueven a la vez, \"arreglado\" " +
      "y \"cambiado de sitio\" se confundiran para siempre.",
  );

  // La nota al lado. Un override sin documentar es un override que nadie va a poner.
  assert.match(
    fuente.slice(0, fuente.indexOf("/**")),
    new RegExp(VAR),
    `la cabecera de mcp_exhaustive_validation.js tiene que nombrar ${VAR}. Sin ella el ` +
      "override queda escrito y no se menciona, que es como empieza el siguiente hallazgo.",
  );
  assert.match(
    readFileSync(README, "utf8"),
    new RegExp(VAR),
    `el README de dev/test tiene que nombrar ${VAR}. Un override que no esta en el README ` +
      "es un override que no se usa, y entonces la ruta mala sigue mandando en silencio.",
  );

  console.log("--- All DB Path Override Tests Passed Successfully! ---");
}

runTests().catch((err) => {
  console.error("\nDB path override test suite failed with error:");
  console.error(err);
  process.exit(1);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * El arranque destruia endpoints que el operador habia creado, cuando coincidian de
 * nombre MCP con uno del backup del seed. Medido de punta a punta en PostgreSQL y en
 * MSSQL, y por la API, sin tocar la base a mano: el operador borra un endpoint del seed
 * con `DELETE /api/endpoint`, crea el suyo reutilizando su `mcp.name` con
 * `POST /api/endpoint`, reinicia, y su endpoint ha desaparecido. El unico rastro era
 * una linea de log con un UUID y las palabras "before restore", que leen como un paso
 * mecanico del restore y no como la perdida del endpoint de alguien.
 *
 * ## Por que esto va contra la politica del backup
 *
 * `defaultApps()` restaura el backup de las apps del seed encima de lo que haya. Un
 * backup *reemplaza* lo que trae, y por eso el arranque revierte el codigo editado,
 * reactiva lo que se desactivo y repone lo que se borro: eso es lo correcto y esta
 * medido. Lo que el backup **no** puede hacer es borrar endpoints que no trae. Y eso
 * era justo lo que hacia `removeConflictingMcpEndpoints`, sin preguntar de quien era
 * el endpoint que tenia el nombre.
 *
 * ## Por que se ejecuta la funcion en vez de buscarla con un grep
 *
 * Un `assert.match(fuente, /Endpoint\.destroy/)` no distingue nada: pasaria con el
 * `destroy` escribiendo en una rama muerta, y pasaria tambien con el `destroy`
 * correcto, que es el que se queda para los endpoints que si son del backup. Lo que
 * hay que comprobar es **que caso toma cada endpoint**, y eso solo se ve ejecutando
 * el codigo. Asi que se saca el cuerpo real de la funcion del fuente y se **evalua**
 * contra un doble de `Endpoint` que registra lo que se le pide, en vez de contra la
 * base de datos.
 *
 * Mismo criterio que `db_path_override_test.js`: si alguien reescribe la funcion y la
 * extraccion deja de encontrar el cuerpo, el fallo lo dice y hay que actualizar el
 * arnes. Un test que puede seguir pasando sin comprobar nada es una foto, no un test.
 *
 * ## Los casos, y por que esos
 *
 *   1. Endpoint PROPIO con el nombre en disputa -> **no se borra**. Es el fallo medido.
 *   2. Ese endpoint **deja de estar expuesto** como herramienta MCP, porque el nombre
 *      lo gana el seed. Quitar solo el `name` no serviria: el listado de herramientas
 *      filtra por `mcp.enabled` y no mira el nombre
 *      (`src/lib/server/endpoint/handlerBuild/mcp.js`), y un `enabled` sin `name`
 *      seria una herramienta con el nombre vacio.
 *   3. Endpoint DEL BACKUP con el nombre en disputa -> **si se borra**. Es el caso que
 *      la funcion resolvia bien desde el principio: una version anterior del seed dejo
 *      el endpoint en otra ruta y conservo el mcp.name, y el backup tiene que poder
 *      reemplazarlo. Si este caso se rompe, el seed deja de reponer sus propios
 *      endpoints y el arranque falla en silencio, que es peor que borrar de mas.
 *   4. La busqueda se acota a `(idapp + environment)`. Lo decide el `where` de la
 *      consulta, asi que lo que se comprueba es el `where` que llega a `findAll`: un
 *      endpoint de otra app con el mismo nombre MCP no se toca.
 *   5. Lo que se dice en el log. El encargo era que el mensaje dijera de quien era el
 *      endpoint, no solo un UUID, asi que se comprueba que aparezcan su `resource` y su
 *      `method` y que se diga que conserva la fila.
 *
 * Puro: no abre conexion, no arranca servidor y no lee la base. Lo que se afirma aqui
 * es sobre el codigo real de la funcion, y por eso cabe dentro del packet.
 *
 * Nota sobre `safeParseJson`: se le pasa al cuerpo evaluado como dependencia en vez de
 * sacarlo tambien del fuente. Su comportamiento (un `JSON.parse` con `null` si falla) no
 * es lo que este test afirma, y atarlo al fuente anadiria una segunda forma que puede
 * romperse sin que el fallo senale el sitio bueno.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const OBJETIVO = path.join(REPO_ROOT, "src", "lib", "db", "app.js");

/**
 * El nombre actual y el de antes del arreglo. Se aceptan los dos a proposito: con un solo
 * nombre, la suite fallaria contra el codigo anterior por "no encuentro la funcion", que
 * es un rojo de acoplamiento al nombre y no de comportamiento, y no demuestra nada. Con
 * los dos, la suite ejecuta la funcion que haya y falla por lo que hace, que es lo que
 * hay que demostrar.
 */
const NOMBRES_ACEPTADOS = ["resolverConflictoMcpNombre", "removeConflictingMcpEndpoints"];

/**
 * Saca el cuerpo de la funcion del fuente contando llaves, que aguanta reformateos donde
 * un regex con un `[\s\S]*?\n\}` no aguanta. Si la forma cambia de raiz, esto falla con un
 * mensaje que lo dice, en vez de devolver `null` y dejar que el llamante se entere mas
 * tarde y mas lejos.
 */
function cuerpoDeLaFuncion(fuente) {
  let m = null;
  let nombre = null;
  for (const candidato of NOMBRES_ACEPTADOS) {
    m = new RegExp(`(?:async\\s+)?function\\s+${candidato}\\s*\\(`).exec(fuente);
    if (m) {
      nombre = candidato;
      break;
    }
  }
  assert.ok(
    m,
    `no se ha encontrado ninguna de las funciones ${NOMBRES_ACEPTADOS.join(" / ")} en ` +
      "src/lib/db/app.js. Si se han movido, renombrado, partido en varias o reescrito " +
      "con otra forma, hay que actualizar este arnes. Lo que no puede hacer este test es " +
      "seguir pasando sin comprobar nada.",
  );
  const abre = fuente.indexOf("{", fuente.indexOf(")", m.index));
  assert.ok(abre > 0, `el cuerpo de \`${nombre}\` no tiene llave de apertura`);
  let nivel = 0;
  for (let i = abre; i < fuente.length; i++) {
    if (fuente[i] === "{") nivel++;
    else if (fuente[i] === "}") {
      nivel--;
      if (nivel === 0) return fuente.slice(m.index, i + 1);
    }
  }
  throw new Error(`el cuerpo de \`${nombre}\` no cierra: faltan llaves`);
}

/**
 * Monta la funcion real, evaluada, con las tres dependencias que el cuerpo usa: el doble
 * de `Endpoint`, el `Op` de sequelize (solo `Op.ne`) y `safeParseJson`.
 */
function montaLaFuncion(fuente, endpointDoble) {
  const cuerpo = cuerpoDeLaFuncion(fuente);
  const safeParseJson = (value) => {
    if (value == null) return null;
    if (typeof value === "object") return value;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  };
  const Op = { ne: "__NE__" };
  // El `return` es lo que hace que la nueva funcion DEVUELVA la del cuerpo: sin el, el
  // cuerpo solo la declara y `new Function` retorna undefined.
  // eslint-disable-next-line no-new-func
  const fn = new Function("Endpoint", "Op", "safeParseJson", `return (${cuerpo});`);
  return fn(endpointDoble, Op, safeParseJson);
}

/** `mcp` tal como lo guarda el modelo. */
const mcpDe = (nombre, extra = {}) => ({ enabled: true, name: nombre, ...extra });

/** Un endpoint con la forma que devuelve `Endpoint.findAll`. */
const endpoint = (id, { nombre, resource, method = "GET", environment = "dev", mcp }) => {
  const fila = {
    idendpoint: id,
    mcp: mcp || mcpDe(nombre),
    resource,
    method,
    environment,
    toJSON: () => ({
      idendpoint: id,
      mcp: fila.mcp,
      resource,
      method,
      environment,
    }),
  };
  return fila;
};

/** Doble de `Endpoint`: registra en vez de tocar la base, y guarda el `where` recibido. */
function dobleEndpoint(filas) {
  const registro = { whereBusqueda: null, destruidos: [], actualizados: [] };
  return {
    registro,
    findAll: async ({ where }) => {
      registro.whereBusqueda = where;
      return filas;
    },
    destroy: async ({ where }) => {
      registro.destruidos.push(where);
    },
    update: async (cambios, { where }) => {
      registro.actualizados.push({ cambios, where });
    },
  };
}

/** Captura lo que la funcion escribe por consola, sin dejar que salga por la salida. */
async function capturaConsola(hacer) {
  const original = console.log;
  const lineas = [];
  console.log = (...partes) => lineas.push(partes.map((p) => String(p)).join(" "));
  try {
    await hacer();
  } finally {
    console.log = original;
  }
  return lineas;
}

async function runTests() {
  const fuente = readFileSync(OBJETIVO, "utf8");

  // Lo que se esta restaurando: el endpoint del seed que aporta el nombre en disputa.
  const DEL_SEED = {
    idendpoint: "aaaa-1",
    resource: "/ofapi/examples/function/demo",
    method: "GET",
    environment: "dev",
    mcp: mcpDe("nombre_en_disputa"),
  };
  const APP = "app-demo";
  const NOMBRE = "nombre_en_disputa";

  console.log("[STEP 1/5] An endpoint of the operator keeps its row...");
  {
    const propio = endpoint("propio-1", { nombre: NOMBRE, resource: "/mi_endpoint" });
    const doble = dobleEndpoint([propio]);
    const fn = montaLaFuncion(fuente, doble);
    await capturaConsola(() => fn(APP, "dev", DEL_SEED, new Set(["aaaa-1"])));
    assert.equal(
      doble.registro.destruidos.length,
      0,
      "un endpoint PROPIO del operador con el mcp.name en disputa no se puede borrar. " +
        "Medido: el operador que reutiliza el nombre MCP de un endpoint del seed pierde su " +
        "endpoint en el siguiente arranque, en silencio. Un backup no puede borrar lo que no " +
        "trae, y los endpoints que no estan en el backup se mantienen.",
    );
    assert.equal(
      doble.registro.actualizados.length,
      1,
      "ese endpoint propio tiene que quedar actualizado una vez: conserva la fila y se le " +
        "desactiva el MCP.",
    );
    assert.deepEqual(
      doble.registro.actualizados[0].where,
      { idendpoint: "propio-1" },
      "el update tiene que ir al endpoint propio, no a otro.",
    );
  }

  console.log("[STEP 2/5] ... and it stops being exposed as an MCP tool...");
  {
    // Configuracion MCP completa del operador, para comprobar que solo se cede el nombre.
    const propio = endpoint("propio-1", {
      nombre: NOMBRE,
      resource: "/mi_endpoint",
      mcp: mcpDe(NOMBRE, { description: "la mia", annotations: { readOnly: true } }),
    });
    const doble = dobleEndpoint([propio]);
    const fn = montaLaFuncion(fuente, doble);
    await capturaConsola(() => fn(APP, "dev", DEL_SEED, new Set(["aaaa-1"])));
    const { cambios } = doble.registro.actualizados[0];
    assert.equal(
      cambios.mcp.enabled,
      false,
      "mcp.enabled tiene que quedar en false. El listado de herramientas MCP filtra por " +
        "`mcp.enabled` y no mira el nombre (src/lib/server/endpoint/handlerBuild/mcp.js), " +
        "asi que quitar solo el nombre dejaria una herramienta expuesta sin nombre.",
    );
    assert.ok(
      !("name" in cambios.mcp),
      "el mcp.name en disputa tiene que desaparecer del endpoint propio. Si se queda, el " +
        "arranque siguiente lo vuelve a encontrar y a tocar: el seed borrandose a si mismo " +
        "en cada arranque seria el mismo fallo con dos arranques de margen.",
    );
    assert.equal(
      cambios.mcp.description,
      "la mia",
      "el resto de la configuracion MCP del operador tiene que quedarse: lo que se cede es " +
        "el nombre, no el endpoint entero.",
    );
    assert.deepEqual(
      cambios.mcp.annotations,
      { readOnly: true },
      "lo demas del mcp del operador tiene que quedarse intacto.",
    );
  }

  console.log("[STEP 3/5] An endpoint that IS in the backup is still removed...");
  {
    // El caso que la funcion resolvia bien: una version anterior del seed dejo el endpoint
    // en otra ruta y conservo el mcp.name. El backup tiene que poder reemplazarlo. Si se
    // rompe, el seed deja de reponer sus propios endpoints, y eso tambien es silencioso.
    const viejoDelSeed = endpoint("viejo-2", { nombre: NOMBRE, resource: "/ruta_antigua" });
    const doble = dobleEndpoint([viejoDelSeed]);
    const fn = montaLaFuncion(fuente, doble);
    await capturaConsola(() => fn(APP, "dev", DEL_SEED, new Set(["aaaa-1", "viejo-2"])));
    assert.equal(
      doble.registro.destruidos.length,
      1,
      "un endpoint que SI esta en el backup y choca de nombre se tiene que seguir borrando: " +
        "es el caso legitimo (una version anterior del seed lo dejo en otra ruta) y sin el " +
        "el arranque no puede reponer sus propios endpoints.",
    );
    assert.deepEqual(
      doble.registro.destruidos[0],
      { idendpoint: ["viejo-2"] },
      "se borra el endpoint del backup, y solo ese.",
    );
    assert.equal(
      doble.registro.actualizados.length,
      0,
      "un endpoint del backup se borra; uno del operador se desactiva. Son caminos " +
        "distintos y no se mezclan.",
    );
  }

  console.log("[STEP 4/5] The search is scoped to one app and one environment...");
  {
    const propio = endpoint("propio-1", { nombre: NOMBRE, resource: "/mi_endpoint" });
    const doble = dobleEndpoint([propio]);
    const fn = montaLaFuncion(fuente, doble);
    await capturaConsola(() => fn(APP, "dev", DEL_SEED, new Set(["aaaa-1"])));
    const where = doble.registro.whereBusqueda;
    assert.ok(where, "la funcion tiene que consultar los endpoints existentes");
    assert.equal(where.idapp, APP, "la busqueda tiene que acotar por idapp");
    assert.equal(
      where.environment,
      "dev",
      "la busqueda tiene que acotar por environment. Un nombre MCP solo es unico dentro " +
        "de (idapp + environment): sin el acotado, un endpoint de otra app con el mismo " +
        "nombre seria tambien tocado.",
    );
    // Y el propio endpoint que se va a restaurar queda fuera del borrido, que si no
    // haria el borrido inutil: se borraria a si mismo para luego reinsertarse. En
    // Sequelize el `!=` se expresa como un operador en el valor, asi que lo que llega es
    // una clave calculada.
    assert.deepEqual(
      where.idendpoint,
      { __NE__: "aaaa-1" },
      "el endpoint que se esta restaurando tiene que quedar fuera de la busqueda de " +
        "conflictos, con un `!=` sobre su idendpoint. Sin eso se buscaria a si mismo y se " +
        "borraria antes de reinsertarse.",
    );
  }

  console.log("[STEP 5/5] The log says whose endpoint it was...");
  {
    const propio = endpoint("propio-7", {
      nombre: NOMBRE,
      resource: "/mi_endpoint_de_produccion",
      method: "POST",
      environment: "prd",
    });
    const doble = dobleEndpoint([propio]);
    const fn = montaLaFuncion(fuente, doble);
    const lineas = await capturaConsola(() => fn(APP, "prd", DEL_SEED, new Set(["aaaa-1"])));
    const texto = lineas.join("\n");
    assert.match(
      texto,
      /recupera|conserva|keeps its row|reponer|restore it/i,
      "el mensaje tiene que decir que el endpoint conserva su fila. Un mensaje que solo " +
        "diga que se ha quitado un nombre deja al operador pensando que se ha perdido el " +
        "endpoint entero.",
    );
    assert.ok(
      texto.includes("/mi_endpoint_de_produccion"),
      "el mensaje tiene que incluir el resource del endpoint del operador. Con solo el " +
        "idendpoint no hay forma de saber cual se ha tocado sin ir a mirar la base, y el " +
        "id no aparece en ninguna parte de la interfaz.",
    );
    assert.ok(
      texto.includes("POST"),
      "el mensaje tiene que incluir el method. Un resource con GET y POST son dos " +
        "endpoints distintos, y sin el method el mensaje identifica solo la mitad.",
    );
  }

  console.log("--- All MCP Conflict On Restore Tests Passed Successfully! ---");
}

runTests().catch((err) => {
  console.error("\nMCP conflict on restore test suite failed with error:");
  console.error(err);
  process.exit(1);
});

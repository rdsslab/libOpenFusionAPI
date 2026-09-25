import assert from "node:assert/strict";
import {
  applyConnectionOverride,
  parseConnectionOverrideAllowlist,
  resolveConnectionOverrideAllowlist,
} from "../../src/lib/handler/utils.js";
import { describeConnectionOverride } from "../../src/lib/handler/connectionOverrideLog.js";

/**
 * Puro: no abre conexiones ni escribe en base de datos.
 */

const set = (...v) => new Set(v);

// --- parseConnectionOverrideAllowlist: leer la declaracion del endpoint ------
{
  // Ausente = sin restriccion. Es el estado por defecto y el que garantiza que
  // instalar esto no cambia el comportamiento de nadie.
  assert.strictEqual(parseConnectionOverrideAllowlist(undefined), null);
  assert.strictEqual(parseConnectionOverrideAllowlist(null), null);
  assert.strictEqual(parseConnectionOverrideAllowlist(""), null);
  assert.strictEqual(parseConnectionOverrideAllowlist("   "), null);

  // Un array se toma tal cual, sin duplicados.
  assert.deepStrictEqual(
    [...parseConnectionOverrideAllowlist(["database", "password", "database"])],
    ["database", "password"],
  );

  // Se admite la forma compacta, porque custom_data se escribe a mano.
  assert.deepStrictEqual(
    [...parseConnectionOverrideAllowlist("database, password")],
    ["database", "password"],
  );

  // El separador de la forma compacta es la coma, nunca el punto: "options.host"
  // es UNA ruta, no dos.
  assert.deepStrictEqual(
    [...parseConnectionOverrideAllowlist("options.host,options.port")],
    ["options.host", "options.port"],
  );

  // Una entrada invalida no se cuela como ruta. Y lo que no puede ser el nombre de
  // una clave se descarta con aviso, no se interpreta como una clave rarísima: un
  // typo silencioso dejaria el endpoint con una lista que no permite nada.
  assert.deepStrictEqual(
    [...parseConnectionOverrideAllowlist(["database", 42, null, {}])],
    ["database"],
  );
  assert.deepStrictEqual([...parseConnectionOverrideAllowlist(["options.host", "????"])], ["options.host"]);
  assert.strictEqual(parseConnectionOverrideAllowlist(["????"]), null, "basura pura = sin opinion");
  assert.strictEqual(parseConnectionOverrideAllowlist("????"), null);

  // Un nombre de clave puede llevar guion, digito o signo de dollar: el criterio
  // es que el dedo lo pueda escribir, no que sea un identificador de JavaScript.
  assert.deepStrictEqual(
    [...parseConnectionOverrideAllowlist(["mi-base", "db_2", "$app", "a.b.c.d"])],
    ["mi-base", "db_2", "$app", "a.b.c.d"],
  );
  // Un punto al principio o al final no es un camino.
  assert.strictEqual(parseConnectionOverrideAllowlist([".options"]), null);
  assert.strictEqual(parseConnectionOverrideAllowlist(["options."]), null);
  assert.strictEqual(parseConnectionOverrideAllowlist(["options..host"]), null);

  // Quien quiera negar todo lo dice de forma reconocible, con una clave valida que
  // no conviene permitir.
  assert.strictEqual(parseConnectionOverrideAllowlist(["__nada__"]).size, 1);

  // "*" significa lo mismo que no declarar nada.
  assert.strictEqual(parseConnectionOverrideAllowlist(["*"]), null);

  // Basura que no es lista = sin opinion, no "negar todo". Negar todo en silencio
  // romperia endpoints sin que nadie entendiera por que.
  assert.strictEqual(parseConnectionOverrideAllowlist(42), null);
  assert.strictEqual(parseConnectionOverrideAllowlist({ database: true }), null);

  // Una lista que se queda vacia tras limpiar tampoco restringe: no se puede
  // desactivar la feature escribiendo una lista vacia por accidente.
  assert.strictEqual(parseConnectionOverrideAllowlist([]), null);
  assert.strictEqual(parseConnectionOverrideAllowlist(["", "  ", "*"]), null);
}

// --- resolveConnectionOverrideAllowlist: el techo manda --------------------
{
  const credenciales = set("uid", "pwd", "user", "password");

  // Sin techo y sin declaracion: todo permitido (comportamiento historico).
  assert.strictEqual(resolveConnectionOverrideAllowlist(null, null), null);

  // Sin techo, con declaracion: la declaracion manda.
  const declarado = set("database");
  assert.deepStrictEqual(
    [...resolveConnectionOverrideAllowlist(null, declarado)],
    ["database"],
  );

  // Con techo y sin declaracion: el techo.
  assert.deepStrictEqual(
    [...resolveConnectionOverrideAllowlist(credenciales, null)],
    ["uid", "pwd", "user", "password"],
  );

  // Con ambos: interseccion. Esto es lo que impide ampliar desde el body.
  assert.deepStrictEqual(
    [...resolveConnectionOverrideAllowlist(credenciales, set("pwd", "database"))],
    ["pwd"],
  );

  // Declarar algo que el techo no concede no lo concede: niega todo, no lo deja
  // pasar. Un endpoint HANA que pida "options" se queda sin override, que es la
  // lectura conservadora correcta de "quiero algo que no tengo".
  const fuera = resolveConnectionOverrideAllowlist(credenciales, set("options"));
  assert.notStrictEqual(fuera, null, "debe ser una lista, no ausencia de lista");
  assert.strictEqual(fuera.size, 0, "nada puede pasar el techo");
  assert.deepStrictEqual(
    applyConnectionOverride({ password: "a" }, { options: { host: "x" } }, fuera).config,
    { password: "a" },
    "y el descarte tiene que verse en la config",
  );

  // Estrechar dentro de un techo mas ancho: se conservan las entradas del techo que
  // caen dentro. Una interseccion literal daria vacio y negaria de mas.
  const ancho = set("options");
  assert.deepStrictEqual(
    [...resolveConnectionOverrideAllowlist(ancho, set("options.host"))],
    ["options.host"],
  );
}

// --- applyConnectionOverride: sin allowlist, copia todo ---------------------
{
  const base = { database: "prod", options: { dialect: "postgres", host: "h" } };
  const override = { database: "otro", options: { host: "otro" } };
  const r = applyConnectionOverride(base, override, null);

  assert.deepStrictEqual(r.config, { database: "otro", options: { host: "otro", dialect: "postgres" } },
    "sin allowlist se comporta como el merge profundo de siempre");
  assert.deepStrictEqual(r.applied.sort(), ["database", "options.host"],
    "applied registra hojas, no la raiz de la rama: en el log interesa saber que host cambio");
  assert.deepStrictEqual(r.rejected, []);
  assert.strictEqual(base.options.host, "h", "la base no se toca");
}

// --- applyConnectionOverride: Rama completa permitida -----------------------
{
  const base = { database: "prod", options: { dialect: "postgres", host: "h", port: 5432 } };
  const r = applyConnectionOverride(
    base,
    { options: { host: "otro", port: 6543 } },
    set("options"),
  );

  assert.deepStrictEqual(r.config.options, { host: "otro", port: 6543, dialect: "postgres" },
    "permitir 'options' abre la rama entera y lo no enviado se conserva");
  assert.deepStrictEqual(r.applied.sort(), ["options.host", "options.port"]);
  assert.deepStrictEqual(r.rejected, []);
}

// --- applyConnectionOverride: hoja suelta permitida, resto negada -----------
{
  const base = { database: "prod", options: { dialect: "postgres", host: "h", storage: "/a.db" } };
  const r = applyConnectionOverride(
    base,
    { database: "otro", options: { host: "malo", storage: "/b.db" } },
    set("database", "options.storage"),
  );

  assert.deepStrictEqual(r.config, {
    database: "otro",
    options: { dialect: "postgres", host: "h", storage: "/b.db" },
  }, "lo permitido se aplica y lo denied conserva su valor original");
  assert.deepStrictEqual(r.applied.sort(), ["database", "options.storage"]);
  assert.deepStrictEqual(r.rejected, ["options.host"],
    "solo se reporta lo que el body intenta cambiar de verdad, no lo que se conserva");

  // Este es el caso que importa: con la allowlist declarada, el host NO cambia.
  assert.strictEqual(r.config.options.host, "h", "el host no puede cambiarse");
}

// --- applyConnectionOverride: rama entera rechazada ------------------------
{
  const base = { database: "prod", options: { dialect: "postgres", host: "h" } };
  const r = applyConnectionOverride(base, { options: { host: "malo" } }, set("database"));

  assert.deepStrictEqual(r.config, base, "la config queda intacta");
  assert.deepStrictEqual(r.rejected, ["options", "options.host"],
    "se anota la raiz y la hoja: en el log son hechos distintos");
  assert.deepStrictEqual(r.applied, []);
}

// --- applyConnectionOverride: la allowlist no depende de la config base ----
{
  // Este es el punto de seguridad. Si la ruta viene del custom_data guardado, eso
  // no la hace tocable: lo que decide es de donde salio, no su valor.
  const base = { database: "prod", options: { host: "guardado", dialect: "postgres" } };
  const r = applyConnectionOverride(base, { options: { host: "del-body" } }, set("database"));

  assert.strictEqual(r.config.options.host, "guardado",
    "un valor que ya estaba en la config sigue sin ser modificable por el body");
  assert.deepStrictEqual(r.rejected, ["options", "options.host"]);
}

// --- applyConnectionOverride: arrays son valores, no ramas -----------------
{
  const base = { options: { hosts: ["a", "b"] } };
  const permitido = applyConnectionOverride(
    base,
    { options: { hosts: ["c"] } },
    set("options.hosts"),
  );
  assert.deepStrictEqual(permitido.config.options.hosts, ["c"]);

  const negado = applyConnectionOverride(base, { options: { hosts: ["c"] } }, set("database"));
  assert.deepStrictEqual(negado.config.options.hosts, ["a", "b"], "un array no se partializa");
  assert.deepStrictEqual(negado.rejected, ["options", "options.hosts"]);
}

// --- applyConnectionOverride: no inventar override donde no lo hay ----------
{
  const base = { database: "prod" };

  // Sin override, nada que registrar ni que aplicar.
  for (const vacio of [undefined, null, "", 0, false, "texto", 42]) {
    const r = applyConnectionOverride(base, vacio, set("database"));
    assert.deepStrictEqual(r.config, base);
    assert.deepStrictEqual(r.applied, []);
    assert.deepStrictEqual(r.rejected, []);
  }

  // Un array no es una configuracion: se trata como si no hubiera override, para
  // no inventarse una rama donde el body no dio ninguna.
  const r = applyConnectionOverride(base, ["database"], set("database"));
  assert.deepStrictEqual(r.config, base);
  assert.deepStrictEqual(r.applied, []);
}

// --- applyConnectionOverride: null y undefined en el body -----------------
{
  const base = { database: "prod", password: "viejo" };
  const r = applyConnectionOverride(
    base,
    { password: null, database: undefined },
    set("password", "database"),
  );

  // Un null explicito SI se aplica si la ruta esta permitida. Y un undefined
  // tambien borra: es lo que hacia el merge profundo de antes, y cambiarlo aqui
  // seria una diferencia sin motivo entre installar la allowlist y no instalarla.
  assert.strictEqual(r.config.password, null);
  assert.strictEqual(r.config.database, undefined,
    "undefined tambien escribe, igual que mergeObjects");
}

// --- applyConnectionOverride: deep merge en ruta permitida -----------------
{
  const base = {
    options: {
      dialectOptions: { ssl: { rejectUnauthorized: true }, application_name: "viejo" },
    },
  };
  const r = applyConnectionOverride(
    base,
    { options: { dialectOptions: { application_name: "nuevo" } } },
    set("options.dialectOptions"),
  );

  assert.deepStrictEqual(r.config.options.dialectOptions, {
    ssl: { rejectUnauthorized: true },
    application_name: "nuevo",
  }, "la rama permitida se mezcla en profundidad y conserva lo no enviado");
}

// --- describeConnectionOverride: el texto es lo que lee un operador --------
{
  const ctx = { handler: "SQL", resource: "/api/demo/x", environment: "prd" };

  // Sin restriccion: el texto tiene que decirlo, porque la pregunta que alguien se
  // hace al leerlo es si este endpoint deja cambiar el destino de la consulta.
  const libre = describeConnectionOverride(
    { applied: ["options.host"], rejected: [] },
    null,
    ctx,
  );
  assert.match(libre, /sin restriccion/);
  assert.match(libre, /options\.host/);

  const acotado = describeConnectionOverride(
    { applied: ["database"], rejected: ["options.host", "options"] },
    set("database"),
    ctx,
  );
  assert.match(acotado, /allowlist \[database\]/);
  assert.match(acotado, /aplicadas: database/);
  assert.match(acotado, /descartadas: options, options\.host/);

  // Nunca valores. Esta es la propiedad que no hay que perder: un valor puede ser
  // una contrasena o una ruta de archivo interna, y el log no es el sitio para
  // copiarlos.
  const conSecretos = describeConnectionOverride(
    { applied: ["password", "options.storage"], rejected: [] },
    null,
    { ...ctx, password: "hunter2", storage: "/etc/shadow" },
  );
  assert.ok(!conSecretos.includes("hunter2"), "no debe aparecer el valor de la contrasena");
  assert.ok(!conSecretos.includes("/etc/shadow"), "no debe aparecer la ruta del archivo");
  assert.match(conSecretos, /password/, "pero si el nombre de la clave");

  // Salidas vacias: no debe lanzar.
  assert.ok(describeConnectionOverride().length > 0);
  assert.ok(describeConnectionOverride({}, null, {}).length > 0);
  assert.ok(describeConnectionOverride({ applied: ["x"] }, set("x"), {}).includes("x"));
}

// --- applyConnectionOverride: allowlist de dos niveles ---------------------
{
  // Caso que ya rompio una vez: al comprobar solo el primer segmento del prefijo,
  // la rama entraba por su nombre y sus propias hojas se rechazaban. Sin error, sin
  // aviso, y justo en el endpoint que se habia molado en acotar.
  const base = {
    options: {
      dialectOptions: { ssl: { rejectUnauthorized: true }, application_name: "viejo" },
      pool: { max: 5 },
    },
  };
  const r = applyConnectionOverride(
    base,
    { options: { dialectOptions: { application_name: "nuevo" }, pool: { max: 99 } } },
    set("options.dialectOptions"),
  );

  assert.strictEqual(r.config.options.dialectOptions.application_name, "nuevo",
    "una hoja bajo un ancestro permitido de dos niveles se aplica");
  assert.deepStrictEqual(r.config.options.dialectOptions.ssl, { rejectUnauthorized: true });
  assert.strictEqual(r.config.options.pool.max, 5,
    "una rama vecina que no se nombra se conserva");
  assert.deepStrictEqual(r.applied, ["options.dialectOptions.application_name"]);
  assert.deepStrictEqual(r.rejected, ["options.pool", "options.pool.max"],
    "la rama vecina se reporta como descartada, no como ignorada");

  // Y al reves: permitir un nivel mas fondo no debe abrir el nivel intermedio.
  const profundo = applyConnectionOverride(
    base,
    { options: { dialectOptions: { ssl: { ca: "/tmp/ca.pem" } }, pool: { max: 99 } } },
    set("options.dialectOptions.ssl"),
  );
  assert.deepStrictEqual(profundo.config.options.dialectOptions.ssl, { ca: "/tmp/ca.pem", rejectUnauthorized: true });
  assert.strictEqual(profundo.config.options.pool.max, 5);
  assert.deepStrictEqual(profundo.applied, ["options.dialectOptions.ssl.ca"]);
}

console.log("OK  sql_connection_override_allow_test: la allowlist acota y solo acota");

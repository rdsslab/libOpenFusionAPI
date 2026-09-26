import assert from "node:assert/strict";
import { limpiarDefinicionAlterColumn } from "../../src/lib/db/mssql_query_generator.js";

/**
 * `ALTER COLUMN` en T-SQL solo admite un tipo y la nulabilidad.
 *
 * Estas son las definiciones que Sequelize arma de verdad para los modelos de la
 * plataforma, recogidas del DDL que emitia y que SQL Server rechazaba. Lo
 * interesante no es el primer caso, sino los de abajo: el saneador tiene que
 * recortar lo que sobra sin comerse lo que `changeColumnQuery` espera encontrar
 * despues, que son las referencias a otra tabla y el comentario.
 */

const CASOS = [
  // El caso que ya fallaba: un entero con default.
  ["SMALLINT DEFAULT 0", "SMALLINT"],
  ["BIT DEFAULT 1", "BIT"],
  ["INTEGER DEFAULT 30", "INTEGER"],
  ["NVARCHAR(4) NOT NULL DEFAULT N'dev'", "NVARCHAR(4) NOT NULL"],
  ["NVARCHAR(MAX) NOT NULL DEFAULT N''", "NVARCHAR(MAX) NOT NULL"],

  // Clave primaria autoincremental: identity y primary key van juntos y hay que
  // quitar los dos, o el `ALTER` sigue siendo ilegal.
  ["BIGINT IDENTITY(1,1) PRIMARY KEY", "BIGINT"],
  ["INT IDENTITY(1,1)", "INT"],

  // `UNIQUE` tampoco vale en un `ALTER COLUMN`, y Sequelize lo emite para las
  // columnas marcadas unicas.
  ["NVARCHAR(255) NOT NULL UNIQUE", "NVARCHAR(255) NOT NULL"],
  ["CHAR(36) NOT NULL UNIQUE", "CHAR(36) NOT NULL"],

  // Lo que no lleva nada que quitar tiene que quedar igual, incluida la
  // nulabilidad, que si no se pierde.
  ["NVARCHAR(255) NULL", "NVARCHAR(255) NULL"],
  ["CHAR(36) NOT NULL", "CHAR(36) NOT NULL"],
  ["DATETIMEOFFSET NOT NULL", "DATETIMEOFFSET NOT NULL"],

  // Un default que contiene la palabra DEFAULT dentro de su texto, otro que trae
  // comillas duplicadas (el escape de T-SQL) y otro con espacios que hay que
  // conservar. Un `replace` de texto se equivocaria en los tres.
  ["NVARCHAR(50) NOT NULL DEFAULT N'default value'", "NVARCHAR(50) NOT NULL"],
  ["NVARCHAR(50) NOT NULL DEFAULT N'it''s DEFAULT here'", "NVARCHAR(50) NOT NULL"],
  ["NVARCHAR(50) NOT NULL DEFAULT N'dos  espacios'", "NVARCHAR(50) NOT NULL"],

  // El default del `json_schema`: un JSON largo con comillas dobles y espacios.
  [
    `NVARCHAR(MAX) DEFAULT N'{"in":{"enabled":false,"schema":{"type":"object","properties":{},"additionalProperties":true}},"out":{"enabled":false,"schema":{"type":"object","properties":{},"additionalProperties":true}}}'`,
    "NVARCHAR(MAX)",
  ],

  // Las columnas ENUM llegan como tipo mas `CHECK (... IN (...))`, que tampoco
  // se admite en el `ALTER`.
  [
    "VARCHAR(30) NOT NULL CHECK ([status] IN(N'a',N'b'))",
    "VARCHAR(30) NOT NULL",
  ],

  // `UNIQUEIDENTIFIER` es un tipo de T-SQL, no la palabra `UNIQUE` repetida. Es
  // el caso que obliga a leer el tipo como palabra completa y no a buscar
  // fragmentos: un `replace("UNIQUE", "")` dejaria `IDENTIFIER`.
  ["UNIQUEIDENTIFIER NOT NULL", "UNIQUEIDENTIFIER NOT NULL"],
  [
    "UNIQUEIDENTIFIER NULL DEFAULT N'00000000-0000-0000-0000-000000000000'",
    "UNIQUEIDENTIFIER NULL",
  ],

  // Tipos con esquema y con parentesis, que no se pueden cortar por el espacio.
  ["dbo.mitipo NOT NULL DEFAULT N'x'", "dbo.mitipo NOT NULL"],
  ["DECIMAL(10,2) NOT NULL DEFAULT 0.00", "DECIMAL(10,2) NOT NULL"],
];

// Lo que va detras de `REFERENCES` o `COMMENT` NO se corta, y no por descuido:
// `changeColumnQuery` lo detecta para moverlo de sitio por su cuenta, la primera
// a una clausula `ADD FOREIGN KEY` y la segunda al comentario extendido. Si el
// saneador se lo comiera, un `alter` borraria las claves foraneas de la tabla.
const COLAS = [
  [
    "CHAR(36) NOT NULL REFERENCES [ofapi_application] ([idapp])",
    "CHAR(36) NOT NULL REFERENCES [ofapi_application] ([idapp])",
  ],
  [
    "CHAR(36) NOT NULL DEFAULT N'x' REFERENCES [ofapi_application] ([idapp]) ON DELETE CASCADE",
    "CHAR(36) NOT NULL REFERENCES [ofapi_application] ([idapp]) ON DELETE CASCADE",
  ],
  [
    "DATETIMEOFFSET NOT NULL COMMENT 'Cuando se creo la cuenta'",
    "DATETIMEOFFSET NOT NULL COMMENT 'Cuando se creo la cuenta'",
  ],
  [
    "NVARCHAR(255) NOT NULL DEFAULT N'' UNIQUE COMMENT 'Nombre de usuario'",
    "NVARCHAR(255) NOT NULL COMMENT 'Nombre de usuario'",
  ],
  // Un default cuyo texto contiene la palabra REFERENCES no es una clave
  // foranea. Aqui es donde una busqueda sin saltar literales se equivoca.
  [
    "NVARCHAR(50) NOT NULL DEFAULT N'la tabla REFERENCES es ajena'",
    "NVARCHAR(50) NOT NULL",
  ],
];

for (const [entrada, esperado] of [...CASOS, ...COLAS]) {
  const obtenido = limpiarDefinicionAlterColumn(entrada);
  assert.equal(obtenido, esperado, `"${entrada}" deberia quedar como "${esperado}"`);
}

// Ningun caso puede conservar lo que `ALTER COLUMN` prohibe.
for (const [entrada] of [...CASOS, ...COLAS]) {
  const obtenido = limpiarDefinicionAlterColumn(entrada);
  const prohibido = obtenerProhibidos(obtenido);
  assert.ok(
    prohibido.length === 0,
    `"${entrada}" deja ${prohibido.join(", ")} y eso ALTER COLUMN no lo admite`,
  );
}

/**
 * Las palabras que T-SQL no admite fuera del tipo, la nulabilidad, la
 * referencia y el comentario. Se buscan como palabra completa: `UNIQUE` no puede
 * marcar `UNIQUEIDENTIFIER` ni `PRIMARY KEY` puede contar dentro de un literal.
 */
function obtenerProhibidos(texto) {
  const prohibidas = ["DEFAULT", "IDENTITY", "UNIQUE", "CHECK", "COLLATE"];
  const encontradas = [];
  let i = 0;
  while (i < texto.length) {
    if (texto[i] === "'") {
      i++;
      while (i < texto.length && texto[i] !== "'") i++;
      i++;
      continue;
    }
    if (/[A-Za-z0-9_]/.test(texto[i])) {
      let j = i;
      while (j < texto.length && /[A-Za-z0-9_]/.test(texto[j])) j++;
      const palabra = texto.slice(i, j).toUpperCase();
      if (prohibidas.includes(palabra)) encontradas.push(palabra);
      if (palabra === "PRIMARY" && /^KEY\b/.test(texto.slice(j))) encontradas.push("PRIMARY KEY");
      i = j;
      continue;
    }
    i++;
  }
  return encontradas;
}

// Casos limite que no son definiciones de columna y no deben romperse.
assert.equal(limpiarDefinicionAlterColumn(""), "");
assert.equal(limpiarDefinicionAlterColumn(undefined), undefined);
assert.equal(limpiarDefinicionAlterColumn(42), 42);

console.log(
  `OK  mssql_alter_column: ${CASOS.length + COLAS.length} definiciones de T-SQL reducidas`,
);

/**
 * `ALTER COLUMN` en T-SQL solo admite un tipo y la nulabilidad:
 *
 *     ALTER TABLE [t] ALTER COLUMN [c] <tipo> [ NOT NULL | NULL ]
 *
 * Ni `DEFAULT`, ni `IDENTITY`, ni `PRIMARY KEY`, ni `UNIQUE`, ni `CHECK`. Y Sequelize
 * mete las cuatro cosas a la vez, en este orden fijo (su
 * `dialects/mssql/query-generator.js`, en `attributeToSQL`):
 *
 *     <tipo> [NOT NULL|NULL] [IDENTITY(1,1)] [DEFAULT x] [UNIQUE] [PRIMARY KEY]
 *            [REFERENCES t (k)] [ON DELETE x] [ON UPDATE y] [COMMENT 'z']
 *
 * De ahi sale, tal cual, lo que `changeColumnQuery` convierte en
 * `ALTER TABLE [ofapi_user] ALTER COLUMN [rowkey] SMALLINT DEFAULT 0;`, que SQL
 * Server rechaza con el error 156. Como el `DEFAULT` viene del `defaultValue` de
 * cada atributo, el problema alcanza a unas 70 columnas de 20 modelos y
 * `sync({ alter: true })` no se puede completar en MSSQL. Tampoco el `sync()` a
 * secas que se usa de reserva (que ademas chocaba con un nombre de constraint
 * duplicado, resuelto en `models.js` renombrando el segundo `unique_av_combo`).
 *
 * Aqui no se quitan los `defaultValue` de los modelos, y esa es la decision que
 * importa: `defaultValue` no es solo DDL. Sequelize lo aplica en cada ruta de
 * escritura —`create`, `upsert`, `findOrCreate` y `bulkCreate`, con
 * `individualHooks` en `true` o en `false`—, asi que borrarlo cambiaria el
 * comportamiento del log de auditoria, cuyo `id` es clave primaria con
 * `defaultValue: UUIDV4` y cuyo `bulkCreate` desactiva los hooks a proposito para
 * ir mas rapido. Un `beforeValidate` no reproduce eso, y la clave primaria
 * ademas se resiste a que un hook la rellene.
 *
 * Lo que se hace es recortar la definicion del `ALTER`, y no tocar el
 * `CREATE TABLE`, donde esos mismos atributos si son obligatorios. Perder el
 * default en el `ALTER` tampoco destruye el que ya tuviera la columna: en T-SQL,
 * un `ALTER COLUMN` sin `DEFAULT` lo deja como estaba.
 */

/** Una palabra de la definicion: letras, digitos y guion bajo. */
const PALABRA = /[A-Za-z0-9_]/;
const ESPACIO = /\s/;

/**
 * Devuelve el indice siguiente al final de la cadena que empieza en `i`.
 *
 * Una comilla duplicada (`''`) es el escape de SQL Server, no el cierre, asi que
 * hay que distinguir las dos cosas o la lectura se corta en el sitio erroneo.
 */
function finDeCadena(texto, i) {
  const comilla = texto[i];
  i++;
  while (i < texto.length) {
    if (texto[i] === comilla) {
      if (texto[i + 1] === comilla) {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i++;
  }
  return i;
}

/** Devuelve el indice siguiente al cierre del parentesis que abre `i`. */
function finDeParentesis(texto, i) {
  let nivel = 0;
  do {
    if (texto[i] === "(") nivel++;
    else if (texto[i] === ")") nivel--;
    i++;
  } while (i < texto.length && nivel > 0);
  return i;
}

/**
 * Busca la primera palabra `buscada` a partir de `desde`, saltando los literales.
 *
 * hace falta saltar los literales porque un valor por defecto puede contener
 * cualquier texto: un `DEFAULT N'dato REFERENCES'` no es una clave foranea. Una
 * busqueda a pelo de la cadena no lo distinguiria.
 *
 * @returns {number} el indice de la palabra, o `-1` si no aparece
 */
function indiceDePalabra(texto, desde, buscada) {
  let i = desde;
  while (i < texto.length) {
    if (texto[i] === "'" || texto[i] === '"') {
      i = finDeCadena(texto, i);
      continue;
    }
    if (PALABRA.test(texto[i])) {
      let j = i;
      while (j < texto.length && PALABRA.test(texto[j])) j++;
      if (texto.slice(i, j).toUpperCase() === buscada) return i;
      i = j;
      continue;
    }
    i++;
  }
  return -1;
}

/**
 * Reduce una definicion de columna de T-SQL a lo que `ALTER COLUMN` admite.
 *
 * Conserva el tipo, la nulabilidad y lo que va detras de `REFERENCES` o
 * `COMMENT`. Las dos ultimas se conservan a proposito y no por descuido:
 * `changeColumnQuery` las detecta y las mueve de sitio por su cuenta, la primera
 * a una clausula `ADD FOREIGN KEY` aparte y la segunda al `sp_addextendedproperty`
 * del comentario. Si se cortaran aqui, un `alter` borraria las claves foraneas
 * de la tabla.
 *
 * @param {string} definition la definicion de la columna, tal cual la arma Sequelize
 * @returns {string} la definicion reducida a `ALTER COLUMN` + las dos colas de arriba
 */
export function limpiarDefinicionAlterColumn(definition) {
  if (typeof definition !== "string" || definition === "") return definition;

  // 1. El tipo. Se admite un punto para los tipos propios con esquema
  //    (`dbo.mitipo`) y parentesis para los que los llevan (`NVARCHAR(255)`,
  //    `DECIMAL(10,2)`), contando los anidados.
  let i = 0;
  while (i < definition.length && (PALABRA.test(definition[i]) || definition[i] === ".")) i++;
  let finTipo = i;
  if (definition[finTipo] === "(") finTipo = finDeParentesis(definition, finTipo);
  const tipo = definition.slice(0, finTipo);
  if (tipo === "") return definition;

  // 2. La nulabilidad, que solo puede ir inmediatamente despues del tipo.
  let resto = definition.slice(finTipo);
  let nulabilidad = "";
  if (/^\s*NOT\s+NULL\b/i.test(resto)) nulabilidad = " NOT NULL";
  else if (/^\s+NULL\b/i.test(resto)) nulabilidad = " NULL";

  // 3. Lo que `changeColumnQuery` se lleva por su cuenta.
  const desde = finTipo;
  const ref = indiceDePalabra(definition, desde, "REFERENCES");
  const com = indiceDePalabra(definition, desde, "COMMENT");
  const cola = [ref, com].filter((x) => x >= 0);
  const sufijo = cola.length > 0 ? definition.slice(Math.min(...cola)) : "";

  return `${tipo}${nulabilidad}${sufijo ? ` ${sufijo}` : ""}`.replace(/\s+/g, " ").trim();
}

/**
 * Envuelve `changeColumnQuery` y `commentTemplate` del dialecto `mssql`.
 *
 * Se parchea la instancia y no el prototipo de Sequelize a proposito: el cambio
 * queda contenido en este proceso, y si algun dia el driver lo arregla, este
 * archivo sobra sin mas que dejar de llamarse.
 *
 * @param {import("sequelize").Sequelize} dbsequelize
 * @returns {boolean} si el parche se aplico; `false` en cualquier otro dialecto
 */
export function parcheAlterColumnMssql(dbsequelize) {
  if (dbsequelize.getDialect() !== "mssql") return false;

  const generator = dbsequelize.dialect.queryGenerator;
  const original = generator.changeColumnQuery.bind(generator);

  generator.changeColumnQuery = (tableName, attributes) =>
    original(
      tableName,
      Object.fromEntries(
        Object.entries(attributes).map(([columna, definicion]) => [
          columna,
          limpiarDefinicionAlterColumn(definicion),
        ]),
      ),
    );

  // Segundo defecto, que el primero tapaba. El comentario de una columna se
  // escribe con `sp_addextendedproperty`, que en T-SQL no es idempotente: si la
  // propiedad ya existe, responde "Property 'MS_Description' already exists for
  // 'dbo.ofapi_user.start_date'". Es decir que el `ALTER` solo podia completarse
  // la primera vez, y a partir del segundo arranque de la plataforma el
  // `sync({ alter: true })` volvia a fallar. Con el `IF NOT EXISTS` delante, si
  // no existe se agrega y si existe se actualiza, y el arranque es repetible.
  const comentarioOriginal = generator.commentTemplate.bind(generator);

  generator.commentTemplate = (comment, table, column) => {
    // El punto y coma se conserva a proposito. En T-SQL el cuerpo de un `IF` es
    // una sentencia y el `EXEC` tiene que cerrarse antes del `ELSE`; quitarlo
    // deja `EXEC a ELSE EXEC b`, que no parsea (error 156).
    const agregar = comentarioOriginal(comment, table, column).trim();
    const actualizar = comentarioOriginal(comment, table, column)
      .trim()
      .replace("EXEC sp_addextendedproperty", "EXEC sp_updateextendedproperty");
    // `quoteIdentifier` devuelve el nombre entre corchetes, y `OBJECT_ID` quiere
    // el nombre pelado: los corchetes aqui serian parte del literal. Y `escape`
    // ya antepone la `N` de Unicode, asi que no hay que volver a ponerla.
    const tabla = String(generator.quoteIdentifier(table)).replace(/^\[|\]$/g, "");
    const nombreTabla = generator.escape(tabla);
    const nombreColumna = generator.escape(column);
    return (
      `IF NOT EXISTS (SELECT 1 FROM sys.extended_properties` +
      ` WHERE major_id = OBJECT_ID(${nombreTabla})` +
      // El tercer argumento no es opcional en esta version de SQL Server: sin
      // el, responde "The columnproperty function requires 3 argument(s)".
      ` AND minor_id = COLUMNPROPERTY(OBJECT_ID(${nombreTabla}), ${nombreColumna}, 'ColumnId')` +
      ` AND name = N'MS_Description') ${agregar}` +
      ` ELSE ${actualizar}`
    );
  };

  return true;
}

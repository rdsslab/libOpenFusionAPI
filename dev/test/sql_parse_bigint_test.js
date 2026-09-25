import assert from "node:assert/strict";
import pgTypes from "pg-types";
import {
  buildBigintAwareTypeParser,
  parseBigintIfSafe,
} from "../../src/lib/handler/ConnectionPool.js";
import {
  buildConnectionCacheKey,
  isParseBigintEnabled,
} from "../../src/lib/handler/utils.js";

/**
 * H10: `pg` devuelve `int8` / `bigint` como STRING, no como número. Es deliberado
 * — un bigint de PostgreSQL llega hasta 9.2e18 y el `Number` de JavaScript no lo
 * representa con exactitud — pero el efecto del otro lado es que un cliente HTTP
 * recibe `{"ord":"1"}` y cualquier comparación o suma posterior falla en silencio.
 *
 * `parse_bigint: true` convierte SOLO lo que cabe en el rango seguro de `Number` y
 * deja el string intacto en el resto. Estos tests son puros: no abren conexión.
 */

// --- El comportamiento por defecto de pg, que es el que no se toca ----------
{
  const porDefecto = pgTypes.getTypeParser(20, "text");
  assert.equal(typeof porDefecto("1"), "string", "pg devuelve int8 como string");
  assert.equal(porDefecto("9223372036854775807"), "9223372036854775807");
}

// --- Conversión dentro del rango seguro -------------------------------------
{
  const casos = [
    ["1", 1],
    ["0", 0],
    ["42", 42],
    ["-7", -7],
    ["9007199254740991", 9007199254740991], // Number.MAX_SAFE_INTEGER
    ["-9007199254740991", -9007199254740991], // Number.MIN_SAFE_INTEGER
  ];
  for (const [entrada, esperado] of casos) {
    const r = parseBigintIfSafe(entrada);
    assert.equal(typeof r, "number", `${entrada} debería convertirse a número`);
    assert.equal(r, esperado, `${entrada} -> ${esperado}`);
  }
}

// --- Fuera del rango seguro se conserva el string, nunca se aproxima ---------
{
  // El caso que da nombre a la opción: convertir 9007199254740993 a number daría
  // 9007199254740992, que es OTRO número. Un id que cambia de valor en el camino es
  // peor que un id que llega como texto.
  for (const entrada of [
    "9007199254740992",
    "9007199254740993",
    "-9007199254740992",
    "9223372036854775807",
    "-9223372036854775808",
    "123456789012345678901234567890",
  ]) {
    const r = parseBigintIfSafe(entrada);
    assert.equal(typeof r, "string", `${entrada} no cabe en Number: debe quedar string`);
    assert.equal(r, entrada, `${entrada} debe llegar sin alterar`);
  }
}

// --- Entradas que no son enteros -------------------------------------------
{
  // Se devuelven tal cual, igual que hacía pg. Un `numeric` con decimales que
  // llegara convertido a Number introduciría error de redondeo en importes.
  for (const entrada of ["", "   ", "abc", "1.5", "-0.5", "1e3", "0x10"]) {
    const r = parseBigintIfSafe(entrada);
    assert.equal(r, entrada, `${JSON.stringify(entrada)} debe volver intacto`);
  }
  // Tipos no string no se tocan: el parser solo recibe texto de pg.
  assert.equal(parseBigintIfSafe(null), null);
  assert.equal(parseBigintIfSafe(undefined), undefined);
  assert.equal(parseBigintIfSafe(5), 5);
  assert.equal(parseBigintIfSafe(true), true);
}

// --- El type parser solo intercepta int8 ------------------------------------
{
  const p = buildBigintAwareTypeParser();

  assert.equal(p(20, "text")("1"), 1, "int8 se convierte");
  assert.equal(p(20, "text")("9223372036854775807"), "9223372036854775807");

  // El resto de OIDs debe comportarse EXACTAMENTE igual que sin la opción. Esto es
  // la garantía que permite ofrecer la conversión sin sorprender en otros campos.
  for (const [oid, format, valor] of [
    [16, "text", "t"],       // bool
    [23, "text", "7"],       // int4
    [21, "text", "7"],       // int2
    [1700, "text", "1.50"],  // numeric
  ]) {
    const base = pgTypes.getTypeParser(oid, format)(valor);
    const conOpcion = p(oid, format)(valor);
    assert.deepStrictEqual(
      conOpcion,
      base,
      `OID ${oid} (${format}) cambió con parse_bigint: ${base} -> ${conOpcion}`,
    );
  }
}

// --- Formato binario del protocolo extendido --------------------------------
{
  // Con protocolo binario `pg` entrega 8 bytes, no texto. Sin cubrirlo, activar la
  // opción devolvería un Buffer en medio de una fila de valores normales, y se
  // serializaría como {"type":"Buffer","data":[...]}: peor que el string original.
  const buf = (n) => {
    const b = Buffer.alloc(8);
    b.writeBigInt64BE(BigInt(n));
    return b;
  };

  const p = buildBigintAwareTypeParser();
  assert.equal(p(20, "binary")(buf(1)), 1);
  assert.equal(p(20, "binary")(buf("9007199254740991")), 9007199254740991);
  assert.equal(p(20, "binary")(buf(-7)), -7, "los negativos también");
  assert.equal(
    p(20, "binary")(buf(-9007199254740991)),
    -9007199254740991,
    "MIN_SAFE_INTEGER en binario",
  );

  // Fuera del rango seguro se conserva el Buffer, igual que haría pg.
  for (const fuera of [
    "9007199254740993",
    "9223372036854775807",
    "-9223372036854775808",
  ]) {
    const r = p(20, "binary")(buf(fuera));
    assert.ok(Buffer.isBuffer(r), `${fuera} no cabe en Number: debe quedar Buffer`);
    assert.equal(r.readBigInt64BE(0).toString(), buf(fuera).readBigInt64BE(0).toString());
  }

  // Un Buffer que no son 8 bytes no se toca: no es un int8.
  const corto = Buffer.from([0, 1]);
  assert.strictEqual(p(20, "binary")(corto), corto);
  // pg devuelve string también en binario: la diferencia con la opción es
  // justamente el tipo, no el valor. Esto fija que no estamos cambiando el número
  // que ve el cliente, solo su presentación.
  const dePg = pgTypes.getTypeParser(20, "binary")(buf(42));
  const nuestro = p(20, "binary")(buf(42));
  assert.equal(typeof dePg, "string", "pg sigue devolviendo string en binario");
  assert.equal(nuestro, 42);
  assert.equal(Number(dePg), nuestro, "el valor debe ser el mismo, solo cambia el tipo");
}

// --- Un getTypeParser previo se respeta como base --------------------------
{
  let consultados = [];
  const base = (oid, format) => {
    consultados.push(oid);
    return () => "base";
  };
  const p = buildBigintAwareTypeParser(base);

  assert.equal(p(20, "text")("1"), 1, "int8 sigue interceptándose");
  assert.equal(p(23, "text")("7"), "base", "los demás OIDs pasan por el parser previo");
  assert.deepStrictEqual(consultados, [23], "el parser previo no se consulta para int8");
}

// --- La opción solo se activa con un sí explícito ---------------------------
{
  for (const v of [true, "true", "TRUE", " 1 ", "on", "yes"]) {
    assert.equal(isParseBigintEnabled(v), true, `${JSON.stringify(v)} debería activar`);
  }
  for (const v of [false, "false", "0", "no", "off", 0, 1, null, undefined, {}, [], ""]) {
    assert.equal(isParseBigintEnabled(v), false, `${JSON.stringify(v)} no debería activar`);
  }
  // El 1 numérico NO activa: `1` como string sí, porque llega de un formulario.
  assert.equal(isParseBigintEnabled(1), false, "un 1 numérico no es un sí explícito");
}

// --- La clave de caché tiene que distinguir la opción -----------------------
{
  // Dos endpoints sobre la MISMA base pueden pedir número o string. Si la clave no
  // lo reflejara, el segundo hereda la conexión del primero y recibe el tipo que no
  // pidió, sin ningún aviso: el fallo estaría en la caché, no en la conexión.
  const base = {
    database: "app",
    username: "u",
    options: { dialect: "postgres", host: "db", port: 5432 },
  };

  const sin = buildConnectionCacheKey({ ...base }, "dev");
  const conTrue = buildConnectionCacheKey({ ...base, parse_bigint: true }, "dev");
  const conFalse = buildConnectionCacheKey({ ...base, parse_bigint: false }, "dev");
  const conString = buildConnectionCacheKey({ ...base, parse_bigint: "true" }, "dev");

  assert.notEqual(sin, conTrue, "parse_bigint debe entrar en la clave de caché");
  assert.equal(sin, conFalse, "ausente y false son la misma configuración");
  assert.equal(conTrue, conString, "'true' y true son la misma configuración");
  assert.equal(conTrue, buildConnectionCacheKey({ ...base, parse_bigint: "1" }, "dev"));

  // Y la caché sigue separando entornos, como antes.
  assert.notEqual(conTrue, buildConnectionCacheKey({ ...base, parse_bigint: true }, "prd"));
}

console.log("OK  sql_parse_bigint_test: int8 seguro, resto de tipos intactos");

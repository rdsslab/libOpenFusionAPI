import assert from "node:assert/strict";
import { mapConLimite, limiteDesdeEntorno, LIMITE_POR_DEFECTO } from "../../src/lib/db/concurrency.js";

/**
 * H34, parte 2: el 1205 del arranque real no lo causaba `HOLDLOCK` en si, sino las
 * 77 escrituras simultaneas que `restoreAppFromBackup` soltaba sobre las mismas
 * tablas. Acotarlas es lo que hace que el 1205 no ocurra; `lock_retry.js` es la red
 * por si ocurre igual.
 *
 * Estos tests son puros: no abren conexion. Comprueban las tres garantias de las que
 * depende el acierto del restore —nunca se pasa del limite, el orden de salida es el de
 * entrada, y un fallo no se come a los demas— porque un limitador mal escrito falla
 * justo en esas tres y el sintoma es un backup restaurado a medias sin que nadie lo
 * note hasta que faltan endpoints.
 */

/**
 * Corre `operaciones` con el limite dado y devuelve el maximo que hubo en vuelo, el
 * orden real de TERMINACION y los resultados en el orden de entrada.
 *
 * `retardo(n)` permite invertir el orden de terminacion a proposito: si el resultado
 * saliese ordenado con la entrada, es por el indice, no porque el reloj cooperase.
 */
const correr = async (operaciones, limite, retardo = () => 5) => {
  let enVuelo = 0;
  let maximo = 0;
  const ordenTerminacion = [];
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));

  const resultados = await mapConLimite(
    operaciones,
    async (n) => {
      enVuelo++;
      maximo = Math.max(maximo, enVuelo);
      await espera(retardo(n));
      enVuelo--;
      ordenTerminacion.push(n);
      return n * 10;
    },
    limite,
  );

  return { resultados, maximo, ordenTerminacion };
};

{
  const lista = [0, 1, 2, 3, 4, 5, 6, 7];
  // El primero tarda MAS que los que le siguen: el primer lote termina al reves, de
  // modo que si el resultado saliese ordenado no puede ser casualidad del reloj.
  const { resultados, maximo, ordenTerminacion } = await correr(lista, 4, (n) => 40 - n * 4);
  assert.equal(maximo, 4, `nunca mas de 4 en vuelo, llegaron ${maximo}`);
  assert.notDeepEqual(ordenTerminacion, lista, "el reloj se ha encargado de desordenar la terminacion");
  assert.deepEqual(ordenTerminacion.slice(0, 4), [3, 2, 1, 0], "y lo ha hecho al reves, que es lo que se queria");
  assert.deepEqual(
    resultados.map((r) => r.valor),
    lista.map((n) => n * 10),
    "el resultado vuelve en el orden de la entrada, no en el de terminacion",
  );
}

{
  const { maximo } = await correr([0, 1, 2, 3, 4], 2);
  assert.equal(maximo, 2, "un limite de 2 se cumple");
}

{
  // Un limite mayor que la lista no crea consumidores de mas: no hay trabajo que
  // hacer y un `Array.from({length: 99})` sobre una lista de 2 es trabajo de mas.
  const { maximo, resultados } = await correr([0, 1], 99);
  assert.equal(maximo, 2, "el limite se recorta al numero de elementos");
  assert.equal(resultados.length, 2);
}

{
  assert.deepEqual(await mapConLimite([], async () => 1, 4), [], "lista vacia sin consumidores y sin error");
}

{
  // Un limite absurdo NO puede romper el arranque. `0` haria un bucle infinito de
  // consumidores que no toman trabajo; `NaN` haria `Array.from({length: NaN})` = [] y
  // devolveria una lista de `undefined` sin haber ejecutado nada, que es peor: el
  // restore seeria un exito falso.
  for (const limite of [0, -3, NaN, undefined, "muchos", 1.5]) {
    const { resultados } = await correr([0, 1, 2], limite);
    assert.equal(resultados.length, 3, `limite ${String(limite)}: se ejecutan todos`);
    assert.ok(resultados.every((r) => r.ok), `limite ${String(limite)}: ninguno sin ejecutar`);
  }
}

{
  // Un fallo no puede arrastrar a los demos: en un restore de backup, un endpoint con
  // un `code` de una version antigua que no valida no puede impedir que se restauren
  // los otros setenta.
  const entradas = [1, 2, 3, 4, 5, 6, 7, 8];
  const resultados = await mapConLimite(
    entradas,
    async (n) => {
      if (n % 3 === 0) throw new Error(`endpoint ${n} no valida`);
      return n;
    },
    3,
  );

  assert.equal(resultados.length, entradas.length, "uno por entrada, sin huecos");
  for (let i = 0; i < entradas.length; i++) {
    const n = entradas[i];
    if (n % 3 === 0) {
      assert.equal(resultados[i].ok, false, `el ${n} fallo`);
      assert.match(resultados[i].error.message, new RegExp(`endpoint ${n}`));
    } else {
      assert.equal(resultados[i].ok, true, `el ${n} salio bien`);
      assert.equal(resultados[i].valor, n);
    }
  }
}

{
  // Y un fallo que se rechaza sin motivo tamien cabe: `upsertEndpoint` devuelve
  // `undefined` en vez de lanzar cuando su `catch` se dispara, asi que hay call sites
  // que dependen del valor, no del rechazo.
  const resultados = await mapConLimite([1, 2], async (n) => (n === 1 ? undefined : n), 2);
  assert.equal(resultados[0].ok, true);
  assert.equal(resultados[0].valor, undefined, "`undefined` es un valor valido, no un fallo");
  assert.equal(resultados[1].valor, 2);
}

{
  // El indice se pasa a la operacion. En `restoreAppFromBackup` hace falta para
  // reportar cual endpoint fallo, y para cualquier operacion que tenga que mirar a los
  // vecinos.
  const vistos = [];
  await mapConLimite(["a", "b", "c"], async (el, i) => vistos.push([el, i]), 2);
  assert.deepEqual(vistos.sort(), [["a", 0], ["b", 1], ["c", 2]].sort());
}

// ------------------------------------------------------------ el limite del entorno

{
  assert.equal(limiteDesdeEntorno("VAR_QUE_NO_EXISTE_1234"), LIMITE_POR_DEFECTO, "sin variable, el de por defecto");
  assert.equal(limiteDesdeEntorno("VAR_QUE_NO_EXISTE_1234", 7), 7, "el de por defecto tambien se puede fijar al llamar");

  const nombre = "OFAPI_TEST_LIMITE";
  const original = process.env[nombre];
  try {
    process.env[nombre] = "3";
    assert.equal(limiteDesdeEntorno(nombre), 3, "un entero valido se respeta");
    process.env[nombre] = " 6 ";
    assert.equal(limiteDesdeEntorno(nombre), 6, "con espacios alrededor tambien: esto viene de un .env escrito a mano");
    for (const malo of ["", "   ", "0", "-1", "abc", "3.5", "1e3x"]) {
      process.env[nombre] = malo;
      assert.equal(limiteDesdeEntorno(nombre), LIMITE_POR_DEFECTO, `"${malo}" no es un limite y cae al de por defecto`);
    }
  } finally {
    if (original === undefined) delete process.env[nombre];
    else process.env[nombre] = original;
  }
}

console.log("OK  db_concurrency_test: el limite se respeta, el orden se respeta y un fallo no arrastra a los demas");

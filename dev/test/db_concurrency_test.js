import assert from "node:assert/strict";
import {
  mapConCierre,
  crearCierraDePaso,
  limiteDesdeEntorno,
  LIMITE_POR_DEFECTO,
} from "../../src/lib/db/concurrency.js";

/**
 * H35 + H36: la acotacion del arranque paso de "un limite por bucle" a "una puerta de
 * paso del proceso".
 *
 * La puerta sustituyo a `mapConLimite` en vez de acompanarlo. Un limite por llamada no
 * acota el arranque, que no es una llamada sino `defaultApps` lanzando las apps en
 * paralelo: el tope real era `limite x numero de apps`, y con las 2 apps por defecto
 * salia un pico medido de 8 sobre `ofapi_endpoint` con un limite de 4. Dejar el
 * limitador viejo en el modulo era dejar la trampa armada.
 *
 * Estos tests son puros: no abren conexion. Comprueban las garantias de las que depende
 * el acierto del restore —nunca se pasa del limite, el limite es del PROCESO y no de la
 * llamada, el orden de salida es el de entrada, y un fallo no se come a los demas—
 * porque un limitador mal escrito falla justo en esas y el sintoma es un backup
 * restaurado a medias que nadie nota hasta que faltan endpoints.
 */


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

// ------------------------------------------------------------ la puerta de paso global

// H36: el limite de H34 era POR APP, y `defaultApps` lanza las apps en paralelo, asi
// que el tope global real era `limite x numero de apps`. Con las 2 apps por defecto
// son 8, que es exactamente el pico medido en `ofapi_endpoint`; con 5 apps seria 20,
// el `pool.max` de la plataforma, y con 6 lo superaria. `crearCierraDePaso` es lo que
// hace que el limite sea del proceso y no de la llamada.

{
  const cierre = crearCierraDePaso(3);
  let enVuelo = 0;
  let maximo = 0;
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));

  const correr = async (n) => {
    enVuelo++;
    maximo = Math.max(maximo, enVuelo);
    await espera(5);
    enVuelo--;
    return n;
  };

  // Dos `map` independientes, como dos apps que se restauran a la vez. Con un limite
  // por llamada cada uno tendria 3 en vuelo y el total 6.
  const [a, b] = await Promise.all([
    mapConCierre([0, 1, 2, 3, 4], correr, cierre),
    mapConCierre([10, 11, 12, 13, 14], correr, cierre),
  ]);

  assert.equal(maximo, 3, `la puerta es global, no por llamada: llegaron ${maximo} a la vez`);
  assert.deepEqual(a.map((r) => r.valor), [0, 1, 2, 3, 4], "y cada mapa conserva su orden de entrada");
  assert.deepEqual(b.map((r) => r.valor), [10, 11, 12, 13, 14]);
}

{
  // Un fallo no puede dejar la puerta cerrada. Si `liberar` no se llamara en el
  // `finally`, las siguientes operaciones esperarian para siempre y el arranque se
  // quedaria colgado sin ningun error: el peor sintoma posible.
  const cierre = crearCierraDePaso(1);
  const resultados = await mapConCierre([1, 2, 3], async (n) => {
    if (n === 1) throw new Error("se rompe la primera");
    return n;
  }, cierre);

  assert.equal(resultados[0].ok, false);
  assert.match(resultados[0].error.message, /primera/);
  assert.deepEqual(resultados.slice(1).map((r) => r.valor), [2, 3], "las siguientes siguen entrando");
}

{
  // Y lo mismo con un rechazo asincrono en medio: `Promise.reject` en vez de `throw`.
  const cierre = crearCierraDePaso(2);
  const resultados = await mapConCierre(
    [1, 2, 3, 4],
    async (n) => {
      if (n % 2 === 0) return Promise.reject(new Error(`rechazo ${n}`));
      return n;
    },
    cierre,
  );
  assert.equal(resultados.filter((r) => !r.ok).length, 2);
  assert.equal(cierre.libres, 2, "la puerta queda con todos sus huecos libres al terminar");
  assert.equal(cierre.esperando, 0, "y con nadie en cola");
}

{
  // Una operacion que falla de forma sincrona, antes de devolver una promesa, es el
  // otro camino por el que se puede perder un hueco.
  const cierre = crearCierraDePaso(1);
  const resultados = await mapConCierre([1, 2], (n) => {
    if (n === 1) throw new Error("sincrono");
    return Promise.resolve(n);
  }, cierre);
  assert.equal(resultados[0].ok, false);
  assert.equal(resultados[1].ok, true);
  assert.equal(cierre.esperando, 0);
}

{
  const cierre = crearCierraDePaso(2);
  assert.equal(cierre.limite, 2);
  assert.equal(cierre.libres, 2, "nadie hapedido sitio todavia");
  assert.equal(cierre.esperando, 0);

  // Un hueco se toma y se devuelve, y la cola se vacia en orden.
  const orden = [];
  const uno = cierre.ejecutar(async () => { orden.push("a"); });
  const dos = cierre.ejecutar(async () => { orden.push("b"); });
  assert.equal(cierre.libres, 0, "los dos huecos estan ocupados");
  const tres = cierre.ejecutar(async () => { orden.push("c"); });
  assert.equal(cierre.esperando, 1, "el tercero espera");

  await Promise.all([uno, dos, tres]);
  assert.deepEqual(orden, ["a", "b", "c"], "la cola se sirve en orden de llegada");
  assert.equal(cierre.libres, 2);
  assert.equal(cierre.esperando, 0);
}

{
  // Un limite que no vale no se honra, y en una puerta de paso eso no es un detalle.
  // Con 0 huecos no es "poco paralelismo": es un bloqueo eterno. Nadie entra y las
  // esperas se quedan colgadas para siempre, sin un solo error, que es el sintoma mas
  // dificil de diagnosticar que puede dar un arranque. Por eso la regla es "invalido
  // cae al de por defecto" y no "invalido se corrige a 1": el de por defecto es lo que
  // se obtiene sin configurar nada, y 1 —que es lo que haria `|| 1`— convertiria el
  // arranque en serie sin que nadie lo pidiera.
  assert.equal(crearCierraDePaso(0).limite, LIMITE_POR_DEFECTO, "0 huecos colgaría el arranque");
  assert.equal(crearCierraDePaso(-5).limite, LIMITE_POR_DEFECTO);
  assert.equal(crearCierraDePaso(NaN).limite, LIMITE_POR_DEFECTO);
  assert.equal(crearCierraDePaso(undefined).limite, LIMITE_POR_DEFECTO);
  assert.equal(crearCierraDePaso("muchos").limite, LIMITE_POR_DEFECTO);

  // Y con el limite ya corregido, la puerta deja entrar: no hay ningun valor con el
  // que una puerta construida se quede esperando para siempre.
  for (const limite of [0, -5, NaN, undefined, "muchos", 1, 3]) {
    const cierre = crearCierraDePaso(limite);
    const carrera = await Promise.race([
      cierre.ejecutar(async () => "entro"),
      new Promise((r) => setTimeout(() => r("COLGADO"), 80)),
    ]);
    assert.equal(carrera, "entro", `limite ${String(limite)}: nadie se queda esperando`);
  }
}

{
  // Y un limite enorme no crea un limite: sale entero, sin decimales, y a la vez
  // tendria el comportamiento de "sin limite", que es lo que se le pidio.
  assert.equal(crearCierraDePaso(3.7).limite, 3, "3.7 son 3, no 3.7 personas");
  assert.equal(crearCierraDePaso(1000000).limite, 1000000);
}

{
  // El aviso es una vez por puerta, no uno por llamada: el arranque llama a
  // `limiteDesdeEntorno` al importar el modulo, pero una puerta puede construirse en
  // un test y en otro, y no puede inundar la salida.
  const nombre = "OFAPI_TEST_LIMITE_CIERRE";
  const original = process.env[nombre];
  const avisos = [];
  const wary = console.warn;
  console.warn = (m) => avisos.push(m);
  try {
    process.env[nombre] = "cero";
    const cierre = crearCierraDePaso(limiteDesdeEntorno(nombre, 4));
    assert.equal(cierre.limite, 4);
  } finally {
    console.warn = wary;
    if (original === undefined) delete process.env[nombre];
    else process.env[nombre] = original;
  }
  assert.equal(avisos.length, 1, "un aviso, no uno por construccion de puerta");
  assert.match(avisos[0], /OFAPI_TEST_LIMITE_CIERRE/);
}

{
  // El reloj se invierte a proposito: si el orden de salida no depende del reloj, no
  // puede depender de el. Un restore cuyo resultado dependa de que transaccionase mas
  // rapido no es un restore reproducible.
  const cierre = crearCierraDePaso(4);
  const lista = [0, 1, 2, 3, 4, 5, 6, 7];
  const ordenTerminacion = [];
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));

  const resultados = await mapConCierre(
    lista,
    async (n) => {
      await espera(40 - n * 4);
      ordenTerminacion.push(n);
      return n * 10;
    },
    cierre,
  );

  assert.notDeepEqual(ordenTerminacion, lista, "el reloj se ha encargado de desordenar la terminacion");
  assert.deepEqual(ordenTerminacion.slice(0, 4), [3, 2, 1, 0], "y al reves, que es lo que se queria");
  assert.deepEqual(
    resultados.map((r) => r.valor),
    lista.map((n) => n * 10),
    "el resultado vuelve en el orden de la entrada, no en el de terminacion",
  );
}

{
  assert.deepEqual(await mapConCierre([], async () => 1, crearCierraDePaso(4)), [], "lista vacia y sin error");
}

{
  // `undefined` es un valor, no un fallo. `upsertEndpoint` devuelve `undefined` en vez
  // de lanzar cuando su `catch` se dispara, asi que hay call sites cuyo resultado
  // depende del valor y no del rechazo.
  const resultados = await mapConCierre([1, 2], async (n) => (n === 1 ? undefined : n), crearCierraDePaso(2));
  assert.equal(resultados[0].ok, true);
  assert.equal(resultados[0].valor, undefined);
  assert.equal(resultados[1].valor, 2);
}

{
  // El indice llega a la operacion: en `restoreAppFromBackup` hace falta para decir que
  // endpoint fallo.
  const vistos = [];
  await mapConCierre(["a", "b", "c"], async (el, i) => vistos.push([el, i]), crearCierraDePaso(2));
  assert.deepEqual(vistos.sort(), [["a", 0], ["b", 1], ["c", 2]].sort());
}

console.log("OK  db_concurrency_test: la puerta es global, respeta su limite, no cuelga y un fallo no arrastra a los demas");

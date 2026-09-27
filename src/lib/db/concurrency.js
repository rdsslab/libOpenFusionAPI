/**
 * Ejecucion con concurrencia acotada.
 *
 * ## Por que existe
 *
 * `Promise.all` y `Promise.allSettled` sobre un `map` lanzan TODAS las operaciones a
 * la vez. Para trabajo de CPU o de E/S que no compite entre si, es lo correcto. Para
 * trabajo que escribe en una base de datos, no: N escrituras simultaneas contra las
 * mismas filas producen bloqueos que el motor tiene que romper, y en MSSQL el
 * `upsert` de Sequelize sale con `WITH(HOLDLOCK)` fijo
 * (`node_modules/sequelize/lib/dialects/mssql/query-generator.js`), con lo que cada
 * sentencia se lleva un rango de bloqueos hasta el COMMIT. Medido en un arranque real
 * de la plataforma: 30 faltas 1205 de 100 sentencias, y el mismo trabajo en serie
 * tardaba 6512 ms frente a 20341 ms — tres veces MAS RAPIDO en serie, porque el
 * deadlock no se paga solo una vez: se paga la espera, la victima, el reintento del
 * sistema y la vuelta a empezar.
 *
 * Acotar la concurrencia no es un parche para el 1205: es la parte que hace que el
 * 1205 no ocurra. `lock_retry.js` es la red por si ocurre igual.
 *
 * ## Por que un limite y no serie
 *
 * En serie no habria ningun bloqueo cruzado, pero tampoco habria paralelismo, y en
 * estos bucles hay trabajo que NO es de base de datos: validacion de codigo de
 * endpoints JS con `validateEndpointCode`, `JSON.parse` de backups antiguos,
 * migracion de nombres. Ese trabajo tarda mucho mas que la sentencia y no necesita
 * conexion. Un limite de 4 conserva ese solapamiento y quita la estampida.
 */

/** Limite por defecto. Cuatro conexiones simultaneas contra una base: sin estrangulamiento. */
export const LIMITE_POR_DEFECTO = 4;

/**
 * Resuelve el limite desde el entorno.
 *
 * Se lee del entorno y no se fija en el codigo porque el numero correcto depende de
 * la base de datos donde se este corriendo: contra HANA, que serializa mas, el mismo
 * limite puede ser de mas; contra una base de desarrollo en el mismo socket, el limite
 * no importa. Lo que no tiene sentido es un numero unico valido para todos los sitios.
 *
 * Un valor invalido no es un error: se avisa una vez y se usa el de por defecto, porque
 * un `parseInt` de `""` o de `"muchos"` dando `NaN` y usandose como indice rompe el
 * arranque entero por un detalle de configuracion.
 *
 * @param {string} [nombre] nombre de la variable
 * @param {number} [porDefecto]
 * @returns {number}
 */
export const limiteDesdeEntorno = (nombre, porDefecto = LIMITE_POR_DEFECTO) => {
  const crudo = process.env[nombre];
  if (crudo === undefined || String(crudo).trim() === "") return porDefecto;

  const valor = Number(crudo);
  if (!Number.isInteger(valor) || valor < 1) {
    console.warn(
      `[db:concurrencia] ${nombre}="${crudo}" no es un entero >= 1; se usa ${porDefecto}.`,
    );
    return porDefecto;
  }
  return valor;
};

/**
 * Aplica `operacion` a cada elemento con como mucho `limite` en vuelo a la vez.
 *
 * Devuelve los resultados EN EL MISMO ORDEN que la entrada, que es lo que hace
 * intercambiable con el `map` que sustituye. Un `push` desde las tareas Completion
 * devolveria el orden de terminacion, y en un restore de backup eso hace que el
 * resultado dependa de que transaccioniolo mas rapido.
 *
 * Un fallo NO se propaga: cada elemento se resuelve a `{ ok, valor }` o
 * `{ ok: false, error }`, imitando a `Promise.allSettled`. La alternativa —propagar
 * y que el caller lo selectively ignore— obliga a cada caller a writing el mismo
 * `try/catch` en un `map`, que es como se cuelan los rechazos silenciosos.
 *
 * @template T, R
 * @param {T[]} elementos
 * @param {(elemento: T, indice: number) => Promise<R>} operacion
 * @param {number} [limite]
 * @returns {Promise<Array<{ok: true, valor: R} | {ok: false, error: unknown}>>}
 */
export const mapConLimite = async (elementos, operacion, limite = LIMITE_POR_DEFECTO) => {
  const total = elementos.length;
  const resultados = new Array(total);
  if (total === 0) return resultados;

  // Un limite de 1 o menor es serie, y serie con este bucle es correcto: se pierde
  // paralelismo, que es justo lo que se pidio, pero no se pierde correctitud.
  const ancho = Math.max(1, Math.min(Math.floor(limite) || LIMITE_POR_DEFECTO, total));

  let siguiente = 0;

  const consumidor = async () => {
    while (true) {
      const indice = siguiente++;
      if (indice >= total) return;
      try {
        resultados[indice] = { ok: true, valor: await operacion(elementos[indice], indice) };
      } catch (error) {
        resultados[indice] = { ok: false, error };
      }
    }
  };

  await Promise.all(Array.from({ length: ancho }, consumidor));
  return resultados;
};

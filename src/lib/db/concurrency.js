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
 *
 * ## Por que una puerta y no un limite
 *
 * El limite tiene que ser del PROCESO, no de la llamada. `defaultApps` lanza las apps
 * en paralelo, de modo que un limite de 4 por bucle es un tope real de 8, y con 5 apps
 * de 20 —el `pool.max` de la plataforma—, que es donde el limite deja de existir. El
 * pool es de la plataforma; el limite tiene que ser de la plataforma. De ahi que la
 * forma sea una puerta de paso compartida (`crearCierraDePaso`) y no un parametro.
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

  // Estricto a proposito, y sin `normalizarLimite`: aqui el valor lo escribio una
  // persona en un `.env`, y un `3.5` que se trunca a 3 en silencio es una
  // configuracion que no es la que creia tener. Acordarse de la regla es mas barato
  // que averiguar por que la concurrencia es la que es.
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
 * Un limite entero >= 1, nunca menos.
 *
 * Un valor que no vale no se corrige a 1, se corrige al de por defecto. La diferencia
 * importa: en una puerta de paso, 0 huecos no es "poco paralelismo", es un bloqueo
 * eterno —nadie entra y las esperas se quedan colgadas para siempre, sin un solo
 * error—; y en serie, que es lo que 1 significaria, el arranque funciona pero cambia
 * de comportamiento sin que nadie lo pidiera. El valor por defecto es lo que se
 * obtiene sin configurar nada, asi que es lo menos sorprendente.
 *
 * Aqui si se trunca un decimal, porque el que llama es codigo y no un `.env`: un
 * limite de 3.7 en un argumento de funcion es 3.
 *
 * @param {unknown} limite
 * @param {number} [porDefecto]
 * @returns {number}
 */
export const normalizarLimite = (limite, porDefecto = LIMITE_POR_DEFECTO) => {
  const entero = Math.floor(Number(limite));
  if (!Number.isInteger(entero) || entero < 1) return porDefecto;
  return entero;
};

/**
 * Puerta de paso: como mucho `limite` operaciones a la vez EN TODO EL PROCESO.
 *
 * ## Por que no basta con un limite por llamada
 *
 * Un limite como parametro acota una llamada, y el arranque no es una llamada.
 * `defaultApps` lanza las apps en paralelo (`src/lib/db/app.js`), asi que un limite de
 * 4 por app es un limite de `4 x numero de apps`: con las 2 apps por defecto el tope
 * real era 8, con 5 seria 20 —el `pool.max` de la plataforma— y con 6 lo superaria.
 * Medido: pico de 8 sentencias en vuelo sobre `ofapi_endpoint`, que es exactamente
 * 4 x 2. Esa fue la primera version del arreglo, y no acotaba el arranque.
 *
 * El pool es de la plataforma, luego el limite tiene que ser de la plataforma.
 *
 * ## Lo que NO puede hacer
 *
 * La puerta no puede envolver una operacion que a su vez pida la puerta: se quedaria
 * esperando un hueco que ella misma esta ocupando, y eso no se manifestaria como un
 * error sino como un arranque que se queda parado. Ninguna de las operaciones que la
 * usan hace eso, y por eso no hay deteccion: esta nota es la deteccion.
 *
 * @param {number} [limite]
 * @returns {{ ejecutar: <T>(op: () => Promise<T>) => Promise<T>, limite: number, libres: number, esperando: number }}
 */
export const crearCierraDePaso = (limite = LIMITE_POR_DEFECTO) => {
  const ancho = normalizarLimite(limite);
  let libres = ancho;
  const cola = [];

  const adquirir = () => {
    if (libres > 0) {
      libres--;
      return Promise.resolve();
    }
    return new Promise((resolve) => cola.push(resolve));
  };

  /**
   * Cede el hueco al primero que este esperando, o lo devuelve si no hay nadie. Ceder
   * en vez de devolver es lo que mantiene la invariante: si se hiciera `libres++` y
   * luego se resolviera a uno de la cola, habria un hueco de mas y el limite seria una
   * sugerencia.
   */
  const liberar = () => {
    const siguiente = cola.shift();
    if (siguiente) siguiente();
    else libres++;
  };

  return {
    ejecutar: async (op) => {
      await adquirir();
      try {
        // `await` y no un return directo: una operacion que devuelve un valor sin
        // promesa tambien tiene que devolver su hueco.
        return await op();
      } finally {
        liberar();
      }
    },
    get limite() {
      return ancho;
    },
    get libres() {
      return libres;
    },
    get esperando() {
      return cola.length;
    },
  };
};

/**
 * Aplica `operacion` a cada elemento, con todas las llamadas pasando por `cierre`.
 *
 * ## Por que no hay ventana local
 *
 * La puerta es el unico limite. Una ventana local MAS la puerta serian el mismo limite
 * contado dos veces, y con dos limites que no se conocen entre si el resultado es el
 * mas pequeño de los dos sin que nadie lo haya pedido.
 *
 * Sin ventana, los `await` de la puerta se encolan todos de golpe —209 promesas para
 * las apps por defecto—, y eso es lo correcto: el trabajo que NO es de base de datos
 * (validar codigo de endpoints, parsear backups antiguos) ocurre en paralelo y sin
 * conexion, y lo que se serializa es exactamente lo que tiene que serializarse.
 *
 * ## El orden de salida
 *
 * El resultado vuelve en el orden de la entrada, no en el de terminacion, porque un
 * restore cuyo resultado dependa de que transaccionase mas rapido no es un restore
 * reproducible.
 *
 * @template T, R
 * @param {T[]} elementos
 * @param {(elemento: T, indice: number) => Promise<R>} operacion
 * @param {{ ejecutar: (op: () => Promise<any>) => Promise<any> }} cierre
 * @returns {Promise<Array<{ok: true, valor: R} | {ok: false, error: unknown}>>}
 */
export const mapConCierre = async (elementos, operacion, cierre) => {
  return Promise.all(
    elementos.map(async (elemento, indice) => {
      try {
        return { ok: true, valor: await cierre.ejecutar(() => operacion(elemento, indice)) };
      } catch (error) {
        return { ok: false, error };
      }
    }),
  );
};

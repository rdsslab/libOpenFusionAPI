/**
 * Reintento ante errores de bloqueo de la base de datos.
 *
 * ## Que pasa y por que hace falta
 *
 * El `upsert` del dialecto mssql de Sequelize escribe `MERGE INTO ... WITH(HOLDLOCK)`
 * (`node_modules/sequelize/lib/dialects/mssql/query-generator.js`), con el
 * `WITH(HOLDLOCK)` fijo: es codigo de Sequelize, no de este proyecto, y no hay forma
 * de quitarlo desde aqui. `HOLDLOCK` es un SERIALIZABLE disfrazado: la sentencia se
 * lleva un rango de bloqueos que dura hasta que acaba la transaccion.
 *
 * Con eso, N de esas sentencias simultaneas se bloquean entre si en grafos que SQL
 * Server resuelve eligiendo una victima, a la que devuelve 1205. Medido en un
 * arranque real de la plataforma en MSSQL, con `restoreAppFromBackup` lanzando los
 * upserts en paralelo: 30 faltas 1205 de 100 sentencias, 16 operaciones fallidas en
 * silencio —5 backups de endpoint perdidos y 6 endpoints sin restaurar, porque el 1205
 * tambien mato el `findAll` que va antes del `upsert`— y el arranque seguia
 * imprimiendo
 * "Database created or updated successfully with alter: true".
 *
 * La victima de un deadlock SIEMPRE se puede reintentar: su transaccion ya se ha
 * abortado, no tiene nada que deshacer, y la razon por la que perdio —la otra
 * transaccion queria un lock que ella tenia— ya no existe cuando la otra sigue. El
 * backoff es pequeno y con jitter porque el grafo que se rompio se reconstruye solo en
 * cuanto la otra transaccion llega al COMMIT, y porque reintentar las N victimas a la
 * vez reconstruye el mismo grafo.
 *
 * ## Lo que NO se reintenta, y por que importa mas
 *
 * - 2601 / 2627 (clave duplicada) y 23505 en PG: reintentar la misma sentencia da el
 *   mismo error. Quien debe tolerarlos es quien llama, y ya lo hacen los dos
 *   call sites que pueden: `endpoint_backup.js` y `bot_backup.js`.
 * - `ETIMEOUT` de tedious ("Request failed to complete in 15000ms"): no es un error de
 *   bloqueo. Puede ser una consulta lenta de verdad, y reintentarla multiplica el
 *   coste por el numero de intentos. Es ademas el error por el que sale una espera
 *   larga por un lock que no llega a convertirse en 1204, porque el `LOCK_TIMEOUT` de
 *   la sesion no esta puesto y el limite que manda es el `requestTimeout` de tedious,
 *   15 s por defecto. Ver `deadlock_1205.md` en el informe.
 * - **Nada dentro de una transaccion explicita.** 1205 aborta la transaccion victima
 *   ENTERA y 1204 aborta la sentencia; volver a lanzar la sentencia sobre la misma
 *   transaccion falla por un motivo mas raro que el original, y en el caso de 1204
 *   puede repetir un efecto a medio aplicar. Un deadlock entre transacciones no se
 *   arregla reintentando: se arregla ordenando las transacciones. Por eso aqui se
 *   comprueba `options.transaction` y se propaga.
 *
 * ## Donde se engancha
 *
 * En `Sequelize#query`, y ese es el punto clave: TODA la SQL que emite Sequelize pasa
 * por ahi. `QueryInterface#select`, `insert`, `update`, `upsert`, `bulkInsert`,
 * `bulkUpdate` y el DDL de `sync` terminan todos en `this.sequelize.query(sql, opts)`
 * (`node_modules/sequelize/lib/dialects/abstract/query-interface.js`). Engancharse a
 * `Model.findAll` o a `QueryInterface.upsert` obligaria a envolver veinte modelos, y el
 * proximo modelo nuevo se quedaria fuera sin que nadie se entere.
 *
 * El reintento es seguro con las transacciones porque solo afecta a la sentencia: una
 * sentencia en autocommit ES su propia transaccion, y una sentencia DDL que ya se
 * aplico y que al reintentar falla con "ya existe" esta diciendo la verdad.
 */

/** 1205 victima de un deadlock; 1204 se agoto el tiempo maximo de espera de un lock. */
const NUMEROS_MSSQL = new Set([1205, 1204]);

/**
 * SQLSTATE de PostgreSQL. Los tres son "esta sentencia no se pudo hacer ahora, sin
 * cambios en lo que hace", que es justo la condicion para reintentarla: 40001
 * `serialization_failure`, 40P01 `deadlock_detected`, 55P03 `lock_not_available`.
 *
 * Del trio, solo 40P01 tiene un equivalente en MSSQL; los otros dos se anaden por el
 * mismo motivo que hace util el 1205 aqui: la plataforma corre en los dos motores y un
 * error de bloqueo no deberia depender de en cual este.
 */
const SQLSTATES_PG = new Set(["40001", "40P01", "55P03"]);

/**
 * Extrae los identificadores de error de una cadena de envoltorios.
 *
 * Sequelize envuelve el error del driver y deja el original en `.original` y/o
 * `.parent`, que en MSSQL suelen ser el MISMO objeto. Un recorrido sin conjunto de
 * vistos se cuelga en cuanto un error se referencia a si mismo, y colgar aqui
 * significa que el proceso no arranca. El tope de profundidad es una segunda red.
 *
 * @param {unknown} error
 * @returns {Set<string|number>} numeros y codigos que aparecen en la cadena
 */
const identificadoresDeError = (error) => {
  const vistos = new Set();
  const encontrados = new Set();
  let actual = error;
  let profundidad = 0;

  while (actual && typeof actual === "object" && profundidad < 6 && !vistos.has(actual)) {
    vistos.add(actual);
    for (const campo of ["number", "errno", "code", "sqlState", "state"]) {
      const valor = actual[campo];
      // Sin normalizar `"1205"` a 1205. El numero de SQL Server llega de tedious como
      // numero y el SQLSTATE de `pg` como texto, y los dos estan ya en su conjunto: una
      // conversion de formato solo serviria para admitir un error cuyo identificador
      // llega con la forma equivocada, que es exactamente el caso que no se debe
      // reintentar.
      if (typeof valor === "number" || typeof valor === "string") {
        encontrados.add(valor);
      }
    }
    actual = actual.original ?? actual.parent;
    profundidad++;
  }

  return encontrados;
};

/**
 * ¿Es este error una pelea de bloqueos que se puede reintentar?
 *
 * Deliberadamente POSITIVA: solo se reintentan los codigos de la lista. Clasificar por
 * el texto del mensaje ("deadlock", "lock timeout") pareceria mas generico y
 * aceptaria cosas que no son reintentables, entre ellas el mensaje de una violacion de
 * unicidad, que ademas llega sin numero de motor al que fiarse.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
export const esErrorDeBloqueo = (error) => {
  for (const id of identificadoresDeError(error)) {
    if (typeof id === "number" ? NUMEROS_MSSQL.has(id) : SQLSTATES_PG.has(id)) {
      return true;
    }
  }
  return false;
};

/** Política por defecto. Los numeros estan medidos, no elegidos a ojo. */
export const POLITICA_POR_DEFECTO = {
  /**
   * 1 intento original + 3 reintentos. Tres porque el 1205 es transitorio por
   * definicion: la transaccion que nos mato sigue su curso y acaba en COMMIT en
   * milisegundos. Con mas intentos solo se alarga el peor caso de un deadlock que no
   * se va a resolver; con menos, un unico reintento unlucky todavia pierde.
   */
  intentos: 4,
  /** Primera espera, en ms. */
  baseMs: 25,
  /** Multiplicador por reintento. */
  factor: 2,
  /** Techo de la espera, en ms. */
  topeMs: 800,
  /**
   * Fraccion de la espera que se sortea al azar, de 0 a `topeMs`. Sin esto las
   * victimas de un mismo deadlock, que mueren casi a la vez, vuelven a la vez y
   * reconstruyen el grafo que las mato. Con tope 800 ms, un 1205 se absorbe en menos
   * de 2 s en el caso peor y en unos 50 ms en el tipico.
   */
  jitter: 1,
};

const dormirPorDefecto = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * How many times to wait before the retry, without exponential backoff exceeding `topeMs`.
 *
 * @param {number} intento 1 para el primer reintento
 * @param {object} politica
 * @returns {number} ms
 */
export const esperaDelReintento = (intento, politica) => {
  const bruto = politica.baseMs * Math.pow(politica.factor, intento - 1);
  const acotada = Math.min(bruto, politica.topeMs);
  const jitter = Math.random() * acotada * politica.jitter;
  return Math.round(Math.max(0, acotada - jitter));
};

/**
 * Ejecuta `operacion` reintentando mientras falle por un error de bloqueo.
 *
 * Un fallo que no es de bloqueo se propaga en el acto: un error de sintaxis, una
 * violacion de unicidad o una tabla que no existe no se arreglan esperando, y quien
 * llama los necesita ver enseguida.
 *
 * @template T
 * @param {() => Promise<T>} operacion
 * @param {object} [opciones] `POLITICA_POR_DEFECTO` mas `alReintentar`, `dormir` y `puedeReintentar`
 * @returns {Promise<T>}
 */
export const reintentarAnteBloqueo = async (operacion, opciones = {}) => {
  const {
    alReintentar = null,
    dormir = dormirPorDefecto,
    puedeReintentar = () => true,
    ...ajustes
  } = opciones;
  const politica = { ...POLITICA_POR_DEFECTO, ...ajustes };

  let ultimoError;
  for (let intento = 1; intento <= politica.intentos; intento++) {
    try {
      return await operacion();
    } catch (error) {
      ultimoError = error;

      const esElUltimo = intento === politica.intentos;
      if (esElUltimo || !esErrorDeBloqueo(error) || !puedeReintentar(error)) {
        throw ultimoError;
      }

      const espera = esperaDelReintento(intento, politica);
      if (alReintentar) alReintentar({ error, intento, espera, politica });
      if (espera > 0) await dormir(espera);
    }
  }

  // Solo se llega aqui si `intentos` es 0 o negativo, es decir si alguien paso una
  // politica absurda. Con la politica por defecto es codigo inalcanzable.
  throw ultimoError;
};

/**
 * Throttled log of contention. The count is cumulative and the line is not repeated
 * more than once every `ventanaMs`.
 *
 * Not rate-limited per event because there is a real, measured need for it: the
 * operator has to know there was contention, the culprit is exactly the code that is
 * being throttled, and a silent retry converts a visible error into an invisible one.
 * Rate-limited per event because the same thing happening 200 times a second, which is
 * what a user endpoint under contention does, would turn the log into the cost.
 */
const crearRegistrador = (politica, ventanaMs = 5000) => {
  let acumulado = 0;
  let ultimaLinea = 0;
  const codigos = new Map();

  return {
    registrar({ error, intento, espera }) {
      acumulado++;
      const id = [...identificadoresDeError(error)]
        .map((c) => String(c))
        .find((c) => NUMEROS_MSSQL.has(Number(c)) || SQLSTATES_PG.has(c)) ?? "?";
      codigos.set(id, (codigos.get(id) ?? 0) + 1);

      const ahora = Date.now();
      if (ahora - ultimaLinea < ventanaMs) return;
      ultimaLinea = ahora;

      console.warn(
        `[db:lock] ${acumulado} reintento(s) por bloqueo en lo que va de ${ventanaMs} ms ` +
          `(${[...codigos].map(([c, n]) => `${c}:${n}`).join(", ")}). ` +
          `Ultimo: intento ${intento}, esperando ${espera} ms. ` +
          `Si esto sube mucho, la causa casi nunca es el motor: es codigo que abre ` +
          `demasiadas transacciones a la vez contra las mismas filas.`,
      );
    },
    get total() {
      return acumulado;
    },
  };
};

/**
 * Envuelve `Sequelize#query` con el reintento. Ver el comentario de la cabecera para
 * por que ese metodo y no otro.
 *
 * Es idempotente: llamarlo dos veces sobre la misma instancia no envuelve dos veces,
 * que es lo que pasaria si `sequelize.js` lo hiciera y otro modulo tambien.
 *
 * @param {{ query: Function }} sequelize
 * @param {object} [opciones] campos de `POLITICA_POR_DEFECTO`, mas `alRegistrar` y
 *   `ventanaMs` para el log de contencion
 * @returns {{ reintentos: number, enSentencia: string[] }} estado para inspeccionar
 */
export const adjuntarReintentoAnteBloqueo = (sequelize, opciones = {}) => {
  if (sequelize.__reintentoBloqueoPuesto) return sequelize.__reintentoBloqueoPuesto;

  const { alReintentar, puedeReintentar, alRegistrar, ventanaMs, ...politica } = opciones;
  const estado = { reintentos: 0, enSentencia: [] };
  const registrar = alRegistrar ? { registrar: alRegistrar, get total() { return estado.reintentos; } } : crearRegistrador(politica, ventanaMs);
  const queryOriginal = sequelize.query.bind(sequelize);

  sequelize.query = async (sql, opcionesQuery) => {
    // Dentro de una transaccion explicita no se reintenta. Ver la cabecera.
    const enTransaccion = Boolean(opcionesQuery?.transaction);

    return reintentarAnteBloqueo(() => queryOriginal(sql, opcionesQuery), {
      ...politica,
      puedeReintentar: puedeReintentar ?? (() => !enTransaccion),
      alReintentar:
        alReintentar ??
        ((info) => {
          estado.reintentos++;
          // Solo la forma de la sentencia y sin los valores: esto acaba en el log del
          // proceso, y un `WHERE id = '...'` de un endpoint traeria el dato.
          estado.enSentencia.push(String(sql).replace(/\s+/g, " ").slice(0, 160));
          registrar.registrar(info);
        }),
    });
  };

  sequelize.__reintentoBloqueoPuesto = estado;
  return estado;
};

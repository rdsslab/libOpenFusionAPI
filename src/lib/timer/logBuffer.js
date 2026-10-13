// LogBuffer.js
// Clase optimizada para acumular logs en memoria y hacer bulk insert cada 30s.
// - 1 solo timer (debounce): se programa cuando llega el primer log.
// - Swap de buffers para minimizar copias y permitir que push() siga aceptando logs mientras se inserta.
// - Evita re-insert: si el bulk insert fue OK, el buffer "flushed" se descarta y NO vuelve a entrar.
// - Si falla el insert por un error transitorio (conexión caída), re-encola SOLO lo que no
//   llegó a insertarse: los lotes ya confirmados no se repiten.
// - Si la base rechaza una fila por datos inválidos (filas "venenosas", p. ej. un `trace_id`
//   que no es UUID), se aísla y se descarta esa fila con un aviso, en vez de bloquear su lote
//   y todos los posteriores para siempre.

/**
 * Errores que indican que la base no está disponible AHORA (conexión, recursos,
 * timeout, deadlock): esos sí se reintentan, porque la fila puede ser válida.
 */
const CONNECTION_ERROR_NAMES = new Set([
  "SequelizeConnectionError",
  "SequelizeConnectionRefusedError",
  "SequelizeConnectionTimedOutError",
  "SequelizeHostNotReachableError",
  "SequelizeHostNotFoundError",
  "SequelizeTimeoutError",
  "SequelizeConnectionAcquireTimeoutError",
]);

const CONNECTION_ERROR_CODES = new Set([
  // Node / drivers SQL
  "ECONNREFUSED",
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
  "PROTOCOL_CONNECTION_LOST",
  "ER_CON_COUNT_ERROR",
  // SQLite en uso/bloqueado
  "SQLITE_BUSY",
  "SQLITE_LOCKED",
]);

/**
 * Códigos de SQL Server que indican indisponibilidad, deadlock o timeout, no
 * datos inválidos.
 */
const SQLSERVER_TRANSIENT_NUMBERS = new Set([
  1205, // deadlock victim
  -2, // timeout
  40197, 40501, 40613, // errores de servicio de Azure SQL
  49918, 49919, 49920, // límite de operaciones
]);

export class LogBuffer {
  /**
   * @param {{
   *   flushFn: (logs: any[]) => Promise<any>,
   *   flushIntervalMs?: number,
   *   maxBatchSize?: number,
   *   maxBufferSize?: number,
   *   onErrorRetryDelayMs?: number,
   * }} params
   */
  constructor({
    flushFn,
    flushIntervalMs = 30000,
    maxBatchSize = 10000,
    maxBufferSize = 200000,
    onErrorRetryDelayMs = 5000,
  }) {
    if (typeof flushFn !== "function") {
      throw new Error("LogBuffer: flushFn es requerido y debe ser función async.");
    }

    this._flushFn = flushFn;
    this._flushIntervalMs = flushIntervalMs;
    this._maxBatchSize = maxBatchSize;
    this._maxBufferSize = maxBufferSize;
    this._onErrorRetryDelayMs = onErrorRetryDelayMs;

    /** @type {any[]} */
    this._buffer = [];
    this._timer = null;
    this._flushing = false;
    this._stopped = false;
    /** Fallos transitorios seguidos; habilita el recorte por límite de memoria. */
    this._consecutiveFailures = 0;
  }

  /**
   * Inserta un log en memoria.
   * @param {any} log
   */
  push(log) {
    if (this._stopped) return;

    this._buffer.push(log);
    this._enforceBufferLimit();

    // Protección básica para no crecer indefinidamente:
    // si alcanzas un tamaño grande, fuerza flush inmediato.
    if (this._buffer.length >= this._maxBufferSize) {
      // fire-and-forget (pero controlado internamente)
      void this.flush().catch((err) => this._logFlushError(err));
      return;
    }

    // Programa flush 30s después del primer push (debounce)
    this._scheduleFlush(this._flushIntervalMs);
  }

  /**
   * Inserta muchos logs en memoria (más eficiente que llamar push muchas veces).
   * @param {any[]} logs
   */
  pushMany(logs) {
    if (this._stopped) return;
    if (!Array.isArray(logs) || logs.length === 0) return;

    // Evita spread por límites/stack con arrays grandes
    for (let i = 0; i < logs.length; i++) this._buffer.push(logs[i]);

    this._enforceBufferLimit();

    if (this._buffer.length >= this._maxBufferSize) {
      void this.flush().catch((err) => this._logFlushError(err));
      return;
    }

    this._scheduleFlush(this._flushIntervalMs);
  }

  /**
   * Fuerza el flush inmediato (si no hay flush en progreso).
   *
   * Nunca lanza: los errores transitorios se reportan por consola y lo pendiente
   * queda en el buffer para el reintento. Las filas rechazadas por datos se
   * descartan con un aviso, para no bloquear el resto del buffer.
   */
  async flush() {
    if (this._stopped) return { success: true, inserted: 0, skipped: true };
    if (this._flushing) return { success: true, inserted: 0, skipped: true };
    if (this._buffer.length === 0) return { success: true, inserted: 0 };

    this._flushing = true;
    this._clearTimer();

    // Swap de buffers: lo que se va a insertar queda en "toFlush"
    const toFlush = this._buffer;
    this._buffer = [];

    let insertedTotal = 0;
    let discardedTotal = 0;
    /** Logs que NO se insertaron y deben reintentarse, en orden temporal. */
    let retryRows = [];
    let transientError = null;

    try {
      // Si viene demasiado grande, parte en lotes para no reventar memoria/tiempos
      for (let i = 0; i < toFlush.length; i += this._maxBatchSize) {
        const chunk = toFlush.slice(i, i + this._maxBatchSize);
        const res = await this._insertWithIsolation(chunk);

        insertedTotal += res.inserted;
        discardedTotal += res.discarded;

        if (res.transient) {
          // La base no está disponible: no tiene sentido seguir ni descartar.
          // Se reencola SOLO lo no insertado: lo ya confirmado no se repite.
          transientError = res.error ?? transientError;
          retryRows = res.retry.slice();
          for (let j = i + chunk.length; j < toFlush.length; j++) {
            retryRows.push(toFlush[j]);
          }
          break;
        }
      }
    } finally {
      // Importante: liberamos referencia para GC
      toFlush.length = 0;
      this._flushing = false;
    }

    if (retryRows.length > 0) {
      // Lo pendiente va DELANTE de los logs que llegaron durante el flush para
      // conservar el orden temporal (antes se hacía push y quedaba detrás).
      this._buffer = retryRows.concat(this._buffer);
      retryRows = [];

      this._consecutiveFailures += 1;
      this._enforceBufferLimit();

      // Reintento con delay corto
      this._scheduleFlush(this._onErrorRetryDelayMs);

      if (transientError) this._logFlushError(transientError);

      return {
        success: false,
        inserted: insertedTotal,
        discarded: discardedTotal,
        buffered: this._buffer.length,
        timestamp: new Date(),
      };
    }

    // Flush drenado: no queda nada pendiente.
    this._consecutiveFailures = 0;

    // Si durante el flush llegaron nuevos logs, reprograma
    if (this._buffer.length > 0) {
      this._scheduleFlush(this._flushIntervalMs);
    }

    return {
      success: true,
      inserted: insertedTotal,
      ...(discardedTotal > 0 ? { discarded: discardedTotal } : {}),
      timestamp: new Date(),
    };
  }

  /**
   * Inserta un lote aislando las filas que la base rechaza por datos inválidos.
   *
   * - Error transitorio (conexión): devuelve el lote entero para reintento.
   * - Lote con una fila inválida: biseca hasta localizarla, inserta el resto en
   *   sub-lotes normales y descarta solo la fila mala.
   *
   * @param {any[]} rows
   * @returns {Promise<{inserted: number, retry: any[], discarded: number, transient: boolean, error?: any}>}
   */
  async _insertWithIsolation(rows) {
    if (rows.length === 0) {
      return { inserted: 0, retry: [], discarded: 0, transient: false };
    }

    try {
      const r = await this._flushFn(rows);
      return {
        inserted: r?.inserted ?? rows.length,
        retry: [],
        discarded: 0,
        transient: false,
      };
    } catch (err) {
      if (this._isTransientError(err)) {
        return { inserted: 0, retry: rows, discarded: 0, transient: true, error: err };
      }

      if (rows.length === 1) {
        // Fila "venenosa": la base la rechaza por datos y la rechazará siempre.
        // Se descarta con aviso; de lo contrario su lote y todos los posteriores
        // quedarían bloqueados para siempre.
        this._logDiscardedRow(rows[0], err);
        return { inserted: 0, retry: [], discarded: 1, transient: false };
      }

      // Error de datos dentro de un lote: bisecar para localizar la(s) fila(s)
      // mala(s) e insertar el resto en sub-lotes normales.
      const mid = Math.ceil(rows.length / 2);
      const left = await this._insertWithIsolation(rows.slice(0, mid));
      const right = await this._insertWithIsolation(rows.slice(mid));

      return {
        inserted: left.inserted + right.inserted,
        retry: left.retry.concat(right.retry),
        discarded: left.discarded + right.discarded,
        transient: left.transient || right.transient,
        error: left.error ?? right.error,
      };
    }
  }

  /**
   * Decide si un error es transitorio (reintentar) o de datos (descartar la fila).
   * Todo lo que no se reconozca como transitorio se trata como error de datos: el
   * fallo observado en producción era justo el contrario, una fila inválida que se
   * reintentaba para siempre y bloqueaba el resto del buffer.
   * @param {any} err
   * @returns {boolean}
   */
  _isTransientError(err) {
    const queue = [err];
    const seen = new Set();

    while (queue.length > 0) {
      const e = queue.shift();
      if (!e || typeof e !== "object" || seen.has(e)) continue;
      seen.add(e);

      if (e.name && CONNECTION_ERROR_NAMES.has(e.name)) return true;

      const code = e.code ?? e.errno;
      if (typeof code === "string" && CONNECTION_ERROR_CODES.has(code)) return true;

      // SQLSTATE de PostgreSQL: clase 08 (conexión), 53 (recursos), 57/58 (operador/sistema)
      const sqlState = e.sqlState ?? e.parent?.sqlState;
      if (typeof sqlState === "string" && /^(08|53|57|58)/.test(sqlState)) return true;

      const number = Number(e.number ?? e.parent?.number);
      if (SQLSERVER_TRANSIENT_NUMBERS.has(number)) return true;

      if (e.parent) queue.push(e.parent);
      if (e.original) queue.push(e.original);
      if (e.cause) queue.push(e.cause);
    }

    return false;
  }

  /**
   * Acota la memoria cuando el flush falla de forma sostenida. En marcha normal el
   * buffer no supera `maxBufferSize`; si los flush fallan (base caída), el buffer
   * crecería sin fin, así que se descartan los logs más antiguos con un aviso.
   */
  _enforceBufferLimit() {
    if (this._consecutiveFailures <= 0) return;

    const overflow = this._buffer.length - this._maxBufferSize;
    if (overflow <= 0) return;

    this._buffer.splice(0, overflow);

    console.warn(
      "[LogBuffer] El buffer supera el límite y los flush siguen fallando; se descartan los logs más antiguos para acotar memoria.",
      {
        timestamp: new Date().toISOString(),
        discarded: overflow,
        remaining: this._buffer.length,
        maxBufferSize: this._maxBufferSize,
        consecutiveFailures: this._consecutiveFailures,
      }
    );
  }

  /**
   * Detiene el buffer. Opcionalmente hace flush final.
   * @param {{ flush?: boolean }} opts
   */
  async stop({ flush = true } = {}) {
    this._clearTimer();

    if (flush && !this._flushing && this._buffer.length > 0) {
      // El flush final va ANTES de marcar `_stopped`: `flush()` ignora la llamada
      // cuando `_stopped` es true, así que marcarlo primero (como antes) descartaba
      // en silencio todo lo que quedaba en memoria.
      const result = await this.flush();

      if (result?.success === false && this._buffer.length > 0) {
        const pendientes = this._buffer.length;
        this._buffer.length = 0;
        console.warn(
          "[LogBuffer] stop({ flush: true }): quedaron logs sin insertar tras el flush final y se descartan.",
          { timestamp: new Date().toISOString(), discarded: pendientes }
        );
      }
    }

    this._stopped = true;
    this._clearTimer();

    if (!flush) {
      // descarta memoria
      this._buffer.length = 0;
    }
  }

  _scheduleFlush(ms) {
    if (this._timer) return; // ya está programado
    this._timer = setTimeout(() => {
      this._timer = null;
      // fire-and-forget controlado: nunca dejar la promesa sin manejar,
      // pues un rechazo aquí escala a un crash fatal del proceso (unhandled rejection
      // dentro del callback nativo de sqlite3).
      void this.flush().catch((err) => this._logFlushError(err));
    }, ms);

    // No mantener vivo el proceso Node solo por el timer (ahorro recursos)
    if (typeof this._timer.unref === "function") this._timer.unref();
  }

  _clearTimer() {
    if (!this._timer) return;
    clearTimeout(this._timer);
    this._timer = null;
  }

  /**
   * Registra en consola el error de un flush fallido, con evidencia suficiente
   * para diagnosticar (mensaje original de la BD, cantidad de logs re-encolados, etc.)
   * sin volver a lanzar la excepción.
   * @param {any} err
   */
  _logFlushError(err) {
    console.error(
      "[LogBuffer] Fallo al hacer flush de logs. Se re-encolaron en memoria para reintentar.",
      {
        timestamp: new Date().toISOString(),
        bufferedForRetry: this._buffer.length,
        message: err?.message,
        original: err?.original?.message ?? err?.parent?.message,
        name: err?.name,
        stack: err?.stack,
      }
    );
  }

  /**
   * Avisa de una fila descartada por la base, con una muestra acotada de la fila
   * para poder identificar el campo problemático sin volcar objetos gigantes.
   * @param {any} row
   * @param {any} err
   */
  _logDiscardedRow(row, err) {
    let sample;
    try {
      sample = JSON.stringify(row);
    } catch {
      sample = String(row);
    }
    if (typeof sample === "string" && sample.length > 2000) {
      sample = sample.slice(0, 2000) + "...[TRUNCATED]";
    }

    console.error(
      "[LogBuffer] Una fila de log fue rechazada por la base de datos y se descarta para no bloquear el resto.",
      {
        timestamp: new Date().toISOString(),
        message: err?.message,
        original: err?.original?.message ?? err?.parent?.message,
        name: err?.name,
        code: err?.code ?? err?.original?.code ?? err?.parent?.code,
        row: sample,
      }
    );
  }
}

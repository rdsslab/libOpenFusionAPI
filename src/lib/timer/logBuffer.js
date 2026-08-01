import { createLog, createLogEntriesBulk } from "../db/log.js";

// LogBuffer.js
// Clase optimizada para acumular logs en memoria y hacer bulk insert cada 30s.
// - 1 solo timer (debounce): se programa cuando llega el primer log.
// - Swap de buffers para minimizar copias y permitir que push() siga aceptando logs mientras se inserta.
// - Evita re-insert: si el bulk insert fue OK, el buffer “flushed” se descarta.
// - Si falla el insert, re-encola los logs en memoria (sin perderlos).

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
  }

  /**
   * Inserta un log en memoria.
   * @param {any} log
   */
  push(log) {
    if (this._stopped) return;

    this._buffer.push(log);

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

    if (this._buffer.length >= this._maxBufferSize) {
      void this.flush().catch((err) => this._logFlushError(err));
      return;
    }

    this._scheduleFlush(this._flushIntervalMs);
  }

  /**
   * Fuerza el flush inmediato (si no hay flush en progreso).
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

    try {
      let insertedTotal = 0;

      // Si viene demasiado grande, parte en lotes para no reventar memoria/tiempos
      for (let i = 0; i < toFlush.length; i += this._maxBatchSize) {
        const chunk = toFlush.slice(i, i + this._maxBatchSize);
        const r = await this._flushFn(chunk);
        // r.inserted podría no existir, pero tu función lo retorna.
        insertedTotal += r?.inserted ?? chunk.length;
      }

      // Importante: liberamos referencia para GC
      toFlush.length = 0;

      // Si durante el flush llegaron nuevos logs, reprograma
      if (this._buffer.length > 0) {
        this._scheduleFlush(this._flushIntervalMs);
      }

      return { success: true, inserted: insertedTotal, timestamp: new Date() };
    } catch (err) {
      // Si falla: re-encolamos lo pendiente para reintentar.
      // Para ahorrar recursos evitamos concatenaciones creando otro array grande.
      // OJO: el orden puede cambiar respecto a logs nuevos (normalmente aceptable en logs).
      for (let i = 0; i < toFlush.length; i++) this._buffer.push(toFlush[i]);
      toFlush.length = 0;

      // Reintento con delay corto
      this._scheduleFlush(this._onErrorRetryDelayMs);

      throw err;
    } finally {
      this._flushing = false;
    }
  }

  /**
   * Detiene el buffer. Opcionalmente hace flush final.
   * @param {{ flush?: boolean }} opts
   */
  async stop({ flush = true } = {}) {
    this._stopped = true;
    this._clearTimer();
    if (flush) {
      // intenta insertar lo que quede
      if (!this._flushing && this._buffer.length > 0) {
        await this.flush();
      }
    } else {
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
}


//import { EventEmitter } from "events";
import { Worker } from "worker_threads";
import { fileURLToPath } from "url";
import path from "path";

// Obtener la ruta absoluta del archivo actual
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function safeStringify(obj, space = 2) {
  const seen = new WeakSet();
  return JSON.stringify(
    obj,
    (key, value) => {
      if (typeof value === "object" && value !== null) {
        if (seen.has(value)) return; // elimina la referencia circular
        seen.add(value);
      }
      return value;
    },
    space
  );
}

/** Cuánto espera `abortRun` el ack del worker antes de rendirse. */
const ABORT_ACK_TIMEOUT_MS = 2500;

export class TasksInterval {
  constructor({
    WorkerClass = Worker,
    restartDelayMs = 5000,
    workerPath = path.resolve(__dirname, "./worker.js"),
  } = {}) {
    //  super();
    //  this.interval = 5000; // Time Interval in milliseconds

    this.WorkerClass = WorkerClass;
    this.restartDelayMs = restartDelayMs;
    this.workerPath = workerPath;
    this.worker = null;
    this.restartTimer = null;
    this.stopping = false;

    /**
     * Callback para los eventos que el worker publica sobre las tareas programadas.
     * Lo inyecta el servidor para reenviarlos por websocket.
     * @type {(payload: any) => void}
     */
    this.onIntervalTaskEvent = null;

    /**
     * Promesas de `abortRun` a la espera del ack del worker.
     * @type {Map<string, {resolve: Function, timer: NodeJS.Timeout}>}
     */
    this.pendingAborts = new Map();
  }

  /**
   * Pide al worker que aborte la corrida en vuelo de una tarea.
   *
   * Resuelve con `{stopped, reason}`: el worker solo dice `stopped: true` cuando tenía
   * una corrida pendiente que abortar de verdad. El ack se espera con tope para que una
   * llamada no cuelgue si el worker está cerrando: pasado el tope se responde
   * `NO_ACK`, que es un falso conservador (no se promete un aborto que no se confirmó).
   *
   * @param {string} idtask
   * @returns {Promise<{stopped: boolean, reason?: string}>}
   */
  abortRun(idtask) {
    const key = String(idtask);
    if (!this.worker) {
      return Promise.resolve({ stopped: false, reason: "WORKER_UNAVAILABLE" });
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingAborts.delete(key);
        resolve({ stopped: false, reason: "NO_ACK" });
      }, ABORT_ACK_TIMEOUT_MS);

      this.pendingAborts.set(key, { resolve, timer });
      this.worker.postMessage(safeStringify({ action: "abortRun", idtask: key }));
    });
  }

  pushLog(log) {
    this.postMessage({ action: "pushLog", data: log });
  }

  wake() {
    this.postMessage({ action: "wake" });
  }

  postMessage(data) {
    if (this.worker) {
      this.worker.postMessage(safeStringify(data));
    } else {
      console.warn("TasksInterval: Worker not initialized, message skipped.");
    }
  }

  run() {
    if (this.worker) return this.worker;

    this.stopping = false;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    console.log("workerPath", this.workerPath);
    const worker = new this.WorkerClass(this.workerPath);
    this.worker = worker;

    // Recibir mensajes del worker
    worker.on("message", (msg) => {
      try {
        const data = typeof msg === "string" ? JSON.parse(msg) : msg;

        if (data?.action === "intervalTaskEvent") {
          if (typeof this.onIntervalTaskEvent === "function") {
            this.onIntervalTaskEvent(data.data);
          }
          return;
        }

        if (data?.action === "abortRunResult") {
          const pending = this.pendingAborts.get(String(data.idtask));
          if (pending) {
            clearTimeout(pending.timer);
            this.pendingAborts.delete(String(data.idtask));
            pending.resolve({
              stopped: data.stopped === true,
              reason: data.reason || null,
            });
          }
          return;
        }

        console.log("Mensaje recibido del worker:", msg);
      } catch (error) {
        console.log("Mensaje recibido del worker:", msg);
      }
    });

    // Enviar mensaje al worker
    //this.worker.postMessage("¡Hola worker, desde el hilo principal!");

    worker.on("error", (err) => {
      console.error("Error en el worker:", err);
    });

    worker.on("exit", (code) => {
      if (this.worker !== worker) return;
      this.worker = null;

      // Un worker caído no va a confirmar abortos pendientes: se resuelven con falso
      // conservador en vez de dejar colgada la llamada hasta el timeout.
      this._flushPendingAborts("WORKER_UNAVAILABLE");

      if (this.stopping) return;

      console.warn(
        `${Date.now().toString()} - El worker finalizó con código ${code}. Reiniciando...`,
      );
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null;
        this.run();
      }, this.restartDelayMs);
    });

    return worker;
  }

  async stop() {
    this.stopping = true;

    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    const worker = this.worker;
    if (!worker) return;

    const exited = new Promise((resolve) => worker.once("exit", resolve));
    worker.postMessage(safeStringify({ action: "shutdown" }));

    const forceTimer = setTimeout(() => {
      worker.terminate().catch(() => {});
    }, 5000);
    await exited;
    clearTimeout(forceTimer);
    if (this.worker === worker) this.worker = null;
  }

  /**
   * Resuelve todos los `abortRun` pendientes con un falso conservador. Se llama cuando
   * el worker se cae o se apaga, porque entonces no hay quien emita el ack.
   * @private
   * @param {string} reason
   */
  _flushPendingAborts(reason) {
    for (const [key, pending] of this.pendingAborts) {
      clearTimeout(pending.timer);
      pending.resolve({ stopped: false, reason });
    }
    this.pendingAborts.clear();
  }
}

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
}

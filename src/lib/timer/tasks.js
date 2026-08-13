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
  constructor() {
    //  super();
    //  this.interval = 5000; // Time Interval in milliseconds

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

  postMessage(data) {
    if (this.worker) {
      this.worker.postMessage(safeStringify(data));
    } else {
      console.warn("TasksInterval: Worker not initialized, message skipped.");
    }
  }

  run() {
    // Crea un nuevo hilo ejecutando el worker
    const workerPath = path.resolve(__dirname, "./worker.js");
    console.log("workerPath", workerPath);
    this.worker = new Worker(workerPath);

    // Recibir mensajes del worker
    this.worker.on("message", (msg) => {
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

    this.worker.on("error", (err) => {
      console.error("Error en el worker:", err);
    });

    this.worker.on("exit", (code) => {
      console.warn(`${Date.now().toString()} - El worker finalizó con código ${code}. Reiniciando...`);
      setTimeout(() => this.run(), 5000); // Esperar 1 segundo antes de reiniciar
    });

    return this.worker;
  }
}

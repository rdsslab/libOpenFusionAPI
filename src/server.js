import server from "./lib/index.js";

const OFAPIServer = new server();

// Apagado ordenado.
//
// Sin esto, SIGINT/SIGTERM matan el proceso sin cerrar Fastify, así que su hook
// `onClose` nunca corre y `TasksInterval.stop()` no se ejecuta: el worker del
// planificador no recibe "shutdown" y `logBuffer.stop({ flush: true })` no llega a
// volcar. Todos los logs que aún están en memoria (hasta 10 s de tráfico) se pierden
// en cada reinicio. Cerrar Fastify primero garantiza que el flush final se complete.
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] ${signal} recibido: cerrando de forma ordenada...`);

  // Tope de seguridad: si el cierre se atasca (p. ej. conexiones keep-alive colgadas)
  // se fuerza la salida en lugar de quedar vivo indefinidamente.
  const forceTimer = setTimeout(() => {
    console.error(
      "[server] el cierre ordenado no terminó a tiempo; saliendo de todos modos."
    );
    process.exit(1);
  }, 10000);
  forceTimer.unref?.();

  try {
    await OFAPIServer.fastify.close();
    clearTimeout(forceTimer);
    console.log("[server] cerrado de forma ordenada.");
    process.exit(0);
  } catch (err) {
    clearTimeout(forceTimer);
    console.error("[server] error al cerrar:", err);
    process.exit(1);
  }
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

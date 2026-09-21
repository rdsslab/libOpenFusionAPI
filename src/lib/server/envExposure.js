// Exposición de entornos por instancia, vía EXPOSE_DEV_API / EXPOSE_QA_API / EXPOSE_PROD_API.
//
// Topología multi-servidor que comparte una misma base de datos (ej. producción + un
// servidor de pruebas): cada instancia solo debe ejecutar/exponer los entornos que el
// operador le habilita con estas variables. Reglas:
//   - Si NINGUNA variable EXPOSE_*_API está seteada => todos los entornos quedan expuestos
//     (comportamiento por defecto, compatible con despliegues de una sola instancia).
//   - Si al menos una está seteada => solo los entornos con valor "true" se exponen.
//   - La app "system" siempre está expuesta (endpoints + MCP + websocket): es la única
//     superficie que los agentes de IA y el dashboard usan para administrar la plataforma,
//     con independencia de la instancia a la que se conecten. Sus tareas y bots, en cambio,
//     sí siguen la exposición (evita doble bot y doble scheduler en servidores espejo).
const ENV_KEY_MAP = {
  dev: "EXPOSE_DEV_API",
  qa: "EXPOSE_QA_API",
  prd: "EXPOSE_PROD_API",
};

/** Entornos gestionables por EXPOSE_*_API. Los demás (entornos propios) no se gatean. */
export const MANAGED_ENVIRONMENTS = Object.keys(ENV_KEY_MAP);

function envVarTruthy(key) {
  return (process.env[key] || "").toString().toUpperCase() === "TRUE";
}

function computeExposedEnvironments() {
  // Si ninguna está seteada => todos expuestos (default histórico, compatibilidad total).
  const anyConfigured = isExposureConfigured();

  if (!anyConfigured) {
    return new Set(MANAGED_ENVIRONMENTS);
  }

  return new Set(MANAGED_ENVIRONMENTS.filter((env) => envVarTruthy(ENV_KEY_MAP[env])));
}

const exposedEnvironmentsCache = computeExposedEnvironments();

/** true si el operador seteó al menos una variable EXPOSE_*_API. */
export function isExposureConfigured() {
  return MANAGED_ENVIRONMENTS.some(
    (env) => process.env[ENV_KEY_MAP[env]] !== undefined,
  );
}

/** Set de entornos (dev/qa/prd) ejecutables en esta instancia. */
export function getExposedEnvironments() {
  return exposedEnvironmentsCache;
}

/** Lista ordenada de entornos expuestos (útil para logs y respuestas HTTP). */
export function getExposedEnvironmentsList() {
  return [...exposedEnvironmentsCache];
}

/**
 * Decide si un endpoint de la app/environment dados es ejecutable en esta instancia.
 * La app "system" siempre está expuesta. Un environment vacío/ausente no se gatea
 * (no hay forma de saber su entorno; se preserva el comportamiento actual). Los
 * entornos fuera de dev/qa/prd tampoco se gatean: no tienen variable EXPOSE_*_API
 * y bloquearlos sin forma de habilitarlos rompería despliegues con entornos propios.
 */
export function isEnvironmentExposed(environment, app = null) {
  if (String(app ?? "").toLowerCase() === "system") {
    return true;
  }

  const env = String(environment ?? "").toLowerCase();
  if (!env || !MANAGED_ENVIRONMENTS.includes(env)) {
    return true;
  }

  return exposedEnvironmentsCache.has(env);
}

/**
 * Aviso de exposición de esta instancia en markdown. Lo consumen las MCP tools
 * (`platform_instance_status`) y el log de arranque, para que agentes de IA y
 * operadores sepan qué entornos se ejecutan aquí antes de intentar pruebas.
 */
export function buildExposureNotice() {
  const anyConfigured = isExposureConfigured();
  const exposed = getExposedEnvironmentsList();
  const mode = anyConfigured
    ? "configured via EXPOSE_*_API"
    : "default (no EXPOSE_*_API variable set: all environments exposed)";

  return [
    "## Instance environment exposure (EXPOSE_*_API)",
    `- Executable environments on THIS instance: ${exposed.join(", ") || "(none)"}`,
    `- Exposure mode: ${mode}.`,
    "- Requests to a non-exposed environment respond 403 { \"error\": \"...\", \"code\": \"ENV_NOT_EXPOSED\", \"exposed_environments\": [\"...\"] }.",
    '- Exception: the "system" app endpoints and MCP tools are always available on every instance.',
    "- Interval tasks and bots of non-exposed environments do NOT run on this instance (they are skipped, not errored).",
    "- Before attempting to test an endpoint in another environment, call the tool `platform_instance_status` on the system MCP server.",
  ].join("\n");
}
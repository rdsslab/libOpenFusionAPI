// Corrige la hora que usa la app (JWT, timestamps de logs, eventos websocket) cuando el
// reloj del host/contenedor no es confiable (ej. RTC del contenedor ajustado a hora local
// pero interpretado como UTC). Desactivado por defecto: solo actúa si TIME_SYNC_ENABLED=true.
const ENABLED =
  (process.env.TIME_SYNC_ENABLED || "").toString().toUpperCase() === "TRUE";

// Offsets menores a este umbral se ignoran y se trata como si el reloj estuviera bien
// (ruido de red/latencia, no vale la pena "corregir" para una diferencia insignificante).
// Configurable porque lo que cuenta como "insignificante" depende de qué tan sensible al
// tiempo sea el consumidor (JWT, gráficas de logs, etc.) en cada despliegue.
const THRESHOLD_MS = Number(process.env.TIME_SYNC_THRESHOLD_MS) || 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 4000;

// Fuentes de hora externa a probar en orden hasta que una responda. Configurable vía
// TIME_SYNC_URLS (lista separada por comas) para no depender de un único proveedor
// quemado en el código; si no se define, se usan estas por defecto. Cualquier endpoint
// HTTPS sirve como fallback aunque no tenga el formato `ts=` de Cloudflare, porque
// fetchExternalTimeMs cae al header `Date` de la respuesta si no encuentra ese formato.
const DEFAULT_TIME_SYNC_URLS = [
  "https://www.cloudflare.com/cdn-cgi/trace",
  "https://www.google.com",
  "https://www.microsoft.com",
];

const TIME_SYNC_URLS = (process.env.TIME_SYNC_URLS || "")
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean);

const timeSourceUrls = TIME_SYNC_URLS.length > 0 ? TIME_SYNC_URLS : DEFAULT_TIME_SYNC_URLS;

let offsetMs = 0;

// Intenta obtener la hora actual desde una única fuente externa. Prioriza el formato
// `ts=<epoch>` que expone Cloudflare (alta precisión); si la fuente no lo tiene (ej. un
// sitio genérico usado solo como fallback), usa el header HTTP `Date` de la respuesta,
// que cualquier servidor HTTPS envía por defecto (precisión de segundo, suficiente aquí).
async function fetchExternalTimeMs(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const text = await res.text();
    const match = text.match(/^ts=(\d+(?:\.\d+)?)$/m);
    if (match) {
      return Math.round(parseFloat(match[1]) * 1000);
    }
    const dateHeader = res.headers.get("date");
    if (dateHeader) {
      return new Date(dateHeader).getTime();
    }
    throw new Error(`No se pudo determinar la hora externa desde la respuesta de ${url}`);
  } finally {
    clearTimeout(timer);
  }
}

// Prueba las fuentes configuradas en orden y devuelve la hora de la primera que responda
// dentro del timeout, en vez de depender de un único proveedor que podría no estar
// accesible desde este contenedor (bloqueo de red, caída puntual, etc.).
async function fetchExternalTimeMsWithFallback() {
  let lastError;
  for (const url of timeSourceUrls) {
    try {
      return await fetchExternalTimeMs(url);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("No hay fuentes de hora externa configuradas");
}

export async function syncTime() {
  if (!ENABLED) return;
  try {
    const externalNowMs = await fetchExternalTimeMsWithFallback();
    const measuredOffset = externalNowMs - Date.now();
    offsetMs = Math.abs(measuredOffset) > THRESHOLD_MS ? measuredOffset : 0;
    if (offsetMs !== 0) {
      console.warn(
        `[timeSync] Reloj del host desincronizado en ${measuredOffset}ms respecto a la hora externa. Aplicando corrección.`,
      );
    }
  } catch (err) {
    console.warn(
      `[timeSync] No se pudo verificar la hora externa en ninguna de las fuentes configuradas: ${err.message}. Manteniendo offset actual (${offsetMs}ms).`,
    );
  }
}

// "Ahora" corregido: usar en vez de Date.now()/new Date() en cualquier timestamp que se
// persista o se envíe al cliente (logs, eventos websocket, ventanas de consulta), para que
// no queden atados a un reloj de host/contenedor potencialmente desincronizado.
export function getCorrectedNow() {
  return Date.now() + offsetMs;
}

export function getCorrectedNowSeconds() {
  return Math.floor(getCorrectedNow() / 1000);
}

export function isTimeSyncEnabled() {
  return ENABLED;
}

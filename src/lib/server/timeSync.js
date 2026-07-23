// Corrige iat/exp/nbf de JWT cuando el reloj del host está desincronizado.
// Desactivado por defecto: solo actúa si TIME_SYNC_ENABLED=true.
const ENABLED =
  (process.env.TIME_SYNC_ENABLED || "").toString().toUpperCase() === "TRUE";

const THRESHOLD_MS = 5 * 60 * 1000; // offsets menores se ignoran (ruido de red)
const FETCH_TIMEOUT_MS = 4000;

let offsetMs = 0;

async function fetchExternalTimeMs() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch("https://www.cloudflare.com/cdn-cgi/trace", {
      signal: controller.signal,
    });
    const text = await res.text();
    const match = text.match(/^ts=(\d+(?:\.\d+)?)$/m);
    if (match) {
      return Math.round(parseFloat(match[1]) * 1000);
    }
    const dateHeader = res.headers.get("date");
    if (dateHeader) {
      return new Date(dateHeader).getTime();
    }
    throw new Error("No se pudo determinar la hora externa desde la respuesta");
  } finally {
    clearTimeout(timer);
  }
}

export async function syncTime() {
  if (!ENABLED) return;
  try {
    const externalNowMs = await fetchExternalTimeMs();
    const measuredOffset = externalNowMs - Date.now();
    offsetMs = Math.abs(measuredOffset) > THRESHOLD_MS ? measuredOffset : 0;
    if (offsetMs !== 0) {
      console.warn(
        `[timeSync] Reloj del host desincronizado en ${measuredOffset}ms respecto a la hora externa. Aplicando corrección para JWT.`,
      );
    }
  } catch (err) {
    console.warn(
      `[timeSync] No se pudo verificar la hora externa: ${err.message}. Manteniendo offset actual (${offsetMs}ms).`,
    );
  }
}

export function getCorrectedNow() {
  return Date.now() + offsetMs;
}

export function getCorrectedNowSeconds() {
  return Math.floor(getCorrectedNow() / 1000);
}

export function isTimeSyncEnabled() {
  return ENABLED;
}

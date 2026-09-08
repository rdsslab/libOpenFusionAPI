/**
 * @file RateLimitService.js
 * @description Servicio de rate limiting en memoria para intentos de autenticación
 * fallidos. Conteo de fallos 401 por clave (IP y, si se conoce, IP+usuario) con
 * ventana deslizante y lockout con backoff exponencial. Diseñado como módulo
 * desplegable por servidor, sin dependencias externas.
 *
 * El `preValidation` consulta `isBlocked()` antes de validar credenciales: si hay
 * lockout activo responde 429 con `Retry-After`. El `onResponse` registra los 401
 * (`recordFailure`) para alimentar las ventanas. Al cruzar el umbral por primera vez
 * (`lockoutStarted`) se emite un log de nivel 3 con `{type:"possible_attack",...}`.
 */

import {
  AUTH_MAX_FAILURES_DEFAULT,
  AUTH_LOCKOUT_BASE_MS_DEFAULT,
  AUTH_LOCKOUT_MAX_MS_DEFAULT,
  AUTH_WINDOW_MS_DEFAULT,
  AUTH_PRUNING_AGE_MS_DEFAULT,
  lockoutDurationMs,
  isEntryExpired,
  parsePositiveInt,
} from "./rateLimitPolicy.js";

export const RATE_LIMIT_DEFAULTS = Object.freeze({
  maxFailures: parsePositiveInt(
    process.env.AUTH_MAX_FAILURES,
    AUTH_MAX_FAILURES_DEFAULT
  ),
  windowMs: parsePositiveInt(process.env.AUTH_WINDOW_MS, AUTH_WINDOW_MS_DEFAULT),
  lockoutBaseMs: parsePositiveInt(
    process.env.AUTH_LOCKOUT_BASE_MS,
    AUTH_LOCKOUT_BASE_MS_DEFAULT
  ),
  lockoutMaxMs: parsePositiveInt(
    process.env.AUTH_LOCKOUT_MAX_MS,
    AUTH_LOCKOUT_MAX_MS_DEFAULT
  ),
});

/** Divide un array de timestamps dejando solo los de la ventana actual. */
function pruneWindow(failures, nowMs, windowMs) {
  const cutoff = nowMs - windowMs;
  for (let i = 0; i < failures.length; i++) {
    if (failures[i] > cutoff) {
      return failures.slice(i);
    }
  }
  return [];
}

/** Prefijos para no mezclar claves de distinto tipo en el mismo Map. */
const KEY_IP = "ip:";
const KEY_IP_USER = "ipu:";

export class RateLimitService {
  /**
   * @param {{maxFailures?: number, windowMs?: number, lockoutBaseMs?: number,
   *          lockoutMaxMs?: number, pruneAgeMs?: number, now?: () => number}} [opts]
   */
  constructor(opts = {}) {
    this.maxFailures = opts.maxFailures ?? RATE_LIMIT_DEFAULTS.maxFailures;
    this.windowMs = opts.windowMs ?? RATE_LIMIT_DEFAULTS.windowMs;
    this.lockoutBaseMs = opts.lockoutBaseMs ?? RATE_LIMIT_DEFAULTS.lockoutBaseMs;
    this.lockoutMaxMs = opts.lockoutMaxMs ?? RATE_LIMIT_DEFAULTS.lockoutMaxMs;
    this.pruneAgeMs =
      opts.pruneAgeMs ?? parsePositiveInt(process.env.AUTH_PRUNING_AGE_MS, AUTH_PRUNING_AGE_MS_DEFAULT);
    /** Inyectable para tests deterministas. */
    this._now = opts.now ?? (() => Date.now());

    /** @type {Map<string, {failures: number[], lockedUntil: number, lastAt: number}>} */
    this._entries = new Map();

    // Pruning periódico: evita que el Map crezca con una entrada por cada IP atacante.
    this._pruneTimer = setInterval(() => this.prune(), Math.min(this.windowMs, 3600_000));
    if (typeof this._pruneTimer.unref === "function") {
      this._pruneTimer.unref();
    }
  }

  /**
   * Genera la clave de una entrada.
   * @param {string|undefined} ip
   * @param {string|undefined} username
   */
  keyFor(ip, username) {
    if (username && ip) return `${KEY_IP_USER}${ip}|${username}`;
    return `${KEY_IP}${ip ?? "unknown"}`;
  }

  /**
   * Consulta si una IP (y opcionalmente usuario) está en lockout.
   * @param {string|undefined} ip
   * @param {string|undefined} [username]
   * @returns {{ blocked: boolean, retryAfterMs: number }}
   */
  isBlocked(ip, username) {
    const nowMs = this._now();
    const keys = this._keysFor(ip, username);

    let blocked = false;
    let retryAfterMs = 0;
    for (const key of keys) {
      const entry = this._entries.get(key);
      if (!entry) continue;
      if (entry.lockedUntil > nowMs) {
        blocked = true;
        retryAfterMs = Math.max(retryAfterMs, entry.lockedUntil - nowMs);
      }
    }
    return { blocked, retryAfterMs };
  }

  /**
   * Registra un fallo 401. Cuenta la clave IP siempre y, si hay usuario, también la
   * clave IP+usuario (fuerza bruta distribuida sobre una cuenta o desde una IP).
   * @param {string|undefined} ip
   * @param {string|undefined} [username]
   * @returns {{ blocked: boolean, retryAfterMs: number, failures: number, lockoutStarted: boolean }}
   */
  recordFailure(ip, username) {
    const keys = this._keysFor(ip, username);

    let blocked = false;
    let retryAfterMs = 0;
    let failuresSeen = 0;
    let lockoutStarted = false;

    for (const key of keys) {
      const result = this._recordFailureForKey(key);
      if (result.blocked) {
        blocked = true;
        retryAfterMs = Math.max(retryAfterMs, result.retryAfterMs);
      }
      if (result.lockoutStarted) {
        lockoutStarted = true;
      }
      failuresSeen = Math.max(failuresSeen, result.failures);
    }

    return { blocked, retryAfterMs, failures: failuresSeen, lockoutStarted };
  }

  /** Claves contra las que se comprueba una solicitud. */
  _keysFor(ip, username) {
    const keys = [this.keyFor(ip)];
    if (username && ip) {
      keys.push(this.keyFor(ip, username));
    }
    return keys;
  }

  /**
   * Registra el fallo en una única clave.
   * @returns {{ blocked: boolean, retryAfterMs: number, failures: number, lockoutStarted: boolean }}
   */
  _recordFailureForKey(key) {
    const nowMs = this._now();
    const entry = this._entry(key, nowMs);
    const failuresBefore = entry.failures.length;

    // Si el lockout está activo, no entramos en la ventana: seguimos bloqueados.
    if (entry.lockedUntil > nowMs) {
      return {
        blocked: true,
        retryAfterMs: entry.lockedUntil - nowMs,
        failures: failuresBefore,
        lockoutStarted: false,
      };
    }

    entry.failures.push(nowMs);
    entry.failures = pruneWindow(entry.failures, nowMs, this.windowMs);
    entry.lastAt = nowMs;

    const count = entry.failures.length;
    if (count >= this.maxFailures) {
      const durationMs = lockoutDurationMs(count, {
        baseMs: this.lockoutBaseMs,
        maxMs: this.lockoutMaxMs,
      });
      entry.lockedUntil = nowMs + durationMs;
      return {
        blocked: true,
        retryAfterMs: durationMs,
        failures: count,
        lockoutStarted: failuresBefore < this.maxFailures,
      };
    }

    return { blocked: false, retryAfterMs: 0, failures: count, lockoutStarted: false };
  }

  /**
   * Limpia entradas ya expiradas o sin fallos dentro de la ventana.
   * Invocada por un timer y también de forma manual en tests.
   */
  prune() {
    const nowMs = this._now();
    for (const [key, entry] of this._entries) {
      entry.failures = pruneWindow(entry.failures, nowMs, this.windowMs);
      const expired =
        entry.failures.length === 0 && entry.lockedUntil <= nowMs;
      const stale = isEntryExpired(entry, nowMs, this.pruneAgeMs);
      if (expired || stale) {
        this._entries.delete(key);
      }
    }
  }

  /** Devuelve cuántas claves se están trackeando (diagnóstico / tests). */
  get size() {
    this.prune();
    return this._entries.size;
  }

  /** Obtiene (o crea) la entrada para una clave. */
  _entry(key, nowMs) {
    let entry = this._entries.get(key);
    if (!entry) {
      entry = { failures: [], lockedUntil: 0, lastAt: nowMs };
      this._entries.set(key, entry);
    }
    return entry;
  }
}

export default RateLimitService;
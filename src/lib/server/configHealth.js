/**
 * Health-check de configuración del servidor.
 *
 * Variables de entorno OBLIGATORIAS: sin valor el servidor arranca en modo
 * degradado — se loguea el error y la raíz (/) muestra qué falta mientras la
 * API responde 503. No se usan valores por defecto para estas variables.
 */
const REQUIRED_ENV_VARS = ["JWT_KEY"];

/**
 * Devuelve las variables obligatorias que no están presentes o vienen vacías.
 * @param {string[]} [vars] - Lista de variables a comprobar.
 * @returns {string[]}
 */
export function getMissingEnvVars(vars = REQUIRED_ENV_VARS) {
  return vars.filter((name) => {
    const value = process.env[name];
    return value === undefined || value === null || String(value).trim() === "";
  });
}

/**
 * Estado de la configuración sin efectos colaterales (sin logs).
 * @param {string[]} [vars]
 * @returns {{ ok: boolean, missing: string[] }}
 */
export function getConfigHealth(vars = REQUIRED_ENV_VARS) {
  const missing = getMissingEnvVars(vars);
  return { ok: missing.length === 0, missing };
}

/**
 * Loguea un error por cada variable obligatoria ausente y devuelve el health.
 * @param {string[]} [vars]
 * @returns {{ ok: boolean, missing: string[] }}
 */
export function logConfigHealth(vars = REQUIRED_ENV_VARS) {
  const health = getConfigHealth(vars);
  if (!health.ok) {
    console.error("================ ERROR DE CONFIGURACION ===============");
    for (const name of health.missing) {
      console.error(
        `La variable de entorno obligatoria "${name}" no esta definida.`
      );
    }
    console.error(
      "El servidor arranca en modo degradado: la raiz (/) muestra este error"
    );
    console.error("y toda la API responde 503. Define las variables en .env y reinicia.");
    console.error("======================================================");
  }
  return health;
}

/**
 * Página HTML que se sirve en la raíz (/) cuando falta configuración.
 * @param {string[]} missing - Variable(s) ausente(s).
 * @returns {string}
 */
export function renderConfigErrorPage(missing) {
  const items = missing
    .map(
      (name) =>
        `<li><code>${String(name)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")}</code> no está definida</li>`,
    )
    .join("");

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>OpenFusionAPI | Configuración incompleta</title>
  <style>
    :root {
      --bg: #0a0f1e;
      --panel: #121a30;
      --line: #2a3654;
      --ink: #eaf0ff;
      --muted: #97a5c8;
      --danger: #ff5f5f;
      --brand: #4d7cff;
      --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      color: var(--ink);
      font-family: var(--font);
      background:
        radial-gradient(900px 420px at 12% -8%, #1e5eff33 0%, transparent 55%),
        linear-gradient(180deg, #0d1426 0%, var(--bg) 60%);
    }
    .card {
      width: min(600px, calc(100vw - 40px));
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 32px 28px;
      background: var(--panel);
      box-shadow: 0 30px 80px rgba(0, 0, 0, 0.5);
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      border-radius: 999px;
      border: 1px solid var(--line);
      color: var(--danger);
      font-size: 12.5px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-weight: 700;
    }
    .badge::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--danger); }
    h1 { margin: 18px 0 8px; font-size: 24px; letter-spacing: -0.02em; }
    p { margin: 0 0 20px; color: var(--muted); line-height: 1.6; }
    ul { margin: 0 0 22px; padding: 0; list-style: none; display: grid; gap: 10px; }
    li {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 14px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.035);
      font-family: var(--mono);
      font-size: 13.5px;
    }
    li::before { content: "✕"; color: var(--danger); font-weight: 700; }
    code {
      padding: 2px 8px;
      border-radius: 6px;
      background: rgba(77, 124, 255, 0.14);
      color: var(--brand);
      font-family: var(--mono);
    }
    .hint { font-size: 13px; color: var(--muted); display: grid; gap: 6px; }
    .hint code { color: var(--ink); }
  </style>
</head>
<body>
  <div class="card">
    <span class="badge">Configuración incompleta</span>
    <h1>Faltan variables de entorno obligatorias</h1>
    <p>El servidor está en modo degradado: la API responde 503 hasta que se definan estas variables y se reinicie.</p>
    <ul>${items}</ul>
    <div class="hint">
      <span>Define la(s) variable(s) en tu archivo <code>.env</code> (ver <code>.env.example</code>) y reinicia el proceso.</span>
      <span>El log de arranque del servidor también muestra estos errores.</span>
    </div>
  </div>
</body>
</html>`;
}
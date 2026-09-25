/**
 * Registro del override de conexión de los handlers SQL.
 *
 * Va en su propio módulo y no dentro de `sqlFunction.js` porque los tres handlers
 * SQL lo necesitan: el principal, el de inserción masiva y el de HANA. Dejar la
 * lógica en uno solo significaba que los otros dos quedaban fuera por un detalle
 * de archivo, que es exactamente como estas cosas se desincronizan.
 *
 * Lo que se registra son las RUTAS tocadas, nunca los valores. Un valor podría
 * ser una contraseña, un host interno o una ruta de archivo, y escribirlo en el
 * log convertiría el registro en una segunda copia del secreto y en un mapa de la
 * red interna. El nombre de la clave ya dice qué se intentó cambiar, que es lo
 * que hace falta para juzgar el evento.
 *
 * ## Por qué esto NO va a `ofapi_log`
 *
 * `ofapi_log` es un log de PETICIONES, no una bitácora genérica, y tres consumidores
 * asumen que cada fila es una petición real:
 *
 * - `getLogStats` cuenta con `COUNT(*)`, así que cada evento infla `total_logs`.
 * - `getLogsRecordsPerMinute` lo usa para el gráfico de tráfico por minuto.
 * - `getLogsStatusClassPerMinute` lo agrupa por clase de status, y una fila sin
 *   status cae en la clase `info`. Eso es peor que inflar un contador: `info` es
 *   una serie real que un operador mira para detectar anomalías, y se llenaría de
 *   filas que no son tráfico.
 *
 * Un endpoint multi-tenant de alto tráfico que usa el override en cada petición
 * generaría una fila fantasma por petición. Además cada fila lleva precio por
 * petición, y algo que no es una petición no puede llevar precio.
 *
 * El proyecto ya resolvió este caso por otra vía: los bots usan `ofapi_bot_log`,
 * una tabla dedicada, y el comentario de su modelo dice explícitamente que
 * "reemplaza el uso de LogEntry". La regla del código es que un evento que no es
 * una petición no va en el log de peticiones. Si algún día se quiere un histórico
 * consultable de estos eventos, lo que corresponde es una tabla como
 * `ofapi_bot_log`, no este log.
 *
 * Aquí el registro va a la consola del proceso, que es por donde el operador ya
 * ve los avisos del servidor y por donde se filtra sin ambigüedad. Es además el
 * canal que sobrevive a un reinicio cuando el log del proceso se rota a fichero,
 * que es la forma habitual de despliegue.
 */

/** Orden estable para que dos eventos iguales produzcan el mismo texto. */
const sorted = (paths) => [...paths].sort();

/**
 * Construye el texto del evento. Se exporta para poder comprobarlo sin base de
 * datos: el formato es la parte que un operador va a leer, y merece un test.
 *
 * @param {{applied: string[], rejected: string[]}} outcome
 * @param {Set<string>|null} allowlist lista efectiva; null = sin restricción
 * @param {{resource?: string, handler?: string, environment?: string}} ctx
 * @returns {string}
 */
export const describeConnectionOverride = (outcome, allowlist, ctx = {}) => {
  const { applied = [], rejected = [] } = outcome ?? {};
  const donde = [ctx.handler, ctx.resource].filter(Boolean).join(" ") || "handler SQL";
  const env = ctx.environment ? ` (${ctx.environment})` : "";

  // Se normaliza en la entrada en vez de confiar en que quien llama paso `null`.
  // Esto vive en la ruta del log de un evento de seguridad: si al formatar el
  // texto saltara una excepción, quien ni se entera es justo el operador que
  // necesita leerlo. Un `Set` vacío es un estado con significado —"todo
  // denegado"— y se distingue de la ausencia de lista.
  const allow = allowlist instanceof Set ? allowlist : null;

  const frases = [`Override de conexion en ${donde}${env}`];

  if (allow === null) {
    // Sin restricción, que es el estado por defecto. Conviene dejarlo dicho: si
    // alguien lee el log tiene que poder distinguir "este endpoint lo permite a
    // todo" de "este endpoint lo tiene acotado", porque la lectura que importa es
    // si un endpoint abierto acepta cambiar el destino de la consulta.
    frases.push("endpoint sin restriccion: todas las claves son sobrescribibles");
  } else {
    frases.push(
      `endpoint con allowlist [${sorted([...allow]).join(", ")}]`,
    );
  }

  if (applied.length > 0) frases.push(`aplicadas: ${sorted(applied).join(", ")}`);
  if (rejected.length > 0) {
    frases.push(`descartadas: ${sorted(rejected).join(", ")}`);
  }

  return frases.join(" | ");
};

/**
 * Escribe el evento en la consola del proceso.
 *
 * Siempre, y no solo cuando algo se descarta: un descarte silencioso es imposible
 * de diagnosticar, pero también lo es un uso silencioso, y esta capacidad es de las
 * que conviene tener a la vista aunque se esté usando como se.documentó.
 *
 * El nivel distingue los dos casos, y esa es toda la información que hace falta
 * para decidir qué mirar: `warn` cuando hubo algo que no prosperó, `info` cuando
 * el override se aplicó como se esperaba.
 *
 * No lanza. Esta función está en la ruta de una consulta que el cliente sí esperaba,
 * y un fallo al registrar no puede convertirse en un fallo de la consulta.
 *
 * @param {{applied: string[], rejected: string[]}} outcome
 * @param {Set<string>|null} allowlist
 * @param {{resource?: string, idendpoint?: string, idapp?: string, environment?: string, handler?: string}} ctx
 * @param {{method?: string, url?: string}} [request]
 */
export const recordConnectionOverride = (outcome, allowlist, ctx = {}, request = {}) => {
  const { applied = [], rejected = [] } = outcome ?? {};
  const message = describeConnectionOverride(outcome, allowlist, ctx);

  const metodo = request.method ? `method=${request.method}` : "method=?";
  const url = request.url ? ` url=${request.url}` : "";
  const prefijo = `[sql][connection-override] ${metodo}${url} ::`;

  if (rejected.length > 0) {
    console.warn(`${prefijo} ${message}`);
    return;
  }

  console.info(`${prefijo} ${message}`);
};

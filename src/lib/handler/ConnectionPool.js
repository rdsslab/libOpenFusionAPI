import { Sequelize } from "sequelize";
import Connection from "tedious/lib/connection.js";
import Request from "tedious/lib/request.js";
import BulkLoad from "tedious/lib/bulk-load.js";
import { TYPES } from "tedious/lib/data-type.js";
import { ISOLATION_LEVEL } from "tedious/lib/transaction.js";
import { prepararSqlParaBinds } from "./utils.js";

const tediousDialectModule = {
  Connection,
  Request,
  BulkLoad,
  TYPES,
  ISOLATION_LEVEL,
};

// Defaults applied only when the endpoint's AppVar config doesn't already set them.
// Without these, a stalled TCP socket to SQL Server (network blip, server hang) never
// errors on its own and sequelize.query() waits forever.
const DEFAULT_MSSQL_CONNECT_TIMEOUT_MS = 15_000;
const DEFAULT_MSSQL_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_POOL_ACQUIRE_MS = 30_000;

/**
 * Conexiones cacheadas por proceso. Antes era una constante (50) sin forma de
 * ajustarla, y el número de claves distintas que caben no es una propiedad del
 * código sino de la instalación: depende de cuántas apps, cuántos entornos y
 * cuántos endpoints con conexión propia haya. Con 50 y una app que publica
 * endpoints con conexión propia por endpoint, el pool empieza a evictar
 * conexiones que siguen en uso, y cada petición que llegue después paga un
 * `authenticate()` completo. Se puede subir con OFAPI_SQL_POOL_MAX_CONNECTIONS.
 */
const DEFAULT_MAX_CONNECTIONS = 50;

/** Techo duro: por encima de esto el LRU deja de ser un límite de memoria. */
const HARD_MAX_CONNECTIONS = 500;

function getMaxConnections() {
  const raw = Number(process.env.OFAPI_SQL_POOL_MAX_CONNECTIONS);
  if (Number.isFinite(raw) && raw >= 1) {
    return Math.min(Math.floor(raw), HARD_MAX_CONNECTIONS);
  }
  return DEFAULT_MAX_CONNECTIONS;
}

/**
 * Errores que el servidor de base de datos emite cuando ya no acepta más
 * conexiones. No son de autenticación aunque el mensaje mentione el login, y
 * confundirlos con un password malo manda a diagnostics por el camino
 * equivocado: el usuario acaba rotando credenciales que eran correctas.
 *
 * Postgres: «sorry, too many clients already» (SQLSTATE 53300)
 * MySQL/MariaDB: ER_CON_COUNT_ERROR (1040) «Too many connections»
 * SQL Server: error 109 «Could not open a connection because of too many
 *             existing connections» (as opposed to 18456, which IS auth)
 *
 * Deliberadamente NO se buscan los números 1040 / 109 como texto suelto: un
 * puerto, un conteo de filas o un timeout pueden contenerlos, y convertir eso en
 * «el servidor está lleno» es exactamente el falso positivo que este cambio
 * busca evitar. Los códigos numéricos se leen de los campos estructurados
 * (`original.code`, `parent.errno`, `number`), que es donde el driver los pone.
 */
const CONNECTION_EXHAUSTION_PATTERNS = [
  /too many clients/i,
  /too many connections/i,
  /too many existing connections/i,
  /ER_CON_COUNT_ERROR/i,
  /max[_ ]client[_ ]conn/i,
  /connection limit reached/i,
  /connection slots/i,
  /reached the limit of .*connection/i,
];

/**
 * ¿El error es "el servidor no acepta más conexiones" y no "credenciales
 * incorrectas"? Se separa del resto porque la acción que corrige cada uno es
 * distinta: subir `max_connections` en el servidor, o arreglar el password.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
export function isConnectionExhaustionError(err) {
  if (!err) return false;

  // Postgres entrega el código en `err.original.code` (clase 53 = insufficient
  // resources); MySQL lo pone en `err.parent.errno`; tedious en `err.number`.
  const original = err?.original ?? err?.parent ?? err;
  const codes = [
    original?.code,
    original?.sqlState,
    original?.sqlState ?? original?.state,
    err?.code,
    err?.parent?.errno,
    err?.number,
  ]
    .filter((v) => v !== undefined && v !== null)
    .map((v) => String(v));

  for (const code of codes) {
    if (/^(53\d{3})$/.test(code)) return true; // 53xxx = insufficient resources
    if (code === "1040") return true; // MySQL ER_CON_COUNT_ERROR
    if (code === "109") return true; // SQL Server too many connections
  }

  const text = [err?.message, original?.message, err?.parent?.message]
    .filter(Boolean)
    .join(" ");
  if (!text) return false;

  return CONNECTION_EXHAUSTION_PATTERNS.some((re) => re.test(text));
}

/**
 * Envuelve un fallo de apertura de conexión con un mensaje que diga qué se
 * rompió de verdad.
 *
 * Antes todo error de apertura se reportaba como `Cannot authenticate connection
 * to database: <mensaje del driver>`, y el texto del driver se colaba entero
 * detrás. Eso convertía «sorry, too many clients already» —que no tiene nada que
 * ver con credenciales— en un «Cannot authenticate», y el diagnóstico que
 * seguía era "el password está mal": rotar una contraseña correcta no arregla un
 * servidor que ya está en su `max_connections`.
 *
 * @param {unknown} err
 * @param {string} configHash
 * @returns {Error}
 */
function wrapConnectionError(err, configHash) {
  const message = String(err?.message ?? err ?? "unknown error");

  if (isConnectionExhaustionError(err)) {
    const error = new Error(
      `The database server refused the connection because it has reached its ` +
      `connection limit, not because of invalid credentials. Original error: ${message}. ` +
      `Raise max_connections on the database server, or lower ` +
      `OFAPI_SQL_POOL_MAX_CONNECTIONS (currently ${getMaxConnections()}) so this ` +
      `process stops competing for slots it cannot win.`,
    );
    // Se conserva el original: los drivers y los handlers que suben en la cadena
    // siguen pudiendo inspeccionar el código nativo (53300, 1040, 109…).
    error.cause = err;
    error.code = "DB_CONNECTION_LIMIT_REACHED";
    error.configHash = configHash;
    return error;
  }

  const error = new Error(`Cannot authenticate connection to database: ${message}`);
  error.cause = err;
  error.configHash = configHash;
  return error;
}

/**
 * Enseña a una instancia de Sequelize a no contar los comentarios como parámetros.
 *
 * ## El defecto
 *
 * `sequelize.query(sql, { bind })` sustituye los `$nombre` con
 * `formatBindParameters` (`lib/dialects/abstract/query.js`), que es una regex:
 * `sql.replace(/\B\$(\$|\w+)/g, …)`. Una regex no distingue "un `$nombre` en el SQL" de
 * "un `$nombre` que alguien escribió en un comentario", así que cuenta los dos, y si
 * el segundo no tiene valor lanza «Named bind parameter has no value in the given
 * object». Basta con que el comentario mencione el nombre de una variable de
 * aplicación —`/* sale de $_VAR_MSSQL_TEST *\/`— para que la consulta entera devuelva
 * 500, aunque el comentario no signifique nada para el motor.
 *
 * El otro camino de sustitución de Sequelize, `injectReplacements` (`:nombre`, `?`),
 * no sufre esto: es un escáner a mano que sí lleva la cuenta de literales,
 * identificadores y comentarios. La asimetría entre los dos es todo el defecto.
 *
 * ## Por qué aquí y no en el handler
 *
 * Porque el escáner de `scanSqlPlaceholders` ya lo ignoraba, y aun así la consulta
 * fallaba: ese escáner decide *qué* se manda, y la sustitución la hace Sequelize con
 * su propia regex, que es ciega. Arreglarlo en el handler no arregla nada; el
 * sitio donde la sustitución ocurre es esta instancia.
 *
 * ## Por qué una subclase y no un `dialect.Query.formatBindParameters = …`
 *
 * Porque `Query` está en el **prototipo** de la clase del dialecto
 * (`MssqlDialect.prototype.Query = Query`, en `lib/dialects/mssql/index.js`): dos
 * instancias del mismo motor comparten exactamente el mismo objeto, y asignarle el
 * método a una las cambia a todas. Se comprobó: con A y B del mismo motor,
 * `A.dialect.Query === B.dialect.Query` es `true`, y tras parchear A, B lo ve.
 *
 * Eso además arrastraría a `lib/db/sequelize.js`, la conexión propia de la
 * plataforma, que no tiene nada que ver con esto. Aquí se sombrea con una subclase
 * propia de **esta** instancia: las demás —incluida la de la plataforma— siguen con
 * la clase original intacta.
 *
 * @param {import("sequelize").Sequelize} sequelize
 */
function parchearBindsDeComentarios(sequelize) {
  const Original = sequelize?.dialect?.Query;
  if (typeof Original !== "function") return;

  class QueryConComentariosNeutros extends Original {
    static formatBindParameters(sql, values, dialect, ...resto) {
      // Sin `values` no hay sustitución que hacer y el camino rápido de Sequelize
      // ya devuelve el SQL tal cual; no hace falta recorrerlo.
      if (!values) return Original.formatBindParameters.call(this, sql, values, dialect, ...resto);

      const { sql: limpio, rechazados } = prepararSqlParaBinds(sql);

      if (rechazados.length > 0) {
        // Un `$nombre` dentro de un literal no se puede neutralizar sin reescribir el
        // literal con concatenación —`+` en T-SQL, `||` en el resto—, que depende del
        // dialecto y no se puede aplicar ni a un identificador entrecomillado ni
        // dentro de un cuerpo `$$…$$`. Y si no se hace nada, cuando el nombre del
        // literal coincide con un parámetro real Sequelize lo sustituye y el endpoint
        // responde 200 con el dato cambiado: `SELECT 'coste: $name'` devuelve
        // `coste: @name`, sin ninguna señal para quien lo consume. Un 400 explícito
        // es peor para el cliente y mucho mejor para quien escribe el endpoint.
        const detalle = rechazados
          .map((r) => `$${r.name} (${r.contenedor.replace(/_/g, " ")})`)
          .join(", ");
        const error = new Error(
          `This query uses ${detalle} inside a quoted string or identifier. Sequelize ` +
          `replaces every $name it finds in the text with the value of the parameter of ` +
          `the same name, whatever quotes surround it, so the endpoint would answer 200 ` +
          `with altered data. Rename the parameter, or build that text outside the SQL.`,
        );
        error.code = "SQL_BIND_INSIDE_LITERAL";
        // Lo lee `replyException`, que toma el status de `error.statusCode`.
        error.statusCode = 400;
        throw error;
      }

      return Original.formatBindParameters.call(this, limpio, values, dialect, ...resto);
    }
  }

  // Sombra propia de la instancia: no toca `MssqlDialect.prototype.Query`.
  Object.defineProperty(sequelize.dialect, "Query", {
    value: QueryConComentariosNeutros,
    configurable: true,
    writable: true,
  });
}

class ConnectionPool {  constructor(maxConnections = getMaxConnections()) {
    this.connections = new Map();
    this.MAX_CONNECTIONS = maxConnections;
    this.validationIdleMs = getValidationIdleMs();
    this.forceValidateAlways = isValidationAlwaysEnabled();
  }

  /**
   * Valida si una conexión en caché sigue siendo funcional.
   * Intenta un authenticate() ligero sin query pesada.
   */
  async validateConnection(sequelize) {
    try {
      // Intenta validar la conexión con authenticate()
      // Si falla, retorna false (conexión muerta)
      await sequelize.authenticate();
      return true;
    } catch (err) {
      console.warn(`[ConnectionPool] Connection validation failed: ${err.message}`);
      return false;
    }
  }

  /**
   * Gestiona el ciclo de vida de las conexiones para evitar fugas de memoria.
   * Implementa una estrategia LRU (Least Recently Used).
   */
  async getConnection(configHash, paramsSQL) {
    // 1. Si existe, actualizamos timestamp y retornamos
    if (this.connections.has(configHash)) {
      const connData = this.connections.get(configHash);

      // Auto-recuperacion: reciclar conexiones MSSQL creadas sin dialectModule.
      const isMssql = connData?.sequelize?.options?.dialect === "mssql";
      const hasDialectModule = !!connData?.sequelize?.options?.dialectModule;
      if (isMssql && !hasDialectModule) {
        try {
          await connData.sequelize.close();
        } catch (err) {
          console.error("Error closing legacy mssql connection:", err);
        }
        this.connections.delete(configHash);
      } else {
        // Validate only after configured idle threshold to avoid authenticate() on hot paths.
        const idleMs = Date.now() - (connData.lastUsed || 0);
        const needsValidation = this.forceValidateAlways || idleMs > this.validationIdleMs;
        const isValid = needsValidation ? await this.validateConnection(connData.sequelize) : true;
        if (isValid) {
          connData.lastUsed = Date.now();
          return connData.sequelize;
        } else {
          // Conexión muerta: cerrar y eliminar del caché
          console.log(`[ConnectionPool] Stale connection detected for ${configHash}, recreating...`);
          try {
            await connData.sequelize.close();
          } catch (err) {
            console.error("Error closing stale connection:", err);
          }
          this.connections.delete(configHash);
          // Continúa para crear nueva conexión
        }
      }
    }

    // 2. Si no existe, verificamos límite
    if (this.connections.size >= this.MAX_CONNECTIONS) {
      // Buscar la conexión más antigua (LRU)
      let oldestHash = null;
      let oldestTime = Infinity;

      for (const [hash, data] of this.connections.entries()) {
        if (data.lastUsed < oldestTime) {
          oldestTime = data.lastUsed;
          oldestHash = hash;
        }
      }

      if (oldestHash) {
        // `lastUsed` marca la última petición que la pidió, no el final de su
        // consulta: la conexión evictada puede estar sirviendo algo ahora mismo.
        // Cerrarla aborta esa consulta, así que el aviso dice cuál era y no se
        // presenta como una limpieza de rutina.
        const idleForMs = Date.now() - oldestTime;
        console.warn(
          `[ConnectionPool] Pool at capacity (${this.connections.size}/${this.MAX_CONNECTIONS}). ` +
          `Evicting the least recently requested connection ${oldestHash} ` +
          `(last requested ${Math.round(idleForMs / 1000)}s ago). If this repeats, the ` +
          `number of distinct connection configs has outgrown the pool: raise ` +
          `OFAPI_SQL_POOL_MAX_CONNECTIONS or consolidate the per-endpoint connection overrides.`,
        );

        const oldConn = this.connections.get(oldestHash);
        try {
          await oldConn.sequelize.close();
        } catch (err) {
          console.error("Error closing idle connection:", err);
        }
        this.connections.delete(oldestHash);
      }
    }

    // 3. Crear nueva conexión
    const sequelizeOptions = {
      ...paramsSQL.config.options,
    };

    if (sequelizeOptions.dialect === "mssql") {
      sequelizeOptions.dialectOptions = {
        connectTimeout: DEFAULT_MSSQL_CONNECT_TIMEOUT_MS,
        requestTimeout: DEFAULT_MSSQL_REQUEST_TIMEOUT_MS,
        ...sequelizeOptions.dialectOptions,
      };
      sequelizeOptions.pool = {
        acquire: DEFAULT_POOL_ACQUIRE_MS,
        ...sequelizeOptions.pool,
      };
    }

    // H10, retirado: aquí se metía el parser de `int8` en `dialectOptions.types`
    // cuando la config del endpoint traía `parse_bigint`. No era que estuviera mal
    // puesto —`pg` solo recibe `types` por ahí— es que Sequelize pisa
    // `connectionConfig.types` en cada conexión y su lista blanca de
    // `dialectOptions` no incluye `types`: la opción se ignoraba en silencio y
    // `parse_bigint: true` devolvía el mismo texto que `false`. Se retiró la opción
    // entera en 13.11.10 en vez de dejarla cableada a algo que no hacía nada.

    // Aquí es donde nace la instancia Sequelize de un endpoint, y es el único sitio
    // del proyecto donde pasa: los endpoints que ya existen y los que se creen
    // después pasan todos por esta función, sin tocar su definición. El parche va
    // aquí y no en `sqlFunction` porque lo que falla es la sustitución de binds, que
    // ocurre dentro de Sequelize y no en el handler.
    const buildSequelize = (options) => {
      const instancia = new Sequelize(
        paramsSQL.config.database,
        paramsSQL.config.username,
        paramsSQL.config.password,
        options
      );
      parchearBindsDeComentarios(instancia);
      return instancia;
    };

    let sequelize = buildSequelize(sequelizeOptions);

    // 4.5 Validar que la nueva conexión sea funcional
    try {
      await sequelize.authenticate();
    } catch (err) {
      const isMssql = sequelizeOptions?.dialect === "mssql";
      const canRetryWithDialectModule = isMssql && !sequelizeOptions?.dialectModule;

      if (canRetryWithDialectModule) {
        console.warn(`[ConnectionPool] Default MSSQL connection failed for ${configHash}. Retrying with explicit dialectModule.`, err.message);
        try {
          await sequelize.close();
        } catch (closeErr) {
          console.error("Error closing failed default connection:", closeErr);
        }

        const retryOptions = {
          ...sequelizeOptions,
          dialectModule: tediousDialectModule,
        };
        sequelize = buildSequelize(retryOptions);

        try {
          await sequelize.authenticate();
        } catch (retryErr) {
          console.error(`[ConnectionPool] Failed to authenticate fallback MSSQL connection for ${configHash}:`, retryErr.message);
          try {
            await sequelize.close();
          } catch (closeRetryErr) {
            console.error("Error closing failed fallback connection:", closeRetryErr);
          }
          throw wrapConnectionError(retryErr, configHash);
        }
      } else {
        console.error(`[ConnectionPool] Failed to authenticate new connection for ${configHash}:`, err.message);
        try {
          await sequelize.close();
        } catch (closeErr) {
          console.error("Error closing failed connection:", closeErr);
        }
        throw wrapConnectionError(err, configHash);
      }
    }

    // 4. Guardar en mapa
    this.connections.set(configHash, {
      sequelize: sequelize,
      lastUsed: Date.now(),
    });

    return sequelize;
  }

  /**
   * Evicta una conexión cacheada sin esperar a que cierre (best-effort).
   * Se usa cuando una query excede su timeout: el socket puede seguir colgado,
   * así que no se espera a `close()` para no bloquear la respuesta del handler,
   * pero se retira del mapa para que la siguiente petición cree una conexión nueva.
   */
  invalidate(configHash) {
    const connData = this.connections.get(configHash);
    if (!connData) {
      return;
    }

    this.connections.delete(configHash);

    try {
      connData.sequelize.close().catch((err) => {
        console.error(`[ConnectionPool] Error closing invalidated connection ${configHash}:`, err.message);
      });
    } catch (err) {
      console.error(`[ConnectionPool] Error invalidating connection ${configHash}:`, err.message);
    }
  }
}

function getValidationIdleMs() {
  const raw = Number(process.env.OFAPI_SQL_POOL_VALIDATE_IDLE_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 30_000;
}

function isValidationAlwaysEnabled() {
  const raw = String(process.env.OFAPI_SQL_POOL_FORCE_VALIDATE_ALWAYS || "")
    .trim()
    .toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

// Export a singleton instance
export const Pool = new ConnectionPool();

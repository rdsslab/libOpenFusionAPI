import { parentPort, workerData } from "node:worker_threads";
import hive from "hive-driver";

const { sql, config, bind, maxRows, timeoutMs } = workerData;

async function main() {
  try {
    const { TCLIService, TCLIService_types } = hive.thrift;
    const client = new hive.HiveClient(TCLIService, TCLIService_types);
    const utils = new hive.HiveUtils(TCLIService_types);

    // Configurar autenticación (hoy PLAIN, mañana se cambia a Kerberos sin tocar handler)
    const authType = (config?.authType || "PLAIN").toUpperCase();
    let auth;
    if (authType === "NONE" || authType === "NOSASL" || authType === "NO_SASL") {
      auth = new hive.auth.NoSaslAuthentication();
    } else if (authType === "KERBEROS") {
      // Placeholder: en futuro instanciar KerberosTcpAuthentication; hoy fallback a PLAIN para no instalar kerberos
      auth = new hive.auth.PlainTcpAuthentication({ username: config.username || "", password: config.password || "" });
    } else {
      auth = new hive.auth.PlainTcpAuthentication({
        username: config.username || "",
        password: config.password || "",
      });
    }

    const connectionOptions = {
      host: config.host,
      port: Number(config.port || 21050),
      options: {},
    };

    if (config.useTLS === true || config.tls) {
      connectionOptions.options.ssl = true;
      // Si se pasan opciones TLS adicionales (ca, rejectUnauthorized, etc.) se pueden incorporar
      if (config.tls && typeof config.tls === "object") {
        Object.assign(connectionOptions.options, config.tls);
      }
    }

    await client.connect(connectionOptions, new hive.connections.TcpConnection(), auth);

    const session = await client.openSession({
      client_protocol: TCLIService_types.TProtocolVersion.HIVE_CLI_SERVICE_PROTOCOL_V10,
    });

    const operation = await session.executeStatement(sql, { runAsync: true });
    await utils.waitUntilReady(operation, false, () => {});

    const rows = [];
    operation.setMaxRows(maxRows || 1000);
    let more = true;
    while (more) {
      const status = await operation.fetch();
      if (status?.operationState === TCLIService_types.TOperationState.FINISHED_STATE) {
        // Terminado
      }
      const result = utils.getResult(operation)?.getValue();
      if (Array.isArray(result)) {
        rows.push(...result);
      }
      // Si hay más filas, seguir; si no, salir
      const hasMore = operation.hasMoreRows?.() || false;
      if (!hasMore) {
        more = false;
      }
    }

    await operation.close();
    await session.close();
    await client.close();

    parentPort.postMessage({ result: { rows, count: rows.length } });
  } catch (error) {
    parentPort.postMessage({ error: error.message || String(error), name: error.name || "HiveDriverError" });
  }
}

main();

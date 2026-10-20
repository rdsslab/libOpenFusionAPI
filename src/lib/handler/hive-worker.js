import { parentPort, workerData } from "node:worker_threads";
import hive from "hive-driver";

const {
  sql,
  config,
  bind,
  maxRows,
  timeoutMs,
} = workerData || {};

async function main() {
  try {
    const { TCLIService, TCLIService_types } = hive.thrift;
    const client = new hive.HiveClient(TCLIService, TCLIService_types);
    const utils = new hive.HiveUtils(TCLIService_types);

    // --------- PROTOCOL SUPPORT (V6 / V10) ----------
    let clientProtocol = TCLIService_types.TProtocolVersion.HIVE_CLI_SERVICE_PROTOCOL_V10; // default V10
    if (config?.protocol) {
      const p = String(config.protocol).toUpperCase();
      if (p === "V6" || p === "6") {
        clientProtocol = TCLIService_types.TProtocolVersion.HIVE_CLI_SERVICE_PROTOCOL_V6;
      } else if (p === "V10" || p === "10") {
        clientProtocol = TCLIService_types.TProtocolVersion.HIVE_CLI_SERVICE_PROTOCOL_V10;
      }
    }
    // also allow client_protocol field
    if (config?.client_protocol) {
      const p = Number(config.client_protocol);
      if (p === 6) {
        clientProtocol = TCLIService_types.TProtocolVersion.HIVE_CLI_SERVICE_PROTOCOL_V6;
      } else if (p === 10) {
        clientProtocol = TCLIService_types.TProtocolVersion.HIVE_CLI_SERVICE_PROTOCOL_V10;
      }
    }

    // --------- TRANSPORT SUPPORT (FRAMED vs BUFFERED) ----------
    // Default to framed (what HiveServer2 expects) unless explicitly set to buffered.
    let useFramedTransport = true;
    if (config?.transport) {
      const t = String(config.transport).toLowerCase();
      if (t === "buffered" || t === "tb") {
        useFramedTransport = false;
      } else if (t === "framed" || t === "tf") {
        useFramedTransport = true;
      }
    }

    // --------- AUTHENTICATION ----------
    const authType = (config?.authType || "PLAIN").toUpperCase();
    let auth;

    // Custom auth for NONE that does NOT force TBufferedTransport (fixes openSession hang)
    class NoSaslTransportPassthroughAuthentication {
      async authenticate(transport) {
        await transport.connect();
        // Do NOT override transport options -> let TcpConnection use TFramedTransport by default
        return transport;
      }
    }

    if (authType === "NONE" || authType === "NOSASL" || authType === "NO_SASL") {
      // Use our custom auth that doesn't override transport
      auth = new NoSaslTransportPassthroughAuthentication();
    } else if (authType === "KERBEROS") {
      // Placeholder: future KerberosTcpAuthentication; fallback to PLAIN to avoid native dep
      auth = new hive.auth.PlainTcpAuthentication({ username: config.username || "", password: config.password || "" });
    } else {
      // PLAIN (LDAP / Active Directory)
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
      if (config.tls && typeof config.tls === "object") {
        Object.assign(connectionOptions.options, config.tls);
      }
    }

    await client.connect(connectionOptions, new hive.connections.TcpConnection(), auth);

    const session = await client.openSession({
      client_protocol: clientProtocol,
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

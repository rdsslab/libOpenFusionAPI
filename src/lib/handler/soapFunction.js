import soap from "soap";
import Ajv from "ajv";
import { schema_input_genericSOAP } from "./json_schemas.js";
import { mergeObjects } from "../server/utils.js";
import {
  createBadRequestError,
  getAppVarContext,
  parseJsonConfig,
  replyException,
  resolveAppVarPlaceholder,
  sendHandlerError,
} from "./utils.js";
//process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const ajv = new Ajv();
const validate_schema_input_genericSOAP = ajv.compile(schema_input_genericSOAP);

/*
import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');
*/

const soapClients = new Map();
const MAX_CLIENTS = 50;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutos

/**
 * Headers that must never be forwarded to an upstream SOAP service.
 *
 * Hop-by-hop (RFC 7230 §6.1): connection-specific, become invalid across hops.
 * Body/content: managed entirely by node-soap; overriding them corrupts the XML envelope.
 * Host/routing: must resolve to the SOAP target, not the original client.
 * Credentials: authorization carries the OpenFusionAPI JWT (not the SOAP service's credential);
 *   cookie/set-cookie would leak browser session data to external services.
 * Proxy/forwarding: internal routing metadata; enterprise SOAP servers actively reject these.
 * Response-context: headers that only make sense in responses (e.g. "server").
 * Browser-specific: "referer" is rejected by many corporate SOAP/firewall setups.
 * All "sec-*" headers are handled separately via startsWith() to cover current and future
 *   browser security hints (sec-ch-ua, sec-fetch-*, sec-gpc, etc.).
 */
const SOAP_BLOCKED_HEADERS = new Set([
  // Hop-by-hop — RFC 7230 §6.1
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade",
  // Body/content — managed by node-soap
  "content-type", "content-length", "content-encoding",
  // Host/routing
  "host", "origin",
  // Credentials — must not leak to external services
  "authorization", "cookie", "set-cookie",
  // Proxy/forwarding infrastructure
  "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto",
  "x-real-ip", "forwarded",
  // Response-context headers
  "server",
  // Commonly rejected by SOAP/enterprise servers
  "referer",
]);

const toBasicAuthHeader = (security) => {
  if (!security?.User) {
    return undefined;
  }

  return `Basic ${Buffer.from(
    `${security.User}:${security.Password || ""}`,
  ).toString("base64")}`;
};

const getWsdlAuthorizationHeader = (SOAPParameters) => {
  if (SOAPParameters?.BasicAuthSecurity?.User) {
    return toBasicAuthHeader(SOAPParameters.BasicAuthSecurity);
  }

  if (SOAPParameters?.BearerSecurity) {
    return `Bearer ${SOAPParameters.BearerSecurity}`;
  }

  return undefined;
};

const buildSoapClientOptions = (SOAPParameters) => {
  const baseOptions =
    SOAPParameters?.options && typeof SOAPParameters.options === "object"
      ? JSON.parse(JSON.stringify(SOAPParameters.options))
      : {};

  const authorization = getWsdlAuthorizationHeader(SOAPParameters);

  if (!authorization) {
    return baseOptions;
  }

  baseOptions.wsdl_headers = {
    ...(baseOptions.wsdl_headers || {}),
    Authorization: authorization,
  };

  baseOptions.wsdl_options = {
    ...(baseOptions.wsdl_options || {}),
    headers: {
      ...(baseOptions.wsdl_options?.headers || {}),
      Authorization: authorization,
    },
  };

  return baseOptions;
};

const normalizeSoapError = (error) => {
  if (!(error instanceof Error)) {
    return error;
  }

  const message = error.message || "";
  const lowerMessage = message.toLowerCase();

  if (
    lowerMessage.includes("root element of wsdl was <html>") ||
    lowerMessage.includes("invalid wsdl url")
  ) {
    error.message =
      "The configured WSDL URL did not return a valid WSDL XML document. The upstream response was HTML, which usually means the URL points to a SOAP runtime/status page instead of a WSDL, or that the WSDL request still requires different authentication.";
  }

  return error;
};

/**
 * Obtiene un cliente SOAP del caché o crea uno nuevo.
 * Implementa LRU (Least Recently Used) y TTL (Time To Live).
 */
const getSoapClient = async (wsdl, options) => {
  const cacheKey = JSON.stringify({ wsdl, options });
  const now = Date.now();

  // 1. Verificar Caché
  if (soapClients.has(cacheKey)) {
    const entry = soapClients.get(cacheKey);

    // Verificar TTL
    if (now - entry.created > CACHE_TTL) {
      console.log(`SOAP Client expired: ${wsdl}`);
      soapClients.delete(cacheKey);
    } else {
      // Actualizar uso (LRU) y retornar
      entry.lastUsed = now;
      return entry.client;
    }
  }

  // 2. Limpieza LRU si está lleno — Map preserva orden de inserción, el primero es el más antiguo
  if (soapClients.size >= MAX_CLIENTS) {
    const oldestKey = soapClients.keys().next().value;
    if (oldestKey) soapClients.delete(oldestKey);
  }

  // 3. Crear nuevo cliente
  console.log(`Creating new SOAP Client: ${wsdl}`);
  const client = await soap.createClientAsync(wsdl, options || {});

  // 4. Guardar en caché
  soapClients.set(cacheKey, {
    client,
    created: now,
    lastUsed: now,
  });

  return client;
};

/**
 * Evicta un cliente SOAP cacheado (best-effort). Se usa cuando una llamada excede su
 * timeout, para que la siguiente petición no reutilice un cliente cuya conexión
 * subyacente pueda haber quedado colgada.
 */
const invalidateSoapClient = (wsdl, options) => {
  const cacheKey = JSON.stringify({ wsdl, options });
  soapClients.delete(cacheKey);
};

// Limpieza periódica de entradas expiradas para no acumular WSDLs distintos sin uso
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of soapClients.entries()) {
    if (now - entry.created > CACHE_TTL) {
      console.log(`SOAP Client TTL cleanup: ${key.substring(0, 60)}...`);
      soapClients.delete(key);
    }
  }
}, CACHE_TTL);

export const soapFunction = async (context) => {
  const request = context?.request;
  const reply = context?.reply;
  const endpoint = context?.method || context?.endpoint;

  try {
    // console.log(">>>>>>>>>>>>> method.code -----> ", method.code);
    let SOAPParameters;

    if (endpoint?.custom_data?.wsdl) {
      // Toma el wsdl del custom_data, que es cuando el usuario ingresa los parametros manualmente
      SOAPParameters = endpoint?.custom_data;
    } else {
      // Toma el wsdl del code, que es cuando el usuario usa una variable de aplicación
      const { appVars, environment } = getAppVarContext(endpoint);
      const soapConfigValue = resolveAppVarPlaceholder(
        endpoint.code,
        appVars,
        environment,
      );

      try {
        SOAPParameters = parseJsonConfig(
          soapConfigValue,
          "SOAP endpoint configuration is invalid JSON. Check AppVar/code value.",
        );
      } catch (error) {
        throw createBadRequestError(
          "SOAP endpoint configuration is invalid JSON. Check AppVar/code value.",
        );
      }
    }

    //    console.log(SOAPParameters);
    let dataRequest = {};

    const requestQuery = request.query && typeof request.query === "object" ? request.query : {};
    const requestBody = request.body && typeof request.body === "object" ? request.body : {};

    if (request.method == "GET") {
      // Obtiene los datos del query
      SOAPParameters.RequestArgs = requestQuery;
      dataRequest = SOAPParameters;
    } else {
      // Obtiene los datos del body y conserva query como fallback.
      dataRequest = mergeObjects(requestQuery, requestBody);
      dataRequest = mergeObjects(dataRequest, SOAPParameters);
    }

    dataRequest.HTTPHeaders = request.headers;

    //console.log('dataRequest>>>>>', dataRequest);

    // Endpoint-configured timeout (seconds). Without it, a stalled SOAP call (WSDL fetch
    // or the actual request) leaves the request hanging forever, ignoring the timeout set
    // for this endpoint.
    const hasEndpointTimeout = endpoint?.timeout !== undefined && endpoint?.timeout !== null;
    const endpointTimeoutSeconds = hasEndpointTimeout ? Number(endpoint.timeout) : undefined;
    const endpointTimeoutMs =
      hasEndpointTimeout && Number.isFinite(endpointTimeoutSeconds) && endpointTimeoutSeconds > 0
        ? endpointTimeoutSeconds * 1000
        : undefined;

    let soap_response;

    if (endpointTimeoutMs) {
      let timeoutHandle;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => {
          const timeoutError = new Error(
            `SOAP handler execution timed out after ${endpointTimeoutMs}ms`,
          );
          timeoutError.name = "TimeoutError";
          reject(timeoutError);
        }, endpointTimeoutMs);
      });

      try {
        soap_response = await Promise.race([SOAPGenericClient(dataRequest), timeoutPromise]);
      } catch (raceErr) {
        if (raceErr?.name === "TimeoutError") {
          invalidateSoapClient(dataRequest.wsdl, buildSoapClientOptions(dataRequest));
          sendHandlerError(reply, 504, raceErr.message);
          return;
        }
        throw raceErr;
      } finally {
        clearTimeout(timeoutHandle);
      }
    } else {
      soap_response = await SOAPGenericClient(dataRequest);
    }

    if (soap_response.error && Array.isArray(soap_response.error)) {
      reply.code(400).send(soap_response);
      return;
    }

    if (reply.openfusionapi?.lastResponse?.hash_request) {
      // @ts-ignore
      reply.openfusionapi.lastResponse.data = soap_response;
    }

    reply.code(200).send(soap_response);
  } catch (error) {
    replyException(request, reply, normalizeSoapError(error));
  }

  ////
};

export const SOAPGenericClient = async (
  /** @type {{ wsdl: string; functionName: string | any[]; BasicAuthSecurity: { User: any; Password: any; }; RequestArgs: any; }} */ SOAPParameters
) => {
  //console.log("\n\n\nSOAPGenericClient", SOAPParameters);

  let describe = false;
  /*
  let options = {
    wsdl_options: {
      strictSSL: true,
      rejectUnauthorized: false,
      //secureOptions: constants.SSL_OP_NO_TLSv1_2,
    },
  };
  */

  if (
    SOAPParameters["describe()"] ||
    (SOAPParameters.RequestArgs && SOAPParameters.RequestArgs["describe()"])
  ) {
    describe = true;
    SOAPParameters.functionName = SOAPParameters.functionName || "undefined";
  }

  if (describe || validate_schema_input_genericSOAP(SOAPParameters)) {
    const clientOptions = buildSoapClientOptions(SOAPParameters);
    let client = await getSoapClient(SOAPParameters.wsdl, clientOptions);

    // Forward request headers to the SOAP client, excluding those that cause errors.
    // SOAP_BLOCKED_HEADERS (Set) handles exact matches in O(1).
    // All sec-* headers (browser security hints) are blocked via prefix check.
    for (const [key, value] of Object.entries(SOAPParameters.HTTPHeaders)) {
      const k = key.toLowerCase();
      if (!SOAP_BLOCKED_HEADERS.has(k) && !k.startsWith("sec-")) {
        client.addHttpHeader(key, value);
      }
    }

    //     console.log('\n\nClient >>>>>> SOAP: ', describe, SOAPParameters);

    if (
      SOAPParameters.BasicAuthSecurity &&
      SOAPParameters.BasicAuthSecurity.User
    ) {
      client.setSecurity(
        new soap.BasicAuthSecurity(
          SOAPParameters.BasicAuthSecurity.User,
          SOAPParameters.BasicAuthSecurity.Password
        )
      );
    } else if (SOAPParameters.BearerSecurity) {
      client.setSecurity(
        new soap.BearerSecurity(SOAPParameters.BearerSecurity)
      );
    }

    let r;

    if (describe) {
      r = client.describe();
    } else {
      let fnName = SOAPParameters.functionName + "Async";

      if (SOAPParameters.endpoint) {
        client.setEndpoint(SOAPParameters.endpoint);
      }

      if (client[fnName]) {
        const [r1] = await client[fnName](SOAPParameters.RequestArgs);
        r = r1;
      } else {
        throw new Error(fnName + " not exists.");
      }
    }

    //     console.log("SOAPGenericClient result", r);
    return r;
  } else {
    return { error: validate_schema_input_genericSOAP.errors };
  }
};

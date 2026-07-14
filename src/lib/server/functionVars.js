import crypto from "crypto";
import { Blob } from "node:buffer";
import PromiseSequence from "@rddslab/sequential-promises";
import mongoose from "mongoose";
import * as luxon from "luxon";
import * as sequelize from "sequelize";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import nodemailer from "nodemailer";
import * as xmlCrypto from "xml-crypto";
import * as xmldom from "@xmldom/xmldom";
import * as forge from "node-forge";
import * as uuid from "uuid";
import Zod from "zod";
import * as XLSX from "xlsx";
//import * as xlsx_style from "xlsx-js-style";
import xlsx_style from "xlsx-js-style";
import { askAIWithTools, askIAWithMCP, askIAWithProviderMCP, createAIProviderMCPClient, listMcpTools } from "./ia.js";

import {
  createImage as createImageFromHTML,
  createPDF as createPDFFromHTML,
} from "../server/pdf-generator.js";
import { isValidHttpStatusCode } from "../handler/utils.js";
import { default_port } from "./utils_path.js";
import { createLog } from "../db/log.js";
import uFetch from "@rddslab/uFetch";
import jwt from "jsonwebtoken";
import xmlFormatter from "xml-formatter";
import xml2js from "xml2js";
import dnsPromises from "dns/promises";
import OpenAI from "openai";

const { PORT, JWT_KEY } = process.env;

if (!process.env.JWT_KEY) {
  if (process.env.NODE_ENV === 'production') {
    console.error("FATAL: JWT_KEY is not defined in production. Refusing to start.");
    process.exit(1);
  }
  console.warn("WARNING: JWT_KEY is not defined. Using insecure fallback key.");
}
export const JWTKEY = JWT_KEY ?? 'oy8632rcv"$/8';

const sanitizeNodemailerMailOptions = (mailOptions) => {
  if (!mailOptions || typeof mailOptions !== "object") {
    return mailOptions;
  }

  if (
    mailOptions.envelope &&
    typeof mailOptions.envelope === "object" &&
    Object.hasOwn(mailOptions.envelope, "size")
  ) {
    const safeEnvelope = { ...mailOptions.envelope };
    delete safeEnvelope.size;
    return { ...mailOptions, envelope: safeEnvelope };
  }

  return mailOptions;
};

const wrapNodemailerTransport = (transporter) => {
  if (!transporter || typeof transporter.sendMail !== "function") {
    return transporter;
  }

  return {
    ...transporter,
    sendMail(mailOptions, ...args) {
      return transporter.sendMail(
        sanitizeNodemailerMailOptions(mailOptions),
        ...args
      );
    },
  };
};

const nodemailerSafe = {
  ...nodemailer,
  createTransport(...args) {
    return wrapNodemailerTransport(nodemailer.createTransport(...args));
  },
};

/**
 * @param {any} data
 */
export function GenToken(data, exp_seconds = 3600 * 2 /* 2 horas */, key = JWTKEY) {
  let exp = Math.floor(Date.now() / 1000) + Number(exp_seconds);
  return jwt.sign({ data: { ...data, _rnd_: Math.random() }, exp: exp }, key);
}

/**
 * Genera un JWT firmado con fechas de inicio y fin explícitas.
 * @param {any} data - Datos a incluir en el token.
 * @param {Date|string} [startAt] - Fecha/hora de inicio. Por defecto: ahora.
 * @param {Date|string} [endAt]   - Fecha/hora de expiración. Por defecto: ahora + 1 hora.
 * @param {string} [key]          - Clave de firma. Por defecto: JWTKEY.
 * @returns {string} JWT firmado.
 */
export function GenTokenJWT(data, startAt, endAt, key = JWTKEY) {
  const now = new Date();

  const start = startAt ? new Date(startAt) : now;
  const end = endAt ? new Date(endAt) : new Date(start.getTime() + 3600 * 1000);

  // Validations
  if (isNaN(start.getTime())) {
    throw new Error("startAt is not a valid date");
  }

  if (isNaN(end.getTime())) {
    throw new Error("endAt is not a valid date");
  }

  if (end <= start) {
    throw new Error("endAt must be greater than startAt");
  }

  const iat = Math.floor(start.getTime() / 1000);
  const exp = Math.floor(end.getTime() / 1000);
  const nbf = iat; // actual validity start

  return jwt.sign(
    {
      data: { ...data },
      //iat,
      exp,
      nbf
    },
    key
  );
}

export const jsException = (message, data, http_statusCode = 500) => {
  let status = isValidHttpStatusCode(http_statusCode) ? http_statusCode : 500;
  throw { message, data, date: new Date(), statusCode: status };
};

const ENV_SUFFIX_REGEX = /\/(auto|env)$/;

/**
 * Clase para manejar URLs con entornos auto y env
 */
export class URLAutoEnvironment {

  constructor({ environment, port = default_port, baseUrl = "http://localhost", headers = new Headers() }) {
    this.environment = environment;
    this.base = `${baseUrl}:${port}`;
    this.headers = headers;
  }

  isAbsoluteUrl = (url) => {
    // 1. Filtro rápido: Si no tiene ':', no puede ser absoluta (evita el try/catch)
    if (typeof url !== "string" || !url.includes(":")) return false;

    try {
      // 2. El constructor URL lanza error si no es válida
      // new URL() acepta rutas relativas si se le da una base,
      // pero si solo le pasas un string, valida si parece absoluta.
      // Para ser 100% seguros de que es absoluta, verificamos el protocolo.
      const parsed = new URL(url);
      // ws:, wss:, http:, https:, ftp:, etc.
      return parsed.protocol.length > 0;
    } catch (e) {
      return false;
    }
  };

  /**
   * Punto de entrada principal
   */
  create(url, shouldApplyAuto = true) {
    let uF;
    // Si es absoluta, devolvemos uFetch directo
    if (this.isAbsoluteUrl(url)) {
      uF = new uFetch(url);
    }

    if (!uF) {
      // Si es relativa, procesamos
      const finalPath = shouldApplyAuto ? this._applyEnvironment(url) : url;
      uF = new uFetch(this._buildFullUrl(finalPath));
    }

    if (this.headers) {

      for (const key of this.headers.keys()) {
        uF.addHeader(key, this.headers.get(key));
      }
    }

    return uF;
  }

  auto(url) {
    return this.create(url, true);
  }

  /**
   * Construye la URL completa
   * @private
   */
  _buildFullUrl(path) {
    // Aseguramos que el path empiece con /
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return `${this.base}${normalizedPath}`;
  }

  /**
   * Aplica la lógica de reemplazo de sufijos
   * @private
   */
  _applyEnvironment(path) {
    // Reemplaza /auto o /env permitiendo query strings o hash al final
    // Ejemplo: /api/auto?q=1 -> /api/prd?q=1
    return path.replace(/\/(auto|env)(\?|#|$)/, `/${this.environment}$2`);
  }
}

export const json_to_xlsx_buffer = (
  data = { filename: "file", sheets: [{ sheet: "Sheet1", data: [] }] },
) => {
  try {
    //let resultBuffer = null;
    // Paso 1: Crear un nuevo libro (workbook)
    const workbook = XLSX.utils.book_new();

    if (Array.isArray(data.sheets)) {
      for (let index = 0; index < data.sheets.length; index++) {
        const sheetInfo = data.sheets[index];
        const sheetName = sheetInfo.sheet || `Sheet${index + 1}`;
        const jsonData = sheetInfo.data || [];
        // Convertir el array de objetos a una hoja de cálculo (worksheet)
        // - `json_to_sheet` convierte automáticamente los objetos a una hoja.
        // - Property names (a, b) become the column headers.
        const worksheet = XLSX.utils.json_to_sheet(jsonData);

        // Definir los estilos
        const headerStyle = {
          fill: {
            fgColor: { rgb: "D3D3D3" }, // Fondo gris claro para el encabezado
          },
          font: {
            bold: true,
          },
        };

        // Aplicar estilo al encabezado (primera fila)
        if (worksheet["!ref"]) {
          const range = XLSX.utils.decode_range(worksheet["!ref"]);
          for (let col = range.s.c; col <= range.e.c; col++) {
            const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
            if (worksheet[cellAddress]) {
              worksheet[cellAddress].s = headerStyle;
            }
          }
        }

        // Añadir la hoja al libro
        // - Primer parámetro: la hoja creada
        // - Segundo parámetro: el nombre de la hoja (aparecerá en la pestaña abajo)
        XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
      }
    }

    // Obtenemos el Buffer directamente en memoria, sin guardar nada en disco
    const buffer = XLSX.write(workbook, {
      bookType: "xlsx",
      type: "buffer",
      compression: true,
    });
    return {
      buffer: Buffer.from(buffer),
      filename: data.filename || "data.xlsx",
      contentDisposition: `attachment; filename="${data.filename || "data.xlsx"}"`,
      ContentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
  } catch (error) {
    console.error("Error generating XLSX:", error);
    // Return empty buffer or handle as needed, for now just returning error structure or similar might be better but 
    // strictly, the caller expects a buffer object. Let's return a safe failure object or rethrow.
    // Given the context (likely used in an API response), returning specific error might be handled by caller if they check properties.
    // But to be safe and consistent with previous behavior (which crashed), let's swallow and return null or throw. 
    // The previous code crashed. Rethrowing with a clearer message is better.
    throw new Error("Failed to generate XLSX: " + error.message);
  }
};

export const xlsx_body_to_json = async (request) => {
  let result = [];

  const contentType = request.headers["content-type"];

  // Identifica el tipo de dato que llega y extrae los valores
  if (contentType && contentType.includes("multipart/form-data")) {
    // Multipart (archivos, streams, etc)
    for (let name in request.body) {
      //console.log("Processing body field:", name);
      let element = request.body[name];

      if (Array.isArray(element)) {
        // Es una lista de archivos con el mismo nombre
        //console.log(`Field ${name} is an array with ${element.length} items.`);

        for (let index = 0; index < element.length; index++) {
          const file = element[index];
          if (file && file.type === "file") {
            let buffer = await file.toBuffer();
            result.push({
              filename: file.filename,
              sheets: xlsx_buffer_to_json(buffer),
            });
          }
        }
      } else if (element && element.type === "file") {
        //console.log(`Field ${name} is a file of type ${element.mimetype}.`);
        let buffer = await element.toBuffer();
        result.push({
          filename: element.filename,
          sheets: xlsx_buffer_to_json(buffer),
        });
      }
    }
  }

  return result;
};

const xlsx_buffer_to_json = (buffer) => {
  let sheets = [];
  try {
    let workbook = XLSX.read(buffer, { type: "buffer" });

    let sheet_names = workbook.SheetNames;
    for (let index = 0; index < sheet_names.length; index++) {
      let sheet_name = sheet_names[index];
      const worksheet = workbook.Sheets[sheet_name];
      let out_json = XLSX.utils.sheet_to_json(worksheet, {
        header: 0,
        raw: false,
      });
      sheets.push({ sheet: sheet_name, data: out_json });
    }
  } catch (error) {
    console.error("Error processing XLSX buffer:", error);
  }

  return sheets;
};

export const functionsVars = (request, reply, environment) => {
  let fnVars = listFunctionsVars(request, reply, environment);
  let fnResult = {};
  let keys = Object.keys(fnVars);

  try {
    for (let index = 0; index < keys.length; index++) {
      const k = keys[index];
      fnResult[k] = fnVars[k].fn;
    }
  } catch (error) {
    console.error(error);
  }

  return fnResult;
};

export const listFunctionsVars = (request, reply, environment) => {

  let headers = new Headers();

  if (request) {
    let trace_id = request.headers?.["ofapi-trace-id"];
    if (trace_id) {
      headers.append("ofapi-trace-id", trace_id);
    }
  }

  const fnUrlae = new URLAutoEnvironment({ environment, port: PORT, headers });

  const own_repo = "https://github.com/rdsslab/libOpenFusionAPI";

  const ofapi = {
    server: reply ? reply?.openfusionapi?.server : undefined,
    genToken: request && reply ? GenToken : undefined,

    throw: (message, http_statusCode = 500, data = null) => {
      let status = isValidHttpStatusCode(http_statusCode)
        ? http_statusCode
        : 500;
      throw { message, data, date: new Date(), statusCode: status };
    },

    log: (message, data = null, level = "info") => {
      try {
        const trace_id = request?.headers?.["ofapi-trace-id"] || request?.headers?.get?.("ofapi-trace-id") || crypto.randomUUID();
        const idapp = request?.openfusionapi?.handler?.params?.idapp || null;
        const idendpoint = request?.openfusionapi?.handler?.params?.idendpoint || null;
        
        let status_code = 200;
        let log_level = 2; // INFO
        
        const lvl = String(level).toLowerCase();
        if (lvl === "debug") {
          log_level = 1;
        } else if (lvl === "warn" || lvl === "warning") {
          log_level = 3;
          status_code = 400; // soft warning status
        } else if (lvl === "error" || lvl === "fatal") {
          log_level = 4;
          status_code = 500; // error status
        }

        const logData = {
          trace_id,
          timestamp: new Date(),
          idapp,
          idendpoint,
          method: request?.method || "LOG",
          url: request?.url || "custom-log",
          status_code,
          log_level,
          client: request?.ip || "localhost",
          message: {
            log: message,
            data
          },
          response_time: 0
        };

        const pushLogFn = reply?.openfusionapi?.server?.TasksInterval?.pushLog;

        if (typeof pushLogFn === "function") {
          pushLogFn.call(reply.openfusionapi.server.TasksInterval, logData);
        } else {
          console.warn("[URGENTE] deofapi: La cola de logs asíncrona (TasksInterval) no está disponible. Guardando directamente en BD.");
          if (typeof createLog === "function") {
            createLog(logData).catch((err) => {
              console.error("[URGENTE] deofapi: Error crítico al guardar log de fallback en la base de datos:", err);
            });
          } else {
            console.error("[URGENTE] deofapi: La función 'createLog' de base de datos no está disponible. No se pudo guardar el log.");
          }
        }
      } catch (err) {
        console.error("[URGENTE] deofapi: Error inesperado en ofapi.log:", err);
      }
    },
  };

  return {
    OpenAI: {
      fn: request && reply ? OpenAI : undefined,
      description: "Official OpenAI SDK for calling language, reasoning, and multimodal models from JS handlers.",
      web: "https://github.com/openai/openai-node",
      return: "OpenAI client instance",
      notes: [
        "Requires a valid API key, typically injected through App Vars or environment variables.",
        "Outbound network access must be available from the server running the JS handler.",
      ],
      agentGuidance: [
        "Use this when the endpoint must call an external OpenAI model directly instead of delegating to another internal endpoint.",
        "Return only the relevant subset of the SDK response unless the caller explicitly needs raw provider metadata.",
      ],
      example: `
const client = new OpenAI({
  apiKey: endpointEnv.OPENAI_API_KEY,
});

const response = await client.responses.create({
  model: 'gpt-4.1-mini',
  input: 'Summarize in one sentence what OpenFusionAPI does.',
});

$_RETURN_DATA_ = {
  text: response.output_text,
  id: response.id,
};
      `,
    },
    ofapi: {
      fn: request && reply ? ofapi : undefined,
      description: "OpenFusionAPI runtime helpers exposed to JS handlers.",
      web: own_repo,
      return: {
        type: "object",
        description: "Utility object with server context and helper methods.",
        object: [
          { name: "server", type: "object", description: "Runtime server information when available." },
          { name: "genToken", type: "function", description: "Signs a JWT token for OpenFusionAPI usage." },
          { name: "throw", type: "function", description: "Throws a controlled HTTP exception." },
          { name: "log", type: "function", description: "Saves a log entry asynchronously in the high-performance log queue (accepts message, data, level)." },
        ],
      },
      notes: [
        "Use ofapi.throw when you need a structured HTTP error from JS handler code.",
      ],
    },
    xmlCrypto: {
      fn: request && reply ? xmlCrypto : undefined,
      description: "It is a Node.js package that allows working with XML digital signatures, facilitating the signing and verification of XML documents using the XML Signature specification, ideal for applications that handle security and data validation in this format, using private and public keys.",
      web: "https://github.com/node-saml/xml-crypto",
      return: "Read documentation",
      example: `
const xml = fs.readFileSync('my-xml-doc.xml');
const sig = new xmlCrypto.SignedXml();

sig.addReference(
  '//*[local-name(.)="Invoice"]',
  ['http://www.w3.org/2000/09/xmldsig#enveloped-signature'],
  'http://www.w3.org/2001/10/xml-exc-c14n#'
);

sig.loadXml(xml);

const key = fs.readFileSync('my-key.pem');
sig.signingKey = key;

sig.computeSignature();

const signedXml = sig.getSignedXml();
$_RETURN_DATA_ = signedXml;
      `,
    },
    xmlFormatter: {
      fn: request && reply ? xmlFormatter : undefined,
      description: "Formats XML into a readable, pretty-printed string.",
      web: "https://github.com/chrisbottin/xml-formatter",
      return: "Formatted XML string",
      notes: [
        "Useful for debugging SOAP/XML payloads before returning them or saving them to logs.",
      ],
      example: `
const xml = '<root><child>Hello</child></root>';
const formattedXml = xmlFormatter(xml, { indentation: '  ' });
$_RETURN_DATA_ = formattedXml;
      `,
    },
    xmldom: {
      fn: request && reply ? xmldom : undefined,
      description: "A JavaScript implementation of W3C DOM for Node.js, Rhino and the browser. Fully compatible with W3C DOM level2; and some compatible with level3.",
      web: "https://github.com/xmldom/xmldom",
      return: "Read documentation",
      example: `
const parser = new xmldom.DOMParser();
const doc = parser.parseFromString('<root><child>Hello</child></root>', 'text/xml');
$_RETURN_DATA_ = doc;
      `,
    },
    dnsPromises: {
      fn: request && reply ? dnsPromises : undefined,
      description: "The DNS module enables name resolution functions. It contains methods for performing DNS queries of various types, as well as utility functions for converting between IP addresses in text and binary forms.",
      web: "https://nodejs.org/api/dns.html",
      return: "Read documentation",
      example: `
const addresses = await dnsPromises.resolve4('example.com');
$_RETURN_DATA_ = addresses;
      `,
    },
    xml2js: {
      fn: request && reply ? xml2js : undefined,
      description: "Simple XML to JavaScript object converter. It supports bi-directional conversion.",
      web: "https://github.com/Leonidas-from-XIV/node-xml2js",
      return: "Read documentation",
      example: `
const parser = new xml2js.Parser();
const result = await parser.parseStringPromise('<root><child>Hello</child></root>');
$_RETURN_DATA_ = result;
      `,
    },
    forge: {
      fn: request && reply ? forge.default : undefined,
      description: "A native implementation of TLS (and various other cryptographic tools) in JavaScript.",
      web: "https://github.com/digitalbazaar/forge",
      return: "Read documentation",
      example: `
const pki = forge.pki;
const keys = pki.rsa.generateKeyPair(2048);
const pem = pki.encryptRsaPrivateKey(keys.privateKey, 'password');
$_RETURN_DATA_ = pem;
      `,
    },
    json_to_xlsx_buffer: {
      fn: request && reply ? json_to_xlsx_buffer : undefined,
      description: "Builds an XLSX workbook in memory and returns the binary buffer plus download metadata.",
      web: own_repo,
      params: [
        {
          name: "data",
          info: "Workbook definition. Example: { filename: 'report.xlsx', sheets: [{ sheet: 'Sheet1', data: [{ id: 1 }] }] }",
          type: "object",
        },
      ],
      return: {
        type: "object",
        description: "Workbook binary and download metadata.",
        object: [
          { name: "buffer", type: "Buffer", description: "XLSX binary content." },
          { name: "filename", type: "string", description: "Suggested filename." },
          { name: "contentDisposition", type: "string", description: "Download header value." },
          { name: "ContentType", type: "string", description: "MIME type for XLSX." },
        ],
      },
      notes: [
        "This helper does not send the file by itself; you still need to assign headers and return the buffer.",
      ],
      agentGuidance: [
        "If the endpoint should download a file, set $_CUSTOM_HEADERS_ from the returned metadata and assign only result.buffer to $_RETURN_DATA_.",
      ],
      example: `
const data = {
  filename: 'users.xlsx',
  sheets: [
    {
      sheet: 'Users',
      data: [
        { name: 'John', age: 30 },
        { name: 'Jane', age: 25 },
      ],
    },
  ],
};

const result = json_to_xlsx_buffer(data);

$_CUSTOM_HEADERS_.set('Content-Type', result.ContentType);
$_CUSTOM_HEADERS_.set('Content-Disposition', result.contentDisposition);

$_RETURN_DATA_ = result.buffer;
      `,
    },
    request_xlsx_body_to_json: {
      fn: request && reply ? xlsx_body_to_json : undefined,
      description: "Reads uploaded XLSX files from a multipart/form-data request and converts their sheets into JSON rows.",
      web: own_repo,
      params: [
        {
          name: "request",
          description: "Fastify request object containing multipart form-data files.",
          required: true,
          type: "object",
        },
      ],
      return: "Array of objects with the data of each sheet of each Excel file.",
      notes: [
        "Only multipart file fields are processed; regular text fields remain available on request.body.",
      ],
      agentGuidance: [
        "Use this helper only when the endpoint receives an uploaded spreadsheet; do not use it for plain JSON requests.",
      ],
      example: `
const files = await request_xlsx_body_to_json(request);
const firstWorkbook = files[0];

$_RETURN_DATA_ = {
  filename: firstWorkbook?.filename,
  sheets: firstWorkbook?.sheets,
};
      `
    },
    crypto: {
      fn: request && reply ? crypto : undefined,
      description: "Node.js crypto module",
      web: "https://nodejs.org/api/crypto.html",
      return: "Read documentation",
      example: `
const hash = crypto.createHash('sha256');
hash.update('hello world');
const hex = hash.digest('hex');
$_RETURN_DATA_ = hex;
      `,
    },
    $_ENV_: { fn: environment, description: "Current runtime environment (dev, qa, prd)", web: own_repo, return: "string", notes: ["This variable is injected automatically based on the server environment and can be used for environment-specific logic in handlers."], example: `if ($_ENV_ === 'dev') { /* dev-only code */ }` },
    $_RETURN_DATA_: {
      fn: {},
      description: "Primary output slot for JS handlers. Assign the final payload here instead of using return.",
      web: own_repo,
      return: "Any values",
      notes: [
        "This is the supported JS handler response contract.",
      ],
      agentGuidance: [
        "Prefer assigning to $_RETURN_DATA_ over calling reply.send() directly unless you need low-level Fastify control.",
      ],
      example: `
$_RETURN_DATA_ = { name: 'John', age: 30 };
      `,
    },
    $_CUSTOM_HEADERS_: {
      fn: new Map(),
      description: "Map of custom response headers to send together with $_RETURN_DATA_.",
      web: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map",
      return: "Map object with custom headers",
      notes: [
        "Useful for downloads, custom content types, caching headers, and content disposition.",
      ],
      agentGuidance: [
        "Set headers here before assigning binary or special response payloads to $_RETURN_DATA_.",
      ],
      example: `
$_CUSTOM_HEADERS_.set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
$_CUSTOM_HEADERS_.set(
  "Content-Disposition",
  'attachment; filename="file.xlsx"',
);
      `,
    },
    reply: {
      fn: request && reply ? reply : undefined,
      description: "Fastify Reply object for low-level response control.",
      web: "https://fastify.dev/docs/latest/Reference/Reply/#introduction",
      return: "Fastify Reply object",
      notes: [
        "Once you send a response manually with reply.send(), avoid also assigning a different value to $_RETURN_DATA_.",
      ],
      agentGuidance: [
        "Use reply directly only when $_RETURN_DATA_ and $_CUSTOM_HEADERS_ are not enough for the desired response behavior.",
      ],
      example: `
reply.code(200).send({ name: 'John', age: 30 });
      `,
    },
    request: {
      fn: request && reply ? request : undefined,
      description: "Fastify Request object with body, query, headers, params, and request metadata.",
      web: "https://fastify.dev/docs/latest/Reference/Request/",
      return: "Fastify Request object",
      notes: [
        "For GET endpoints, use request.query. For JSON POST endpoints, use request.body.",
      ],
      example: `
$_RETURN_DATA_ = {
  query: request.query,
  body: request.body,
  headers: request.headers,
};
      `,
    },
    uFetch: {
      fn: request && reply ? uFetch : undefined,
      description: "Universal HTTP client for Node.js and browsers. Primary use is standard fetch-style requests (get/post/put/patch/delete); batch adds controlled parallel processing for large input sets.",
      web: "https://github.com/rdsslab/uFetch",
      params: [
        {
          name: "constructor(url?, redirect_in_unauthorized?, timeoutOptions?)",
          description: "Creates an instance with optional base URL for relative paths. In browser mode, redirect_in_unauthorized can redirect on 401. timeoutOptions configures default timeout behavior.",
          required: false,
          type: "function",
        },
        {
          name: "request(url, method, data, headers, options, body, timeout)",
          description: "Low-level request method used by all wrappers.",
          required: false,
          type: "function",
        },
        {
          name: "get|post|put|patch|delete({ url, data, body, headers, options, timeout })",
          description: "Convenience wrappers for common HTTP methods.",
          required: false,
          type: "function",
        },
        {
          name: "batch({ url, method, items, headers, options, config })",
          description: "Parallel fail-safe processor. Receives a single options object and returns one result per item without failing the whole batch.",
          required: false,
          type: "function",
        },
        {
          name: "batch_old(url, method, items, headers, options, config)",
          description: "Legacy compatibility wrapper for positional batch calls.",
          required: false,
          type: "function",
        },
      ],
      return: {
        type: "object",
        description: "uFetch instance with request wrappers and auth helpers.",
        object: [
          { name: "request", type: "function", description: "Core request primitive." },
          { name: "get|post|put|patch|delete", type: "function", description: "HTTP method wrappers using opts object." },
          { name: "batch", type: "function", description: "Fail-safe batch execution with configurable concurrency." },
          { name: "setTimeouts", type: "function", description: "Updates global timeout defaults for this instance." },
          { name: "setAbortTimeout", type: "function", description: "Convenience helper to update only global timeout." },
          { name: "setBasicAuthorization", type: "function", description: "Sets persistent Basic auth header for the instance." },
          { name: "setBearerAuthorization", type: "function", description: "Sets persistent Bearer auth header for the instance." },
          { name: "abort", type: "function", description: "Aborts active in-flight requests for this instance." },
        ],
      },
      notes: [
        "Use uFetch when the target URL is absolute or belongs to another system.",
        "Primary workflow: use get/post/put/patch/delete for single requests or simple request chains.",
        "Quick decision: one request => get/post/put/patch/delete.",
        "Quick decision: list/lote of requests with controlled parallel workers => batch({ items, config: { concurrency, ... } }).",
        "For GET or HEAD, data is serialized as query string. For non-GET methods, object data is serialized as JSON automatically.",
        "Method wrappers accept body to force payload in HTTP body and timeout to override request duration.",
        "Use setTimeouts({ timeout, headersTimeout, bodyTimeout, socketTimeout }) to configure default timeouts at instance level.",
        "Use setAbortTimeout(timeout) as a shortcut when only abort timeout must be adjusted.",
        "Use batch() when you must process many calls from a list and split the workload into concurrent workers/blocks.",
        "batch() returns per-item result objects and is designed to continue even if some items fail; always inspect isError per item.",
        "batch() signature: batch({ url, method, items, headers, options, timeout, config: { concurrency, onProgress, responseParser, includeResponse } }).",
        "If an item includes any of { url, method, data, body, headers, options, timeout }, those fields override base values for that item.",
        "Positional signature batch(url, method, items, headers, options, config) is not accepted by batch(); use batch_old(...) for legacy compatibility.",
        "Each batch result item has shape by default: { isError, httpCode, data?, error? }.",
        "If config.includeResponse is true, each result may also include response.",
        "Authorization helpers persist at instance level. Create a fresh instance when different credentials must be isolated.",
      ],
      agentGuidance: [
        "For internal OpenFusionAPI endpoints in the same instance, prefer uFetchAutoEnv instead of hardcoding dev/qa/prd URLs.",
        "Start with get/post/put/patch/delete and switch to batch only when you have a collection of inputs to process concurrently.",
        "If you need per-item fault tolerance and progress in a large workload, prefer batch over Promise.all.",
        "Prefer method wrappers with opts object for readability: get/post/put/patch/delete({ url, data, body, headers, options, timeout }).",
        "Use request(url, method, data, headers, options, body, timeout) only when method must be computed dynamically.",
        "For bulk operations, prefer batch() over Promise.all to avoid failing the full operation due to a single request error.",
        "Prefer the object signature of batch(); use batch_old() only while migrating legacy positional code.",
      ],
      example: `
const api = new uFetch('https://api.example.com');

api.setBearerAuthorization(endpointEnv.API_TOKEN);

const usersRes = await api.get({
  url: '/users',
  data: { role: 'admin', page: 1 },
});

const createRes = await api.post({
  url: '/users',
  data: { username: 'johndoe' },
  timeout: 30000,
});

api.setAbortTimeout(90000);

const batchResults = await api.batch({
  url: '/users',
  method: 'POST',
  timeout: 60000,
  items: [
    { username: 'a' },
    { username: 'b', method: 'PUT', timeout: 15000 },
    { url: 'https://other-api.example/log', data: { msg: 'audit' } },
  ],
  config: {
    concurrency: 5,
    includeResponse: false,
  },
});

$_RETURN_DATA_ = {
  users: await usersRes.json(),
  created: await createRes.json(),
  batch: batchResults.map((r) => ({
    isError: r.isError,
    httpCode: r.httpCode,
    hasData: typeof r.data !== 'undefined',
  })),
};
      `,
    },
    uFetchAutoEnv: {
      fn: request && reply ? fnUrlae : undefined,
      description: `OpenFusionAPI helper that wraps uFetch for same-instance calls. Use it mainly with get/post/put/patch/delete and optionally with batch for parallelized internal fan-out. It resolves /auto or /env suffixes to the current runtime environment.`,
      web: "https://github.com/rdsslab/uFetch",
      params: [
        {
          name: "create(url, shouldApplyAuto = true)",
          description: "Creates a uFetch instance for the given URL/path. Relative paths are resolved against current server base URL and port.",
          required: false,
          type: "function",
        },
        {
          name: "auto(url)",
          description: "Shortcut for create(url, true).",
          required: false,
          type: "function",
        },
      ],
      return: {
        type: "object",
        description: "URLAutoEnvironment instance exposing create() and auto() that return uFetch instances.",
        object: [
          { name: "create", type: "function", description: "Builds uFetch instance from relative/absolute URL with optional environment replacement." },
          { name: "auto", type: "function", description: "Always applies environment suffix replacement for /auto and /env." },
        ],
      },
      notes: [
        "For relative paths, this helper builds a full URL using current base URL and server port.",
        "If the path contains /auto or /env suffix before query/hash, it is replaced by the current environment (dev, qa, prd).",
        "Absolute URLs bypass environment replacement and are sent as-is.",
        "Most endpoints should start with get/post/put/patch/delete; batch is for list-driven parallel calls with controlled concurrency.",
        "Quick decision: if you need N calls to the same internal endpoint with a lote, use create('/api/.../auto') + batch({ method, items, config }).",
        "create()/auto() return a uFetch instance, so batch({ ...opts }) is also available for internal fan-out calls.",
        "Request trace header ofapi-trace-id is propagated automatically when available.",
      ],
      agentGuidance: [
        "Prefer relative internal URLs such as /api/myapp/resource/auto instead of hardcoded localhost URLs.",
        "Use auto() for environment-agnostic internal calls and keep endpoint code portable across dev/qa/prd.",
        "Use create(path, false) when you must preserve a literal path and avoid automatic /auto or /env replacement.",
        "After obtaining the uFetch instance, use standard uFetch methods like get/post/put/patch/delete with opts object.",
      ],
      example: `
const sumFetch = uFetchAutoEnv.auto('/api/datetime_app/sum-array/auto');
const sumResponse = await sumFetch.post({
  data: { numbers: [4, 12, 9] },
});

const usersFetch = uFetchAutoEnv.create('/api/myapp/users/env?active=true#view');
const usersResponse = await usersFetch.get();

const soapFetch = uFetchAutoEnv.create('/api/demo/ofapi/soap/example01/auto');
const items = Array.from({ length: 40 }, (_, i) => ({ dNum: i + 1 }));
const batch = await soapFetch.batch({
  method: 'GET',
  items,
  config: {
    concurrency: 5,
  },
});

$_RETURN_DATA_ = {
  sum: await sumResponse.json(),
  users: await usersResponse.json(),
  batchSummary: batch.map((r) => ({ isError: r.isError, httpCode: r.httpCode })),
};
      `,
    },
    PromiseSequence: {
      fn: request && reply ? PromiseSequence : undefined,
      description: "Utility for processing async tasks sequentially or in controlled batches.",
      web: "https://github.com/rdsslab/sequential-promises",
      notes: [
        "Useful when you must avoid flooding an external API or database with too many parallel calls.",
      ],
      agentGuidance: [
        "Use this when order matters or when downstream systems require throttled execution.",
      ],
      example: `
function processBlock(block) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({ data: block * 2 });
    }, 250);
  });
}

const data = [1, 2, 3, 4, 5];
const batchSize = 2;

const result = await PromiseSequence.ByItems(processBlock, batchSize, data);
$_RETURN_DATA_ = result;
      `,
    },
    sequentialPromises: {
      fn: request && reply ? PromiseSequence : undefined,
      description: "Legacy alias of PromiseSequence kept for backward compatibility.",
      web: "https://github.com/rdsslab/sequential-promises",
      notes: [
        "Deprecated alias. Prefer PromiseSequence in new endpoint code.",
      ],
      example: `
const result = await sequentialPromises.ByBlocks(async (item) => item, 2, [1, 2, 3, 4]);
$_RETURN_DATA_ = result;
      `,
    },
    uuid: {
      fn: request && reply ? uuid : undefined,
      description: "UUID package to generate RFC4122 UUIDs.",
      web: "https://www.npmjs.com/package/uuid",
      example: `
const result_uuid = uuid.v4();
$_RETURN_DATA_ = result_uuid;
      `,
    },
    mongoose: {
      fn: request && reply ? mongoose : undefined,
      description: "MongoDB ODM for defining schemas, models, and queries with validation support.",
      web: "https://mongoosejs.com",
      notes: [
        "Long-lived connections should be reused carefully; close temporary connections when the job is done.",
      ],
      agentGuidance: [
        "Prefer MONGODB handlers for direct data access endpoints; use mongoose in JS handlers when you need schema logic, orchestration, or mixed business rules.",
      ],
      example: `
await mongoose.connect('mongodb://127.0.0.1:27017/test');

const Cat = mongoose.model('Cat', { name: String });
await Cat.create({ name: 'Zildjian' });

const cats = await Cat.find().lean();
await mongoose.disconnect();

$_RETURN_DATA_ = cats;
      `,
    },
    $_EXCEPTION_: {
      fn: request && reply ? jsException : undefined,
      description: "Interrupts the program flow and throws an exception with a specific message and status code.",
      web: own_repo,
      params: [
        {
          name: "message",
          description: "The error message to display.",
          required: true,
          type: "string",
          default: "",
        },
        {
          name: "data",
          description: "Additional context data for the error.",
          required: false,
          type: "any",
          default: null,
        },
        {
          name: "statusCode",
          description: "HTTP Status Code for the response.",
          required: false,
          type: "integer",
          default: 500,
        },
      ],
      return: {
        type: "void",
        description: "Throws an exception object that stops execution.",
        object: [
          {
            name: "message",
            description: "The error message.",
            type: "string",
          },
          {
            name: "data",
            description: "Context data.",
            type: "any",
          },
          {
            name: "statusCode",
            description: "HTTP Status Code.",
            type: "integer",
          },
        ],
      },
      example: `// simple usage
$_EXCEPTION_("Invalid input parameter");

// with data and status code
$_EXCEPTION_("User not found", { userId: 123 }, 404);`,
    },
    jwt: {
      fn: request && reply ? jwt : undefined,
      description: "An implementation of JSON Web Tokens.",
      web: "https://github.com/auth0/node-jsonwebtoken",
      example: `
      const token = jwt.sign({ foo: 'bar' }, 'shhhhh');
      $_RETURN_DATA_ = token;
      `
    },
    luxon: {
      fn: request && reply ? luxon : undefined,
      description: "Friendly wrapper for JavaScript dates and times",
      web: "https://moment.github.io/luxon",
      example: `
      const dt = luxon.DateTime.now();
      $_RETURN_DATA_ = dt;
      `
    },
    pdfjs: {
      fn: request && reply ? pdfjs : undefined,
      description: "PDF parsing library for reading text, metadata, and page structure from PDF documents.",
      web: "https://mozilla.github.io/pdf.js/",
      notes: [
        "This is useful for extraction and inspection, not for generating PDFs.",
      ],
      agentGuidance: [
        "Use this when the endpoint must inspect uploaded or downloaded PDFs; do not use it for PDF generation workflows.",
      ],
      example: `
const fileResponse = await fetch('https://mozilla.github.io/pdf.js/web/compressed.tracemonkey-pldi-09.pdf');
const fileBuffer = Buffer.from(await fileResponse.arrayBuffer());

const doc = await pdfjs.getDocument({ data: fileBuffer }).promise;
const page = await doc.getPage(1);
const content = await page.getTextContent();

$_RETURN_DATA_ = {
  pages: doc.numPages,
  firstPageTextItems: content.items.length,
};
      `
    },

    createImageFromHTML: {
      fn: request && reply ? createImageFromHTML : undefined,
      description: "Renders HTML content or a URL into an image buffer.",
      web: own_repo,
      params: [
        {
          name: "html",
          description: "String HTML",
          required: false,
          value_type: "string",
          default_value: "",
        },
        {
          name: "url",
          description: "URL resource",
          required: false,
          value_type: "string",
          default_value: "",
        },
        {
          name: "type",
          description: "Output type",
          required: false,
          value_type: "string",
          default_value: "png",
        },
        {
          name: "quality",
          description: "quality",
          required: false,
          value_type: "integer",
          default_value: 90,
        },
        {
          name: "fullPage",
          description: "fullPage",
          required: false,
          type: "boolean",
          default_value: true,
        },
      ],
      return: "NodeJS.ArrayBufferView",
      notes: [
        "Pass either html or url. If both are provided, your wrapper implementation defines precedence.",
        "Supports both positional arguments style (html, url, type, quality, fullPage) and single object parameter style ({ html, url, type, quality, fullPage }).",
      ],
      agentGuidance: [
        "Use this when the endpoint must return a screenshot-like image artifact generated on demand.",
      ],
      example: `
const image = await createImageFromHTML('<html><body><h1>Hello</h1></body></html>', '', 'png');

$_CUSTOM_HEADERS_.set("Content-Type", "image/png");
$_CUSTOM_HEADERS_.set(
  "Content-Disposition",
  'attachment; filename="file.png"',
);

$_RETURN_DATA_ = image;
      `,
    },

    createPDFFromHTML: {
      fn: request && reply ? createPDFFromHTML : undefined,
      description: "Generates a PDF document from an HTML string or a URL.",
      web: own_repo,
      params: [
        {
          name: "html",
          description: "Raw HTML content to render.",
          required: false,
          type: "string",
          default: "",
        },
        {
          name: "url",
          description: "URL of the page to convert to PDF.",
          required: false,
          type: "string",
          default: "",
        },
        {
          name: "format",
          description: "Paper format (e.g., 'A4', 'Letter').",
          required: false,
          type: "string",
          default: "A4",
        },
        {
          name: "landscape",
          description: "Whether to print in landscape mode.",
          required: false,
          type: "boolean",
          default: false,
        },
        {
          name: "margin",
          description: "Page margins (e.g., '10mm').",
          required: false,
          type: "string",
          default: "10mm",
        },
        {
          name: "printBackground",
          description: "Whether to print background graphics.",
          required: false,
          type: "boolean",
          default: true,
        },
      ],
      return: "NodeJS.ArrayBufferView",
      notes: [
        "Pass either html or url depending on whether the content is already available in memory.",
        "Supports both positional arguments style (html, url, format, landscape, margin, printBackground) and single object parameter style ({ html, url, format, landscape, margin, printBackground }).",
      ],
      agentGuidance: [
        "Use this for report exports, tickets, or printable documents assembled inside the handler.",
      ],
      example: `
const pdf = await createPDFFromHTML('<html><body><h1>Monthly Report</h1></body></html>');

$_CUSTOM_HEADERS_.set("Content-Type", "application/pdf");
$_CUSTOM_HEADERS_.set(
  "Content-Disposition",
  'attachment; filename="file.pdf"',
);

$_RETURN_DATA_ = pdf;
      `,
    },

    sequelize: {
      fn: request && reply ? sequelize : undefined,
      description: "Sequelize is a modern TypeScript and Node.js ORM for Oracle, Postgres, MySQL, MariaDB, SQLite and SQL Server, and more.",
      web: "https://sequelize.org/",
      notes: [
        "Useful for ad hoc relational DB operations inside JS handlers, but prefer the SQL handler when the endpoint is mostly a database proxy.",
      ],
      agentGuidance: [
        "Choose sequelize here only when you need transactions, model logic, or multi-step orchestration in JS instead of a single SQL statement.",
      ],
      example: `
const seq = new sequelize.Sequelize({
  dialect: "sqlite",
  storage: ":memory:",
  logging: false,
});

try {
  await seq.authenticate();
  await seq.query("CREATE TABLE users (iduser INTEGER PRIMARY KEY, name TEXT, email TEXT);");
  await seq.query("INSERT INTO users (iduser, name, email) VALUES (1, 'Juan', 'juan@mail.com'), (2, 'Ana', 'ana@mail.com');");

  const result = await seq.query(
    "SELECT * FROM users WHERE iduser = $iduser",
    {
      bind: { iduser: 1 },
      type: sequelize.QueryTypes.SELECT,
    }
  );

  $_RETURN_DATA_ = result;
} finally {
  await seq.close();
}

      `
    },
    z: {
      fn: request && reply ? Zod : undefined,
      description: "Zod schema builder and validator, exposed in the JS handler as the variable z.",
      web: "https://zod.dev/?id=introduction",
      notes: [
        "The runtime key is z, even though the imported module is named Zod in this source file.",
      ],
      example: `
const schema = z.object({
  name: z.string(),
  age: z.number().int().nonnegative(),
});

const result = schema.parse({ name: 'John', age: 30 });
$_RETURN_DATA_ = result;
      `
    },
    nodemailer: {
      fn: request && reply ? nodemailerSafe : undefined,
      description: "Nodemailer makes sending email from a Node.js application straightforward and secure, without pulling in a single runtime dependency.",
      web: "https://nodemailer.com/",
      notes: [
        "The runtime wrapper strips mailOptions.envelope.size before sendMail() so untrusted request bodies cannot inject that SMTP parameter.",
      ],
      example: `
      const transporter = nodemailer.createTransport({
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        auth: {
          user: 'username',
          pass: 'password'
        }
      });
      const mailOptions = {
        from: 'sender@example.com',
        to: 'recipient@example.com',
        subject: 'Test Email',
        text: 'This is a test email sent using Nodemailer.'
      };
      const info = await transporter.sendMail(mailOptions);
      $_RETURN_DATA_ = info;
      `
    },
    xlsx: {
      fn: request && reply ? XLSX : undefined,
      description: "SheetJS Community Edition offers battle-tested open-source solutions for extracting useful data from almost any complex spreadsheet and generating new spreadsheets that will work with legacy and modern software alike.",
      web: "https://docs.sheetjs.com/docs/",
      agentGuidance: [
        "Use xlsx when you need direct workbook/worksheet operations. Use json_to_xlsx_buffer when you only need a quick downloadable XLSX file.",
      ],
      example: `
const rows = [
  { name: 'John', age: 30 },
  { name: 'Jane', age: 25 },
];

const worksheet = xlsx.utils.json_to_sheet(rows);
const workbook = xlsx.utils.book_new();
xlsx.utils.book_append_sheet(workbook, worksheet, 'Users');

const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

$_CUSTOM_HEADERS_.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
$_CUSTOM_HEADERS_.set('Content-Disposition', 'attachment; filename="users.xlsx"');
$_RETURN_DATA_ = Buffer.from(buffer);
      `
    },
    askIAWithProviderMCP: {
      fn: request && reply ? askIAWithProviderMCP : undefined,
      description: "Primary provider-first AI helper for JS handlers. It accepts `options.provider`, can connect to one or more MCP servers, exposes those tools to the model, executes tool calls, and returns either the final text or rich diagnostics.",
      web: own_repo,
      params: [
        {
          name: "options.provider",
          description: "Provider configuration. Must include at least `model`. Built-in presets currently available in this repo are `openai`, `openai-compatible`, `azure-openai`, `ollama`, `anthropic`, `claude`, `google`, `gemini`, and `google-gemini`.",
          required: true,
          type: "object",
        },
        {
          name: "options.provider.provider|modelProvider|name|vendor",
          description: "Provider preset selector. Supported values are `openai`, `openai-compatible`, `azure-openai`, `azure`, `ollama`, `anthropic`, `claude`, `google`, `gemini`, and `google-gemini`. If omitted, the helper assumes `openai-compatible`.",
          required: false,
          type: "string",
        },
        {
          name: "options.provider.model",
          description: "Exact model or deployment name to invoke. This field is always required. For Azure OpenAI, pass the deployment name here.",
          required: true,
          type: "string",
        },
        {
          name: "options.provider.baseUrl|baseURL",
          description: "Optional provider base URL override. Use this for custom OpenAI-compatible hosts, Ollama, or Azure OpenAI resource paths.",
          required: false,
          type: "string",
        },
        {
          name: "options.provider.apiKey|api_key",
          description: "Provider API key for OpenAI-compatible or native providers when required. Local Ollama can work without a real key when `baseUrl` is set.",
          required: false,
          type: "string",
        },
        {
          name: "options.provider.azureApiKey|azure_api_key",
          description: "Azure OpenAI API key when using the Azure provider preset.",
          required: false,
          type: "string",
        },
        {
          name: "options.provider.apiVersion|api_version|api-version",
          description: "Azure OpenAI API version. Recommended whenever the provider is Azure OpenAI.",
          required: false,
          type: "string",
        },
        {
          name: "options.provider.temperature",
          description: "Sampling temperature sent to the provider.",
          required: false,
          type: "number",
        },
        {
          name: "options.provider.maxTokens|max_tokens",
          description: "Maximum output tokens for the completion.",
          required: false,
          type: "integer",
        },
        {
          name: "options.provider.toolChoice|tool_choice",
          description: "Optional tool selection policy passed to the provider when MCP tools are available.",
          required: false,
          type: "string|object",
        },
        {
          name: "options.provider.timeout",
          description: "HTTP timeout in milliseconds for provider requests.",
          required: false,
          type: "integer",
          default: 60000,
        },
        {
          name: "options.provider.responseTimeout|responseTimeoutMs|runTimeout",
          description: "Optional overall wait timeout in milliseconds for the AI response cycle. Unlike `timeout`, this aborts the helper run even if the provider SDK itself does not stop promptly.",
          required: false,
          type: "integer",
        },
        {
          name: "options.prompts",
          description: "Prompt input. Accepts a string, an array of strings, or an array of structured chat messages like `{ role, content }`.",
          required: true,
          type: "string|array",
        },
        {
          name: "options.mcpServers",
          description: "Optional MCP server definitions. Each item can include `name`, `url`, `headers`, `timeout`, and `transportPriority`.",
          required: false,
          type: "array<object>",
          default: [],
        },
        {
          name: "options.maxToolRounds",
          description: "Maximum number of tool-execution rounds before forcing a final answer.",
          required: false,
          type: "integer",
          default: 6,
        },
        {
          name: "options.includeDiagnostics",
          description: "When true, returns execution metadata including tool calls, messages, and resolved MCP server info.",
          required: false,
          type: "boolean",
          default: false,
        },
        {
          name: "options.signal",
          description: "Optional AbortSignal used to cancel the provider request.",
          required: false,
          type: "AbortSignal",
        },
      ],
      return: {
        type: "string|object",
        description: "Returns the assistant text by default. When `includeDiagnostics` is true, returns an object with `text`, `provider`, `model`, `messages`, `toolExecutions`, and `mcpServers`.",
      },
      notes: [
        "This is the canonical provider-first helper in `ia.js`. Use it when you want the function name itself to make the provider+MCP contract explicit.",
        "It shares the same runtime behavior as `askAIWithTools`; the difference is naming and intent clarity, not capability.",
        "If you do not need MCP, you can still call this helper with only `provider + prompts`.",
        "If you do need MCP, pass `mcpServers` and the helper will discover tools, expose them to the model, execute them, and continue until the model returns a final answer or the round limit is reached.",
        "Use `includeDiagnostics` when you need to inspect `toolExecutions` or message flow before changing prompts or provider settings.",
        "Use `responseTimeout` or `runTimeout` when you need a hard deadline for the overall AI wait, especially with slower local or remote providers.",
      ],
      agentGuidance: [
        "Prefer this helper when you are writing new JS handler code and want the name to communicate clearly that both the provider and MCP servers are configurable inputs.",
        "Use `askAIWithTools` interchangeably only when brevity matters. Treat both functions as the same runtime capability.",
        "Use `askIAWithMCP` only when you must preserve legacy payloads that already send `ai` instead of `provider`.",
        "If the provider is unknown or controlled by request/App Vars, this helper is usually the clearest option for generated endpoint code.",
        "If MCP capabilities are unknown, call `listMcpTools` first and then call this helper with the selected MCP servers.",
        "If the task is informational, prefer read-only MCP servers or read-only tools and keep `maxToolRounds` low unless the workflow genuinely needs multiple tool steps.",
      ],
      example: `
const result = await askIAWithProviderMCP({
  provider: {
    provider: 'azure-openai',
    model: 'gpt-4o-mini',
    baseUrl: 'https://your-resource.cognitiveservices.azure.com/openai',
    apiVersion: '2025-01-01-preview',
    azureApiKey: $_APP_VARS_['$_VAR_AZURE_OPENAI_API_KEY'],
    responseTimeout: 120000,
  },
  mcpServers: [
    {
      name: 'exa',
      url: 'https://mcp.exa.ai/mcp',
    },
  ],
  prompts: [
    {
      role: 'user',
      content: 'Use MCP if needed and answer with the official Exa MCP page title only.',
    },
  ],
  includeDiagnostics: true,
  maxToolRounds: 4,
});

$_RETURN_DATA_ = result;
      `,
    },
    createAIProviderMCPClient: {
      fn: request && reply ? createAIProviderMCPClient : undefined,
      description: "Low-level MCP-aware AI client factory. Use this when you need explicit connect/list/run/close control instead of a single helper call.",
      web: own_repo,
      params: [
        {
          name: "options.provider",
          description: "Provider configuration with the same shape accepted by askIAWithProviderMCP.",
          required: true,
          type: "object",
        },
        {
          name: "options.mcpServers",
          description: "MCP server list to connect before running or listing tools.",
          required: false,
          type: "array<object>",
          default: [],
        },
      ],
      return: {
        type: "AIProviderMCPClient",
        description: "Client instance with connect(), listTools(), run(), close(), and runtime access for advanced flows.",
      },
      notes: [
        "This is for advanced handler logic such as custom retries, preflight tool inspection, or manual MCP fallback execution.",
        "Always close the client in a finally block to release MCP transports cleanly.",
      ],
      agentGuidance: [
        "Prefer askIAWithProviderMCP for normal one-shot AI+MCP calls.",
        "Use this client only when the handler must inspect tool catalogs, retry with custom logic, or execute a fallback flow after a model fails to use tools correctly.",
      ],
      example: `
const client = createAIProviderMCPClient({
  provider: {
    provider: 'ollama',
    model: 'qwen2.5-coder:1.5b',
    baseUrl: 'http://localhost:11434',
  },
  mcpServers: [{ name: 'exa', url: 'https://mcp.exa.ai/mcp' }],
});

try {
  await client.connect();
  const tools = await client.listTools();
  const result = await client.run({
    prompts: [{ role: 'user', content: 'Usa MCP si hace falta.' }],
    includeDiagnostics: true,
  });

  $_RETURN_DATA_ = { tools, result };
} finally {
  await client.close();
}
      `,
    },
    askIAWithMCP: {
      fn: request && reply ? askIAWithMCP : undefined,
      description: "Legacy compatibility wrapper over askAIWithTools. It accepts `options.ai` instead of `options.provider`, then runs a chat completion and can connect the model to MCP servers so it can discover and invoke tools during the conversation.",
      web: own_repo,
      params: [
        {
          name: "options.ai",
          description: "AI provider configuration. Must include at least `model`. Built-in presets currently available in this repo are `openai`, `openai-compatible`, `azure-openai`, `ollama`, `anthropic`, `claude`, `google`, `gemini`, and `google-gemini`.",
          required: true,
          type: "object",
        },
        {
          name: "options.ai.modelProvider",
          description: "Provider preset selector. Supported values are `openai`, `openai-compatible`, `azure-openai`, `azure`, `ollama`, `anthropic`, `claude`, `google`, `gemini`, and `google-gemini`.",
          required: false,
          type: "string",
        },
        {
          name: "options.ai.model",
          description: "Exact model name to invoke. This field is required.",
          required: true,
          type: "string",
        },
        {
          name: "options.ai.baseUrl|baseURL",
          description: "Optional OpenAI-compatible base URL. Example: `http://localhost:11434` for Ollama. For Azure OpenAI, use the Azure resource OpenAI path such as `https://your-resource.openai.azure.com/openai` or the matching `cognitiveservices.azure.com/openai` endpoint.",
          required: false,
          type: "string",
        },
        {
          name: "options.ai.apiKey|api_key",
          description: "Provider API key when required. If omitted and `baseUrl` is present, the helper uses a placeholder key for local OpenAI-compatible servers.",
          required: false,
          type: "string",
        },
        {
          name: "options.ai.azureApiKey|azure_api_key",
          description: "Optional Azure OpenAI API key. When present, the helper also injects it into the `api-key` header expected by Azure OpenAI.",
          required: false,
          type: "string",
        },
        {
          name: "options.ai.apiVersion|api_version|api-version",
          description: "Optional Azure OpenAI API version. When provided, the helper sends it as `defaultQuery['api-version']`.",
          required: false,
          type: "string",
        },
        {
          name: "options.ai.defaultQuery|default_query",
          description: "Optional default query parameters passed to the AI provider HTTP client. This is especially useful for Azure OpenAI preview versions.",
          required: false,
          type: "object",
        },
        {
          name: "options.ai.temperature",
          description: "Sampling temperature sent to the provider.",
          required: false,
          type: "number",
        },
        {
          name: "options.ai.maxTokens|max_tokens",
          description: "Maximum output tokens for the completion.",
          required: false,
          type: "integer",
        },
        {
          name: "options.ai.toolChoice|tool_choice",
          description: "Optional tool selection policy passed to the provider when MCP tools are available.",
          required: false,
          type: "string|object",
        },
        {
          name: "options.ai.headers",
          description: "Optional extra HTTP headers sent to the AI provider.",
          required: false,
          type: "object",
        },
        {
          name: "options.ai.organization",
          description: "Optional provider organization identifier.",
          required: false,
          type: "string",
        },
        {
          name: "options.ai.project",
          description: "Optional provider project identifier.",
          required: false,
          type: "string",
        },
        {
          name: "options.ai.timeout",
          description: "HTTP timeout in milliseconds for provider requests.",
          required: false,
          type: "integer",
          default: 60000,
        },
        {
          name: "options.ai.responseTimeout|responseTimeoutMs|runTimeout",
          description: "Optional overall wait timeout in milliseconds for the AI response cycle. Unlike `timeout`, this aborts the helper run even if the provider SDK itself does not stop promptly.",
          required: false,
          type: "integer",
        },
        {
          name: "options.prompts",
          description: "Prompt input. Accepts a string, an array of strings, or an array of chat messages like `{ role, content }`. Structured messages are preferred when system instructions or multi-turn context matter.",
          required: true,
          type: "string|array",
        },
        {
          name: "options.mcpServers",
          description: "Optional MCP server definitions. Each item can include `name`, `url`, `headers`, `timeout`, and `transportPriority`.",
          required: false,
          type: "array<object>",
          default: [],
        },
        {
          name: "options.mcpServers[].name",
          description: "Friendly MCP server name used in diagnostics and tool aliases.",
          required: false,
          type: "string",
        },
        {
          name: "options.mcpServers[].url",
          description: "HTTP endpoint of the MCP server. Required for each server entry.",
          required: true,
          type: "string",
        },
        {
          name: "options.mcpServers[].headers",
          description: "Optional headers for authenticating against the MCP server.",
          required: false,
          type: "object",
        },
        {
          name: "options.mcpServers[].timeout",
          description: "Optional timeout in milliseconds for fallback RPC requests.",
          required: false,
          type: "integer",
        },
        {
          name: "options.mcpServers[].transportPriority",
          description: "Optional ordered list of transport strategies, typically `['streamable-http', 'legacy-sse-http']`.",
          required: false,
          type: "array<string>",
        },
        {
          name: "options.maxToolRounds",
          description: "Maximum number of tool-execution rounds before forcing a final answer.",
          required: false,
          type: "integer",
          default: 6,
        },
        {
          name: "options.includeDiagnostics",
          description: "When true, returns execution metadata including tool calls, messages, and resolved MCP server info.",
          required: false,
          type: "boolean",
          default: false,
        },
        {
          name: "options.signal",
          description: "Optional AbortSignal used to cancel the provider request.",
          required: false,
          type: "AbortSignal",
        },
      ],
      return: {
        type: "string|object",
        description: "Returns the assistant text by default. When `includeDiagnostics` is true, returns an object with `text`, `provider`, `model`, `messages`, `tools`, `toolExecutions`, and `mcpServers`.",
      },
      notes: [
        "This helper is intended to be called from the JS handler. It is no longer tied to a dedicated handler.",
        "For new work, prefer askAIWithTools. This wrapper exists so older endpoints that already pass `ai` continue working without code changes.",
        "`askIAWithProviderMCP` is the clearer modern name when you want a provider-first function signature without the legacy `ai` wrapper field.",
        "The wrapper maps `options.ai` to the new generic `options.provider` contract internally.",
        "Built-in provider presets currently available in this repo are: `openai`, `openai-compatible`, `azure-openai` (alias `azure`), `ollama`, `anthropic` (alias `claude`), and `google-gemini` (aliases `google` and `gemini`).",
        "For local Ollama, a common config is `{ modelProvider: 'ollama', model: 'qwen2.5-coder:1.5b', baseUrl: 'http://localhost:11434', temperature: 0.1, timeout: 1800000, responseTimeout: 120000 }`.",
        "For Azure OpenAI, set `modelProvider: 'azure-openai'`, use the Azure OpenAI base URL, and provide `apiVersion` or `defaultQuery: { 'api-version': '...' }`.",
        "If `baseUrl` is present and `apiKey` is omitted, the helper injects a placeholder key so local OpenAI-compatible servers can still be called.",
        "Native Anthropic support is available through the `anthropic` or `claude` provider preset and requires an Anthropic API key plus a valid Anthropic model name.",
        "Native Google support is available through the `google`, `gemini`, or `google-gemini` provider preset and requires a Google GenAI API key or Vertex AI settings. If `model` is omitted there, the helper defaults to `gemini-2.5-flash`.",
        "`timeout` controls the provider client's HTTP timeout. `responseTimeout` or `runTimeout` can also be set when you want a hard deadline for the overall AI response wait.",
        "MCP tools are exposed to the model as OpenAI function tools. The helper will connect, list tools, execute tool calls, and continue the conversation until it reaches a final answer or the round limit.",
        "Prompt roles should normally be `system`, `user`, `assistant`, and the helper itself manages `tool` messages internally during tool rounds.",
        "For GET endpoints, prompt arrays usually arrive as a JSON string in `request.query.prompts`, so parse them before calling this helper.",
        "When the output looks inconsistent, enable `includeDiagnostics` and inspect `messages`, `tools`, and `toolExecutions` before assuming hidden state.",
      ],
      agentGuidance: [
        "Use this only when you must preserve the old `ai` field shape. Otherwise use askAIWithTools.",
        "If you are generating new handler code from scratch, prefer askIAWithProviderMCP or askAIWithTools instead of this legacy wrapper.",
        "Use this helper when the endpoint needs an AI response and may need tool access through one or more MCP servers.",
        "For plain OpenAI, use `modelProvider: 'openai'` with `apiKey` and an OpenAI model such as `gpt-4o-mini`.",
        "For custom OpenAI-compatible gateways, use `modelProvider: 'openai-compatible'` and set `baseUrl` explicitly.",
        "For Azure OpenAI, use `modelProvider: 'azure-openai'` or `azure`, set the deployment name in `model`, and provide `baseUrl` plus `apiVersion`.",
        "For Ollama, use `modelProvider: 'ollama'`, a local model name, and optionally a custom `baseUrl` if it is not running on the default host.",
        "For Anthropic, use `modelProvider: 'anthropic'` or `claude`, plus `apiKey` and a native Anthropic model name such as `claude-3-7-sonnet-latest`.",
        "For Google Gemini, use `modelProvider: 'google'`, `gemini`, or `google-gemini`, plus `apiKey` and a Gemini model such as `gemini-2.5-flash`.",
        "Use aliases intentionally: `azure` resolves to `azure-openai`, `claude` resolves to `anthropic`, and `google` or `gemini` resolve to `google-gemini`.",
        "Prefer passing prompts as structured messages when system or multi-turn context matters.",
        "If MCP capabilities are unknown, call `listMcpTools` first and only then call `askIAWithMCP` with the chosen servers.",
        "For JS endpoints that rely on Application Variables, prefer `$_APP_VARS_['$_VAR_NAME']` in generated code because it is explicit and avoids scope-name ambiguity.",
        "If the task is informational, provide only read-only MCP servers or read-only tools when possible.",
      ],
      example: `
const result = await askIAWithMCP({
  ai: {
    modelProvider: 'ollama',
    model: 'qwen2.5-coder:1.5b',
    baseUrl: 'http://localhost:11434',
    temperature: 0.1,
    timeout: 1800000,
    responseTimeout: 120000,
  },
  mcpServers: [
    {
      name: 'openfusion_system_remote_prd',
      url: 'https://example.com/api/system/mcp/server/prd',
    },
  ],
  prompts: [
    {
      role: 'user',
      content: 'List the available applications using MCP tools if needed.',
    },
  ],
  includeDiagnostics: true,
});

$_RETURN_DATA_ = result;
// Azure OpenAI example
const result = await askIAWithMCP({
  ai: {
    modelProvider: 'azure-openai',
    model: 'gpt-4o-mini',
    baseUrl: 'https://diegomperezcentralus-resource.cognitiveservices.azure.com/openai',
    apiVersion: '2025-01-01-preview',
    azureApiKey: $_APP_VARS_['$_VAR_AZURE_OPENAI_API_KEY'],
    timeout: 1800000,
    responseTimeout: 120000,
  },
  prompts: [
    {
      role: 'user',
      content: 'Hola',
    },
  ],
});

$_RETURN_DATA_ = result;

// Native Anthropic example
const anthropicResult = await askIAWithMCP({
  ai: {
    modelProvider: 'anthropic',
    model: 'claude-3-7-sonnet-latest',
    apiKey: $_APP_VARS_['$_VAR_ANTHROPIC_API_KEY'],
    responseTimeout: 120000,
  },
  prompts: [{ role: 'user', content: 'Hola desde Anthropic' }],
});

$_RETURN_DATA_ = anthropicResult;

// Google Gemini example
const geminiResult = await askIAWithMCP({
  ai: {
    modelProvider: 'gemini',
    model: 'gemini-2.5-flash',
    apiKey: $_APP_VARS_['$_VAR_GOOGLE_GENAI_API_KEY'],
    responseTimeout: 120000,
  },
  prompts: [{ role: 'user', content: 'Hola desde Gemini' }],
});

$_RETURN_DATA_ = geminiResult;
      `,
    },
    askAIWithTools: {
      fn: request && reply ? askAIWithTools : undefined,
      description: "Generic AI helper that accepts a provider configuration, connects to the selected AI service, and optionally enables MCP tools from one or more MCP servers during the conversation.",
      web: own_repo,
      params: [
        {
          name: "options.provider",
          description: "Provider configuration. Must include at least `model`. Built-in presets currently available in this repo are `openai`, `openai-compatible`, `azure-openai`, `ollama`, `anthropic`, `claude`, `google`, `gemini`, and `google-gemini`.",
          required: true,
          type: "object",
        },
        {
          name: "options.provider.provider|modelProvider|name|vendor",
          description: "Provider preset selector. Supported values are `openai`, `openai-compatible`, `azure-openai`, `azure`, `ollama`, `anthropic`, `claude`, `google`, `gemini`, and `google-gemini`. If omitted, the helper assumes `openai-compatible`.",
          required: false,
          type: "string",
        },
        {
          name: "options.provider.model",
          description: "Exact model or deployment name to invoke. This field is always required. For Azure OpenAI, pass the deployment name here.",
          required: true,
          type: "string",
        },
        {
          name: "options.provider.baseUrl|baseURL",
          description: "Optional provider base URL override. If omitted, the helper uses the preset default when available. Use this when routing through a gateway or a custom OpenAI-compatible endpoint.",
          required: false,
          type: "string",
        },
        {
          name: "options.provider.apiKey|api_key",
          description: "Provider API key for OpenAI-compatible providers. Required unless the selected provider is local and works with a placeholder key, such as Ollama.",
          required: false,
          type: "string",
        },
        {
          name: "options.provider.azureApiKey|azure_api_key",
          description: "Azure OpenAI API key when using the Azure provider preset.",
          required: false,
          type: "string",
        },
        {
          name: "options.provider.apiVersion|api_version|api-version",
          description: "Azure OpenAI API version. This is recommended when the provider is Azure OpenAI.",
          required: false,
          type: "string",
        },
        {
          name: "options.provider.clientName",
          description: "Optional MCP client name used while connecting to MCP servers.",
          required: false,
          type: "string",
        },
        {
          name: "options.provider.clientVersion",
          description: "Optional MCP client version used while connecting to MCP servers.",
          required: false,
          type: "string",
        },
        {
          name: "options.provider.defaultQuery|default_query",
          description: "Optional default query parameters passed to the AI provider client.",
          required: false,
          type: "object",
        },
        {
          name: "options.provider.headers",
          description: "Optional extra HTTP headers sent to the AI provider.",
          required: false,
          type: "object",
        },
        {
          name: "options.provider.temperature",
          description: "Sampling temperature sent to the provider.",
          required: false,
          type: "number",
        },
        {
          name: "options.provider.maxTokens|max_tokens",
          description: "Maximum output tokens for the completion.",
          required: false,
          type: "integer",
        },
        {
          name: "options.provider.toolChoice|tool_choice",
          description: "Optional tool selection policy passed to the provider when MCP tools are available.",
          required: false,
          type: "string|object",
        },
        {
          name: "options.provider.timeout",
          description: "HTTP timeout in milliseconds for provider requests.",
          required: false,
          type: "integer",
          default: 60000,
        },
        {
          name: "options.provider.responseTimeout|responseTimeoutMs|runTimeout",
          description: "Optional overall wait timeout in milliseconds for the AI response cycle. Unlike `timeout`, this aborts the helper run even if the provider SDK itself does not stop promptly.",
          required: false,
          type: "integer",
        },
        {
          name: "options.prompts",
          description: "Prompt input. Accepts a string, an array of strings, or an array of structured chat messages like `{ role, content }`.",
          required: true,
          type: "string|array",
        },
        {
          name: "options.mcpServers",
          description: "Optional MCP server definitions. Each item can include `name`, `url`, `headers`, `timeout`, and `transportPriority`.",
          required: false,
          type: "array<object>",
          default: [],
        },
        {
          name: "options.mcpServers[].name",
          description: "Friendly MCP server name used in diagnostics and generated tool aliases.",
          required: false,
          type: "string",
        },
        {
          name: "options.mcpServers[].url",
          description: "HTTP endpoint of the MCP server. Required for each server entry.",
          required: true,
          type: "string",
        },
        {
          name: "options.mcpServers[].headers",
          description: "Optional headers for authenticating against the MCP server.",
          required: false,
          type: "object",
        },
        {
          name: "options.mcpServers[].timeout",
          description: "Optional timeout in milliseconds for fallback RPC requests.",
          required: false,
          type: "integer",
        },
        {
          name: "options.mcpServers[].transportPriority",
          description: "Optional ordered list of transport strategies, typically `['streamable-http', 'legacy-sse-http']`.",
          required: false,
          type: "array<string>",
        },
        {
          name: "options.maxToolRounds",
          description: "Maximum number of tool-execution rounds before forcing a final answer.",
          required: false,
          type: "integer",
          default: 6,
        },
        {
          name: "options.includeDiagnostics",
          description: "When true, returns execution metadata including tool calls, messages, and resolved MCP server info.",
          required: false,
          type: "boolean",
          default: false,
        },
        {
          name: "options.signal",
          description: "Optional AbortSignal used to cancel the provider request.",
          required: false,
          type: "AbortSignal",
        },
      ],
      return: {
        type: "string|object",
        description: "Returns the assistant text by default. When `includeDiagnostics` is true, returns an object with `text`, `provider`, `model`, `messages`, `tools`, `toolExecutions`, and `mcpServers`.",
      },
      notes: [
        "This helper is the recommended entry point for new JS endpoints that must be configurable across multiple AI providers.",
        "`askIAWithProviderMCP` is the equally capable provider-first alias when you want the function name itself to emphasize MCP-enabled provider execution.",
        "The minimum valid call is `provider.model + prompts`. In practice, most remote providers also need an API key.",
        "Built-in provider presets currently available in this repo are: `openai`, `openai-compatible`, `azure-openai` (alias `azure`), `ollama`, `anthropic` (alias `claude`), and `google-gemini` (aliases `google` and `gemini`).",
        "`openai` and `openai-compatible` use the OpenAI Chat Completions shape. Use `openai-compatible` when routing to a custom compatible base URL.",
        "Azure OpenAI uses the SDK Azure client path internally, including `api-version` handling and deployment-aware routes.",
        "Local Ollama can be called without a real API key because the helper injects a placeholder key when a base URL is present and no key is provided.",
        "Native Anthropic support is available through the `anthropic` or `claude` provider preset and requires an Anthropic API key plus a valid Anthropic model name.",
        "Native Google support is available through the `google`, `gemini`, or `google-gemini` provider preset and requires a Google GenAI API key or Vertex AI settings. If `model` is omitted there, the helper defaults to `gemini-2.5-flash`.",
        "`timeout` controls the provider client's HTTP timeout. `responseTimeout` or `runTimeout` can also be set when you want a hard deadline for the overall AI response wait.",
        "If you pass MCP servers, the helper will prepend a system instruction that explains the available tools and their mutating vs read-only intent.",
        "MCP tools are exposed to the model as OpenAI function tools. The helper connects, lists tools, executes tool calls, and continues the conversation until it reaches a final answer or the round limit.",
      ],
      agentGuidance: [
        "Prefer this helper over askIAWithMCP for new work because it is provider-agnostic and easier to parameterize from request bodies or App Vars.",
        "Use askIAWithProviderMCP when you want the function name to make it obvious that both the provider and MCP servers are first-class inputs.",
        "Always provide `provider.model`. Also provide `provider.provider` when you want a known preset to resolve base URL and behavior automatically.",
        "For plain OpenAI, use `provider: 'openai'` with `apiKey` and optionally override `baseUrl` when you are not using the default OpenAI endpoint.",
        "For custom OpenAI-compatible gateways or self-hosted providers, use `provider: 'openai-compatible'` and set `baseUrl`.",
        "For Azure OpenAI, provide `provider: 'azure-openai'`, the deployment name in `model`, the Azure OpenAI base URL, and `apiVersion`.",
        "For Ollama, provide `provider: 'ollama'`, a local model name, and optionally a custom `baseUrl` if it is not running on the default host.",
        "For Anthropic, provide `provider: 'anthropic'` or `provider: 'claude'`, plus `apiKey` and a native Anthropic model name such as `claude-3-7-sonnet-latest`.",
        "For Google Gemini, provide `provider: 'google'`, `provider: 'gemini'`, or `provider: 'google-gemini'`, plus `apiKey` and a Gemini model such as `gemini-2.5-flash`.",
        "Use the preset aliases intentionally: `azure` resolves to `azure-openai`, `claude` resolves to `anthropic`, and `google` or `gemini` resolve to `google-gemini`.",
        "If MCP capabilities are unknown, call listMcpTools first and only then call askAIWithTools with the selected servers.",
        "Store provider defaults and API keys in Application Variables whenever possible instead of hardcoding them into endpoint code.",
        "When generating endpoint code, prefer one canonical request body shape and document it explicitly in the endpoint JSON schema.",
        "If the task is informational, provide only read-only MCP servers or read-only tools when possible.",
      ],
      example: `
const body = request.body || {};

// Canonical request body shape:
// {
//   provider: {
//     provider: 'openai-compatible',
//     model: 'gpt-4o-mini',
//     apiKey: '...optional if preset is local...',
//     baseUrl: '...optional override...',
//     temperature: 0.1,
//     timeout: 1800000,
//     responseTimeout: 120000
//   },
//   mcpServers: [{ name, url, headers?, timeout?, transportPriority? }],
//   prompts: [{ role, content }],
//   includeDiagnostics: true,
//   maxToolRounds: 6
// }

if (!body.provider?.model) {
  $_EXCEPTION_('The request body must include provider.model.', { body }, 400);
}

if (!(body.prompts ?? body.prompt ?? body.messages)) {
  $_EXCEPTION_('The request body must include prompts, prompt, or messages.', { body }, 400);
}

const result = await askAIWithTools({
  provider: {
    provider: body.provider?.provider ?? 'openai-compatible',
    model: body.provider?.model ?? 'gpt-4o-mini',
    apiKey: body.provider?.apiKey ?? $_APP_VARS_['$_VAR_AI_API_KEY'],
    baseUrl: body.provider?.baseUrl,
    temperature: body.provider?.temperature ?? 0.1,
    timeout: body.provider?.timeout ?? 1800000,
    responseTimeout: body.provider?.responseTimeout ?? body.provider?.responseTimeoutMs ?? body.provider?.runTimeout ?? 120000,
  },
  mcpServers: Array.isArray(body.mcpServers) ? body.mcpServers : [],
  prompts: body.prompts ?? body.prompt ?? body.messages,
  includeDiagnostics: body.includeDiagnostics ?? true,
  maxToolRounds: body.maxToolRounds ?? 6,
});

$_RETURN_DATA_ = result;

// Azure OpenAI example
const azureResult = await askAIWithTools({
  provider: {
    provider: 'azure-openai',
    model: 'gpt-4o-mini',
    baseUrl: 'https://your-resource.cognitiveservices.azure.com/openai',
    apiVersion: '2025-01-01-preview',
    azureApiKey: $_APP_VARS_['$_VAR_AZURE_OPENAI_API_KEY'],
  },
  prompts: [{ role: 'user', content: 'Hola' }],
});

// Native OpenAI example
const openAIResult = await askAIWithTools({
  provider: {
    provider: 'openai',
    model: 'gpt-4o-mini',
    apiKey: $_APP_VARS_['$_VAR_OPENAI_API_KEY'],
    responseTimeout: 120000,
  },
  prompts: [{ role: 'user', content: 'Hola desde OpenAI' }],
});

// Ollama example
const ollamaResult = await askAIWithTools({
  provider: {
    provider: 'ollama',
    model: 'qwen2.5-coder:1.5b',
    baseUrl: 'http://localhost:11434',
    temperature: 0.1,
    timeout: 1800000,
    responseTimeout: 120000,
  },
  prompts: [{ role: 'user', content: 'Hola desde Ollama' }],
});

// Native Anthropic example
const claudeResult = await askAIWithTools({
  provider: {
    provider: 'claude',
    model: 'claude-3-7-sonnet-latest',
    apiKey: $_APP_VARS_['$_VAR_ANTHROPIC_API_KEY'],
    responseTimeout: 120000,
  },
  prompts: [{ role: 'user', content: 'Hola desde Claude nativo' }],
});

// Google Gemini example
const geminiResult = await askAIWithTools({
  provider: {
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    apiKey: $_APP_VARS_['$_VAR_GOOGLE_GENAI_API_KEY'],
    responseTimeout: 120000,
  },
  prompts: [{ role: 'user', content: 'Hola desde Gemini' }],
});
      `,
    },
    listMcpTools: {
      fn: request && reply ? listMcpTools : undefined,
      description: "Connects to one or more MCP servers and returns the discovered tools without running an AI conversation.",
      web: own_repo,
      params: [
        {
          name: "options.mcpServers",
          description: "List of MCP server definitions to inspect.",
          required: true,
          type: "array<object>",
        },
        {
          name: "options.clientName",
          description: "Optional MCP client name used during connection.",
          required: false,
          type: "string",
        },
        {
          name: "options.clientVersion",
          description: "Optional MCP client version used during connection.",
          required: false,
          type: "string",
        },
      ],
      return: "Array of MCP server descriptors with their resolved tool list.",
      notes: [
        "Use this for diagnostics, capability discovery, or to verify that a remote MCP server exposes the expected tools before calling askIAWithMCP.",
      ],
      example: `
const tools = await listMcpTools({
  mcpServers: [
    {
      name: 'openfusion_system_remote_prd',
      url: 'https://example.com/api/system/mcp/server/prd',
    },
  ],
});

$_RETURN_DATA_ = tools;
      `,
    },
    xlsx_style: {
      fn: request && reply ? xlsx_style : undefined,
      description: "Styled XLSX builder based on SheetJS, useful when the exported workbook needs fonts, fills, borders, or alignment.",
      web: "https://github.com/gitbrent/xlsx-js-style",
      notes: [
        "Prefer xlsx_style over xlsx when presentation matters in the generated spreadsheet.",
      ],
      example: `
const wb = xlsx_style.utils.book_new();

let row = [
	{ v: "Courier: 24", t: "s", s: { font: { name: "Courier", sz: 24 } } },
	{ v: "bold & color", t: "s", s: { font: { bold: true, color: { rgb: "FF0000" } } } },
	{ v: "fill: color", t: "s", s: { fill: { fgColor: { rgb: "E9E9E9" } } } },
	{ v: "line\nbreak", t: "s", s: { alignment: { wrapText: true } } },
];
const ws = xlsx_style.utils.aoa_to_sheet([row]);
xlsx_style.utils.book_append_sheet(wb, ws, "Styled Demo");

const buffer = xlsx_style.write(wb, { type: 'buffer', bookType: 'xlsx' });

$_CUSTOM_HEADERS_.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
$_CUSTOM_HEADERS_.set('Content-Disposition', 'attachment; filename="styled-demo.xlsx"');
$_RETURN_DATA_ = Buffer.from(buffer);
      `
    },
    setTimeout: {
      fn: setTimeout,
      description: "Schedules execution of a one-time callback after delay milliseconds.",
      web: "https://developer.mozilla.org/en-US/docs/Web/API/setTimeout",
      return: "Timeout ID"
    },
    clearTimeout: {
      fn: clearTimeout,
      description: "Cancels a timeout previously established by calling setTimeout().",
      web: "https://developer.mozilla.org/en-US/docs/Web/API/clearTimeout"
    },
    clearInterval: {
      fn: clearInterval,
      description: "Cancels a timed, repeating action which was previously established by a call to setInterval().",
      web: "https://developer.mozilla.org/en-US/docs/Web/API/clearInterval"
    },
    AbortController: {
      fn: AbortController,
      description: "A controller object that allows you to abort one or more Web APIs (like fetch requests).",
      web: "https://developer.mozilla.org/en-US/docs/Web/API/AbortController",
      return: "AbortController constructor"
    },
    console: {
      fn: console,
      description: "Provides access to the browser/runtime debugging console.",
      web: "https://developer.mozilla.org/en-US/docs/Web/API/console"
    },
    Date: {
      fn: Date,
      description: "Constructor for creating and managing dates.",
      web: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date",
      return: "Date instance or current timestamp"
    },
    Math: {
      fn: Math,
      description: "A built-in object that has properties and methods for mathematical constants and functions.",
      web: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math"
    },
    JSON: {
      fn: JSON,
      description: "A built-in object that contains methods for parsing JavaScript Object Notation (JSON) and converting values to JSON.",
      web: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON"
    },
    Array: {
      fn: Array,
      description: "Global Array constructor.",
      web: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array"
    },
    Object: {
      fn: Object,
      description: "Global Object constructor.",
      web: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object"
    },
    String: {
      fn: String,
      description: "Global String constructor.",
      web: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String"
    },
    Number: {
      fn: Number,
      description: "Global Number constructor.",
      web: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number"
    },
    Boolean: {
      fn: Boolean,
      description: "Global Boolean constructor.",
      web: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Boolean"
    },
    Promise: {
      fn: Promise,
      description: "Global Promise constructor.",
      web: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise"
    },
    FormData: {
      fn: FormData,
      description: "Global FormData constructor.",
      web: "https://developer.mozilla.org/en-US/docs/Web/API/FormData"
    },
    Blob: {
      fn: Blob,
      description: "Global Blob constructor.",
      web: "https://developer.mozilla.org/en-US/docs/Web/API/Blob"
    },
    Buffer: {
      fn: Buffer,
      description: "Global Buffer constructor (Node.js).",
      web: "https://nodejs.org/api/buffer.html"
    },
    RegExp: {
      fn: RegExp,
      description: "Global RegExp constructor.",
      web: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp"
    },
    parseInt: {
      fn: parseInt,
      description: "Parses a string argument and returns an integer of the specified radix.",
      web: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/parseInt",
      return: "Integer"
    },
    parseFloat: {
      fn: parseFloat,
      description: "Parses a string argument and returns a floating point number.",
      web: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/parseFloat",
      return: "Floating point number"
    },
    setInterval: {
      fn: setInterval,
      description: "Schedules execution of a repeating callback after every delay milliseconds.",
      web: "https://nodejs.org/api/timers.html#setintervalcallback-delay-args",
      return: "Interval ID"
    },
    Map: {
      fn: Map,
      description: "Standard JavaScript Map constructor for key-value collections.",
      web: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map",
      return: "Map instance"
    },
    Set: {
      fn: Set,
      description: "Standard JavaScript Set constructor for collections of unique values.",
      web: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Set",
      return: "Set instance"
    },
    WeakMap: {
      fn: WeakMap,
      description: "Standard JavaScript WeakMap constructor for collections of key-value pairs where keys must be objects.",
      web: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/WeakMap",
      return: "WeakMap instance"
    },
    WeakSet: {
      fn: WeakSet,
      description: "Standard JavaScript WeakSet constructor for collections of unique objects.",
      web: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/WeakSet",
      return: "WeakSet instance"
    },
    URL: {
      fn: URL,
      description: "Standard Web API URL constructor to parse, construct, and validate URLs (available globally in Node.js).",
      web: "https://nodejs.org/api/url.html#class-url",
      return: "URL instance"
    },
    URLSearchParams: {
      fn: URLSearchParams,
      description: "Standard Web API URLSearchParams constructor to work with query string parameters of a URL (available globally in Node.js).",
      web: "https://nodejs.org/api/url.html#class-urlsearchparams",
      return: "URLSearchParams instance"
    },
    TextEncoder: {
      fn: TextEncoder,
      description: "Standard Web API TextEncoder constructor to encode a string into a stream of bytes (Uint8Array) using UTF-8 (available globally in Node.js).",
      web: "https://nodejs.org/api/util.html#class-textencoder",
      return: "TextEncoder instance"
    },
    TextDecoder: {
      fn: TextDecoder,
      description: "Standard Web API TextDecoder constructor to decode a stream of bytes into a string (available globally in Node.js).",
      web: "https://nodejs.org/api/util.html#class-textdecoder",
      return: "TextDecoder instance"
    },
    encodeURIComponent: {
      fn: encodeURIComponent,
      description: "Encodes a Uniform Resource Identifier (URI) component by replacing certain characters with UTF-8 escape sequences.",
      web: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/encodeURIComponent",
      return: "Encoded string"
    },
    decodeURIComponent: {
      fn: decodeURIComponent,
      description: "Decodes a Uniform Resource Identifier (URI) component previously created by encodeURIComponent.",
      web: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/decodeURIComponent",
      return: "Decoded string"
    },
    encodeURI: {
      fn: encodeURI,
      description: "Encodes a complete Uniform Resource Identifier (URI).",
      web: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/encodeURI",
      return: "Encoded string"
    },
    decodeURI: {
      fn: decodeURI,
      description: "Decodes a Uniform Resource Identifier (URI) previously created by encodeURI.",
      web: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/decodeURI",
      return: "Decoded string"
    },
    btoa: {
      fn: btoa,
      description: "Creates a Base64-encoded ASCII string from a string of binary data (available globally in Node.js).",
      web: "https://nodejs.org/api/globals.html#btoa",
      return: "Base64-encoded string"
    },
    atob: {
      fn: atob,
      description: "Decodes a string of data which has been encoded using Base64 encoding (available globally in Node.js).",
      web: "https://nodejs.org/api/globals.html#atob",
      return: "Decoded string"
    },
    ArrayBuffer: {
      fn: ArrayBuffer,
      description: "Global ArrayBuffer constructor.",
      web: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/ArrayBuffer"
    },
    Uint8Array: {
      fn: Uint8Array,
      description: "Global Uint8Array typed array constructor.",
      web: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array"
    },
  };
};


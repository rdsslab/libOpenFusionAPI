import { createHmac, createHash, randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { Buffer } from "node:buffer";
import jwt from "jsonwebtoken";
import { internal_url_post_hooks } from "./utils_path.js"; //
import * as uuid from "uuid";
import uFetch from "@rddslab/uFetch";
import Zod from "zod";
import {
  URLAutoEnvironment,
} from "./functionVars.js";

const { PORT } = process.env;
// Pre-compilamos el Regex fuera para mejorar el rendimiento en llamadas frecuentes

const errors = {
  1: { code: 1, message: "You must enter the same password twice" },
  2: { code: 2, message: "Invalid credentials" },
};

// Definimos el esquema
export const webhookSchema = Zod.object({
  host: Zod.string().min(1, { message: "Host is required." }),
  database: Zod.string().min(1, { message: "Database is required." }),
  schema: Zod.string().min(0, { message: "Schema is required." }),
  model: Zod.string().min(1, { message: "Model is required." }),
  action: Zod.enum(
    ["insert", "update", "delete", "upsert", "afterUpsert", "afterCreate"],
    {
      message:
        "Valid options: 'insert', 'update', 'delete', 'bulk_insert', 'bulk_update', 'upsert'",
    }
  ),
  data: Zod.record(Zod.any()).optional(), // Puede ser un objeto vacío o contener datos dinámicos
});
// Función para obtener los datos según el método
export const getRequestData = (request) => {
  const method = request.method.toUpperCase();

  switch (method) {
    case "GET":
    case "DELETE":
      return request.query;
    case "POST":
    case "PUT":
    case "PATCH":
      return request.body;
    case "OPTIONS":
      return {}; // Normalmente no lleva datos
    default:
      return {}; // Fallback para métodos no esperados
  }
};

let isServerListening = false;
export const setServerListening = (val) => { isServerListening = val; };
export const getServerListening = () => isServerListening;

export async function emitHook(data) {
  if (!isServerListening) {
     // During bootstrap, we skip emitting hooks to the internal HTTP server
     // because it's not yet listening. This prevents ECONNREFUSED noise.
     return { error: "Server not ready" };
  }

  try {
    const fnUrlae = new URLAutoEnvironment({ environment: "prd", port: PORT });
    const uF = fnUrlae.create(internal_url_post_hooks, false);

    let r = await uF.post({ data: data });
    let resp = await r.json();
    return resp;
  } catch (error) {
    if (error.code === 'ECONNREFUSED' || error.cause?.code === 'ECONNREFUSED') {
       // Just in case it slips through or is calling an external server
       // console.warn(`[emitHook] Connection refused to ${internal_url_post_hooks}.`);
    } else {
       console.error("Error in emitHook:", error);
    }
    return { error: "Error validating webhook data", data: error };
  }
}

export const getUUID = () => {
  return uuid.v4();
};

export function getIPFromRequest(req) {
  if (!req) return null;
  const ip =
    req.ip ||
    (req.headers ? req.headers["x-forwarded-for"] : null) ||
    (req.socket ? req.socket.remoteAddress : null) ||
    (req.connection ? req.connection.remoteAddress : null) ||
    (req.connection?.socket ? req.connection.socket.remoteAddress : null);

  // Puedes manipular la IP según tus necesidades
  return ip;
}





/**
 * @param {number} code
 * @param {string | any | undefined} [message]
 */
export function customError(code, message) {
  if (errors[code]) {
    let e = { ...errors[code] };
    e.message = message && message.length > 0 ? message : e.message;
    return e;
  } else {
    return { errors: code, message: message };
  }
}





/**
 * @param {string} path_file
 */
function getPathParts(path_file) {
  const normalized = path.normalize(path_file);
  const parts = normalized.split(path.sep);
  const last = parts.slice(-3);
  return {
    appName: last[0],
    environment: last[1],
    file: last[2],
  };
}

/**
 * @param {string} fn_path
 */
export const getFunctionsFiles = (fn_path) => {
  /**
   * @type {string[]}
   */
  const jsFiles = [];

  /**
   * @param {string} ruta
   */
  function searchFiles(ruta) {
    const archivos = fs.readdirSync(ruta);

    archivos.forEach((archivo) => {
      const rutaCompleta = path.join(ruta, archivo);

      if (fs.statSync(rutaCompleta).isDirectory()) {
        // Si es un directorio, busca en él de forma recursiva
        searchFiles(rutaCompleta);
      } else {
        // Si es un archivo con extensión .js, agrégalo a la lista
        if (path.extname(archivo) === ".js") {
          jsFiles.push(rutaCompleta);
        }
      }
    });
  }

  searchFiles(fn_path);

  return jsFiles.map((f) => {
    return { file: f, data: getPathParts(f) };
  });
};



// Une dos objetos json, los valores de obj2 sobreescriben los valores de obj1
export const mergeObjects = (obj1, obj2) => {
  const merged = { ...obj1 };

  for (let key in obj2) {
    if (obj2.hasOwnProperty(key)) {
      if (
        typeof obj2[key] === "object" &&
        obj2[key] !== null &&
        !Array.isArray(obj2[key])
      ) {
        if (
          typeof obj1[key] === "object" &&
          obj1[key] !== null &&
          !Array.isArray(obj1[key])
        ) {
          merged[key] = mergeObjects(obj1[key], obj2[key]);
        } else {
          merged[key] = obj2[key];
        }
      } else {
        merged[key] = obj2[key];
      }
    }
  }
  //console.log('\n\n>>>>>>>>>>>>>>>>>>>>>>>>>>', obj1, obj2, merged);
  return merged;
};



export /**
 * Devuelve el método de parsing sugerido basado en el Content-Type.
 * @param {string} contentType
 * @returns {"json" | "text" | "blob" | "urlencoded" | "raw"}
 */
  function getParseMethod(contentType = "") {
  // Elimina cualquier parámetro como charset, boundary, etc.
  const mimeType = contentType.split(";")[0].trim().toLowerCase();

  if (mimeType === "application/json") {
    return "json";
  }

  if (mimeType.startsWith("text/")) {
    return "text";
  }

  if (
    mimeType === "application/octet-stream" ||
    mimeType === "application/pdf"
  ) {
    return "blob";
  }

  if (mimeType === "application/x-www-form-urlencoded") {
    return "urlencoded";
  }

  if (mimeType === "multipart/form-data") {
    return "raw"; // requiere plugin multipart
  }

  if (
    mimeType.startsWith("image/") ||
    mimeType.startsWith("audio/") ||
    mimeType.startsWith("video/")
  ) {
    return "blob";
  }

  return "text"; // Fallback genérico
}



/**
 * @param {Array<{environment: string, name: string, value: any}>} app_vars
 */
export const getAppVarsObject = (app_vars) => {

  let appvars_obj = {};

  if (Array.isArray(app_vars)) {

    for (let index = 0; index < app_vars.length; index++) {
      const element = app_vars[index];
      if (!appvars_obj[element.environment]) {
        appvars_obj[element.environment] = {};
      }
      appvars_obj[element.environment][element.name] = element.value;
    }
  }

  return appvars_obj;
}
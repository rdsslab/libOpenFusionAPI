import { createHmac, createHash, randomUUID } from "crypto";
import jwt from "jsonwebtoken";
import { Buffer } from "node:buffer";
import { GenToken, JWTKEY } from "./functionVars.js";
import { getCorrectedNowSeconds } from "./timeSync.js";

export function checkToken(token, key = JWTKEY) {
  if (token) {
    try {
      const decodedToken = tokenVerify(token, key);

      if (decodedToken && decodedToken.data) {
        return decodedToken.data;
      }

      return false;
    } catch (error) {
      return false;
    }
  } else {
    return false;
  }
}

export function CreateRandomPassword(prefix = "rp") {
  const password = prefix + "_" + randomUUID();
  return { password, encrypted: EncryptPwd(password) };
}

export function EncryptPwd(pwd) {
  return createHmac("sha256", JWTKEY).update(String(pwd ?? "")).digest("hex");
}

/**
 * Claves legacy para la migración de servidores con otra/ninguna JWT_KEY.
 * Se leen de la env var AUTH_LEGACY_KEYS (separada por comas).
 */
export function getLegacyPasswordKeys() {
  const raw = process.env.AUTH_LEGACY_KEYS;
  if (typeof raw === "string" && raw.trim()) {
    return raw.split(",").map((k) => k.trim()).filter(Boolean);
  }
  return [];
}

/**
 * Verifica una contraseña contra el hash almacenado admitiendo formatos legacy
 * y avisa si el hash debe re-escribirse con el algoritmo/llave actual.
 *
 * Orden de la cadena de fallback:
 *  1. Contraseña en claro (alta/reset de antes del fix de hashing) -> válida + rehash
 *  2. HMAC-SHA256 con la JWT_KEY actual -> válida
 *  3. HMAC-SHA256 con cada clave de AUTH_LEGACY_KEYS (migración) -> válida + rehash
 *
 * @param {string} plain contraseña en claro ingresada
 * @param {string} storedHash valor almacenado en la columna password
 * @returns {{ valid: boolean, needsRehash: boolean }}
 */
export function passwordMatches(plain, storedHash) {
  if (typeof plain !== "string" || typeof storedHash !== "string" || storedHash === "") {
    return { valid: false, needsRehash: false };
  }

  if (plain === storedHash) {
    return { valid: true, needsRehash: true };
  }

  if (EncryptPwd(plain) === storedHash) {
    return { valid: true, needsRehash: false };
  }

  for (const key of getLegacyPasswordKeys()) {
    if (createHmac("sha256", key).update(plain).digest("hex") === storedHash) {
      return { valid: true, needsRehash: true };
    }
  }

  return { valid: false, needsRehash: false };
}

export function tokenVerify(token, key = JWTKEY) {
  return jwt.verify(token, key, { clockTimestamp: getCorrectedNowSeconds() });
}

export function getUserPasswordTokenFromRequest(req) {
  const authHeader = req.headers?.authorization;
  let username, token, password, data_token;

  if (authHeader?.startsWith("Basic ")) {
    const encoded = authHeader.split(" ")[1] ?? "";
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const idx = decoded.indexOf(":");
    if (idx >= 0) {
      username = decoded.slice(0, idx);
      password = decoded.slice(idx + 1);
    } else {
      username = decoded;
      password = undefined;
    }
  } else if (authHeader?.startsWith("Bearer ")) {
    let jwt_key = JWTKEY;
    token = authHeader.split(" ")[1];

    const decodedToken = jwt.decode(token);

    if (decodedToken?.data?.apikey?.idclient) {
      jwt_key = req?.openfusionapi?.handler?.params?.jwt_key || JWTKEY;
    }

    /*
    if (token.startsWith("OFAPI_KEY@")) {
      token = token.slice("OFAPI_KEY@".length);
      jwt_key = req?.openfusionapi?.handler?.params?.jwt_key || JWTKEY;
    }
    */

    try {
      data_token = checkToken(token, jwt_key);
    } catch (e) {
      data_token = null;
    }
  } else {
    try {
      let token = req.cookies.OFAPI_TOKEN;
      data_token = checkToken(token);
    } catch (e) {
      data_token = null;
    }
  }

  return { Basic: { username, password }, Bearer: { token, data: data_token } };
}

export function websocketUnauthorized(socket) {
  socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
  socket.destroy();
}

export function checkAPIToken(app, endpointData, jwtoken) {
  try {
    let data = tokenVerify(jwtoken);

    if (data && data.app && data.env) {
      return data.app == app && data.env == endpointData.env;
    }

    return false;
  } catch (error) {
    return false;
  }
}

export const md5 = (data) => {
  const hash = createHash("md5");
  hash.update(typeof data !== "string" ? JSON.stringify(data) : data);
  return hash.digest("hex");
};

export const CreateOpenFusionAPIToken = () => {
  return GenToken(
    {
      admin: {
        username: "openfusionapi",
        first_name: "openfusionapi",
        last_name: "openfusionapi",
        ip: "127.0.0.0",
        enabled: true,
        ctrl: {
          as_admin: true,
        },
      },
    },
    60 * 60 * 24 * 365,
  );
};

let cachedSystemToken = null;

/**
 * Token de sistema con el que el propio servidor se autentica contra la app `system`
 * (worker de interval tasks y llamadas internas como el envío del password del
 * apiclient por email).
 *
 * Se emite una sola vez por proceso y se guarda EN MEMORIA (no se expone como
 * variable de entorno). Comparte firma/claims con el token que emite el arranque.
 */
export const getSystemToken = () => {
  if (!cachedSystemToken) {
    cachedSystemToken = CreateOpenFusionAPIToken();
  }
  return cachedSystemToken;
};

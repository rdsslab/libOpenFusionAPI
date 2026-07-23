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
  return createHmac("sha256", JWTKEY).update(pwd).digest("hex");
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
  const token = GenToken(
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
  process.env.USER_OPENFUSIONAPI_TOKEN = token;
};

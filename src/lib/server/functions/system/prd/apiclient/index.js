import { getSystemToken, getUserPasswordTokenFromRequest } from "../../../../auth.js";
import { GenToken } from "../../../../functionVars.js";
import { GetSystemPaths } from "../../../../utils_path.js";
import uFetch from "@rdsslab/uFetch";

import {
  createApiClient,
  ApiClientfindByIdOrUsername,
  loginApiClient,
  updateAPIClientPassword,
  updateApiClient,
  deleteApiClient,
} from "../../../../../db/apiclient.js";
import { userRegister } from "../../../../templates/email/user_register.js";

const SYSTEM_PATHS = GetSystemPaths();

export async function fnUpdateAPIClientPassword(params) {
  let r = { data: undefined, code: 204 };
  // TODO: controlar que solo el usuario pueda cambiar su propia clave y no la de otros usuarios.
  try {
    let data = await updateAPIClientPassword(params?.request?.body);

    r.data = data;
    r.code = 200;
  } catch (error) {
    r.data = error;
    r.code = 500;
  }
  return r;
}

export async function fnCreateApiClient(params) {
  let r = { data: undefined, code: 204 };

  try {
    const body = params?.request?.body;
    if (!body || !body.email || String(body.email).trim() === "") {
      r.data = { error: "The 'email' field is required." };
      r.code = 400;
      return r;
    }

    let data = await createApiClient(body);

    if (data && data.client) {
      let mail = {
        from: "noreply@openfusionapi.com",
        to: "edwinspire@gmail.com",
        subject: `Welcome ${data.client.username}`,
        html: userRegister(data.client.username, data.password),
      };

      // Enviar por email la clave al usuario (token de sistema, en memoria)
      const uF = new uFetch(SYSTEM_PATHS.SEND_EMAIL.PATH);
      uF.setBearerAuthorization(getSystemToken());
      const req = await uF[SYSTEM_PATHS.SEND_EMAIL.METHOD]({ data: mail });
      const res = await req.json();

      let token = GenToken({ api: data.client }, 10 * 60); // Valido por 10 minutos

      // TODO: Si falla el envio al correo guardar en log
      r.data = {
        client: data.client,
        password: data.password, // Contraseña generada; se muestra una sola vez
        token: token,
        email: res,
      };
      r.code = 200;
    } else {
      r.data = { error: "Client not saved." };
      r.code = 500;
    }
  } catch (error) {
    const message = error?.message || String(error);
    const isClientError =
      error?.name === "SequelizeValidationError" ||
      /(?:field is required|required|unique constraint|must not be null)/i.test(
        message,
      );

    r.data = isClientError ? { error: message } : error;
    r.code = isClientError ? 400 : 500;
  }
  return r;
}

export async function fnGetApiClientfindByIdOrUsername(params) {
  let r = { data: undefined, code: 204 };

  try {
    let data = await ApiClientfindByIdOrUsername(params?.request?.query);

    r.data = data;
    r.code = 200;
  } catch (error) {
    r.data = error;
    r.code = 500;
  }
  return r;
}

export async function fnLoginApiClient(params) {
  let r = { data: undefined, code: 204 };

  let auth_data = getUserPasswordTokenFromRequest(params.request);
  const username = auth_data?.Basic?.username;
  const password = auth_data?.Basic?.password;
  if (!username || !password) {
    r.data = {
      login: false,
      error: "username and password are required (Basic Auth) to login.",
    };
    r.code = 400;
    return r;
  }
  const xForwardedProto = params?.request?.headers?.["x-forwarded-proto"];
  const isHttpsRequest =
    params?.request?.protocol === "https" ||
    (typeof xForwardedProto === "string" && xForwardedProto.includes("https"));

  try {
    let data = await loginApiClient(username, password);

    if (data && data.login) {
      let aut = `Bearer ${data.token}`;
      params.reply.header("Authorization", aut);

      params.reply.setCookie("OFAPI_TOKEN", data.token, {
        path: "/",
        httpOnly: true,
        secure: isHttpsRequest,
        sameSite: "Lax",
        maxAge: data.exp_seconds || 3600,
      });

      r.data = data;
      r.code = 200;
    } else {
      r.data = { login: false, error: "Invalid credentials" };
      r.code = 401;
    }
  } catch (error) {
    r.data = error;
    r.code = 500;
  }
  return r;
}

export async function fnUpdateApiClient(params) {
  let r = { data: undefined, code: 204 };
  try {
    const idclient = params?.request?.body?.idclient || params?.request?.query?.idclient;
    if (!idclient) {
      r.data = { error: "idclient is required." };
      r.code = 400;
      return r;
    }

    let data = await updateApiClient(idclient, params?.request?.body);
    r.data = data;
    r.code = 200;
  } catch (error) {
    const message = error?.message || String(error);
    const isClientError =
      error?.name === "SequelizeValidationError" ||
      /(?:not a valid date|field is required|required|unique constraint|must not be null)/i.test(
        message,
      );

    r.data = { error: message };
    r.code = isClientError ? 400 : 500;
  }
  return r;
}

export async function fnDeleteApiClient(params) {
  let r = { data: undefined, code: 204 };
  try {
    const idclient = params?.request?.body?.idclient || params?.request?.query?.idclient;
    if (!idclient) {
      r.data = { error: "idclient is required." };
      r.code = 400;
      return r;
    }

    let deleted = await deleteApiClient(idclient);
    if (deleted) {
      r.data = { success: true, message: "ApiClient deleted." };
      r.code = 200;
    } else {
      r.data = { success: false, message: "ApiClient not found." };
      r.code = 404;
    }
  } catch (error) {
    r.data = { error: error.message };
    r.code = 500;
  }
  return r;
}

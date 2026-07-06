import { getUserPasswordTokenFromRequest } from "../../../../auth.js";
import { GenToken } from "../../../../functionVars.js";
import { GetSystemPaths } from "../../../../utils_path.js";
import uFetch from "@rddslab/uFetch";

import {
  createApiClient,
  ApiClientfindByIdOrUsername,
  loginApiClient,
  updateAPIClientPassword,
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
    let data = await createApiClient(params?.request?.body);

    if (data && data.client) {
      let mail = {
        from: "noreply@openfusionapi.com",
        to: "edwinspire@gmail.com",
        subject: `Welcome ${data.client.username}`,
        html: userRegister(data.client.username, data.password),
      };

      // Enviar por email la clave al usuario
      const uF = new uFetch(SYSTEM_PATHS.SEND_EMAIL.PATH);
      uF.setBearerAuthorization(process.env.USER_OPENFUSIONAPI_TOKEN);
      const req = await uF[SYSTEM_PATHS.SEND_EMAIL.METHOD]({ data: mail });
      const res = await req.json();

      let token = GenToken({ api: data.client }, 10 * 60); // Valido por 10 minutos

      // TODO: Si falla el envio al correo guardar en log
      r.data = { client: data.client, token: token, email: res };
      r.code = 200;
    } else {
      r.data = { error: "Client not saved." };
      r.code = 500;
    }
  } catch (error) {
    r.data = error;
    r.code = 500;
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
  //const xForwardedProto = params?.request?.headers?.["x-forwarded-proto"];
  const isHttpsRequest = false;
  /*
    params?.request?.protocol === "https" ||
    (typeof xForwardedProto === "string" && xForwardedProto.includes("https"));
    */

  try {
    let data = await loginApiClient(
      auth_data.Basic.username,
      auth_data.Basic.password
    );

    // Establecer una cookie básica
    params.reply.setCookie("OFAPI_TOKEN", "", {
      path: "/",
      httpOnly: true,
      secure: isHttpsRequest,
      sameSite: "Strict",
      maxAge: 5,
    });

    if (data.login) {
      let aut = `Bearer ${data.token}`;
      params.reply.header("Authorization", aut);

      params.reply.setCookie("OFAPI_TOKEN", data.token, {
        path: "/",
        httpOnly: true,
        secure: isHttpsRequest,
        sameSite: "Lax",
        maxAge: 60 * 60,
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

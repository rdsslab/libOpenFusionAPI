import {
  createUser,
  login,
  getAllUsers,
  updateUserPassword,
} from "../../../../../db/user.js";
import {getUserPasswordTokenFromRequest} from "../../../../auth.js";

export async function fnCreateUser(params) {
  let r = { data: undefined, code: 204 };

  try {
    let data = await createUser(params?.request?.body);

    r.data = data;
    r.code = 200;
  } catch (error) {
    r.data = error;
    r.code = 500;
  }
  return r;
}



export async function fnLogin(params) {
  let r = { code: 204, data: undefined };
  try {
    let auth_data = getUserPasswordTokenFromRequest(params.request);
    const xForwardedProto = params?.request?.headers?.["x-forwarded-proto"];
    const isHttpsRequest =
      params?.request?.protocol === "https" ||
      (typeof xForwardedProto === "string" && xForwardedProto.includes("https"));

    let user = await login(auth_data.Basic.username, auth_data.Basic.password);

    // Establecer una cookie básica
    params.reply.setCookie("OFAPI_TOKEN", "", {
      path: "/",
      httpOnly: true,
      secure: isHttpsRequest,
      sameSite: "Strict",
      maxAge: 5,
    });

    if (user.login) {

      let aut = `Bearer ${user.token}`;
      params.reply.header("Authorization", aut);

      params.reply.setCookie("OFAPI_TOKEN", user.token, {
        path: "/",
        httpOnly: true,
        secure: isHttpsRequest,
        sameSite: "Lax",
        maxAge: user.exp_seconds || 3600,
      });

      r.data = user;
      r.code = 200;
    } else {
      r.data = user;
      r.code = 401;
    }
  } catch (error) {
    r.data = error;
    r.code = 500;
  }
  return r;
}

export async function fnLogout(params) {
  let r = { data: undefined, code: 204 };
  try {
    // TODO: ver la forma de hacer un logout correctamente e invalide el token
    params.reply.set("OFAPI_TOKEN", undefined);

    r.data = {
      logout: true,
    };
    r.code = 200;
  } catch (error) {
    r.data = error;
    r.code = 500;
  }
  return r;
}

export async function fnGetUsersList(params) {
  let r = { code: 204, data: undefined };
  try {
    let us = await getAllUsers();

    us = us.map((u) => {
      return {
        iduser: u.iduser,
        enabled: u.enabled,
        username: u.username,
        name: u.last_name + " " + u.first_name,
        email: u.email,
      };
    });

    r.data = us;
    r.code = 200;
  } catch (error) {
    r.data = error;
    r.code = 500;
  }
  return r;
}

export async function fnUpdateUserPassword(params) {
  let r = { data: undefined, code: 204 };

  try {
    let data = await updateUserPassword(params?.request?.body);

    r.data = data;
    r.code = 200;
  } catch (error) {
    r.data = error;
    r.code = 500;
  }
  return r;
}

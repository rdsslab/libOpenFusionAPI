import { getUserPasswordTokenFromRequest } from "../../../../auth.js";
import { GenTokenJWT } from "../../../../functionVars.js";

import {
  upsertApiKey,
  getApiKeyById,
  getAllApiKeys,
  deleteApiKey,
  getApiKeyByFilters,
} from "../../../../../db/apikey.js";
import { getAppById } from "../../../../../db/app.js";


export async function fnUpsertApiKey(params) {
  let r = { data: undefined, code: 204 };
  // TODO: controlar que solo el usuario pueda cambiar su propia clave y no la de otros usuarios.
  try {
    let ak = params?.request?.body;
    if (!ak) {
      r.data = "No se proporcionaron datos para la ApiKey";
      r.code = 400;
      return r;
    }

    if (!ak.idapp) {
      r.data = "No se proporcionaron datos para la ApiKey";
      r.code = 400;
      return r;
    }

    if (!ak.idclient) {
      r.data = "No se proporcionaron datos para la ApiKey";
      r.code = 400;
      return r;
    }


    ak.enabled = true;
    ak.startAt = new Date(ak.startAt || new Date());
    ak.endAt = new Date(ak.endAt || new Date(ak.startAt.getTime() + 30 * 24 * 60 * 60 * 1000)); // 1 month

    let key = params?.request?.openfusionapi?.handler?.params?.jwt_key;

    // La key debe firmarse con la jwt_key de la aplicación destino (ak.idapp),
    // no con la del app que sirve el endpoint: al consumir un endpoint protegido
    // la validación usa la jwt_key de la app dueña del endpoint. Sin esto, una
    // key creada desde el endpoint de sistema para otra app quedaría firmada con
    // la clave del sistema y sería inválida en la app destino.
    if (ak.idapp) {
      try {
        const app = await getAppById(ak.idapp);
        if (app?.jwt_key) key = app.jwt_key;
      } catch (error) {
        console.error("Error resolving jwt_key for apikey:", error?.message || error);
      }
    }

    if (!key) {
      r.data = "Application jwt_key is not created.";
      r.code = 400;
      return r;
    }

    //ak.token = 'OFAPI_KEY@' + GenTokenJWT({ apikey: { idapp: ak.idapp, idclient: ak.idclient } }, ak.startAt, ak.endAt, key);
    ak.token = GenTokenJWT({ apikey: { idapp: ak.idapp, idclient: ak.idclient } }, ak.startAt, ak.endAt, key);

    let data = await upsertApiKey(ak);

    r.data = data;
    r.code = 200;
  } catch (error) {
    r.data = error;
    r.code = 500;
  }
  return r;
}

export async function fnGetApiKeyById(params) {
  let r = { data: undefined, code: 204 };

  try {
    let data = await getApiKeyById(params?.request?.query?.idkey);

    r.data = data;
    r.code = 200;
  } catch (error) {
    r.data = error;
    r.code = 500;
  }
  return r;
}

export async function fnGetAllApiKeys(params) {
  let r = { data: undefined, code: 204 };

  try {
    let data = await getAllApiKeys();

    r.data = data;
    r.code = 200;
  } catch (error) {
    r.data = error;
    r.code = 500;
  }
  return r;
}

export async function fnDeleteApiKey(params) {
  let r = { data: undefined, code: 204 };

  try {
    let data = await deleteApiKey(params?.request?.query?.idkey);

    r.data = data;
    r.code = 200;
  } catch (error) {
    r.data = error;
    r.code = 500;
  }
  return r;
}

export async function fnGetApiKeyByFilters(params) {
  let r = { data: undefined, code: 204 };

  try {
    let data = await getApiKeyByFilters(
      params?.request?.query?.idapp,
      params?.request?.query?.idclient,
      params?.request?.query?.endAt,
      params?.request?.query?.startAt,
      params?.request?.query?.enabled,
      params?.request?.query?.token
    );

    r.data = data;
    r.code = 200;
  } catch (error) {
    r.data = error;
    r.code = 500;
  }
  return r;
}




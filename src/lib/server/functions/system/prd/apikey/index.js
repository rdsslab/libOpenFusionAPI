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
import {
  recordAudit,
  AUDIT_ACTIONS,
  AUDIT_ENTITY_TYPES,
} from "../../../../audit/auditService.js";


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

    // idkey vacío (""/null/undefined) => fila nueva: se elimina para que el
    // autoincrement del PK la genere. Antes se pasaba "" y SQLite respondía
    // SQLITE_MISMATCH al guardarlo en una columna BIGINT PRIMARY KEY.
    if (!ak.idkey) delete ak.idkey;

    let before = null;
    if (ak.idkey) {
      const existingKey = await getApiKeyById(ak.idkey);
      if (existingKey) {
        before = existingKey.get ? existingKey.get({ plain: true }) : existingKey.toJSON();
      }
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

    await recordAudit(params, {
      action: before ? AUDIT_ACTIONS.UPDATE : AUDIT_ACTIONS.CREATE,
      entity_type: AUDIT_ENTITY_TYPES.APIKEY,
      entity_id: r.data?.idkey ?? ak.idkey ?? null,
      idapp: ak.idapp,
      before,
      after: r.data,
      status: true,
      result_code: 200,
    });
  } catch (error) {
    r.data = error;
    r.code = 500;
    await recordAudit(params, {
      action: AUDIT_ACTIONS.UPDATE,
      entity_type: AUDIT_ENTITY_TYPES.APIKEY,
      entity_id: params?.request?.body?.idkey || null,
      idapp: params?.request?.body?.idapp || null,
      before: null,
      after: null,
      status: false,
      result_code: 500,
      message: error?.message || String(error),
    });
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
    const idkey = params?.request?.query?.idkey;
    const existingKey = idkey ? await getApiKeyById(idkey) : null;
    let data = await deleteApiKey(idkey);

    r.data = data;
    r.code = 200;

    await recordAudit(params, {
      action: AUDIT_ACTIONS.DELETE,
      entity_type: AUDIT_ENTITY_TYPES.APIKEY,
      entity_id: idkey || null,
      idapp: existingKey?.idapp || null,
      before: existingKey,
      after: null,
      status: Boolean(r.data),
      result_code: 200,
    });
  } catch (error) {
    r.data = error;
    r.code = 500;
    await recordAudit(params, {
      action: AUDIT_ACTIONS.DELETE,
      entity_type: AUDIT_ENTITY_TYPES.APIKEY,
      entity_id: params?.request?.query?.idkey || null,
      status: false,
      result_code: 500,
      message: error?.message || String(error),
    });
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




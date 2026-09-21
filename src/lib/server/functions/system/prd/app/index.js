import {
  getAllApps,
  getAppsCatalog,
  getAppById,
  getAppFullById,
  upsertApp,
  restoreAppFromBackup,
  getAppBackupById,
  getAllAppsBackup,
  restoreAllAppsFromBackup,
  checkSystemApp,
  getApplicationTreeByFilters,
  getApplicationsTreeByFilters,
} from "../../../../../db/app.js";
import { generateDocumentation } from "../../../../doc_generator.js";
import { version } from "../../../../version.js";
import {
  recordAudit,
  AUDIT_ACTIONS,
  AUDIT_ENTITY_TYPES,
} from "../../../../audit/auditService.js";

export async function fnGetApplicationsTreeByFilters(params) {
  let r = { code: 204, data: undefined };
  try {
    const apps = await getApplicationsTreeByFilters(params.request.body);

    r.data = apps;
    r.code = 200;
  } catch (error) {
    r.data = error;
    r.code = 500;
  }
  return r;
}

export async function fnGetApps(params) {
  let r = { code: 204, data: undefined };
  try {
    const attributes = params.request.query?.attributes || params.request.body?.attributes;
    const apps = await getAllApps(attributes);

    r.data = apps;
    r.code = 200;
  } catch (error) {
    r.data = error;
    r.code = 500;
  }
  return r;
}

export async function fnGetAppsCatalog(params) {
  let r = { code: 204, data: undefined };
  try {
    const filters = params?.request?.body || {};
    r.data = await getAppsCatalog(filters);
    r.code = 200;
  } catch (error) {
    r.data = error;
    r.code = 500;
  }
  return r;
}

export async function fnGetAppById(params) {
  let r = { code: 200, data: undefined };
  try {
    let raw =
      !params?.request?.query?.raw || params?.request?.query?.raw == "false"
        ? false
        : true;

    r.data = await getAppFullById(params?.request?.query?.idapp, raw);
    r.code = 200;
  } catch (error) {
    console.log(error);

    r.data = error;
    r.code = 500;
  }
  return r;
}

export async function fnAppGetById(params) {
  let r = { code: 200, data: undefined };
  try {
    let raw =
      !params.request.query.raw || params.request.query.raw == "false"
        ? false
        : true;
    r.data = await getAppById(params.request.query.idapp, raw);
    r.code = 200;
  } catch (error) {
    console.log(error);

    r.data = error;
    r.code = 500;
  }
  return r;
}

export async function fnGetAppDocById(params) {
  let r = { code: 200, data: undefined };
  try {
    r.data = await getAppFullById(params.request.body.idapp, false);

    if (r.data && Array.isArray(r.data) && r.data.length > 0) {
      r.data = {
        html: generateDocumentation(
          r.data[0],
          version,
          params.request.body.endpoints
        ),
      };
      r.code = 200;
    } else {
      r.data = { error: "App not found" };
      r.code = 404;
    }
  } catch (error) {
    console.log(error);

    r.data = error;
    r.code = 500;
  }
  return r;
}

export async function fnAppUpsert(params) {
  let r = { code: 200, data: undefined };
  try {
    const body = params?.request?.body || {};

    let before = null;
    if (body.idapp) {
      const existing = await getAppById(body.idapp, true);
      before = Array.isArray(existing) && existing.length > 0 ? existing[0] : null;
    }

    r.data = await upsertApp(body);
    r.code = 200;

    const idapp = body.idapp || r.data?.idapp || before?.idapp || null;
    await recordAudit(params, {
      action: before ? AUDIT_ACTIONS.UPDATE : AUDIT_ACTIONS.CREATE,
      entity_type: AUDIT_ENTITY_TYPES.APP,
      entity_id: idapp,
      idapp,
      before,
      after: r.data,
      status: true,
      result_code: 200,
    });
  } catch (error) {
    console.log(error);

    r.data = error;
    r.code = 500;
    await recordAudit(params, {
      action: AUDIT_ACTIONS.UPDATE,
      entity_type: AUDIT_ENTITY_TYPES.APP,
      entity_id: params?.request?.body?.idapp || null,
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

/*
export async function fnSaveApp(params) {
  let r = { data: undefined, code: 204 };
  try {
    r.data = await saveAppWithEndpoints(params.request.body);
    r.code = 200;
  } catch (error) {
    r.data = error;
    r.code = 500;
  }
  return r;
}
*/

export async function fnRestoreAppFromBackup(params) {
  let r = { data: undefined, code: 204 };
  try {
    let data = await restoreAppFromBackup(params.request.body);
    r.data = data;
    r.code = 200;
  } catch (error) {
    r.data = error;
    r.code = 500;
  }
  const idapp = params?.request?.body?.idapp || null;
  await recordAudit(params, {
    action: AUDIT_ACTIONS.RESTORE,
    entity_type: AUDIT_ENTITY_TYPES.APP,
    entity_id: idapp,
    idapp,
    status: r.code === 200,
    result_code: r.code,
    message:
      r.code === 200
        ? "App restored from backup"
        : r?.data?.message || "App restore from backup failed",
  });
  return r;
}

export async function fnGetAppBackupById(params) {
  let r = { code: 200, data: undefined };
  try {
    r.data = await getAppBackupById(params.request.query.idapp);
    r.code = 200;
  } catch (error) {
    console.log(error);

    r.data = error;
    r.code = 500;
  }
  return r;
}

export async function fnGetAllAppsBackup(params) {
  let r = { code: 200, data: undefined };
  try {
    r.data = await getAllAppsBackup();
    r.code = 200;
  } catch (error) {
    console.log(error);

    r.data = error;
    r.code = 500;
  }
  return r;
}

export async function fnRestoreAllAppsFromBackup(params) {
  let r = { data: undefined, code: 204 };
  try {
    let data = await restoreAllAppsFromBackup(params.request.body);
    r.data = data;
    r.code = 200;
  } catch (error) {
    r.data = error;
    r.code = 500;
  }
  await recordAudit(params, {
    action: AUDIT_ACTIONS.RESTORE,
    entity_type: AUDIT_ENTITY_TYPES.APP,
    entity_id: null,
    idapp: null,
    status: r.code === 200,
    result_code: r.code,
    message:
      r.code === 200
        ? "All apps restored from backup"
        : r?.data?.message || "Restore all apps from backup failed",
  });
  return r;
}

//
export async function fnCheckSystemApp(params) {
  let r = { data: undefined, code: 204 };

  try {
    let data = await checkSystemApp(
      params?.request?.body.restore,
      params?.server_data?.endpoint_class
    );

    r.data = data;
    r.code = 200;
  } catch (error) {
    r.data = error;
    r.code = 500;
  }
  return r;
}

export async function fnGetInternalAppMetrics(params) {
  let r = { data: undefined, code: 204 };
  try {
    r.data = [];
    r.code = 200;

    r = params.server_data.endpoint_class.getInternalAppMetrics(
      params?.request?.query?.appName
    );
  } catch (error) {
    r.data = error;
    r.code = 500;
  }
  return r;
}

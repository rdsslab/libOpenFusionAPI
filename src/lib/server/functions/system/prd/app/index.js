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
    r.data = await upsertApp(params.request.body);
    r.code = 200;
  } catch (error) {
    console.log(error);

    r.data = error;
    r.code = 500;
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
  return r;
}

//
export async function fnCheckSystemApp(params) {
  let r = { data: undefined, code: 204 };

  try {
    let data = await checkSystemApp(params?.request?.body.restore);

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

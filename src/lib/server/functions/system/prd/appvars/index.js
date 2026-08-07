import {
  upsertAppVar,
  deleteAppVar,
  getAppVarsById,
  getAppVarsByIdApp,
  getAppVarsCatalogByIdApp,
} from "../../../../../db/appvars.js";

export async function fnUpsertAppVar(params) {
  let r = { code: 204, data: undefined };
  try {
    r.data = await upsertAppVar(params.request.body);

    const idapp = params?.request?.body?.idapp || r?.data?.idapp;
    const environment =
      params?.request?.body?.environment ||
      r?.data?.environment;

    params?.server_data?.endpoint_class?.deleteEndpointsByIdApp?.(idapp, environment);

    r.code = 200;
  } catch (error) {
    // Nombre inválido: 400 estructurado para que los agentes MCP puedan
    // detectarlo y autocorregirse, en vez de un 500 con el error crudo.
    if (error?.code === "INVALID_APPVAR_NAME") {
      r.data = {
        error: error.message,
        code: error.code,
        details: error.details,
      };
      r.code = 400;
      return r;
    }

    r.data = error;
    r.code = 500;
  }
  return r;
}

//
export async function fnDeleteAppVar(params) {
  let r = { code: 204, data: undefined };
  try {
    const idvar = params?.request?.query?.idvar;
    const appVar = idvar ? await getAppVarsById(idvar) : undefined;

    r.data = await deleteAppVar(idvar);

    const idapp = appVar?.idapp;
    const environment = appVar?.environment;
    params?.server_data?.endpoint_class?.deleteEndpointsByIdApp?.(idapp, environment);

    r.code = 200;
  } catch (error) {
    r.data = error;
    r.code = 500;
  }
  return r;
}

export async function fnGetAppVarsByIdApp(params) {
  let r = { code: 200, data: undefined };
  try {
    r.data = await getAppVarsByIdApp(params.request.query.idapp);
    r.code = 200;
  } catch (error) {
    console.log(error);

    r.data = error;
    r.code = 500;
  }
  return r;
}

export async function fnGetAppVarsCatalogByIdApp(params) {
  let r = { code: 200, data: undefined };
  try {
    r.data = await getAppVarsCatalogByIdApp(params?.request?.body || {});
    r.code = 200;
  } catch (error) {
    console.log(error);

    r.data = error;
    r.code = 500;
  }
  return r;
}

export async function fnAppVarsEffectiveResolve(params) {
  let r = { code: 200, data: undefined };

  const normalizeEnvironment = (value) =>
    typeof value === "string" ? value.trim().toLowerCase() : "";

  const findInLive = (rows, name, environment) => {
    if (!Array.isArray(rows)) {
      return undefined;
    }

    const targetEnvironment = normalizeEnvironment(environment);

    const exact = rows.find(
      (row) =>
        row?.name === name &&
        normalizeEnvironment(row?.environment) === targetEnvironment,
    );
    if (exact && exact.value !== undefined) {
      return exact.value;
    }

    const fallback = rows.find(
      (row) => row?.name === name && !normalizeEnvironment(row?.environment),
    );

    return fallback?.value;
  };

  try {
    const input = {
      ...(params?.request?.query || {}),
      ...(params?.request?.body || {}),
    };

    const idapp = input?.idapp;
    const environment = normalizeEnvironment(input?.environment || "prd") || "prd";
    const name = input?.name;
    const source = String(input?.source || "auto").trim().toLowerCase();

    if (!idapp || !name) {
      r.code = 400;
      r.data = { error: "'idapp' and 'name' are required." };
      return r;
    }

    const endpointClass = params?.server_data?.endpoint_class;
    let snapshotValue;

    if (endpointClass?.internal_endpoint) {
      for (const item of Object.values(endpointClass.internal_endpoint)) {
        const p = item?.handler?.params;
        if (!p || p.idapp !== idapp) {
          continue;
        }

        if (normalizeEnvironment(p.environment) !== environment) {
          continue;
        }

        const snapshot = p.app_vars;
        if (snapshot && Object.prototype.hasOwnProperty.call(snapshot, name)) {
          snapshotValue = snapshot[name];
          break;
        }
      }
    }

    let resolved = snapshotValue;
    let resolvedSource = snapshotValue !== undefined ? "cache_snapshot" : "not_found";

    if (source === "live" || (source === "auto" && resolved === undefined)) {
      const liveRows = await getAppVarsByIdApp(idapp);
      const liveValue = findInLive(liveRows, name, environment);
      if (liveValue !== undefined) {
        resolved = liveValue;
        resolvedSource = "db_live";
      }
    }

    r.code = resolved === undefined ? 404 : 200;
    r.data = {
      idapp,
      name,
      environment,
      source: resolvedSource,
      value: resolved,
    };
  } catch (error) {
    r.data = error;
    r.code = 500;
  }

  return r;
}

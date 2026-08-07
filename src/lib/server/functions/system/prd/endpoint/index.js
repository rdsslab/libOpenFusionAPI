import {
  upsertEndpoint,
  getEndpointById,
  getEndpointByIdApp,
  getEndpointCatalogByIdApp,
  getEndpointSourceSummaryById,
  searchEndpoints,
  getEndpointCode,
  restoreEndpointFromBackup,
  deleteEndpoint,
} from "../../../../../db/endpoint.js";

import { getEndpointBackupByIdEndpoint, getEndpointBackupByIdEndpointLightweight } from "../../../../../db/endpoint_backup.js";
import { upsertAppVar, getAppVarsById } from "../../../../../db/appvars.js";
import { Endpoint, Application, AppVars } from "../../../../../db/models.js";
import { Op } from "sequelize";
import { createHash } from "node:crypto";
import { internal_url_http } from "../../../../utils_path.js";

export async function fnGetEndpointBackupByIdEndpoint(params) {
  let r = { code: 200, data: undefined };
  try {
    const idendpoint = params.request.query.idendpoint;
    const lightweight =
      params.request.query.lightweight === "true" ||
      params.request.query.lightweight === true ||
      params.request.body?.lightweight === true;

    r.data = lightweight
      ? await getEndpointBackupByIdEndpointLightweight(idendpoint)
      : await getEndpointBackupByIdEndpoint(idendpoint);
    r.code = 200;
  } catch (error) {
    console.log(error);
    r.data = { error: error.message };
    r.code = 500;
  }
  return r;
}

export async function fnEndpointUpsert(params) {
  let r = { code: 200, data: undefined };
  try {
    let body = params.request.body;
    let fileToProcess = null;

    const contentType = params.request.headers?.['content-type'] || '';
    if (contentType.includes("multipart/form-data") && body) {
      let flattenedBody = {};
      
      for (const key in body) {
        let field = body[key];
        let items = Array.isArray(field) ? field : [field];
        
        for (const item of items) {
          if (item && item.type === 'file') {
            if (!fileToProcess) {
              fileToProcess = item;
            }
          } else if (item && item.type === 'field') {
            try {
              flattenedBody[key] = JSON.parse(item.value);
            } catch (e) {
              flattenedBody[key] = item.value;
            }
          }
        }
      }

      if (flattenedBody.json && typeof flattenedBody.json === 'object') {
        body = flattenedBody.json;
      } else if (flattenedBody.data && typeof flattenedBody.data === 'object') {
        body = flattenedBody.data;
      } else if (flattenedBody.endpoint && typeof flattenedBody.endpoint === 'object') {
        body = flattenedBody.endpoint;
      } else {
        body = flattenedBody;
      }
    }

    if (body && body.handler === "TEXT" && fileToProcess) {
      let buffer = await fileToProcess.toBuffer();
      
      if (buffer.length > 1024 * 1024) {
        r.data = { error: "File size exceeds the 1MB limit." };
        r.code = 400;
        return r;
      }
      
      body.code = buffer.toString('base64');
      
      let customData = typeof body.custom_data === 'object' && body.custom_data !== null ? body.custom_data : {};
      if (typeof body.custom_data === 'string') {
        try { customData = JSON.parse(body.custom_data); } catch(e) {}
      }
      
      customData.mimeType = fileToProcess.mimetype;
      customData.fileName = fileToProcess.filename;
      customData.fileSize = buffer.length;
      customData.isBase64 = true;
      
      body.custom_data = customData;
    }

    r.data = await upsertEndpoint(body);
    r.code = 200;
  } catch (error) {
    console.log(error);

    // Structured conflict error — return 400 so agents can detect and fix the name
    if (error?.code === "MCP_NAME_CONFLICT") {
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

export async function fnEndpointGetById(params) {
  let r = { code: 200, data: undefined };
  try {
    const idendpoint = params.request.query.idendpoint || params.request.body?.idendpoint;
    const attributes = params.request.query.attributes || params.request.body?.attributes;

    r.data = await getEndpointById(idendpoint, attributes);
    r.code = 200;
  } catch (error) {
    console.log(error);
    r.data = { error: error.message };
    r.code = 500;
  }
  return r;
}

export async function fnEndpointGetByIdApp(params) {
  let r = { code: 200, data: undefined };
  try {
    const idapp = params.request.query.idapp || params.request.body?.idapp;
    const attributes = params.request.query.attributes || params.request.body?.attributes;

    r.data = await getEndpointByIdApp(idapp, attributes);
    r.code = 200;
  } catch (error) {
    console.log(error);
    r.data = { error: error.message };
    r.code = 500;
  }
  return r;
}

export async function fnEndpointCatalogByIdApp(params) {
  let r = { code: 200, data: undefined };
  try {
    r.data = await getEndpointCatalogByIdApp(params?.request?.body || {});
    r.code = 200;
  } catch (error) {
    console.log(error);

    r.data = error;
    r.code = 500;
  }
  return r;
}

export async function fnEndpointSourceSummaryById(params) {
  let r = { code: 200, data: undefined };
  try {
    r.data = await getEndpointSourceSummaryById(params?.request?.body || {});
    r.code = r.data ? 200 : 404;
  } catch (error) {
    console.log(error);

    r.data = error;
    r.code = 500;
  }
  return r;
}

export async function fnClearCache(params) {
  let r = { data: undefined, code: 204 };
  try {
    r.data = [];
    r.code = 200;

    let data = params.request.body;
    let clear_cache = [];

    if (data && Array.isArray(data) && data.length > 0) {
      clear_cache = data.map((u) => {
        return {
          url: u,
          clear: params.server_data.endpoint_class.clearCache(u),
        };
      });
    }

    r.data = clear_cache;
  } catch (error) {
    r.data = error;
    r.code = 500;
  }
  return r;
}

export async function fnGetCacheSize(params) {
  let r = { data: undefined, code: 204 };
  try {
    r.data = [];
    r.code = 200;

    r = params.server_data.endpoint_class.getCacheSize(
      params?.request?.query?.appName,
    );
  } catch (error) {
    r.data = error;
    r.code = 500;
  }
  return r;
}

export async function fnInvalidateEndpointCache(params) {
  let r = { data: undefined, code: 204 };
  try {
    const body = params?.request?.body || {};
    const endpointClass = params?.server_data?.endpoint_class;
    const idapp = body?.idapp;
    const environment = body?.environment;
    const idendpoint = body?.idendpoint;

    if (!endpointClass) {
      r.code = 500;
      r.data = { error: "Endpoint cache service not available." };
      return r;
    }

    if (!idapp && !idendpoint) {
      r.code = 400;
      r.data = { error: "'idapp' or 'idendpoint' is required." };
      return r;
    }

    let removed = 0;

    if (idendpoint) {
      removed += endpointClass.deleteEndpointByidEndpoint(idendpoint) || 0;
    }

    if (idapp) {
      removed += endpointClass.deleteEndpointsByIdApp(idapp, environment) || 0;
    }

    r.code = 200;
    r.data = {
      removed,
      criteria: {
        idapp,
        environment,
        idendpoint,
      },
    };
  } catch (error) {
    r.data = error;
    r.code = 500;
  }
  return r;
}

export async function fnEndpointCacheStatus(params) {
  let r = { data: undefined, code: 204 };
  try {
    const query = params?.request?.query || {};
    const endpointClass = params?.server_data?.endpoint_class;
    const idapp = query?.idapp;
    const environment = query?.environment;

    if (!endpointClass) {
      r.code = 500;
      r.data = { error: "Endpoint cache service not available." };
      return r;
    }

    const internal = endpointClass?.internal_endpoint || {};
    const entries = [];

    for (const [urlKey, data] of Object.entries(internal)) {
      const p = data?.handler?.params;
      if (!p) {
        continue;
      }

      if (idapp && p.idapp !== idapp) {
        continue;
      }

      if (environment && p.environment !== environment) {
        continue;
      }

      entries.push({
        url_key: urlKey,
        idapp: p.idapp,
        idendpoint: p.idendpoint,
        app: p.app,
        environment: p.environment,
        resource: p.resource,
        method: p.method,
        handler: p.handler,
      });
    }

    r.code = 200;
    r.data = {
      total: entries.length,
      filters: { idapp, environment },
      entries,
    };
  } catch (error) {
    r.data = error;
    r.code = 500;
  }
  return r;
}

export async function fnGetResponseCountStatus(params) {
  let r = { data: undefined, code: 204 };
  try {
    r.data = [];
    r.code = 200;

    r = params.server_data.endpoint_class.getResponseCountStatusCode(
      params?.request?.query?.appName,
    );
  } catch (error) {
    r.data = error;
    r.code = 500;
  }
  return r;
}

export async function fnEndpointMigrate(params) {
  let r = { code: 200, data: undefined };
  try {
    const migrations = params.request.body;
    
    if (!Array.isArray(migrations)) {
      r.code = 400;
      r.data = { error: "Expected an array of objects." };
      return r;
    }

    const results = [];

    for (const item of migrations) {
      const { idendpoint, target_env } = item;
      
      if (!idendpoint || !target_env) {
        results.push({ idendpoint, target_env, status: "error", message: "Missing idendpoint or target_env" });
        continue;
      }

      try {
        const originalEndpoint = await getEndpointById(idendpoint);
        
        if (!originalEndpoint) {
          results.push({ idendpoint, target_env, status: "error", message: "Endpoint not found" });
          continue;
        }

        const data = originalEndpoint.toJSON ? originalEndpoint.toJSON() : originalEndpoint;

        if (data.environment === target_env) {
          results.push({ idendpoint, target_env, status: "ignored", message: "Already in target environment" });
          continue;
        }

        const upsertData = {
          ...data,
          environment: target_env,
          skipMcpNameUniqueness: true,
        };

        delete upsertData.idendpoint;
        delete upsertData.createdAt;
        delete upsertData.updatedAt;
        delete upsertData.rowkey;

        const upsertResult = await upsertEndpoint(upsertData);
        
        results.push({ 
          idendpoint, 
          target_env, 
          status: "success", 
          new_idendpoint: upsertResult.result.idendpoint,
          message: upsertResult.created
            ? "Migrated successfully"
            : "Endpoint replaced successfully in target environment"
        });

      } catch (err) {
        results.push({ idendpoint, target_env, status: "error", message: err.message });
      }
    }

    r.data = results;
    r.code = 200;
  } catch (error) {
    console.log(error);
    r.data = { error: error.message };
    r.code = 500;
  }
  return r;
}

/**
 * Migra una lista de variables de aplicación (AppVars) a otro ambiente.
 * Similar a fnEndpointMigrate pero para AppVars.
 * MCP tool: appvar_migrate
 */
export async function fnAppVarMigrate(params) {
  let r = { code: 200, data: undefined };
  try {
    const migrations = params.request.body;
    
    if (!Array.isArray(migrations)) {
      r.code = 400;
      r.data = { error: "Expected an array of objects." };
      return r;
    }

    const results = [];

    for (const item of migrations) {
      const { idappvar, target_env } = item;
      
      if (!idappvar || !target_env) {
        results.push({ idappvar, target_env, status: "error", message: "Missing idappvar or target_env" });
        continue;
      }

      try {
        // Obtener la AppVar original
        const originalAppVar = await AppVars.findByPk(idappvar);
        
        if (!originalAppVar) {
          results.push({ idappvar, target_env, status: "error", message: "AppVar not found" });
          continue;
        }

        const data = originalAppVar.toJSON ? originalAppVar.toJSON() : originalAppVar;

        // Si ya está en el ambiente objetivo, ignorar
        if (data.environment === target_env) {
          results.push({ idappvar, target_env, status: "ignored", message: "Already in target environment" });
          continue;
        }

        // Preparar datos para upsert en el nuevo ambiente.
        // OJO: `description` NO es columna del modelo AppVars; enviarlo solo
        // añadía ruido (siempre undefined). Por eso no se incluye.
        const upsertData = {
          idapp: data.idapp,
          environment: target_env,
          name: data.name,
          value: data.value,
          type: data.type,
        };

        // Verificar si ya existe una AppVar con el mismo name, idapp y target_env
        const existingAppVar = await AppVars.findOne({
          where: {
            idapp: data.idapp,
            environment: target_env,
            name: data.name,
          },
        });

        if (existingAppVar) {
          // Si ya existe, actualizar esa misma fila.
          // La primary key del modelo es `idvar`, NO `idappvar` (ese es solo el
          // nombre del parámetro de entrada de la herramienta). Enviar
          // `idappvar` dejaba la clave en undefined y el upsert no apuntaba a la
          // fila encontrada, así que esta rama no reemplazaba nada.
          await upsertAppVar({
            idvar: existingAppVar.idvar,
            ...upsertData,
          });

          results.push({
            idappvar,
            target_env,
            status: "success",
            new_idappvar: existingAppVar.idvar,
            message: "AppVar replaced successfully in target environment",
          });
        } else {
          // Si no existe, crear una nueva (sin idvar para que genere uno nuevo)
          const upsertResult = await upsertAppVar(upsertData);

          results.push({
            idappvar,
            target_env,
            status: "success",
            new_idappvar: upsertResult?.idvar,
            message: "AppVar migrated successfully",
          });
        }

      } catch (err) {
        // Un nombre legacy (sin el prefijo `$_VAR_`) hace fallar la migración por
        // diseño: se propaga el nombre de la fila origen. Se devuelve el código
        // y la sugerencia para que el agente sepa qué corregir.
        results.push({
          idappvar,
          target_env,
          status: "error",
          message: err.message,
          ...(err?.code ? { code: err.code } : {}),
          ...(err?.details?.suggestion ? { suggestion: err.details.suggestion } : {}),
        });
      }
    }

    r.data = results;
    r.code = 200;
  } catch (error) {
    console.log(error);
    r.data = { error: error.message };
    r.code = 500;
  }
  return r;
}

/**
 * Búsqueda global de endpoints por texto libre (title, description, resource, keywords, opcionalmente code).
 * MCP tool: search_endpoints
 */
export async function fnEndpointSearch(params) {
  let r = { code: 200, data: undefined };
  try {
    r.data = await searchEndpoints(params?.request?.body || {});
    r.code = 200;
  } catch (error) {
    console.log(error);
    r.data = { error: error.message };
    r.code = 500;
  }
  return r;
}

/**
 * Devuelve una matriz de versiones por endpoint (resource+method) y ambiente.
 * MCP tool: endpoint_versions_matrix
 */
export async function fnEndpointVersionsMatrix(params) {
  let r = { code: 200, data: undefined };
  try {
    const body = params?.request?.body || {};
    const {
      idendpoint,
      idapp,
      app,
      include_disabled = false,
      environments = ["dev", "qa", "prd"],
    } = body;

    const normalizedEnvs = Array.isArray(environments) && environments.length > 0
      ? environments.filter((env) => ["dev", "qa", "prd"].includes(env))
      : ["dev", "qa", "prd"];

    if (normalizedEnvs.length === 0) {
      r.code = 400;
      r.data = { error: "At least one valid environment is required (dev, qa, prd)." };
      return r;
    }

    const where = {
      environment: { [Op.in]: normalizedEnvs },
    };

    if (!include_disabled) {
      where.enabled = true;
    }

    let resolvedIdapp = idapp;

    if (!resolvedIdapp && typeof app === "string" && app.trim() !== "") {
      const appName = app.trim().toLowerCase();
      const appRecord = await Application.findOne({
        where: { app: appName },
        attributes: ["idapp", "app"],
      });

      if (!appRecord) {
        r.code = 404;
        r.data = { error: `Application '${appName}' not found.` };
        return r;
      }

      resolvedIdapp = appRecord.idapp;
    }

    if (idendpoint) {
      const selected = await getEndpointById(idendpoint);
      if (!selected) {
        r.code = 404;
        r.data = { error: `Endpoint '${idendpoint}' not found.` };
        return r;
      }

      const selectedRow = selected.toJSON ? selected.toJSON() : selected;
      where.resource = selectedRow.resource;
      where.method = selectedRow.method;

      if (!resolvedIdapp) {
        resolvedIdapp = selectedRow.idapp;
      }
    }

    if (resolvedIdapp) {
      where.idapp = resolvedIdapp;
    }

    const endpoints = await Endpoint.findAll({
      where,
      attributes: [
        "idendpoint",
        "idapp",
        "resource",
        "method",
        "environment",
        "createdAt",
        "updatedAt",
        "enabled",
      ],
      order: [["resource", "ASC"], ["method", "ASC"], ["environment", "ASC"]],
    });

    const idapps = [...new Set(endpoints.map((ep) => ep.idapp).filter(Boolean))];
    const apps = idapps.length > 0
      ? await Application.findAll({
        where: { idapp: { [Op.in]: idapps } },
        attributes: ["idapp", "app"],
      })
      : [];

    const appMap = new Map(apps.map((a) => [a.idapp, a.app]));
    const envOrder = new Map([["dev", 0], ["qa", 1], ["prd", 2]]);
    const grouped = new Map();
    const comparisonFields = [
      "code",
      "handler",
      "access",
      "timeout",
      "enabled",
      "cache_time",
      "ctrl",
      "cors",
      "json_schema",
      "custom_data",
      "headers_test",
      "data_test",
      "title",
      "description",
      "keywords",
      "price_by_request",
      "price_kb_request",
      "price_kb_response",
    ];

    const normalizeValue = (value) => {
      if (value === null || value === undefined) {
        return null;
      }

      if (value instanceof Date) {
        return value.toISOString();
      }

      if (Array.isArray(value)) {
        return value.map((item) => normalizeValue(item));
      }

      if (typeof value === "object") {
        return Object.keys(value)
          .sort()
          .reduce((acc, key) => {
            acc[key] = normalizeValue(value[key]);
            return acc;
          }, {});
      }

      return value;
    };

    const hashValue = (value) =>
      createHash("sha256").update(JSON.stringify(normalizeValue(value))).digest("hex");

    const hashFields = (row, fields) =>
      createHash("sha256")
        .update(JSON.stringify(fields.reduce((acc, field) => {
          acc[field] = normalizeValue(row?.[field]);
          return acc;
        }, {})))
        .digest("hex");

    const buildComparison = (row, referenceRow) => {
      if (!referenceRow) {
        return {
          reference_env: null,
          same_code: true,
          same_configuration: true,
          same_metadata: true,
          same_overall: true,
          state: "identical",
          different_fields: [],
          matching_fields: comparisonFields,
          hashes: null,
        };
      }

      const codeHash = hashValue(row?.code);
      const referenceCodeHash = hashValue(referenceRow?.code);
      const configurationFields = ["handler", "access", "timeout", "enabled", "cache_time", "ctrl", "cors", "json_schema", "custom_data", "headers_test", "data_test"];
      const metadataFields = ["title", "description", "keywords", "price_by_request", "price_kb_request", "price_kb_response"];

      const hashes = {
        code: codeHash,
        configuration: hashFields(row, configurationFields),
        metadata: hashFields(row, metadataFields),
        overall: hashFields(row, comparisonFields),
      };

      const referenceHashes = {
        code: referenceCodeHash,
        configuration: hashFields(referenceRow, configurationFields),
        metadata: hashFields(referenceRow, metadataFields),
        overall: hashFields(referenceRow, comparisonFields),
      };

      const different_fields = [];
      const matching_fields = [];

      for (const field of comparisonFields) {
        const same = hashValue(row?.[field]) === hashValue(referenceRow?.[field]);
        if (same) {
          matching_fields.push(field);
        } else {
          different_fields.push(field);
        }
      }

      const same_code = hashes.code === referenceHashes.code;
      const same_configuration = hashes.configuration === referenceHashes.configuration;
      const same_metadata = hashes.metadata === referenceHashes.metadata;
      const same_overall = hashes.overall === referenceHashes.overall;

      let state = "different";
      if (same_overall) {
        state = "identical";
      } else if (same_code && same_configuration) {
        state = same_metadata ? "same_code_and_configuration" : "same_code_and_configuration_different_metadata";
      } else if (same_code) {
        state = "same_code_different_configuration";
      } else if (same_configuration) {
        state = "same_configuration_different_code";
      }

      return {
        reference_env: referenceRow.environment,
        same_code,
        same_configuration,
        same_metadata,
        same_overall,
        state,
        different_fields,
        matching_fields,
        hashes,
      };
    };

    for (const endpoint of endpoints) {
      const row = endpoint.toJSON ? endpoint.toJSON() : endpoint;
      const createdAt = row.createdAt ? new Date(row.createdAt).toISOString() : null;
      const updatedAt = row.updatedAt ? new Date(row.updatedAt).toISOString() : null;
      const groupKey = `${row.idapp}::${row.resource}::${row.method}`;

      if (!grouped.has(groupKey)) {
        grouped.set(groupKey, {
          idapp: row.idapp,
          app: appMap.get(row.idapp) || null,
          endpoint: row.resource,
          method: row.method,
          env: [],
          envRecords: {},
          latest: null,
        });
      }

      const group = grouped.get(groupKey);
      group.envRecords[row.environment] = row;
      group.env.push({
        env: row.environment,
        createdAt,
        updatedAt,
        idendpoint: row.idendpoint,
        enabled: row.enabled,
      });
    }

    const result = [...grouped.values()].map((group) => {
      group.env.sort((a, b) => (envOrder.get(a.env) ?? 99) - (envOrder.get(b.env) ?? 99));

      let latest = null;
      for (const item of group.env) {
        const ts = item.updatedAt || item.createdAt;
        if (!latest) {
          latest = { ...item };
          continue;
        }

        const latestTs = latest.updatedAt || latest.createdAt;
        if ((ts || "") > (latestTs || "")) {
          latest = { ...item };
        }
      }

      group.latest = latest;
      const referenceEnv = latest?.env || group.env[0]?.env || null;
      const referenceRow = referenceEnv ? group.envRecords[referenceEnv] : null;

      group.comparison = {
        reference_env: referenceEnv,
        reference_idendpoint: referenceRow?.idendpoint || null,
        all_same_code: true,
        all_same_configuration: true,
        all_same_metadata: true,
        all_same_overall: true,
        different_environments: [],
      };

      group.env = group.env.map((item) => {
        const row = group.envRecords[item.env];
        const comparison = buildComparison(row, referenceRow);

        if (!comparison.same_code) {
          group.comparison.all_same_code = false;
        }
        if (!comparison.same_configuration) {
          group.comparison.all_same_configuration = false;
        }
        if (!comparison.same_metadata) {
          group.comparison.all_same_metadata = false;
        }
        if (!comparison.same_overall) {
          group.comparison.all_same_overall = false;
          group.comparison.different_environments.push({
            env: item.env,
            idendpoint: item.idendpoint,
            state: comparison.state,
            different_fields: comparison.different_fields,
          });
        }

        return {
          ...item,
          comparison,
        };
      });

      delete group.envRecords;
      return group;
    });

    r.data = result;
    r.code = 200;
  } catch (error) {
    console.log(error);
    r.data = { error: error.message };
    r.code = 500;
  }
  return r;
}

/**
 * Devuelve únicamente el campo code (fuente) de un endpoint.
 * MCP tool: endpoint_get_code
 */
export async function fnEndpointGetCode(params) {
  let r = { code: 200, data: undefined };
  try {
    const idendpoint = params?.request?.query?.idendpoint || params?.request?.body?.idendpoint;
    const result = await getEndpointCode(idendpoint);
    r.data = result;
    r.code = result ? 200 : 404;
  } catch (error) {
    console.log(error);
    r.data = { error: error.message };
    r.code = 500;
  }
  return r;
}

/**
 * Ejecuta un endpoint internamente vía HTTP y devuelve el resultado.
 * Permite a agentes probar un endpoint sin construir peticiones HTTP externas.
 *
 * El agente debe proveer:
 *   - idendpoint: UUID del endpoint a ejecutar
 *   - app: nombre de la app (ej: "myapp")
 *   - environment: ambiente (dev / qa / prd)
 *   - payload: body JSON a enviar (para POST/PUT)
 *   - query_params: objeto con query string params (para GET)
 *   - bearer_token: token de autorización opcional
 *   - timeout_ms: timeout en ms (default 10000)
 *
 * MCP tool: execute_endpoint_test
 */
export async function fnEndpointTest(params) {
  let r = { code: 200, data: undefined };
  try {
    const hasOwn = (obj, key) =>
      obj != null && Object.prototype.hasOwnProperty.call(obj, key);

    const methodSupportsBody = (httpMethod) =>
      ["POST", "PUT", "PATCH", "DELETE", "QUERY"].includes(String(httpMethod || "").toUpperCase());

    const isStructuredPayloadValue = (value) =>
      value !== null &&
      (Array.isArray(value) ||
        (typeof value === "object" && !(value instanceof String)));

    const classifyFailure = (statusCode, responseData) => {
      const message =
        typeof responseData === "string"
          ? responseData
          : responseData?.error || responseData?.message || JSON.stringify(responseData || {});
      const msg = String(message || "").toLowerCase();

      if (statusCode === 401 || msg.includes("requires a token") || msg.includes("authorization")) {
        return "auth_required";
      }
      if (statusCode === 406 || msg.includes("text/event-stream") || msg.includes("not acceptable")) {
        return "missing_accept_header";
      }
      if (
        msg.includes("missing parameter") ||
        msg.includes("required") ||
        msg.includes("cannot be empty") ||
        msg.includes("requerido") ||
        msg.includes("obligatorio")
      ) {
        return "missing_params";
      }
      if (msg.includes("not valid json") || msg.includes("unexpected token")) {
        return "invalid_json_or_appvar";
      }
      if (msg.includes("handler") && msg.includes("no es válido")) {
        return "invalid_handler";
      }
      if (statusCode >= 500) {
        return "server_error";
      }
      return "request_error";
    };

    const extractQueryFromDataTest = (data_test) => {
      const result = {};
      const queryRows = data_test?.query;
      if (!Array.isArray(queryRows)) {
        return result;
      }

      for (const row of queryRows) {
        if (!row || row.enabled !== true) {
          continue;
        }
        if (!row.key || String(row.key).trim() === "") {
          continue;
        }
        result[String(row.key)] = row.value == null ? "" : row.value;
      }
      return result;
    };

    const extractHeadersFromDataTest = (data_test, headers_test) => {
      const result = {};

      if (headers_test && typeof headers_test === "object" && !Array.isArray(headers_test)) {
        Object.assign(result, headers_test);
      }

      const headerRows = data_test?.headers;
      if (Array.isArray(headerRows)) {
        for (const row of headerRows) {
          if (!row || row.enabled !== true) {
            continue;
          }
          if (!row.key || String(row.key).trim() === "") {
            continue;
          }
          result[String(row.key)] = row.value == null ? "" : row.value;
        }
      }

      return result;
    };

    const extractPayloadFromDataTest = (data_test) => {
      const bodyCfg = data_test?.body;
      if (!bodyCfg || typeof bodyCfg !== "object") {
        return { payload: null, parse_error: null };
      }

      const jsonCode = bodyCfg?.json?.code;
      if (jsonCode != null) {
        if (typeof jsonCode === "object") {
          return { payload: jsonCode, parse_error: null };
        }
        if (typeof jsonCode === "string" && jsonCode.trim() !== "") {
          try {
            return { payload: JSON.parse(jsonCode), parse_error: null };
          } catch (error) {
            return {
              payload: null,
              parse_error: "Saved data_test.body.json.code is not valid JSON, so no fallback payload was used.",
            };
          }
        }
      }

      return { payload: null, parse_error: null };
    };

    const body = params?.request?.body || {};
    const {
      idendpoint,
      app,
      environment = "prd",
      resource,
      method,
      payload = null,
      query_params = {},
      headers: input_headers = {},
      use_data_test_fallback = false,
      bearer_token = null,
      timeout_ms = 10000,
    } = body;

    const warnings = [];
    const hasMethodInput = hasOwn(body, "method");
    const hasQueryParamsInput = hasOwn(body, "query_params");
    const hasPayloadInput = hasOwn(body, "payload");
    const hasHeadersInput = hasOwn(body, "headers");
    const allowDataTestFallback = use_data_test_fallback === true;

    if (!idendpoint && hasPayloadInput && !hasMethodInput) {
      r.code = 400;
      r.data = {
        error: "When testing by 'app' + 'resource' with an explicit 'payload', provide an explicit 'method' or use 'idendpoint'.",
        error_type: "missing_method_for_payload",
      };
      return r;
    }

    // Necesitamos resource y method — los tomamos del endpoint si no se proveen
    let resolvedResource = resource;
    let resolvedMethod = method || "GET";
    let resolvedApp = app;
    let endpointData = null;

    if (idendpoint && (!resolvedResource || !resolvedApp)) {
      const ep = await getEndpointById(idendpoint);
      if (!ep) {
        r.code = 404;
        r.data = { error: `Endpoint ${idendpoint} not found.` };
        return r;
      }
      const epData = ep.toJSON ? ep.toJSON() : ep;
      endpointData = epData;
      resolvedResource = resolvedResource || epData.resource;
      resolvedMethod = epData.method || resolvedMethod;

      // Obtener el nombre de la app desde idapp si no se provee
      if (!resolvedApp) {
        const appRecord = await Application.findByPk(epData.idapp, { attributes: ["app"] });
        resolvedApp = appRecord ? appRecord.app : null;
      }
    }

    // If caller provided app/resource/method without idendpoint, try to load endpoint metadata.
    if (!endpointData && resolvedApp && resolvedResource && resolvedMethod) {
      const appRecord = await Application.findOne({
        where: { app: resolvedApp },
        attributes: ["idapp"],
      });

      if (appRecord?.idapp) {
        const found = await Endpoint.findOne({
          where: {
            idapp: appRecord.idapp,
            environment,
            resource: resolvedResource,
            method: resolvedMethod,
          },
        });
        endpointData = found?.toJSON ? found.toJSON() : found;
      } else {
        warnings.push(
          `Application '${resolvedApp}' was not found while resolving saved test metadata; proceeding without data_test fallback.`,
        );
      }
    }

    if (!resolvedResource || !resolvedApp) {
      r.code = 400;
      r.data = { error: "Provide 'idendpoint' (auto-resolves app/resource) or explicit 'app' + 'resource' + 'method'." };
      return r;
    }

    // Construir URL interna: http://localhost:PORT/api/{app}{resource}/{environment}
    const internalPath = `/api/${String(resolvedApp)}${String(resolvedResource)}/${String(environment)}`;
    let url = internal_url_http(internalPath);

    // Auto-populate inputs from endpoint test metadata if caller omitted them.
    const autoQueryParams =
      hasQueryParamsInput
        ? (query_params && typeof query_params === "object" ? query_params : {})
        : allowDataTestFallback
          ? extractQueryFromDataTest(endpointData?.data_test)
          : {};

    const payloadFromDataTest = hasPayloadInput
      ? { payload: null, parse_error: null }
      : allowDataTestFallback
        ? extractPayloadFromDataTest(endpointData?.data_test)
        : { payload: null, parse_error: null };

    if (payloadFromDataTest.parse_error) {
      warnings.push(payloadFromDataTest.parse_error);
    }

    const autoPayload = hasPayloadInput ? payload : payloadFromDataTest.payload;
    const payloadSource = hasPayloadInput
      ? "explicit"
      : payloadFromDataTest.payload !== null
        ? "data_test"
        : "none";

    const autoHeaders = hasHeadersInput
      ? (input_headers && typeof input_headers === "object" && !Array.isArray(input_headers) ? input_headers : {})
      : allowDataTestFallback
        ? extractHeadersFromDataTest(
            endpointData?.data_test,
            endpointData?.headers_test,
          )
        : {};

    if (!allowDataTestFallback && endpointData?.data_test && !hasQueryParamsInput && !hasPayloadInput && !hasHeadersInput) {
      warnings.push("Saved data_test/query/header metadata exists but was ignored because use_data_test_fallback=false.");
    }

    // Añadir query params para GET
    if (autoQueryParams && typeof autoQueryParams === "object" && Object.keys(autoQueryParams).length > 0) {
      const qs = new URLSearchParams(
        Object.entries(autoQueryParams).map(([k, v]) => [k, String(v)])
      ).toString();
      url = `${url}?${qs}`;
    }

    const httpMethod = (resolvedMethod || "GET").toUpperCase();

    const headers = { ...autoHeaders };
    if (bearer_token) {
      headers["Authorization"] = `Bearer ${bearer_token}`;
    }

    if (
      autoPayload !== null &&
      methodSupportsBody(httpMethod) &&
      !Object.keys(headers).some((k) => k.toLowerCase() === "content-type")
    ) {
      headers["Content-Type"] = "application/json";
    }

    const fetchOptions = {
      method: httpMethod,
      headers,
      signal: AbortSignal.timeout(timeout_ms),
    };

    let serializedBody = null;

    if (autoPayload !== null && !methodSupportsBody(httpMethod)) {
      warnings.push(`Payload was not sent because method '${httpMethod}' does not use a request body in this tool.`);
    }

    if (autoPayload !== null && methodSupportsBody(httpMethod)) {
      const ctKey = Object.keys(headers).find((k) => k.toLowerCase() === "content-type");
      const ct = ctKey ? String(headers[ctKey]).toLowerCase() : "application/json";
      const isStructuredPayload = isStructuredPayloadValue(autoPayload);

      // Structured payloads coming from either the caller or data_test must travel as JSON.
      if (isStructuredPayload && !ct.includes("application/json")) {
        headers[ctKey || "Content-Type"] = "application/json";
        if (!hasPayloadInput) {
          warnings.push("Structured payload from data_test forced Content-Type to application/json to avoid string coercion.");
        }
      }

      const finalCtKey = Object.keys(headers).find((k) => k.toLowerCase() === "content-type");
      const finalCt = finalCtKey ? String(headers[finalCtKey]).toLowerCase() : "application/json";

      serializedBody = finalCt.includes("application/json")
        ? JSON.stringify(autoPayload)
        : String(autoPayload);
      fetchOptions.body = serializedBody;
    }

    const t0 = Date.now();
    const response = await fetch(url, fetchOptions);
    const elapsed = Date.now() - t0;

    let responseData;
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      responseData = await response.json();
    } else {
      responseData = await response.text();
    }

    r.code = 200;
    r.data = {
      tested_url: url,
      method: httpMethod,
      status_code: response.status,
      response_time_ms: elapsed,
      success: response.status >= 200 && response.status < 300,
      error_type: response.status >= 200 && response.status < 300
        ? null
        : classifyFailure(response.status, responseData),
      resolved_inputs: {
        from_data_test: {
          query_params: allowDataTestFallback && !hasQueryParamsInput,
          payload: allowDataTestFallback && !hasPayloadInput,
          headers: allowDataTestFallback && !hasHeadersInput,
        },
        query_params: autoQueryParams,
        payload: autoPayload,
        payload_source: payloadSource,
        headers,
        serialized_body: serializedBody,
        warnings,
      },
      response: responseData,
    };
  } catch (error) {
    console.log(error);
    const isTimeout = error?.name === "TimeoutError" || error?.code === "ABORT_ERR";
    r.code = isTimeout ? 504 : 500;
    r.data = {
      error: isTimeout ? "Request timed out." : error.message,
      error_type: isTimeout ? "timeout" : "tool_runtime_error",
    };
  }
  return r;
}

/**
 * Restaura un endpoint desde un respaldo (backup) específico.
 * MCP tool: endpoint_restore_version
 */
export async function fnEndpointRestoreBackup(params) {
  let r = { code: 200, data: undefined };
  try {
    const idbackup = params?.request?.query?.idbackup || params?.request?.body?.idbackup;
    r.data = await restoreEndpointFromBackup(idbackup);
    r.code = 200;
  } catch (error) {
    console.log(error);
    r.data = { error: error.message };
    r.code = 500;
  }
  return r;
}

/**
 * Elimina un endpoint por su idendpoint.
 * MCP tool: endpoint_delete
 */
export async function fnEndpointDelete(params) {
  let r = { code: 200, data: undefined };
  try {
    const idendpoint = params?.request?.query?.idendpoint || params?.request?.body?.idendpoint;
    if (!idendpoint) {
      r.code = 400;
      r.data = { error: "idendpoint is required" };
      return r;
    }
    const success = await deleteEndpoint(idendpoint);
    r.data = { success };
    r.code = success ? 200 : 404;
  } catch (error) {
    console.log(error);
    r.data = { error: error.message };
    r.code = 500;
  }
  return r;
}


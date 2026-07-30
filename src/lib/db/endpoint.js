import { Endpoint } from "./models.js";
import { createEndpointBackup } from "./endpoint_backup.js";
import { Op } from "sequelize";

const normalizeMcpConfig = (mcp) => {
  if (!mcp) {
    return undefined;
  }

  if (typeof mcp === "string") {
    try {
      return JSON.parse(mcp);
    } catch {
      return undefined;
    }
  }

  if (typeof mcp === "object") {
    return mcp;
  }

  return undefined;
};

const formatMcpTimestamp = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${year}${month}${day}${hours}${minutes}${seconds}`;
};

/**
 * Verifies that no other enabled endpoint in the same (idapp + environment)
 * already uses the same MCP tool name.
 *
 * Scope: uniqueness is per (idapp, environment). The same name in "dev" and
 * "prd" is perfectly valid — MCP servers are typically scoped to one env.
 *
 * @throws {Error} with code MCP_NAME_CONFLICT when a duplicate is found,
 *   including the conflicting idendpoint so callers / agents can act on it.
 */
const ensureUniqueEnabledMcpName = async (data) => {
  // Nothing to check if no app or no mcp config
  if (!data?.idapp) {
    return data;
  }

  const nextMcp = normalizeMcpConfig(data.mcp);
  const nextName = nextMcp?.name?.trim?.();

  // Only enforce uniqueness when MCP is explicitly enabled with a name
  if (!nextMcp?.enabled || !nextName) {
    return data;
  }

  // Scope: same app + same environment (required for a meaningful scope)
  const environment = data.environment
    ? String(data.environment).toLowerCase()
    : null;

  if (!environment) {
    // Cannot enforce scope without environment — skip silently
    return data;
  }

  // Lean query: only fetch idendpoint + mcp for endpoints in this (idapp, environment)
  const candidates = await Endpoint.findAll({
    where: { idapp: data.idapp, environment },
    attributes: ["idendpoint", "mcp"],
  });

  const conflict = candidates.find((ep) => {
    const current = ep?.toJSON ? ep.toJSON() : ep;
    const currentMcp = normalizeMcpConfig(current?.mcp);
    const currentName = currentMcp?.name?.trim?.();

    // Skip if MCP not enabled or has no name
    if (!currentMcp?.enabled || !currentName) return false;

    // Skip self (UPDATE case)
    if (current?.idendpoint && current.idendpoint === data.idendpoint) return false;

    return currentName === nextName;
  });

  if (!conflict) {
    return data;
  }

  // Throw a structured, descriptive error so agents and callers know exactly
  // what went wrong and which endpoint holds the conflicting name.
  const conflictData = conflict?.toJSON ? conflict.toJSON() : conflict;
  const err = new Error(
    `MCP tool name '${nextName}' is already in use by endpoint '${conflictData.idendpoint}' ` +
    `in app '${data.idapp}' / environment '${environment}'. ` +
    `Choose a different mcp.name before saving.`
  );
  err.code = "MCP_NAME_CONFLICT";
  err.details = {
    requested_name: nextName,
    conflicting_idendpoint: conflictData.idendpoint,
    idapp: data.idapp,
    environment,
  };
  throw err;
};

export const upsertEndpoint = async (
  /** @type {import("sequelize").Optional<any, string>} */ data,
) => {
  try {
    const skipMcpNameUniqueness = data?.skipMcpNameUniqueness === true;
    delete data.skipMcpNameUniqueness;

    // Resolve the target endpoint first so updates/migrations can replace the
    // destination row and keep MCP-name uniqueness checks scoped to that row.
    if (data.idapp && data.environment && data.resource && data.method) {
      const existing = await Endpoint.findOne({
        where: {
          idapp: data.idapp,
          environment: String(data.environment).toLowerCase(),
          resource: String(data.resource).toLowerCase(),
          method: String(data.method).toUpperCase(),
        },
      });
      if (existing) {
        data.idendpoint = existing.idendpoint;
      }
    }

    if (!skipMcpNameUniqueness) {
      data = await ensureUniqueEnabledMcpName(data);
    }

    const [result, created] = await Endpoint.upsert(data, { returning: true });
    
    try {
        await createEndpointBackup({ data: data, idendpoint: result.idendpoint });
      } catch (error) {
        console.error("Error creating endpoint backup:", error);
      }
    

    return { result, created };
  } catch (error) {
    console.error("Error retrieving:", error, data);
    throw error; // c4ca4238-a0b9-2382-0dcc-509a6f75849b
  }
};

// READ
export const getEndpointById = async (
  /** @type {import("sequelize").Identifier | undefined} */ idendpoint,
  attributes = null
) => {
  try {
    const options = {};
    if (attributes && Array.isArray(attributes) && attributes.length > 0) {
      options.attributes = attributes;
    }
    const endpoint = await Endpoint.findByPk(idendpoint, options);
    return endpoint;
  } catch (error) {
    console.error("Error retrieving user:", error);
    throw error;
  }
};

export const getEndpointSourceSummaryById = async (filters = {}) => {
  const { idendpoint, preview_lines } = filters;

  try {
    const endpoint = await Endpoint.findByPk(idendpoint);

    if (!endpoint) {
      return null;
    }

    const data = endpoint.toJSON ? endpoint.toJSON() : endpoint;
    const source = typeof data.code === "string"
      ? data.code
      : data.code == null
        ? ""
        : JSON.stringify(data.code, null, 2);
    const lines = source.length > 0 ? source.split(/\r?\n/g) : [];
    const previewLines = Number.isFinite(Number(preview_lines)) && Number(preview_lines) > 0
      ? Math.floor(Number(preview_lines))
      : 40;

    return {
      idendpoint: data.idendpoint,
      idapp: data.idapp,
      resource: data.resource,
      method: data.method,
      handler: data.handler,
      environment: data.environment,
      enabled: data.enabled,
      title: data.title,
      description: data.description,
      keywords: data.keywords,
      codeLength: source.length,
      codeLines: lines.length,
      previewLines,
      codePreview: lines.slice(0, previewLines).join("\n"),
      hasMoreCode: lines.length > previewLines,
    };
  } catch (error) {
    console.error("Error retrieving endpoint source summary:", error);
    throw error;
  }
};

export const getAllEndpoints = async () => {
  try {
    const endpoints = await Endpoint.findAll();
    return endpoints;
  } catch (error) {
    console.error("Error retrieving:", error);
    throw error;
  }
};

// DISABLE — sets enabled=false without deleting the record
export const disableEndpoint = async (
  /** @type {import("sequelize").Identifier | undefined} */ idendpoint,
) => {
  try {
    const [updated] = await Endpoint.update(
      { enabled: false },
      { where: { idendpoint } },
    );
    return updated > 0;
  } catch (error) {
    console.error("Error disabling endpoint:", error);
    throw error;
  }
};

// DELETE
export const deleteEndpoint = async (
  /** @type {import("sequelize").Identifier | undefined} */ idendpoint,
) => {
  try {
    const ep = await Endpoint.findByPk(idendpoint);
    if (ep) {
      await ep.destroy();
      return true; // Deletion successful
    }
    return false; // User not found
  } catch (error) {
    console.error("Error deleting idendpoint:", error);
    throw error;
  }
};

// READ
export const getEndpointByIdApp = async (
  /** @type {import("sequelize").Identifier | undefined} */ idapp,
  attributes = null,
  environment = null
) => {
  try {
    const where = { idapp: idapp };
    if (environment) {
      where.environment = environment;
    }
    const options = { where };
    if (attributes && Array.isArray(attributes) && attributes.length > 0) {
      options.attributes = attributes;
    }
    const endpoints = await Endpoint.findAll(options);
    return endpoints;
  } catch (error) {
    console.error("Error retrieving endpoints by app:", error);
    throw error;
  }
};

/**
 * Restaura un endpoint desde un respaldo (backup) específico.
 * @param {string} idbackup - ID del respaldo a restaurar
 * @returns {Promise<{success: boolean, idendpoint: string}>}
 */
export const restoreEndpointFromBackup = async (idbackup) => {
  if (!idbackup) throw new Error("idbackup es obligatorio.");
  
  const { getEndpointBackupById } = await import("./endpoint_backup.js");
  const backup = await getEndpointBackupById(idbackup);
  
  if (!backup) {
    throw new Error(`No se encontró el respaldo con ID ${idbackup}`);
  }

  const backupData = backup.toJSON ? backup.toJSON() : backup;
  const endpointData = backupData.data; // El campo 'data' contiene el snapshot del endpoint

  // Asegurarnos de que el idendpoint sea el correcto
  endpointData.idendpoint = backupData.idendpoint;

  // Realizar el upsert para restaurar
  const [result] = await Endpoint.upsert(endpointData, { returning: true });

  // Crear un nuevo backup de este cambio (la restauración en sí misma es un cambio)
  const { createEndpointBackup } = await import("./endpoint_backup.js");
  await createEndpointBackup({ data: endpointData, idendpoint: result.idendpoint });

  return { success: true, idendpoint: result.idendpoint };
};

export const getEndpointCatalogByIdApp = async (filters = {}) => {
  const {
    idapp,
    environment,
    method,
    handler,
    enabled,
    include_code,
    include_mcp,
    limit,
    offset,
  } = filters;

  try {
    const where = {};

    if (idapp) {
      where.idapp = idapp;
    }

    if (typeof environment === "string" && environment.trim() !== "") {
      where.environment = environment;
    }

    if (typeof method === "string" && method.trim() !== "") {
      where.method = method.toUpperCase();
    }

    if (typeof handler === "string" && handler.trim() !== "") {
      where.handler = handler.toUpperCase();
    }

    if (enabled !== null && enabled !== undefined) {
      where.enabled = enabled;
    }

    // The "mcp" column can contain large payloads (description, exampleRequest,
    // exampleResponse, notes). Excluding it by default prevents MCP tool responses
    // from exceeding agent token limits when an app has many endpoints.
    // Pass include_mcp: true to retrieve the full mcp metadata.
    const attributes = [
      "idendpoint",
      "idapp",
      "enabled",
      "access",
      "environment",
      "resource",
      "method",
      "handler",
      "title",
      "description",
      "keywords",
      "cache_time",
      "createdAt",
      "updatedAt",
    ];

    if (include_mcp === true) {
      attributes.push("mcp");
    }

    if (include_code === true) {
      attributes.push("code");
    }

    const parsedLimit = Number(limit);
    const parsedOffset = Number(offset);

    return await Endpoint.findAll({
      where,
      attributes,
      order: [
        ["resource", "ASC"],
        ["environment", "ASC"],
        ["method", "ASC"],
      ],
      ...(Number.isFinite(parsedLimit) && parsedLimit > 0 ? { limit: parsedLimit } : {}),
      ...(Number.isFinite(parsedOffset) && parsedOffset >= 0 ? { offset: parsedOffset } : {}),
    });
  } catch (error) {
    console.error("Error retrieving endpoint catalog:", error);
    throw error;
  }
};

// READ
export const getEndpointByApp = async (
  /** @type {import("sequelize").Identifier | undefined} */ appname,
) => {
  try {
    //const endpoints = await Endpoint.findAll({attributes: list_fields, where: { appname: appname } });
    const endpoints = await Endpoint.findAll({ where: { appname: appname } });
    return endpoints;
  } catch (error) {
    console.error("Error retrieving user:", error);
    throw error;
  }
};

export const bulkCreateEndpoints = (
  /** @type {readonly import("sequelize").Optional<any, string>[]} */ list_endpoints,
) => {
  // Campos que se utilizarán para verificar duplicados (en este caso, todos excepto 'rowkey' y 'idendpoint')
  //const uniqueFields = ['idapp', 'namespace', 'name', 'version', 'environment', 'method'];
  // OJO: No se pudo tener un bulk upsert
  return Endpoint.bulkCreate(list_endpoints, {
    ignoreDuplicates: true,
    //updateOnDuplicate: uniqueFields
  });
};

/**
 * Búsqueda global de endpoints por texto libre.
 * Busca en title, description, resource, keywords y (opcionalmente) en code.
 * @param {Object} filters
 * @param {string} filters.query - Texto a buscar (LIKE)
 * @param {string} [filters.idapp] - Filtrar por app (opcional)
 * @param {string} [filters.environment] - Filtrar por ambiente
 * @param {string} [filters.handler] - Filtrar por handler
 * @param {boolean} [filters.enabled] - Filtrar por estado
 * @param {boolean} [filters.search_code] - Incluir búsqueda dentro del campo code
 * @param {number} [filters.limit=50] - Máximo de resultados
 * @param {number} [filters.offset=0] - Offset para paginación
 * @returns {Promise<Array>}
 */
export const searchEndpoints = async (filters = {}) => {
  const {
    query,
    idapp,
    environment,
    handler,
    enabled,
    search_code = false,
    limit = 50,
    offset = 0,
  } = filters;

  const likePattern = query && typeof query === "string" && query.trim().length > 0
    ? `%${query.trim()}%`
    : null;

  const orConditions = likePattern
    ? [
        { title: { [Op.like]: likePattern } },
        { description: { [Op.like]: likePattern } },
        { resource: { [Op.like]: likePattern } },
        { keywords: { [Op.like]: likePattern } },
      ]
    : [];

  if (search_code && likePattern) {
    orConditions.push({ code: { [Op.like]: likePattern } });
  }

  const where = likePattern ? { [Op.or]: orConditions } : {};

  if (idapp) where.idapp = idapp;
  if (environment) where.environment = environment;
  if (handler) where.handler = handler.toUpperCase();
  if (enabled !== undefined && enabled !== null) where.enabled = enabled;

  const parsedLimit = Math.min(Number.isFinite(Number(limit)) ? Number(limit) : 50, 200);
  const parsedOffset = Number.isFinite(Number(offset)) && Number(offset) >= 0 ? Number(offset) : 0;

  try {
    return await Endpoint.findAll({
      where,
      attributes: [
        "idendpoint",
        "idapp",
        "enabled",
        "environment",
        "resource",
        "method",
        "handler",
        "title",
        "description",
        "keywords",
        "mcp",
        "cache_time",
        "access",
        "updatedAt",
      ],
      order: [
        ["resource", "ASC"],
        ["environment", "ASC"],
        ["method", "ASC"],
      ],
      limit: parsedLimit,
      offset: parsedOffset,
    });
  } catch (error) {
    console.error("Error en searchEndpoints:", error);
    throw error;
  }
};

/**
 * Obtiene únicamente el campo `code` (fuente) de un endpoint.
 * Útil para agentes que solo necesitan leer/modificar el código sin descargar todo el payload.
 * @param {string} idendpoint - UUID del endpoint
 * @returns {Promise<{idendpoint: string, handler: string, code: string|null}|null>}
 */
export const getEndpointCode = async (idendpoint) => {
  if (!idendpoint) throw new Error("idendpoint es obligatorio.");
  try {
    const endpoint = await Endpoint.findByPk(idendpoint, {
      attributes: ["idendpoint", "idapp", "resource", "method", "handler", "environment", "enabled", "code"],
    });
    if (!endpoint) return null;
    const data = endpoint.toJSON ? endpoint.toJSON() : endpoint;
    return data;
  } catch (error) {
    console.error("Error en getEndpointCode:", error);
    throw error;
  }
};

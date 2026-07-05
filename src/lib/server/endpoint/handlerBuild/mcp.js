import { getServer, jsonSchemaToZod } from "../../mcp/server.js";
import { getApplicationTreeByFilters } from "../../../db/app.js";
import { Handlers } from "../../../handler/handler.js";
import { readHandlerSkill } from "../../handlerDocs.js";
import { internal_url_endpoint } from "../../utils_path.js";
import * as z from "zod";
//import uFetch from "@edwinspire/universal-fetch";
import { URLAutoEnvironment } from "../../functionVars.js";

export const CreateMCPHandler = async (app_name, environment) => {

  const UNSUPPORTED_JSON_SCHEMA_KEYS = new Set([
    "if",
    "then",
    "else",
    "dependentSchemas",
    "unevaluatedProperties",
    "patternProperties",
    "prefixItems",
    "contains",
  ]);

  let app = await getApplicationTreeByFilters({
    app: app_name,
    enabled: true,
    endpoint: {
      enabled: true,
      environment: environment,
    },
  });

  // Fix 6: Las tools y los recursos se registran en variables locales y se añaden a un
  // nuevo McpServer en la función factory devuelta. De esta forma, cada request HTTP tiene
  // su propia instancia desconectada de transport permitiendo concurrencia, sin usar
  // cierres que sobrescriban variables globales como en requestContext.headers.
  const _mcpConfig = {
    tools: [],
    resources: []
  };

  for (const handlerKey of Object.keys(Handlers)) {
    const handlerKeyLower = handlerKey.toLowerCase();
    const toolName = `get_handler_skill_${handlerKeyLower}`;
    const resourceURI = `mcp://handlers/skills/${handlerKeyLower}`;

    // Register Resource
    _mcpConfig.resources.push({
      name: `handler-skill-${handlerKeyLower}`,
      uri: resourceURI,
      info: {
        description: `AI agent skill guide and persona instructions for endpoint handler ${handlerKey}`,
        mimeType: "text/markdown",
      },
      handler: async (_uri, _extra) => {
        const skill = await readHandlerSkill(handlerKey);
        return {
          contents: [
            {
              uri: resourceURI,
              mimeType: "text/markdown",
              text: skill.markdown
            }
          ]
        };
      }
    });

    // Register Tool
    _mcpConfig.tools.push({
      name: toolName,
      info: {
        title: `AI Agent Skill Instructions for ${handlerKey}`,
        description: `Returns the expert persona, guidelines, constraints, and templates for creating or modifying endpoints of type ${handlerKey}.`,
        inputSchema: {},
        annotations: { readOnlyHint: true }
      },
      handler: async () => {
        const skill = await readHandlerSkill(handlerKey);
        return {
          content: [
            {
              type: "text",
              mimeType: "text/markdown",
              text: skill.markdown
            }
          ]
        };
      }
    });
  }

  const getAccessLevelLabel = (access) => {
    switch (access) {
      case 0:
        return "Public (no authentication)";
      case 1:
        return "Basic authentication";
      case 2:
        return "Token authentication";
      case 3:
        return "Basic + Token authentication";
      case 4:
        return "Local only";
      default:
        return "Unknown";
    }
  };

  const stringifySafe = (value, fallback = "{}") => {
    if (value === undefined || value === null) return fallback;
    try {
      return JSON.stringify(value, null, 2);
    } catch (_error) {
      return fallback;
    }
  };

  const toCompactText = (value, fallback = "") => {
    if (value === undefined || value === null) return fallback;
    return String(value);
  };

  const getMcpField = (endpoint, fieldName) => {
    return endpoint?.mcp?.[fieldName] ?? endpoint?.mcp?.meta?.[fieldName];
  };

  const buildMcpMetadataDescription = (endpoint) => {
    const lines = [];
    const operationMode = toCompactText(getMcpField(endpoint, "operation_mode")).trim();
    const requiresConfirmation = getMcpField(endpoint, "requires_explicit_confirmation");
    const sideEffects = toCompactText(getMcpField(endpoint, "side_effects")).trim();
    const safeAlternative = toCompactText(getMcpField(endpoint, "safe_alternative")).trim();
    const riskLevel = toCompactText(getMcpField(endpoint, "risk_level")).trim();

    if (operationMode) {
      lines.push(`operation_mode: ${operationMode}`);
    }

    if (requiresConfirmation !== undefined && requiresConfirmation !== null) {
      lines.push(`requires_explicit_confirmation: ${String(requiresConfirmation)}`);
    }

    if (sideEffects) {
      lines.push(`side_effects: ${sideEffects}`);
    }

    if (safeAlternative) {
      lines.push(`safe_alternative: ${safeAlternative}`);
    }

    if (riskLevel) {
      lines.push(`risk_level: ${riskLevel}`);
    }

    if (lines.length === 0) {
      return "";
    }

    return [
      "MCP metadata:",
      ...lines.map((line) => `- ${line}`),
    ].join("\n");
  };

  const isEmptyObject = (value) => {
    return (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0
    );
  };

  const collectUnsupportedKeywordPaths = (schema, currentPath = "$", results = []) => {
    if (Array.isArray(schema)) {
      schema.forEach((item, index) => {
        collectUnsupportedKeywordPaths(item, `${currentPath}[${index}]`, results);
      });
      return results;
    }

    if (!schema || typeof schema !== "object") {
      return results;
    }

    for (const [key, value] of Object.entries(schema)) {
      const nextPath = `${currentPath}.${key}`;
      if (UNSUPPORTED_JSON_SCHEMA_KEYS.has(key)) {
        results.push(nextPath);
      }
      collectUnsupportedKeywordPaths(value, nextPath, results);
    }

    return results;
  };

  const summarizeSerializedSchema = (schema) => {
    if (!schema || typeof schema !== "object") {
      return {
        rootKind: "unknown",
        topLevelFields: [],
      };
    }

    const topLevelFields = schema.properties && typeof schema.properties === "object"
      ? Object.keys(schema.properties)
      : [];

    return {
      rootKind:
        schema.type
        ?? (Array.isArray(schema.allOf) ? "allOf" : null)
        ?? (Array.isArray(schema.anyOf) ? "anyOf" : null)
        ?? (Array.isArray(schema.oneOf) ? "oneOf" : null)
        ?? "unknown",
      topLevelFields,
    };
  };

  const buildJsonSchemaOperationalReport = (input = {}) => {
    const report = {
      valid: false,
      compatible: false,
      summary: "Schema is not compatible with OpenFusionAPI MCP.",
      stages: {
        parseInput: false,
        normalize: false,
        zodConversion: false,
        mcpSerialization: false,
      },
      errors: [],
      warnings: [],
      details: {
        parsedFromString: false,
        normalizationChanged: false,
        removedUnsupportedKeywords: [],
        zodSchemaType: null,
        serializedRootKind: null,
        serializedTopLevelFields: [],
      },
      recommendation: "Call this tool again after adjusting the schema until compatible=true.",
    };

    let candidateSchema = input?.schema;

    if (candidateSchema === undefined && typeof input?.schema_text === "string") {
      candidateSchema = input.schema_text;
    }

    if (typeof candidateSchema === "string") {
      try {
        candidateSchema = JSON.parse(candidateSchema);
        report.details.parsedFromString = true;
      } catch (error) {
        report.errors.push(`schema_text is not valid JSON: ${error?.message || error}`);
        return report;
      }
    }

    if (!candidateSchema || typeof candidateSchema !== "object" || Array.isArray(candidateSchema)) {
      report.errors.push("Input field `schema` must be a JSON Schema object.");
      return report;
    }

    report.stages.parseInput = true;

    const removedUnsupportedKeywords = collectUnsupportedKeywordPaths(candidateSchema);
    const normalizedSchema = normalizeSchemaForZod(candidateSchema);
    report.stages.normalize = true;
    report.details.removedUnsupportedKeywords = removedUnsupportedKeywords;
    report.details.normalizationChanged = stringifySafe(candidateSchema) !== stringifySafe(normalizedSchema);

    if (removedUnsupportedKeywords.length > 0) {
      report.warnings.push(
        `OpenFusionAPI normalization removes unsupported JSON Schema keywords at: ${removedUnsupportedKeywords.join(", ")}.`,
      );
    }

    if (
      Array.isArray(candidateSchema.required) &&
      candidateSchema.required.length > 0 &&
      (!candidateSchema.properties || typeof candidateSchema.properties !== "object")
    ) {
      report.warnings.push(
        "The schema declares required fields without top-level properties. MCP agents may lose parameter guidance.",
      );
    }

    if (isSchemaTooGeneric(normalizedSchema)) {
      report.warnings.push(
        "The schema is very generic after normalization. MCP agents may not get useful field-level guidance.",
      );
    }

    let zodSchema;
    try {
      zodSchema = jsonSchemaToZod(normalizedSchema);
      report.stages.zodConversion = true;
      report.details.zodSchemaType = zodSchema?.constructor?.name ?? typeof zodSchema;
    } catch (error) {
      report.errors.push(`jsonSchemaToZod failed: ${error?.message || error}`);
      return finalizeJsonSchemaOperationalReport(report, input, normalizedSchema, null);
    }

    let serializedSchema = null;
    try {
      serializedSchema = z.toJSONSchema(zodSchema);
      report.stages.mcpSerialization = true;
      const serializedSummary = summarizeSerializedSchema(serializedSchema);
      report.details.serializedRootKind = serializedSummary.rootKind;
      report.details.serializedTopLevelFields = serializedSummary.topLevelFields;
    } catch (error) {
      report.errors.push(`MCP serialization failed: ${error?.message || error}`);
      return finalizeJsonSchemaOperationalReport(report, input, normalizedSchema, null);
    }

    report.valid = true;
    report.compatible = true;
    report.recommendation = report.warnings.length > 0
      ? "Review the warnings before using this schema in endpoint_upsert or any OpenFusionAPI endpoint json_schema field."
      : "The schema is compatible with OpenFusionAPI MCP and is ready to be used in endpoint json_schema fields.";

    return finalizeJsonSchemaOperationalReport(report, input, normalizedSchema, serializedSchema);
  };

  const finalizeJsonSchemaOperationalReport = (report, input, normalizedSchema, serializedSchema) => {
    report.summary = report.compatible
      ? (report.warnings.length > 0
        ? "Schema is compatible with OpenFusionAPI MCP, but warnings should be reviewed."
        : "Schema is compatible with OpenFusionAPI MCP.")
      : "Schema is not compatible with OpenFusionAPI MCP.";

    if (input?.include_normalized_schema === true) {
      report.normalizedSchema = normalizedSchema;
    }

    if (input?.include_serialized_schema === true) {
      report.serializedSchema = serializedSchema;
    }

    return report;
  };

  const isSchemaTooGeneric = (schema) => {
    if (!schema || typeof schema !== "object") return true;
    if (isEmptyObject(schema)) return true;

    const schemaKeys = Object.keys(schema);
    if (schemaKeys.length === 1 && schema.additionalProperties === true) return true;

    return (
      schema.type === "object" &&
      isEmptyObject(schema.properties) &&
      schema.additionalProperties === true
    );
  };

  const inferSchemaFromExample = (value) => {
    if (value === null) return { type: "null" };

    if (Array.isArray(value)) {
      if (value.length === 0) return { type: "array", items: {} };
      return {
        type: "array",
        items: inferSchemaFromExample(value[0]),
      };
    }

    const valueType = typeof value;
    if (valueType === "string") return { type: "string" };
    if (valueType === "number") return Number.isInteger(value) ? { type: "integer" } : { type: "number" };
    if (valueType === "boolean") return { type: "boolean" };

    if (valueType === "object") {
      const properties = {};
      const required = [];
      for (const [key, nestedValue] of Object.entries(value)) {
        properties[key] = inferSchemaFromExample(nestedValue);
        required.push(key);
      }
      return {
        type: "object",
        properties,
        additionalProperties: false,
        ...(required.length > 0 ? { required } : {}),
      };
    }

    return {};
  };

  const tryParseStructuredString = (value) => {
    if (typeof value !== "string") return value;

    const trimmed = value.trim();
    if (!trimmed) return value;
    if (!["{", "[", '"'].includes(trimmed[0])) return value;

    try {
      return JSON.parse(trimmed);
    } catch (_error) {
      return value;
    }
  };

  const buildExampleFromSchema = (schema, depth = 0) => {
    if (!schema || typeof schema !== "object") return null;
    if (depth > 5) return null;

    const explicitExample = schema.example ?? schema.default;
    if (explicitExample !== undefined) return explicitExample;

    if (Array.isArray(schema.enum) && schema.enum.length > 0) {
      return schema.enum[0];
    }

    const schemaType = Array.isArray(schema.type) ? schema.type.find((t) => t !== "null") : schema.type;

    switch (schemaType) {
      case "string": {
        if (schema.format === "uuid") return "00000000-0000-0000-0000-000000000000";
        if (schema.format === "date-time") return "2026-01-01T00:00:00.000Z";
        if (schema.pattern && schema.pattern.includes("a-zA-Z0-9_~.\\-")) return "example_value";
        return "string";
      }
      case "integer":
      case "number":
        return 0;
      case "boolean":
        return false;
      case "array": {
        const itemExample = buildExampleFromSchema(schema.items, depth + 1);
        return itemExample === null || itemExample === undefined ? [] : [itemExample];
      }
      case "object": {
        const out = {};
        const properties = schema.properties && typeof schema.properties === "object"
          ? schema.properties
          : {};
        const required = Array.isArray(schema.required) ? schema.required : [];
        const selectedKeys = required.length > 0 ? required : Object.keys(properties).slice(0, 4);

        for (const key of selectedKeys) {
          if (!properties[key]) continue;
          const child = buildExampleFromSchema(properties[key], depth + 1);
          if (child !== undefined) out[key] = child;
        }

        return out;
      }
      default:
        return null;
    }
  };

  const normalizeToolKey = (name) => {
    return sanitizeToolName(name ?? "", "").toLowerCase();
  };

  const isZodSchemaLike = (value) => {
    return Boolean(value && typeof value === "object" && value._zod);
  };

  const ensureSerializableToolSchema = (schema, { endpoint, toolName }) => {
    try {
      z.toJSONSchema(schema);
      return schema;
    } catch (error) {
      console.warn(
        `[MCP] Tool schema serialization failed for ${toolName} (${endpoint.method} ${endpoint.resource}). Se usa schema flexible.`,
        error?.message || error,
      );
      return z.object({}).passthrough().describe(
        "Flexible input because the generated schema could not be serialized for MCP tool listing.",
      );
    }
  };

  const isObjectLikeSerializedSchema = (schema) => {
    try {
      const jsonSchema = z.toJSONSchema(schema);
      if (jsonSchema?.type === "object") {
        return true;
      }

      return [jsonSchema?.allOf, jsonSchema?.anyOf, jsonSchema?.oneOf].some(
        (collection) => Array.isArray(collection) && collection.length > 0,
      );
    } catch (_error) {
      return false;
    }
  };

  const getTopLevelProperties = (schema) => {
    if (!schema || typeof schema !== "object") return [];
    if (!schema.properties || typeof schema.properties !== "object") return [];
    return Object.keys(schema.properties);
  };

  const getRequiredFields = (schema) => {
    if (!schema || typeof schema !== "object") return [];
    return Array.isArray(schema.required) ? schema.required : [];
  };

  const isStrictObjectSchema = (schema) => {
    return schema?.type === "object" && schema?.additionalProperties === false;
  };

  const schemaHasCompositionOrNestedInput = (schema) => {
    if (!schema || typeof schema !== "object") return false;

    // If these keys exist, there is non-trivial input structure and the
    // tool should not be documented as argument-less.
    return Boolean(
      schema.items ||
      schema.prefixItems ||
      schema.contains ||
      schema.anyOf ||
      schema.oneOf ||
      schema.allOf ||
      schema.not ||
      schema.if ||
      schema.then ||
      schema.else ||
      schema.patternProperties ||
      schema.propertyNames ||
      schema.dependencies ||
      schema.dependentRequired ||
      schema.minProperties ||
      schema.maxProperties
    );
  };

  const schemaIsEmptyObjectInput = (schema) => {
    if (!schema || typeof schema !== "object") return false;
    if (schema.type !== "object") return false;
    if (schemaHasCompositionOrNestedInput(schema)) return false;
    if (getRequiredFields(schema).length > 0) return false;
    return getTopLevelProperties(schema).length === 0;
  };

  const schemaAllowsAdditionalProperties = (schema) => {
    return schema?.type === "object" && schema?.additionalProperties === true;
  };

  const hasStructuredRuntimeSpecificPayload = (handler) => {
    return ["SOAP", "HANA", "MONGODB", "MCP", "TELEGRAM_BOT", "SQL_BULK_I"].includes(handler);
  };

  const isEndpointUpsertLikeTool = (toolName) => {
    const normalized = normalizeToolKey(toolName);
    return (
      normalized === "endpoint_upsert" ||
      (normalized.startsWith("upsert_") && normalized.endsWith("_endpoint_handler"))
    );
  };

  const getRootSchemaKind = (schema) => {
    if (!schema || typeof schema !== "object") return "unspecified";
    if (schema.type === "object") return "object";
    if (schema.type === "array") return "array";
    if (schema.anyOf || schema.oneOf || schema.allOf) return "composed";
    if (typeof schema.type === "string") return schema.type;
    return "unspecified";
  };

  const buildBehaviorNotes = ({
    inputSchema,
    isArgumentlessTool,
    isEffectivelyNoArgTool,
    schemaWasNormalized,
    outputSchemaWasInferred,
    varsDeprecated,
    overrideNotes,
    legacyToolName,
    safeToolName,
  }) => {
    const requiredFields = getRequiredFields(inputSchema);
    const rootKind = getRootSchemaKind(inputSchema);
    const topLevelFields = getTopLevelProperties(inputSchema);
    const hasConditionalKeywords = schemaHasCompositionOrNestedInput(inputSchema);

    const notes = [];

    if (isArgumentlessTool) {
      notes.push("This tool does not require input arguments; call it with an empty object `{}`.");
    } else if (isEffectivelyNoArgTool) {
      notes.push("This tool is typically called with an empty object `{}`; additional fields are not required unless explicitly documented elsewhere.");
    } else {
      notes.push("Use this tool only with fields defined in the input schema.");
    }

    if (requiredFields.length > 0) {
      notes.push(`Required always (top-level): ${requiredFields.join(", ")}.`);
    } else {
      notes.push("Required always (top-level): none.");
    }

    if (!isEffectivelyNoArgTool) {
      if (rootKind === "array") {
        notes.push("Root payload type: array. Send a JSON array, not an empty object.");
      } else if (rootKind === "composed") {
        notes.push("Root payload type: composed schema (anyOf/oneOf/allOf). Ensure at least one branch validates.");
      } else if (rootKind !== "object" && rootKind !== "unspecified") {
        notes.push(`Root payload type: ${rootKind}. Ensure the payload matches this type.`);
      }
    }

    if (hasConditionalKeywords && !isEffectivelyNoArgTool) {
      notes.push("Required conditionally: review composition/items constraints in the input schema (for example anyOf, oneOf, allOf, items).\n");
    }

    if (topLevelFields.length > 0 && !isEffectivelyNoArgTool) {
      notes.push(`Top-level input fields: ${topLevelFields.join(", ")}.`);
    }

    notes.push("If schema marks a field as deprecated, avoid it for new integrations.");
    notes.push("Access level above indicates if credentials are required.");
    notes.push(
      schemaWasNormalized
        ? "Internal runtime validation schema was normalized for MCP compatibility (unsupported JSON Schema keywords removed)."
        : "Runtime validation uses the published JSON schema directly.",
    );
    notes.push(
      outputSchemaWasInferred
        ? "Output schema was inferred from a real example response because the declared output schema is too generic."
        : "Output schema is documented as declared by the endpoint contract.",
    );

    if (varsDeprecated) {
      notes.push("Field `vars` is deprecated (compatibility only). Use appvar_upsert for new app variables.");
    } else if (!isEffectivelyNoArgTool) {
      notes.push("Validate required fields before sending the request.");
    }

    if (Array.isArray(overrideNotes) && overrideNotes.length > 0) {
      notes.push(...overrideNotes);
    }

    if (legacyToolName !== safeToolName) {
      notes.push(`Legacy alias \`${legacyToolName}\` remains registered for backward compatibility.`);
    }

    return notes.map((note) => `- ${note}`).join("\n  ");
  };

  const buildAgentToolDescription = ({
    endpoint,
    safeToolName,
    effectiveDescription,
    inputSchema,
    exampleRequest,
    endpointUpsertDescriptionAddon,
  }) => {
    const topLevelProperties = getTopLevelProperties(inputSchema);
    const requiredFields = getRequiredFields(inputSchema);
    const fallbackDescription = `Calls ${endpoint.method} ${endpoint.resource} for application ${app_name} in ${endpoint.environment}.`;
    const purpose = (effectiveDescription && effectiveDescription.trim().length > 0)
      ? effectiveDescription.trim()
      : fallbackDescription;
    const accessLabel = endpoint.access == 0 ? "public" : "private";
    const strictSchema = isStrictObjectSchema(inputSchema);
    const minimalPayload = toPrettyText(exampleRequest, "No example available.");
    const mcpMetadataDescription = buildMcpMetadataDescription(endpoint);

    const lines = [
      `Purpose: ${purpose}`,
      ...(mcpMetadataDescription ? [mcpMetadataDescription] : []),
      `Tool name: ${safeToolName}`,
      `Access: ${accessLabel}`,
      `HTTP target: ${endpoint.method} ${endpoint.resource}`,
      `Environment: ${endpoint.environment}`,
      `Required fields: ${requiredFields.length > 0 ? requiredFields.join(", ") : "none"}`,
      `Top-level input fields: ${topLevelProperties.length > 0 ? topLevelProperties.join(", ") : "none declared"}`,
      `Additional properties: ${strictSchema ? "not allowed" : "allowed or unspecified"}`,
      `Minimal example payload: ${minimalPayload}`,
//      "Agent guidance: do not duplicate in mcp.description the facts already present in mcp.title, mcp.meta, or json_schema.in; the tool renderer exposes those structured fields automatically.",
//      "Agent guidance: send only fields defined by the input schema unless the schema explicitly allows additional properties.",
    ];

    if (hasStructuredRuntimeSpecificPayload(endpoint.handler)) {
      lines.push(`Agent guidance: this handler uses runtime-specific payload structure; call handler_documentation with handler=${endpoint.handler} before composing complex payloads.`);
    }

    if (normalizeToolKey(safeToolName) === "endpoint_upsert") {
      lines.push("Agent guidance: call read_endpoint_data before updating an existing endpoint, and verify the saved structure after endpoint_upsert.");
    }

    if (isEndpointUpsertLikeTool(safeToolName)) {
      lines.push("Agent guidance: fields under code/custom_data may use AppVar placeholders as strings (for example \"$_MY_VAR\"); runtime resolves them to effective application variable values.");
    }

    if (endpoint.access != 0) {
      lines.push("Agent guidance: this tool requires MCP server credentials; do not assume anonymous access.");
    }

    if (endpointUpsertDescriptionAddon && endpointUpsertDescriptionAddon.trim().length > 0) {
      lines.push(endpointUpsertDescriptionAddon.trim());
    }

    return lines.join("\n");
  };



  const toPrettyText = (value, fallback = "No example available.") => {
    if (value === undefined || value === null) return fallback;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length === 0) return fallback;
      try {
        return JSON.stringify(JSON.parse(trimmed), null, 2);
      } catch (_error) {
        return trimmed;
      }
    }
    if (typeof value === "object") {
      if (Array.isArray(value) && value.length === 0) return fallback;
      if (!Array.isArray(value) && Object.keys(value).length === 0) return fallback;
      return JSON.stringify(value, null, 2);
    }
    return String(value);
  };

  const toPrettyExampleText = (value, { allowEmptyObject = false } = {}) => {
    if (allowEmptyObject && value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) {
      return "{}";
    }
    return toPrettyText(value);
  };

  const sanitizeToolName = (name, fallback = "tool") => {
    const raw = (name ?? fallback).toString().trim();
    const cleaned = raw
      .replace(/\s+/g, "_")
      .replace(/[^a-zA-Z0-9_.-]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^[_\-.]+|[_\-.]+$/g, "");
    return cleaned.length > 0 ? cleaned : fallback;
  };

  const normalizeSchemaForZod = (schema) => {
    if (!schema || typeof schema !== "object") return schema;

    const visit = (node) => {
      if (Array.isArray(node)) return node.map(visit);
      if (!node || typeof node !== "object") return node;

      // Simplifica referencias recursivas complejas de JSON a un tipo abierto serializable
      if (node.$ref && (node.$ref === "#/$defs/jsonValue" || node.$ref.endsWith("jsonValue"))) {
        return {
          description: node.description || "Any JSON value"
        };
      }

      const out = {};
      for (const [key, value] of Object.entries(node)) {
        if (UNSUPPORTED_JSON_SCHEMA_KEYS.has(key)) continue;
        out[key] = visit(value);
      }

      if (out.type === "object") {
        if (!out.properties || typeof out.properties !== "object") {
          out.properties = {};
        }

        if (Array.isArray(out.required) && out.required.length > 0) {
          out.required = out.required.filter((k) => out.properties?.[k]);
          if (out.required.length === 0) delete out.required;
        }
      }

      return out;
    };

    return visit(schema);
  };

  const isEndpointUpsertEndpoint = (endpoint) => {
    const mcpName = (endpoint?.mcp?.name ?? "").toString().trim().toLowerCase();
    return (
      mcpName === "endpoint_upsert" ||
      (
        endpoint?.resource === "/api/endpoint" &&
        endpoint?.method === "POST" &&
        endpoint?.code === "fnEndpointUpsert"
      )
    );
  };

  const getEndpointUpsertHandlerGuide = (endpoint) => {
    if (!isEndpointUpsertEndpoint(endpoint)) return "";

    return `
## How to use endpoint_upsert (Agent Guide)

### INSERT vs UPDATE
- **INSERT**: omit \`idendpoint\` — the server generates a new UUID automatically.
- **UPDATE**: include a valid \`idendpoint\` UUID. Use \`read_endpoint_data\` first to read the current state before modifying.

### Recommended workflow

1. Choose the handler first.
2. Read the input schema and field descriptions from this tool before building the payload.
3. Call \`handler_documentation\` with the chosen handler whenever the handler expects a structured JSON payload or database-specific rules.
4. When you create a JSON Schema that will be stored in OpenFusionAPI, call \`validate_json_schema_for_mcp\` before publishing it.
5. If updating an existing endpoint, call \`read_endpoint_data\` first and modify the current structure instead of rebuilding it from memory.
6. Run \`endpoint_upsert\` with all required fields.
7. Call \`read_endpoint_data\` again to verify the persisted structure.
8. Test the endpoint via its HTTP URL before exposing it as an MCP tool.
`;
  };

  const getEndpointUpsertDescriptionAddon = (endpoint) => {
    if (!isEndpointUpsertEndpoint(endpoint)) return "";

    return " Handler-specific note: `handler` defines the shape of `code` and related fields. Use the input schema field descriptions for the stored contract, and call `handler_documentation` before composing payloads for SQL_BULK_I, SOAP, HANA, MONGODB, MCP, TELEGRAM_BOT, or other handler-specific structures.";
  };

  // Guard against missing endpoint collections when an app is partially configured.
  if (!app || !Array.isArray(app?.endpoints)) {
    console.warn("[MCP] No endpoints were found for application:", app_name);
    // Return the factory even when no tools are available so the MCP flow remains stable.
    return (_headers) => {
      return getServer();
    };
  }

  let mcp_endpoint_tools = app.endpoints.filter((endpoint) => {
    return (
      endpoint.method != "WS" &&
      endpoint.handler != "MCP" &&
      endpoint?.mcp?.enabled
    );
  });

  let markdown_api_docs = [];
  let markdown_api_catalog_rows = [];

  for (let index2 = 0; index2 < mcp_endpoint_tools.length; index2++) {
    const endpoint = mcp_endpoint_tools[index2];

    let url_internal = internal_url_endpoint(
      app.app,
      endpoint.resource,
      endpoint.environment,
      false
    );

    // Bug fix #4: toolName único por URL+METHOD para evitar colisiones
    let toolName = url_internal.replace(/[^a-zA-Z0-9]/g, "_");
    toolName = `${toolName}_${endpoint.method}`;
    toolName = sanitizeToolName(toolName, "endpoint_tool");

    const mcpNameRaw = endpoint?.mcp?.name && endpoint?.mcp?.name.length > 0
      ? endpoint.mcp.name
      : toolName;
    const legacyToolName = sanitizeToolName(mcpNameRaw, toolName);
    const safeToolName = normalizeToolKey(legacyToolName);

    const inputSchema = endpoint?.json_schema?.in?.schema ?? {};
    const outputSchema = endpoint?.json_schema?.out?.schema ?? {};
    const inputSchemaNormalized = normalizeSchemaForZod(inputSchema);
    const schemaWasNormalized = stringifySafe(inputSchemaNormalized) !== stringifySafe(inputSchema);
    const mcpNotes = endpoint?.mcp?.notes ?? endpoint?.mcp?.meta?.notes;
    const mcpExampleRequest = endpoint?.mcp?.exampleRequest ?? endpoint?.mcp?.meta?.exampleRequest;
    const mcpExampleResponse = endpoint?.mcp?.exampleResponse ?? endpoint?.mcp?.meta?.exampleResponse;
    const mcpOutputSchema = endpoint?.mcp?.outputSchema ?? endpoint?.mcp?.meta?.outputSchema;
    const mcpDescription = endpoint?.mcp?.description ?? endpoint?.mcp?.meta?.description;

    const hasExplicitExampleRequest = Boolean(
      mcpExampleRequest !== undefined && mcpExampleRequest !== null
    );
    const rawExampleRequest = endpoint?.data_test?.body?.json?.code;
    const rawExampleResponse = endpoint?.data_test?.last_response?.data;
    const generatedRequestExample = buildExampleFromSchema(inputSchema);
    const generatedResponseExample = buildExampleFromSchema(outputSchema);
    const exampleRequest = mcpExampleRequest ?? rawExampleRequest ?? generatedRequestExample;
    const exampleResponse = mcpExampleResponse ?? rawExampleResponse ?? generatedResponseExample;
    const parsedExampleResponse = tryParseStructuredString(exampleResponse);
    const inferredOutputSchemaFromExample =
      (parsedExampleResponse !== undefined && parsedExampleResponse !== null)
        ? inferSchemaFromExample(parsedExampleResponse)
        : null;
    const effectiveOutputSchema = mcpOutputSchema ?? (
      isSchemaTooGeneric(outputSchema)
        ? (inferredOutputSchemaFromExample ?? outputSchema)
        : outputSchema
    );
    const outputSchemaWasInferred =
      !mcpOutputSchema &&
      isSchemaTooGeneric(outputSchema) &&
      inferredOutputSchemaFromExample &&
      !isSchemaTooGeneric(inferredOutputSchemaFromExample);
    const varsDeprecated =
      endpoint?.json_schema?.in?.schema?.properties?.vars?.deprecated === true;
    const endpointUpsertHandlerGuide = getEndpointUpsertHandlerGuide(endpoint);
    const endpointUpsertDescriptionAddon = getEndpointUpsertDescriptionAddon(endpoint);
    // Prefer canonical docs from system.js (endpoint.mcp.description / endpoint.description)
    // and only use mcp.js override descriptions as fallback.
    const baseDescription = endpoint?.mcp?.description && endpoint?.mcp?.description.length > 0
      ? endpoint?.mcp?.description
      : endpoint.description;
    const effectiveDescription = (baseDescription && String(baseDescription).trim().length > 0)
      ? baseDescription
      : mcpDescription;
    const inputAllowsExtraFields = schemaAllowsAdditionalProperties(inputSchema);
    const isEmptyObjectInput = schemaIsEmptyObjectInput(inputSchema);
    const isArgumentlessTool = isEmptyObjectInput && !inputAllowsExtraFields;
    const isEffectivelyNoArgTool = isEmptyObjectInput;
    const agentToolDescription = buildAgentToolDescription({
      endpoint,
      safeToolName,
      effectiveDescription,
      inputSchema,
      exampleRequest,
      endpointUpsertDescriptionAddon,
    });

    markdown_api_catalog_rows.push([
      endpoint?.mcp?.name && endpoint?.mcp?.name.length > 0
        ? endpoint?.mcp?.name
        : toolName,
      endpoint.method,
      endpoint.resource,
      endpoint.handler,
    ]);

    // Bug fix #5: Uso de optional chaining para evitar TypeError si mcp.title/description no existen
    markdown_api_docs.push(`##
## Endpoint
**${endpoint?.mcp?.name && endpoint?.mcp?.name.length > 0
        ? endpoint?.mcp?.name
        : toolName}** 

**MCP Tool Name (safe)**
${safeToolName}

${legacyToolName !== safeToolName ? `**Legacy Alias**
${legacyToolName}

` : ""}

### Description
${effectiveDescription}

  

This endpoint belongs to application **${app_name}** and is exposed to MCP agents.

  

------------------------------------------------------------------------

## Environment
 ${endpoint.environment}

------------------------------------------------------------------------
## HTTP Request

**Method**
${endpoint.method}

**URL**
${url_internal}

------------------------------------------------------------------------

## Access Level
${getAccessLevelLabel(endpoint.access)}

------------------------------------------------------------------------

  
# Input Parameters

### JSON Schema

\`\`\` json

${stringifySafe(inputSchema)}

\`\`\`

------------------------------------------------------------------------
  

# Example Request

\`\`\` json

${toPrettyExampleText(exampleRequest, { allowEmptyObject: hasExplicitExampleRequest || isEffectivelyNoArgTool })}

\`\`\`

  

------------------------------------------------------------------------

  

# Response  

### JSON Schema

\`\`\` json

${stringifySafe(effectiveOutputSchema)}

      \`\`\`
------------------------------------------------------------------------

  

# Example Response


  \`\`\` json

${toPrettyText(exampleResponse)}

    \`\`\`

  

------------------------------------------------------------------------

  

# Behavior Notes(for AI Agents)

  ${buildBehaviorNotes({
      inputSchema,
      isArgumentlessTool,
      isEffectivelyNoArgTool,
      schemaWasNormalized,
      outputSchemaWasInferred,
      varsDeprecated,
      overrideNotes: Array.isArray(mcpNotes) ? mcpNotes : (mcpNotes ? [mcpNotes] : null),
      legacyToolName,
      safeToolName,
    })}

${endpointUpsertHandlerGuide}
`);

    let zod_inputSchema = z.object({}).describe("Data to send to the endpoint.");
    let shouldUnwrapSingleValueInput = false;

    if (
      endpoint?.json_schema?.in?.enabled &&
      endpoint?.json_schema?.in?.schema
    ) {
      try {
        const zodSchema = jsonSchemaToZod(inputSchemaNormalized);
        if (zodSchema instanceof z.ZodObject || isObjectLikeSerializedSchema(zodSchema)) {
          zod_inputSchema = zodSchema;
        } else if (isZodSchemaLike(zodSchema)) {
          shouldUnwrapSingleValueInput = true;
          zod_inputSchema = z.object({ value: zodSchema }).describe(
            "Structured single-value input wrapped for MCP compatibility.",
          );
        } else {
          console.warn(
            `[MCP] Schema conversion returned an invalid Zod schema for ${endpoint.method} ${endpoint.resource}. Se usa schema flexible.`,
          );
          zod_inputSchema = z.object({}).passthrough().describe(
            "Flexible input because schema conversion did not produce a valid Zod schema.",
          );
        }
      } catch (error) {
        console.warn(
          `[MCP] Schema no support to ${endpoint.method} ${endpoint.resource}. Se usa schema flexible.`,
          error?.message || error,
        );
        zod_inputSchema = z.object({}).passthrough().describe(
          "Flexible input due to unsupported JSON Schema features.",
        );
      }
    }

    zod_inputSchema = ensureSerializableToolSchema(zod_inputSchema, {
      endpoint,
      toolName: safeToolName,
    });

    const registerEndpointTool = (registeredToolName, descriptionPrefix = "") => {
      _mcpConfig.tools.push({
        name: registeredToolName,
        info: {
          title:
            endpoint?.mcp?.title && endpoint?.mcp?.title.length > 0
              ? endpoint?.mcp?.title
              : (endpoint.title || endpoint.description || safeToolName),
          description: `${descriptionPrefix}${agentToolDescription}`,

          inputSchema: zod_inputSchema,
        },

        handler: async (data, _context, currentHeaders) => {

          try {
            const requestData = shouldUnwrapSingleValueInput && data && typeof data === "object" && "value" in data
              ? data.value
              : data;

            let AutoURL = new URLAutoEnvironment({
              environment: endpoint.environment,
            });

            let uF = AutoURL.auto(url_internal, true);

            let sanitizedHeaders = {};
            if (currentHeaders) {
              const forbidden = new Set(["expect", "host", "connection", "keep-alive"]);
              if (typeof currentHeaders.forEach === "function") {
                currentHeaders.forEach((v, k) => {
                  if (!forbidden.has(k.toLowerCase())) sanitizedHeaders[k] = v;
                });
              } else {
                for (const [k, v] of Object.entries(currentHeaders)) {
                  if (!forbidden.has(k.toLowerCase())) sanitizedHeaders[k] = v;
                }
              }
            }

            let request_endpoint = await uF[endpoint.method.toLowerCase()]({
              data: requestData,
              headers: sanitizedHeaders,
            });

            const mimeType = request_endpoint.headers.get("content-type") ?? "text/plain";
            const data_out = await request_endpoint.text();

            return {
              content: [
                {
                  type: "text",
                  mimeType: mimeType,
                  text: data_out,
                  statusCode: request_endpoint.status,
                },
              ],
            };
          } catch (error) {
            console.error(`[MCP] Error al llamar al endpoint ${url_internal}: `, error);
            return {
              content: [
                {
                  type: "text",
                  mimeType: "text/plain",
                  text: `Error: ${error?.message || "Error desconocido al llamar al endpoint."} `,
                  statusCode: 500,
                },
              ],
            };
          }
        }
      });
    };

    registerEndpointTool(safeToolName);
    if (legacyToolName !== safeToolName) {
      registerEndpointTool(legacyToolName, "Legacy alias. ");
    }

  }

  // URI con path explícito: new URL("api://docs/demo").toString() === "api://docs/demo"
  // Si el URI no tiene path (ej: "api://docs-demo"), new URL() añade "/" final → no coincide con la clave registrada
  const resourceURI = "api://docs/" + app_name;
  const catalogResourceURI = "api://docs/catalog/" + app_name;
  const md_resource = `
# API Documentation for ${app_name} on ${environment} environment

${markdown_api_docs.join("\n")}

    `;
  const md_catalog_resource = `
# API Endpoint Catalog for ${app_name} on ${environment} environment

This is a lightweight endpoint catalog for quick discovery. It intentionally excludes per-endpoint schemas, examples, and long behavior notes.

| MCP Tool Name | Method | Resource | Handler |
|---|---|---|---|
${markdown_api_catalog_rows
  .map((row) => `| ${row.map((cell) => toCompactText(cell, "-").replace(/\|/g, "\\|")).join(" | ")} |`)
  .join("\n")}

Use \`list_api_endpoints_${app_name}\` only when you need the full endpoint-by-endpoint documentation dump.

    `;

  _mcpConfig.resources.push({
    name: "api-docs-" + app_name,
    uri: resourceURI,
    info: {
      description: "API Documentation for " + app_name + " on " + environment + " environment",
      mimeType: "text/markdown",
    },
    handler: async (_uri, _extra) => {

      return {
        contents: [
          {
            uri: resourceURI,
            mimeType: "text/markdown",
            text: md_resource
          }
        ]
      }
    }
  });

  _mcpConfig.resources.push({
    name: "api-docs-catalog-" + app_name,
    uri: catalogResourceURI,
    info: {
      description: "Lightweight API endpoint catalog for " + app_name + " on " + environment + " environment",
      mimeType: "text/markdown",
    },
    handler: async (_uri, _extra) => {

      return {
        contents: [
          {
            uri: catalogResourceURI,
            mimeType: "text/markdown",
            text: md_catalog_resource
          }
        ]
      }
    }
  });

_mcpConfig.tools.push({
  name: "validate_json_schema_for_mcp",
  info: {
    title: "Validate JSON Schema For MCP",
    description: [
      "Purpose: validate whether a JSON Schema is operationally compatible with OpenFusionAPI MCP.",
      "Required fields: schema.",
      "Top-level input fields: schema, schema_text, include_normalized_schema, include_serialized_schema.",
      "Output: JSON report with compatibility status, stage-by-stage results, warnings, errors, and recommendations.",
      "Agent guidance: use this tool before publishing any json_schema that will be stored or exposed through OpenFusionAPI.",
      "Agent guidance: this validation is OpenFusionAPI-specific. It checks normalization, jsonSchemaToZod conversion, and MCP serialization behavior instead of only generic JSON Schema validity.",
    ].join("\n"),
    inputSchema: {
      schema: z.unknown().describe("JSON Schema object to validate for OpenFusionAPI MCP compatibility."),
      schema_text: z.string().optional().describe("Optional JSON string form of the schema when the caller cannot send an object directly."),
      include_normalized_schema: z.boolean().optional().describe("When true, include the normalized schema used by OpenFusionAPI before conversion."),
      include_serialized_schema: z.boolean().optional().describe("When true, include the serialized JSON Schema generated from the converted Zod schema."),
    },
    annotations: { readOnlyHint: true },
  },
  handler: async (data) => {
    const report = buildJsonSchemaOperationalReport(data || {});

    return {
      content: [
        {
          type: "text",
          mimeType: "application/json",
          text: JSON.stringify(report, null, 2),
        },
      ],
    };
  }
});

_mcpConfig.tools.push({
  name: sanitizeToolName("list_api_endpoints_catalog_" + app_name, "list_api_endpoints_catalog"),
  info: {
    title: "List API endpoint catalog for " + app_name + " on " + environment + " environment",
    description: [
      `Purpose: return a lightweight endpoint catalog for application '${app_name}' on '${environment}' environment.`,
      "Required fields: none.",
      "Top-level input fields: none.",
      "Output: compact markdown table with MCP tool name, HTTP method, resource path, and handler.",
      "Agent guidance: prefer this tool for discovery because it avoids sending full schemas, examples, and long endpoint documentation blocks.",
    ].join("\n"),
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  handler: async () => ({
    content: [
      {
        type: "text",
        text: md_catalog_resource,
      },
    ],
  })
});

_mcpConfig.tools.push({
  name: sanitizeToolName("list_api_endpoints_" + app_name, "list_api_endpoints"),
  info: {
    title: "List API endpoints for " + app_name + " on " + environment + " environment",
    description: [
      `Purpose: return documentation for all API endpoints for application '${app_name}' on '${environment}' environment.`,
      "Required fields: none.",
      "Top-level input fields: none.",
      "Output: markdown text containing endpoint-by-endpoint API documentation, example payloads, schemas, and behavior notes.",
      `Agent guidance: prefer list_api_endpoints_catalog_${app_name} for initial discovery and call this full dump only when you need detailed schemas, examples, or behavior notes for many endpoints at once.`,
    ].join("\n"),
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  handler: async () => ({
    content: [
      {
        type: "text",
        text: md_resource,
      },
    ],
  })
});

  // Re-creates the McpServer object for the current request (allowing individual transport connect)
  // and injects the current HTTP request headers so concurrent requests are safely isolated.
  return (headers) => {
    const server = getServer();
    const currentHeaders = headers ?? {};

    for (const res of _mcpConfig.resources) {
      server.registerResource(res.name, res.uri, res.info, async (uri, extra) => {
        return await res.handler(uri, extra, currentHeaders);
      });
    }

    for (const t of _mcpConfig.tools) {
      server.registerTool(t.name, t.info, async (data, context) => {
        return await t.handler(data, context, currentHeaders);
      });
    }

    return server;
  };
};

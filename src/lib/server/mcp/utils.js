// jsonSchemaToZod.js
import { z } from "zod";

/**
 * Convierte JSON Schema estándar a Zod 4 (compatible con MCP SDK).
 * @param {object} schema JSON Schema
 * @param {object} [root] Schema raíz (para resolver $ref)
 */
export function jsonSchemaToZod(schema, root = null, context = null) {
  root = root || schema;
  context = context || {
    refCache: new Map(),
    activeRefs: new Set(),
  };

  if (!schema || typeof schema !== "object") {
    return z.unknown();
  }

  // Manejo de $ref
  if (schema.$ref) {
    return resolveRefSchema(schema.$ref, root, context);
  }

  const combinatorSchema = combineCombinatorsIfNeeded(schema, root, context);
  if (combinatorSchema) {
    return combinatorSchema;
  }

  // type como array: e.g. ["string", "null"] → z.union
  if (Array.isArray(schema.type)) {
    const types = schema.type.map((typeName) => jsonSchemaToZod({ ...schema, type: typeName }, root, context));
    return types.length === 1 ? types[0] : z.union(types);
  }

  // Soporte de negación de requeridos: { not: { required: ["field"] } }
  // Útil para reglas condicionales tipo INSERT/UPDATE en anyOf.
  if (schema.not && Array.isArray(schema.not.required)) {
    return makeNotRequiredConstraint(schema.not.required, schema.description);
  }

  if (!schema.type && !schema.properties && Array.isArray(schema.required) && schema.required.length > 0) {
    const requiredShape = Object.fromEntries(
      schema.required.map((key) => [key, z.unknown()]),
    );

    return z.object(requiredShape).passthrough();
  }

  // Tipos primitivos
  switch (schema.type) {
    case "string":
      return makeString(schema);

    case "number":
    case "integer":
      return makeNumber(schema);

    case "boolean":
      return schema.nullable ? z.boolean().nullable() : z.boolean();

    case "null":
      return z.null();

    case "array":
      return makeArray(schema, root, context);

    case "object":
      return makeObject(schema, root, context);

    case undefined:
      // En JSON Schema, ausencia de `type` implica esquema abierto/anotativo.
      if (schema.enum !== undefined) return makeEnum(schema.enum);
      if (schema.const !== undefined) return z.literal(schema.const);
      return schema.nullable ? z.unknown().nullable() : z.unknown();

    default:
      throw new Error("Tipo JSON Schema no soportado: " + schema.type);
  }
}

function combineCombinatorsIfNeeded(schema, root, context) {
  const hasAnyOf = Array.isArray(schema?.anyOf) && schema.anyOf.length > 0;
  const hasOneOf = Array.isArray(schema?.oneOf) && schema.oneOf.length > 0;
  const hasAllOf = Array.isArray(schema?.allOf) && schema.allOf.length > 0;

  if (!hasAnyOf && !hasOneOf && !hasAllOf) {
    return null;
  }

  const { anyOf, oneOf, allOf, ...baseCandidate } = schema;
  const baseSchema = hasMeaningfulValidationKeywords(baseCandidate)
    ? jsonSchemaToZod(baseCandidate, root, context)
    : null;

  if (baseSchema instanceof z.ZodObject && (schema?.type === "object" || schema?.properties || schema?.required)) {
    return baseSchema;
  }

  let combinedSchema = null;

  if (hasAllOf) {
    combinedSchema = allOf
      .map((item) => jsonSchemaToZod(item, root, context))
      .reduce((acc, cur) => acc.and(cur));
  }

  if (hasOneOf) {
    const oneOfUnion = buildUnionSchema(oneOf, root, context);
    combinedSchema = combinedSchema ? combinedSchema.and(oneOfUnion) : oneOfUnion;
  }

  if (hasAnyOf) {
    const anyOfUnion = buildUnionSchema(anyOf, root, context);
    combinedSchema = combinedSchema ? combinedSchema.and(anyOfUnion) : anyOfUnion;
  }

  if (baseSchema && combinedSchema) {
    return baseSchema.and(combinedSchema);
  }

  return baseSchema || combinedSchema || null;
}

function buildUnionSchema(items, root, context) {
  const schemas = items.map((item) => jsonSchemaToZod(item, root, context));
  return schemas.length === 1 ? schemas[0] : z.union(schemas);
}

function hasMeaningfulValidationKeywords(schema) {
  const ignoredKeys = new Set([
    "$id",
    "$schema",
    "$defs",
    "title",
    "description",
    "default",
    "deprecated",
    "examples",
    "example",
    "readOnly",
    "writeOnly",
  ]);

  return Object.keys(schema || {}).some((key) => !ignoredKeys.has(key));
}

function makeNotRequiredConstraint(requiredKeys, description) {
  let out = z.object({}).passthrough().refine(
    (obj) => !requiredKeys.every((key) => Object.prototype.hasOwnProperty.call(obj, key)),
    {
      message: description || `Properties [${requiredKeys.join(", ")}] must not exist at the same time.`,
    }
  );

  return out;
}

/* ---------------------------------------------------------
  ENUM - supports mixed values (string, number, boolean, null)
--------------------------------------------------------- */
function makeEnum(values) {
  // z.enum() en Zod v4 solo acepta arrays de strings
  if (values.every(v => typeof v === "string")) {
    return z.enum(values);
  }
  // Para valores mixtos usamos z.union de literales
  const literals = values.map(v => z.literal(v));
  return literals.length === 1 ? literals[0] : z.union(literals);
}

/* ---------------------------------------------------------
   STRING
--------------------------------------------------------- */
function makeString(schema) {
  let out = z.string();

  if (schema.minLength != null) out = out.min(schema.minLength);
  if (schema.maxLength != null) out = out.max(schema.maxLength);
  if (schema.pattern) out = out.regex(new RegExp(schema.pattern));

  // Zod v4: los formatos son métodos de z.string(), no top-level
  if (schema.format) {
    switch (schema.format) {
      case "email": out = out.email(); break;
      case "uuid": out = out.regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/, { message: "Invalid UUID format" }); break;
      case "uri": out = out.url(); break;
      case "date-time": out = out.datetime(); break;
    }
  }

  // enum y const tienen prioridad sobre el tipo base
  if (schema.enum !== undefined) return makeEnum(schema.enum);
  if (schema.const !== undefined) return z.literal(schema.const);

  if (schema.nullable) out = out.nullable();

  return out;
}

/* ---------------------------------------------------------
   NUMBER / INTEGER
--------------------------------------------------------- */
function makeNumber(schema) {
  let out = z.number();

  if (schema.type === "integer") out = out.int();
  if (schema.minimum != null) out = out.min(schema.minimum);
  if (schema.maximum != null) out = out.max(schema.maximum);

  if (schema.enum !== undefined) return makeEnum(schema.enum);
  if (schema.const !== undefined) return z.literal(schema.const);

  if (schema.nullable) out = out.nullable();

  return out;
}

/* ---------------------------------------------------------
   ARRAY
--------------------------------------------------------- */
function makeArray(schema, root, context) {
  // Sin items: array de elementos desconocidos
  if (!schema.items) return z.array(z.unknown());

  // Soporte de tuplas: items como array de schemas
  if (Array.isArray(schema.items)) {
    const items = schema.items.map((item) => jsonSchemaToZod(item, root, context));
    return z.tuple(items);
  }

  let out = z.array(jsonSchemaToZod(schema.items, root, context));

  if (schema.minItems != null) out = out.min(schema.minItems);
  if (schema.maxItems != null) out = out.max(schema.maxItems);

  if (schema.nullable) out = out.nullable();

  return out;
}

/* ---------------------------------------------------------
   OBJECT
--------------------------------------------------------- */
function makeObject(schema, root, context) {
  const shape = {};

  const props = schema.properties || {};
  const required = schema.required || [];

  for (const [key, value] of Object.entries(props)) {
    let zProp = jsonSchemaToZod(value, root, context);

    if (!required.includes(key)) zProp = zProp.optional();

    shape[key] = zProp;
  }

  let out = z.object(shape);

  if (schema.additionalProperties === false) {
    out = out.strict();
  } else if (schema.additionalProperties === true) {
    out = out.passthrough();
  } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
    out = out.catchall(jsonSchemaToZod(schema.additionalProperties, root, context));
  } else if (Object.keys(shape).length === 0) {
    // JSON Schema: un objeto sin `properties` ni `additionalProperties` restringido
    // es un objeto abierto (default adicionalProperties=true). z.object({}) por
    // defecto DESCARTA las claves entrantes, lo que hacía perder datos como
    // `ctrl.as_admin` en user_create vía MCP. Passthrough conserva el contenido.
    out = out.passthrough();
  }

  if (schema.nullable) out = out.nullable();

  return out;
}

function resolveRefSchema(ref, root, context) {
  const cached = context.refCache.get(ref);
  if (cached) {
    return cached;
  }

  const lazyRef = z.lazy(() => context.refCache.get(ref) || z.unknown());
  context.refCache.set(ref, lazyRef);

  if (context.activeRefs.has(ref)) {
    return lazyRef;
  }

  context.activeRefs.add(ref);

  try {
    const resolved = jsonSchemaToZod(resolveRef(ref, root), root, context);
    context.refCache.set(ref, resolved);
    return resolved;
  } finally {
    context.activeRefs.delete(ref);
  }
}

/* ---------------------------------------------------------
   $REF RESOLUTION
--------------------------------------------------------- */
function resolveRef(ref, root) {
  if (!ref.startsWith("#/")) {
    throw new Error("Solo se soportan referencias internas ($ref '#/...')");
  }

  const path = ref.substring(2).split("/");
  let result = root;

  for (const p of path) {
    result = result[p];
    // Usar === undefined para no fallar con valores falsy legítimos (0, false, "")
    if (result === undefined) throw new Error("Referencia no encontrada: " + ref);
  }

  return result;
}

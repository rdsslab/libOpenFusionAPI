import Zod from "zod";

export const webhookSchema = Zod.object({
  host: Zod.string().min(1, { message: "Host is required." }),
  database: Zod.string().min(1, { message: "Database is required." }),
  schema: Zod.string().min(0, { message: "Schema is required." }),
  model: Zod.string().min(1, { message: "Model is required." }),
  action: Zod.enum(
    ["insert", "update", "delete", "upsert", "afterUpsert", "afterCreate"],
    {
      message:
        "Valid options: 'insert', 'update', 'delete', 'bulk_insert', 'bulk_update', 'upsert'",
    }
  ),
  data: Zod.record(Zod.any()).optional(),
});

export const validateAppName = (name) => {
  const regex = /^[a-zA-Z0-9_~.-]+$/;
  return regex.test(name);
};

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Comprueba si un valor es un UUID. Las columnas `trace_id` de la base son de
 * tipo UUID/UNIQUEIDENTIFIER, así que un valor que no lo sea hace que la base
 * rechace la fila de log (y, por el defecto de `LogBuffer.flush`, bloqueaba el
 * resto del buffer). Se usa para normalizar `ofapi-trace-id` antes de guardarlo.
 * @param {unknown} value
 * @returns {boolean}
 */
export const isUuid = (value) =>
  typeof value === "string" && UUID_REGEX.test(value.trim());

import { validateEndpointCode } from "../../../../../validation/codeValidator.js";

/**
 * Valida el código JS embebido de un handler (JS, MONGODB, TELEGRAM_BOT) en
 * busca de llamadas a APIs de librerías desactualizadas/renombradas. Reporta
 * lo que se puede autocorregir y lo que requiere revisión manual, sin
 * modificar nada persistido — el llamador decide qué hacer con el resultado.
 * MCP tool: validate_endpoint_code
 */
export async function fnValidateEndpointCode(params) {
  let r = { code: 200, data: undefined };
  try {
    const body = params?.request?.body || {};
    const { handler, code, custom_data, dry_run, app_vars } = body;

    if (!handler || typeof code !== "string") {
      r.code = 400;
      r.data = { error: "'handler' y 'code' (string) son obligatorios." };
      return r;
    }

    r.data = await validateEndpointCode({
      handler,
      code,
      custom_data,
      dryRun: !!dry_run,
      app_vars: app_vars || {},
    });
  } catch (error) {
    r.data = { error: error?.message || String(error) };
    r.code = 500;
  }
  return r;
}

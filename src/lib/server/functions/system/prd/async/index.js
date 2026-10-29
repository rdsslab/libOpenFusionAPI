import { AsyncJob } from "../../../../../db/async_job.js";

/**
 * Utilidades de solo lectura para los jobs de `ofapi_async_jobs` — el estado
 * persistido de cada petición que el handler ASYNC_WRAPPER ejecuta en segundo
 * plano. Los seeds de system usan `handler: "FUNCTION"` con estos nombres
 * porque el sandbox de handlers JS no expone `require` (un `require()` en el
 * código del seed falla en caliente con "require is not defined").
 */

/**
 * Estado efectivo de un job: EXPIRED no existe como valor persistido — el
 * backend lo deriva comparando `expires_at` contra el reloj. Se calcula aquí
 * de forma consistente con `/system/async/status` y `/system/async/result`.
 *
 * @param {object} job Instancia o objeto plano de `ofapi_async_jobs`.
 * @returns {string} PENDING | RUNNING | COMPLETED | FAILED | EXPIRED.
 */
function effectiveStatus(job) {
  if (job?.status !== "COMPLETED" && job?.expires_at) {
    if (new Date(job.expires_at).getTime() <= Date.now()) return "EXPIRED";
  }
  return job?.status ?? "PENDING";
}

/**
 * Lista los jobs persistidos. Filtros: `idapp`, `status`, `environment`.
 * Solo lectura (acceso 2 en el seed). Excluye los campos pesados: `result`
 * y `response_headers` van a la pestaña de detalle del cliente, no al listado.
 *
 * @param {object} params
 * @param {object} [params.request] Request fastify.
 * @returns {Promise<{code: number, data: {count: number, jobs: Array}|Error}>}
 */
export async function fnListAsyncJobs(params) {
  let r = { code: 200, data: undefined };
  try {
    const query = params?.request?.query || {};

    /** @type {Record<string, unknown>} */
    const where = {};
    if (query.idapp) where.idapp = query.idapp;
    if (query.status) where.status = query.status;
    if (query.environment) where.environment = query.environment;

    const rows = await AsyncJob.findAll({
      where,
      order: [["created_at", "DESC"]],
      limit: 100,
      attributes: { exclude: ["result", "response_headers", "error_message"] },
    });

    const jobs = rows.map((row) => {
      const plain = typeof row?.get === "function" ? row.get({ plain: true }) : row;
      return { ...plain, status: effectiveStatus(plain) };
    });

    r.data = { count: jobs.length, jobs };
    r.code = 200;
  } catch (error) {
    console.log(error);
    r.data = error;
    r.code = 500;
  }
  return r;
}

/**
 * Estado legible de un job por id. Validación idéntica a `/system/async/status`:
 * el `job_token` (query `token` o header `x-job-token`) debe coincidir — el id
 * (requestId) solo lo conoce quien lanzó la petición, pero el token es la
 * clave compartida que evita enumerar jobs ajenos si el UUID se filtra.
 *
 * @param {object} params
 * @returns {Promise<{code: number, data: object|Error}>}
 */
export async function fnGetAsyncJobStatus(params) {
  let r = { code: 200, data: undefined };
  try {
    const request = params?.request || {};
    const id = request?.params?.id || request?.query?.id;
    const token = request?.headers?.["x-job-token"] || request?.query?.token;

    if (!id) {
      r.code = 400;
      r.data = { error: "Missing id" };
      return r;
    }

    const job = await AsyncJob.findByPk(id);
    if (!job) {
      r.code = 404;
      r.data = { error: "Not found" };
      return r;
    }
    if (job.job_token !== token) {
      r.code = 401;
      r.data = { error: "Invalid token" };
      return r;
    }

    r.data = {
      requestId: job.id,
      status: effectiveStatus(job),
      consume_count: job.consume_count,
      max_consumes: job.max_consumes,
      ttl_remaining_ms: job.expires_at
        ? new Date(job.expires_at).getTime() - Date.now()
        : null,
      completed_at: job.completed_at,
    };
    r.code = 200;
  } catch (error) {
    console.log(error);
    r.data = error;
    r.code = 500;
  }
  return r;
}

/**
 * Resultado completo de un job por id, con la misma validación de token que
 * el endpoint sembrado original. Maneja binario (base64), JSON y texto plano,
 * destruye el job cuando agota `max_consumes` y devuelve 410 cuando expiró.
 *
 * @param {object} params
 * @returns {Promise<{code: number, data: object|Error}>}
 */
export async function fnGetAsyncJobResult(params) {
  let r = { code: 200, data: undefined };
  try {
    const request = params?.request || {};
    const id = request?.params?.id || request?.query?.id;
    const token = request?.headers?.["x-job-token"] || request?.query?.token;

    if (!id) {
      r.code = 400;
      r.data = { error: "Missing id" };
      return r;
    }

    const job = await AsyncJob.findByPk(id);
    if (!job) {
      r.code = 404;
      r.data = { error: "Not found" };
      return r;
    }
    if (job.job_token !== token) {
      r.code = 401;
      r.data = { error: "Invalid token" };
      return r;
    }

    if (job.expires_at && new Date(job.expires_at).getTime() <= Date.now()) {
      r.code = 410;
      r.data = { status: "EXPIRED" };
      return r;
    }
    if (job.status === "PENDING" || job.status === "RUNNING") {
      r.code = 202;
      r.data = { status: job.status, message: "Aún en proceso" };
      return r;
    }
    if (job.status === "FAILED") {
      r.code = 200;
      r.data = { status: "FAILED", error_message: job.error_message };
      return r;
    }

    if (job.max_consumes && job.consume_count >= job.max_consumes) {
      await job.destroy();
      r.code = 410;
      r.data = { status: "GONE" };
      return r;
    }

    await job.increment("consume_count");
    await job.reload();

    // Binario se sirve crudo con su content-type: Buffer pasa la validación de
    // {code, data} (typeof 'object') y `reply.send(Buffer)` responde bytes,
    // igual que la respuesta del seed original (que ya 500-aba por `require`).
    if (job.result_is_binary && job.result) {
      return {
        code: 200,
        data: Buffer.from(job.result, "base64"),
        headers: {
          "content-type": job.content_type || "application/octet-stream",
        },
      };
    }

    const ct = job.content_type || "";
    if (ct.includes("json")) {
      try {
        const parsed = JSON.parse(job.result);
        r.data = typeof parsed === "string" ? parsed : parsed;
        return r;
      } catch {
        r.data = job.result;
        return r;
      }
    }

    r.data = job.result;
    return r;
  } catch (error) {
    console.log(error);
    r.data = error;
    r.code = 500;
    return r;
  }
}

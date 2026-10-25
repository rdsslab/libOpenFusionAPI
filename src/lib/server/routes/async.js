import { AsyncJob } from "../../db/async_job.js";

export async function asyncStatusRoute(fastify, opts) {
  fastify.get("/api/async/status/:id", async (request, reply) => {
    try {
      const { id } = request.params;
      const job = await AsyncJob.findByPk(id);
      if (!job) {
        return reply.code(404).send({ error: "Not found" });
      }
      const now = Date.now();
      if (job.expires_at && new Date(job.expires_at) < now) {
        return reply.code(410).send({ status: "EXPIRED" });
      }
      return reply.send({
        requestId: job.id,
        status: job.status,
        consume_count: job.consume_count,
        max_consumes: job.max_consumes,
        ttl_remaining_ms: job.expires_at ? new Date(job.expires_at).getTime() - now : null,
        completed_at: job.completed_at,
      });
    } catch (e) {
      return reply.code(500).send({ error: e.message });
    }
  });
}

export async function asyncResultRoute(fastify, opts) {
  fastify.get("/api/async/result/:id", async (request, reply) => {
    try {
      const { id } = request.params;
      const job = await AsyncJob.findByPk(id);
      if (!job) {
        return reply.code(404).send({ error: "Not found" });
      }
      const now = Date.now();
      if (job.expires_at && new Date(job.expires_at) < now) {
        return reply.code(410).send({ status: "EXPIRED" });
      }
      if (job.status === "PENDING" || job.status === "RUNNING") {
        return reply.code(202).send({ status: job.status, message: "Aún en proceso" });
      }
      if (job.status === "FAILED") {
        return reply.code(200).send({ status: "FAILED", error_message: job.error_message });
      }
      if (job.max_consumes && job.consume_count >= job.max_consumes) {
        await job.destroy();
        return reply.code(410).send({ status: "GONE" });
      }
      await job.increment("consume_count");
      await job.reload();

      const headers = job.response_headers || {};
      for (const [k, v] of Object.entries(headers)) {
        try {
          reply.header(k, v);
        } catch {}
      }
      if (job.content_type) {
        reply.type(job.content_type);
      }

      if (job.result_is_binary && job.result) {
        const buf = Buffer.from(job.result, "base64");
        return reply.send(buf);
      } else if (job.result !== null && job.result !== undefined) {
        const ct = job.content_type || "";
        if (ct.includes("json")) {
          try {
            const parsed = JSON.parse(job.result);
            if (typeof parsed === "string") {
              return reply.send(parsed);
            }
            return reply.send(parsed);
          } catch {
            return reply.send(job.result);
          }
        }
        return reply.send(job.result);
      }
      return reply.send(null);
    } catch (e) {
      return reply.code(500).send({ error: e.message });
    }
  });
}

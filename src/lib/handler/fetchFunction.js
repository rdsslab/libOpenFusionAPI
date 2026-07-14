// @ts-ignore
import uFetch from "@rdsslab/uFetch";
import {
  getAppVarContext,
  getHandlerExecutionContext,
  replyException,
  sendHandlerError,
  sendHandlerResponse,
  resolveAppVarPlaceholder,
} from "./utils.js";

export const fetchFunction = async (context) => {
  const { request, reply, method, endpoint } = getHandlerExecutionContext(context);
  //console.log(uFetch);
  try {
    // Resolve AppVar placeholder if present in code (the destination URL)
    const { appVars, environment } = getAppVarContext(endpoint, method);
    let url = resolveAppVarPlaceholder(method.code, appVars, environment);

    // Removed unused req_headers block

    /** ------------------------------
     *  SANITIZAR HEADERS
     * ------------------------------*/
    // console.log('-------> Fetch Function');
    //   console.log('custom_data-------> ', method.custom_data);
    const forwardedHeaders = { ...request.headers };
    try {
      if (forwardedHeaders.host) {
        delete forwardedHeaders.host;
      }

      if (forwardedHeaders.origin) {
        delete forwardedHeaders.origin;
      }
    } catch (error) {}

    delete forwardedHeaders["content-length"];
    delete forwardedHeaders["host"];
    delete forwardedHeaders["connection"];
    delete forwardedHeaders["x-forwarded-for"];

    // Explicitly preserve the distributed trace ID for outbound calls
    const traceId = request.headers["ofapi-trace-id"];
    if (traceId) {
      forwardedHeaders["ofapi-trace-id"] = traceId;
    }

    /** ------------------------------
     *  VALIDAR URL DESTINO
     * ------------------------------*/
    if (
      !url ||
      typeof url !== "string" ||
      url.length == 0
    ) {
      sendHandlerError(
        reply,
        500,
        `The destination URL ${url} is invalid.`,
      );
      return;
    }

    const hasEndpointTimeout = method?.timeout !== undefined && method?.timeout !== null;
    const endpointTimeoutSeconds = hasEndpointTimeout ? Number(method.timeout) : undefined;

    if (hasEndpointTimeout && Number.isNaN(endpointTimeoutSeconds)) {
      sendHandlerError(reply, 400, "Invalid endpoint timeout. Expected a numeric value in seconds.", {
        detail: {
          timeout: method.timeout,
          expectedUnit: "seconds",
        },
      });
      return;
    }

    const endpointTimeoutMs = hasEndpointTimeout
      ? endpointTimeoutSeconds * 1000
      : undefined;

    let init = {
      headers: forwardedHeaders, // Usar los headers de la peticion
      body: request.body, // Usar los body de la peticion
      query: request.query, // Usar los query de la peticion,
      url: url,
    };

    if (hasEndpointTimeout) {
      init.timeout = endpointTimeoutMs;
    }

    const FData = new uFetch();
    //  console.log('method -------> ', paramsFetch.method );
    const httpMethod = request.method.toUpperCase();
    const fetchMethod = request.method.toLowerCase();

    // @ts-ignore
    if (typeof FData[fetchMethod] !== "function") {
      sendHandlerError(reply, 405, `Method ${httpMethod} not allowed/supported`);
      return;
    }

    // @ts-ignore
    let resp = await FData[fetchMethod](init);

    // Forward Headers from Upstream
    const headersToForward = [
      "content-type",
      "content-disposition",
      "content-length",
      "cache-control",
      "etag",
      "last-modified",
    ];

    const responseHeaders = {};
    resp.headers.forEach((value, key) => {
      if (headersToForward.includes(key.toLowerCase())) {
        responseHeaders[key] = value;
      }
    });

    let r;
    const contentType = resp.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      try {
        r = await resp.json();
      } catch (e) {
        // Fallback if content-type lies
        const buffer = await resp.arrayBuffer();
        r = Buffer.from(buffer);
      }
    } else if (contentType.includes("text/") || contentType.includes("xml")) {
      r = await resp.text();
    } else {
      // Binary / Other (Images, PDF, Zip, etc)
      const buffer = await resp.arrayBuffer();
      r = Buffer.from(buffer);
    }

    // @ts-ignore
    if (reply.openfusionapi?.lastResponse?.hash_request) {
      // @ts-ignore
      // Limit caching size to avoid memory issues with large binaries
      if (Buffer.isBuffer(r)) {
        // TODO: Verificar si este limite en la cache puede dar problemas con el cliente si no se lo cachea
        if (r.length < 50 * 1024 * 1024) { // 50MB limit for cache
          //          reply.openfusionapi.lastResponse.data = r.toString('base64'); // Cache as base64? Or just skip?
          // Storing large binary in JSON cache might be bad.
          // For now, let's skip checking or store metadata.
          //reply.openfusionapi.lastResponse.data = { info: "Binary data", size: r.length, type: contentType };
          reply.openfusionapi.lastResponse.data = r;
        }
      } else {
        reply.openfusionapi.lastResponse.data = r;
      }
    }

    sendHandlerResponse(reply, {
      statusCode: resp.status,
      data: r,
      cache: false,
      headers: responseHeaders,
    });
  } catch (error) {
    const errorMessage =
      typeof error === "string"
        ? error
        : error?.message || "Unknown error";

    const looksLikeTimeout =
      error?.name === "AbortError" ||
      /timed\s*out|timeout/i.test(errorMessage);

    if (looksLikeTimeout) {
      sendHandlerError(reply, 504, "Gateway Timeout", {
        detail: {
          message: errorMessage,
          name: error?.name,
          code: error?.code,
          stack: error?.stack,
        },
      });
      return;
    }

    replyException(request, reply, error);
  }
};

import { functionsVars } from "../server/functionVars.js";
import {
  getHandlerExecutionContext,
  replyException,
  resolveSuccessStatus,
  sendHandlerResponse,
  warnIfRedirectWithoutLocation,
} from "./utils.js";
import {
  acquireEndpointLock,
  releaseEndpointLock,
} from "../db/endpoint_lock.js";

export const jsFunction = async (context) => {
  const { request, reply, method } = getHandlerExecutionContext(context);
  try {

    // --------------------------------------------------
    // 1) Get the execution context
    // --------------------------------------------------
    let fnVars = functionsVars(request, reply, method.environment);

    // --------------------------------------------------
    // 2) Abort token + unified abort signal
    // --------------------------------------------------
    const abortToken = request.headers?.['x-ofapi-abort-token'] || null;

    // One AbortController per execution. Sources that can abort it:
    //   - VM timeout (inside the sandbox, createFunctionVM)
    //   - IntervalTask exec_time_limit (the worker sends the token via header)
    //   - Operator stop (the token is flagged in the shared cache)
    //   - The HTTP client disconnects (request.raw 'close')
    const abortController = new AbortController();
    const abortSignal = abortController.signal;

    // If the client closes the connection, abort the execution.
    // request.raw is the Node http.IncomingMessage.
    if (request.raw && typeof request.raw.on === 'function') {
      request.raw.on('close', () => {
        if (!abortSignal.aborted) {
          console.log('[jsFunction] Client disconnected, aborting execution');
          abortController.abort(new Error('Client disconnected'));
        }
      });
    }

    // Expose both to the endpoint code through fnVars.
    fnVars.abortSignal = abortSignal;
    fnVars.abortToken = abortToken;

    // --------------------------------------------------
    // 3) Validate the compiled VM before taking any lock
    // --------------------------------------------------
    if (!method.jsFn) {
      throw new Error("Function 'jsFn' is not compiled in cache.");
    }

    // --------------------------------------------------
    // 4) H4: exclusive lock per endpoint
    // --------------------------------------------------
    // If the endpoint has `exclusive: true`, any call (GUI Tester, MCP, direct
    // HTTP client, or a scheduled IntervalTask hitting this endpoint) must hold
    // the lock while it runs. The lease is the endpoint timeout plus a grace
    // window, so a crashed process frees it shortly after its own deadline.
    let endpointLockId = null;
    if (method.exclusive) {
      const ttlSeconds = Number(method.timeout || 30) + 30;
      const lockResult = await acquireEndpointLock(method.idendpoint, ttlSeconds, "manual");
      if (!lockResult.success) {
        return sendHandlerResponse(reply, {
          statusCode: 409,
          data: {
            success: false,
            reason: lockResult.reason || "ENDPOINT_LOCKED",
            message:
              lockResult.message ||
              `Endpoint ${method.idendpoint} is locked by another execution in progress.`,
          },
        });
      }
      endpointLockId = lockResult.idlock;
    }

    // --------------------------------------------------
    // 5) Run the endpoint code with the abort signal
    // --------------------------------------------------
    let fnresult;
    try {
      fnresult = await method.jsFn(fnVars, abortSignal);
    } finally {
      // Always release the lease, on success and on failure.
      if (endpointLockId) {
        await releaseEndpointLock(method.idendpoint, endpointLockId).catch((err) => {
          console.error("[jsFunction] Error releasing endpoint lock:", err);
        });
      }
    }

    // The endpoint may ask for another success code with `$_RETURN_STATUS_`
    // (201 on create, 202 on enqueue, 204 on delete, 302 on redirect).
    const { statusCode, sendsBody } = resolveSuccessStatus(fnresult.statusCode, {
      endpoint: method.resource || method.idendpoint,
    });

    warnIfRedirectWithoutLocation(statusCode, fnresult.headers, {
      endpoint: method.resource || method.idendpoint,
    });

    sendHandlerResponse(reply, {
      statusCode,
      data: sendsBody ? fnresult.data : null,
      headers: fnresult.headers,
    });
  } catch (error) {
    replyException(request, reply, error);
  }
};

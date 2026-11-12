import vm from "node:vm";

const TIMEOUT_VM_MS = 1 * 60 * 1000; // 1 minute

/**
 * Crea una función async ejecutable de forma segura usando vm
 * 
 * Unifica el AbortController: el mismo controller maneja:
 * - VM timeout (config.timeout o default 120s)
 * - IntervalTask exec_time_limit (desde worker via abortToken -> signal)
 * - Cierre de conexión HTTP (request.raw.on('close'))
 * 
 * Expone al sandbox:
 * - $_ABORT_SIGNAL_: AbortSignal nativo (para fetch, drivers DB, etc.)
 * - $_ABORT_CHECK(): helper que lanza AbortError si abortado
 */
export const createFunctionVM = async (
  /** @type {string} */ code,
  /** @type {object} */ app_vars,
  timeoutVM = TIMEOUT_VM_MS
) => {
  try {
    /**
     * Código que será ejecutado dentro del sandbox
     * 
     * IMPORTANTE: El AbortController se crea DENTRO del sandbox para que el
     * AbortSignal sea nativo del contexto VM y funcione con fetch/DB drivers.
     * El timeout del VM llama a controller.abort() que propaga a signal.
     */
    const wrappedCode = `
      (async () => {
        // Track async resources created inside the sandbox so they can be
        // cleaned up when the execution ends (success or timeout).
        const __nativeSetTimeout = globalThis.setTimeout;
        const __nativeClearTimeout = globalThis.clearTimeout;
        const __nativeSetInterval = globalThis.setInterval;
        const __nativeClearInterval = globalThis.clearInterval;
        const __trackedTimeouts = new Set();
        const __trackedIntervals = new Set();

        const setTimeout = (fn, ms, ...args) => {
          const id = __nativeSetTimeout(fn, ms, ...args);
          __trackedTimeouts.add(id);
          return id;
        };

        const clearTimeout = (id) => {
          __trackedTimeouts.delete(id);
          return __nativeClearTimeout(id);
        };

        const setInterval = (fn, ms, ...args) => {
          const id = __nativeSetInterval(fn, ms, ...args);
          __trackedIntervals.add(id);
          return id;
        };

        const clearInterval = (id) => {
          __trackedIntervals.delete(id);
          return __nativeClearInterval(id);
        };

        const __cleanupAsyncResources = () => {
          for (const id of __trackedTimeouts) {
            __nativeClearTimeout(id);
          }
          for (const id of __trackedIntervals) {
            __nativeClearInterval(id);
          }
          __trackedTimeouts.clear();
          __trackedIntervals.clear();
        };

        // AbortController único por ejecución de endpoint.
        // Su signal se expone como $_ABORT_SIGNAL_ para que fetch, drivers DB,
        // y código del usuario lo usen nativamente.
        const AbortController = globalThis.AbortController;
        const controller = new AbortController();
        const signal = controller.signal;

        // Helper síncrono para chequear aborto y lanzar AbortError.
        // El código del endpoint debe llamar a $_ABORT_CHECK() entre pasos
        // (p.ej. antes/después de cada llamada SAP, query DB, etc.)
        // Verifica tanto la signal interna (VM timeout) como la externa (IntervalTask, operador, HTTP close).
        const $_ABORT_CHECK = () => {
          const externalSignal = typeof $_EXTERNAL_ABORT_SIGNAL_ !== "undefined" ? $_EXTERNAL_ABORT_SIGNAL_ : null;
          if (signal.aborted || (externalSignal && externalSignal.aborted)) {
            const err = new Error('Execution aborted');
            err.name = 'AbortError';
            throw err;
          }
        };

        // Exponer signal nativo para uso con fetch, uFetch, drivers que aceptan AbortSignal
        const $_ABORT_SIGNAL_ = signal;

        const __vmTimeoutMs = ${timeoutVM};
        let to;
        const timeoutPromise = new Promise((_, reject) => {
          to = __nativeSetTimeout(() => {
            const diedAt = new Date().toISOString();
            console.log(
              "[createFunctionVM] VM timeout reached after " + __vmTimeoutMs + "ms at " + diedAt + ". Aborting..."
            );
            controller.abort(new Error("JS handler execution timeout"));
            reject(new Error("JS handler execution timeout"));
          }, __vmTimeoutMs);
        });

        const __executeUserCode = async () => {
          ${code}
        };

        try {
          await Promise.race([__executeUserCode(), timeoutPromise]);
        } finally {
          clearTimeout(to);
          // NO llamar controller.abort() aquí: el signal debe reflejar
          // el estado real (timeout vs éxito). Si terminó bien, signal.aborted=false.
          __cleanupAsyncResources();
        }

        return {
          data: typeof $_RETURN_DATA_ !== "undefined" ? $_RETURN_DATA_ : null,
          headers: typeof $_CUSTOM_HEADERS_ !== "undefined" ? $_CUSTOM_HEADERS_ : {},
          // El sandbox no envía nada por su cuenta: solo comunica la intención. El
          // código lo valida y lo aplica jsFunction. Queda undefined cuando el
          // endpoint no lo asigna, para que la ausencia se distinga de un 200
          // explícito. (Sin acentos ni backticks: esto vive dentro de una cadena
          // de plantilla y un acento suelto la rompe.)
          statusCode: typeof $_RETURN_STATUS_ !== "undefined" ? $_RETURN_STATUS_ : undefined
        };
      })()
    `;

    // Compilar una sola vez al cargar el endpoint
    console.log(
      `[createFunctionVM] Compiling VM (timeoutVM=${timeoutVM}ms, default=${TIMEOUT_VM_MS}ms)`
    );
    let compiledScript;
    try {
      compiledScript = new vm.Script(wrappedCode, { filename: "sandbox.vm.js" });
    } catch (compileError) {
      const codePreview = (code || "").split("\n").slice(0, 25).join("\n");
      const enhancedError = new Error(
        `Invalid endpoint JS code. ${compileError?.message || "Unknown compile error"}\n--- code preview ---\n${codePreview}`
      );
      enhancedError.cause = compileError;
      throw enhancedError;
    }

    /**
     * Se retorna una función ejecutable — compiledScript se reutiliza en cada request
     * @param {object} customVarsAndFunctions - variables personalizadas para el sandbox
     * @param {AbortSignal} [abortSignal] - signal externo (p.ej. de IntervalTask worker) para abortar esta ejecución
     */
    return async (customVarsAndFunctions = {}, abortSignal) => {
      let safeAppVars;
      try {
        safeAppVars =
          typeof structuredClone === "function"
            ? structuredClone(app_vars)
            : JSON.parse(JSON.stringify(app_vars));
      } catch (e) {
        safeAppVars = JSON.parse(JSON.stringify(app_vars));
      }

      const sandbox = {
        ...customVarsAndFunctions,
        // App Vars are intentionally exposed twice:
        // 1. spread directly for ergonomic access like `$_VAR_NAME`
        // 2. grouped under `$_APP_VARS_` for enumeration and collision-safe access
        ...safeAppVars,
        $_APP_VARS_: safeAppVars,
        // Expose Node globals that the VM sandbox does not inherit automatically.
        // Required for timer-based VM timeout handling and AbortController support.
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        AbortController,
        fetch, // necesario para código del usuario
      };

      const context = vm.createContext(sandbox, {
        name: "sandbox",
        codeGeneration: { strings: false, wasm: false },
      });

      // Si viene un abortSignal externo (p.ej. de IntervalTask), vincularlo al controller interno
      // NOTA: El controller se crea DENTRO del sandbox. Para abortar desde fuera,
      // el código del usuario debe llamar a $_ABORT_CHECK() que lee signal.aborted.
      // El abortSignal externo se pasa via fnVars a handlers (sqlFunction, fetchFunction, etc.)
      // que ya tienen timeouts nativos. Para el VM timeout, usamos el controller interno.
      // Si abortSignal externo se dispara, podemos propagarlo al sandbox via una variable.
      // Aquí lo exponemos como $_EXTERNAL_ABORT_SIGNAL_ para que $_ABORT_CHECK pueda chequearlo también.
      if (abortSignal) {
        sandbox.$_EXTERNAL_ABORT_SIGNAL_ = abortSignal;
      }

      return await compiledScript.runInContext(context, {
        timeout: timeoutVM + 5000,
        breakOnSigint: true,
      });
    };
  } catch (error) {
    console.error("Error creating secure function:", error);
    return async () => {
      throw new Error("Error creating secure function");
    };
  }
};

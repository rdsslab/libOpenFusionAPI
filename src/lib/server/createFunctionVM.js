import vm from "node:vm";

const TIMEOUT_VM_MS = 1 * 60 * 1000; // 1 minute
//const TIMEOUT_SANDBOX_JAVASCRIPT = process.env.TIMEOUT_SANDBOX_JAVASCRIPT && Number(process.env.TIMEOUT_SANDBOX_JAVASCRIPT) > 0 ? Number(process.env.TIMEOUT_SANDBOX_JAVASCRIPT) : TIMEOUT_VM_MS;

/**
 * Crea una función async ejecutable de forma segura usando vm
 */
export const createFunctionVM = async (
  /** @type {string} */ code,
  /** @type {object} */ app_vars,
  timeoutVM = TIMEOUT_VM_MS
) => {
  try {
    /**
     * Código que será ejecutado dentro del sandbox
     */
    const wrappedCode = `
      (async () => {
        // The timeout now controls the AbortController, not the VM itself.
        const controller = new AbortController();
        const signal = controller.signal;

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

        let to;
        const timeoutPromise = new Promise((_, reject) => {
          to = setTimeout(() => {
            console.log("Timeout reached, aborting VM...");
            controller.abort();
            reject(new Error("JS handler execution timeout"));
          }, ${timeoutVM});
        });

        const __executeUserCode = async () => {
          ${code}
        };

        try {
          await Promise.race([__executeUserCode(), timeoutPromise]);
        } finally {
          clearTimeout(to);
          controller.abort();
          __cleanupAsyncResources();
        }

        return {
          data: typeof $_RETURN_DATA_ !== "undefined" ? $_RETURN_DATA_ : null,
          headers: typeof $_CUSTOM_HEADERS_ !== "undefined" ? $_CUSTOM_HEADERS_ : {}
        };
      })()
    `;

    /**
     * Se retorna una función ejecutable
     */
    return async (customVarsAndFunctions = {}) => {
      const sandbox = {
        ...customVarsAndFunctions,
        // App Vars are intentionally exposed twice:
        // 1. spread directly for ergonomic access like `$_VAR_NAME`
        // 2. grouped under `$_APP_VARS_` for enumeration and collision-safe access
        ...app_vars,
        $_APP_VARS_: app_vars,
      };

      console.log("[DEBUG VM] sandbox keys:", Object.keys(sandbox));
      console.log("[DEBUG VM] typeof sandbox.URL:", typeof sandbox.URL);
      console.log("[DEBUG VM] typeof sandbox.Map:", typeof sandbox.Map);
      console.log("[DEBUG VM] typeof sandbox.setInterval:", typeof sandbox.setInterval);

      // Crear contexto aislado
      const context = vm.createContext(sandbox, {
        name: "sandbox",
        codeGeneration: { strings: false, wasm: false },
      });

      // Compilar script
      let script;
      try {
        script = new vm.Script(wrappedCode, {
          filename: "sandbox.vm.js",
          //        timeout: 60 * 60 * 1000, // evita loops infinitos // Maximo 1 hora // Revisar
        });
      } catch (compileError) {
        const codePreview = (code || "")
          .split("\n")
          .slice(0, 25)
          .join("\n");
        const enhancedError = new Error(
          `Invalid endpoint JS code. ${compileError?.message || "Unknown compile error"}\n--- code preview ---\n${codePreview}`
        );
        enhancedError.cause = compileError;
        throw enhancedError;
      }

      // Ejecutar
      return await script.runInContext(context, {
        timeout: timeoutVM + 5000,
        breakOnSigint: true, // opcional
      });
    };
  } catch (error) {
    console.error("Error creating secure function:", error);
    return async () => {
      throw new Error("Error creating secure function");
    };
  }
};

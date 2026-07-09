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

        // If the code exceeds the allowed timeout (timeoutVM + 1s), abort it.
        const to = setTimeout(() => {
          console.log("Timeout reached, aborting VM...");
          controller.abort();
        }, ${timeoutVM + 1000});

        const __executeUserCode = async () => {
          ${code}
        };

        try {
          await __executeUserCode();
        } finally {
          clearTimeout(to);
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

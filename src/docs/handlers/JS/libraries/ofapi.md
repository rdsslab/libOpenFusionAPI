<!-- AUTO-GENERADO por src/lib/server/generateDocs.js a partir de src/lib/server/functionVars.js. NO EDITAR A MANO: este directorio se vacia y se reescribe en cada regeneracion. Los cambios van en functionVars.js. -->

# `ofapi`

[External Documentation](https://github.com/rdsslab/libOpenFusionAPI) 

OpenFusionAPI runtime helpers exposed to JS handlers.

**Notes**

- Use ofapi.throw when you need a structured HTTP error from JS handler code.

*   Returns: <object> Utility object with server context and helper methods.

    **Result Structure:**

    *   `server` <object> Runtime server information when available.
    *   `genToken` <function> Signs a JWT token for OpenFusionAPI usage.
    *   `throw` <function> Throws a controlled HTTP exception.
    *   `log` <function> Saves a log entry asynchronously in the high-performance log queue (accepts message, data, level).


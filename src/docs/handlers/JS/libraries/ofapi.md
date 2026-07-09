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


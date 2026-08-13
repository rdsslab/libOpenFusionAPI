<!-- AUTO-GENERADO por src/lib/server/generateDocs.js a partir de src/lib/server/functionVars.js. NO EDITAR A MANO: este directorio se vacia y se reescribe en cada regeneracion. Los cambios van en functionVars.js. -->

# `$_EXCEPTION_(options)`

[External Documentation](https://github.com/rdsslab/libOpenFusionAPI) 

Interrupts the program flow and throws an exception with a specific message and status code.

**Notes**

- `options.message` <string, required> is the only text returned to the client.
- `options.statusCode` <integer, default 500> is the HTTP status of the response.
- `options.data.log` <any> is persisted in the log and NEVER sent to the client: put here bodies, credentials or application variables.
- `options.data.public` <any> is added to the HTTP response as `data`: put here only what the caller needs in order to fix the problem.
- A `data` object without `log`/`public` keys is treated entirely as `log`, which is the safe default.
- The positional form `$_EXCEPTION_(message, data, statusCode)` is DEPRECATED. It still works and keeps the old behaviour (the whole `data` is log-only), but prints a deprecation warning naming the endpoint that uses it.

**Agent Guidance**

- If the caller can fix the error (invalid field, business rule), say so in `message` and put the offending values in `data.public`.
- Never put application variables, tokens or full request bodies in `data.public`; that material belongs in `data.log`.

**Parameters**

*   `options` <object> Object with the error definition: { message, statusCode, data: { log, public } }.

*   Returns: <void> Throws an exception object that stops execution.

    **Result Structure:**

    *   `error` <string> The error message, in the HTTP response body.
    *   `trace_id` <string> Trace identifier of the request, in the HTTP response body.
    *   `data` <any> Only present when `options.data.public` was provided; it is that value, truncated if very large.

#### Example

```javascript
// simple usage
$_EXCEPTION_({ message: "Invalid input parameter", statusCode: 400 });

// context for the log only (nothing of this reaches the client)
$_EXCEPTION_({
  message: "User not found",
  statusCode: 404,
  data: { log: { userId: 123, body: request.body } },
});

// tell the caller what to fix, keeping the sensitive context private
$_EXCEPTION_({
  message: "El correo del colaborador no es válido.",
  statusCode: 422,
  data: {
    log: { body: request.body },
    public: { campo: "Correo", valor: "davi88-@hotmail.com" },
  },
});

// DEPRECATED positional form: the whole `data` is log-only
$_EXCEPTION_("User not found", { userId: 123 }, 404);
```


<!-- AUTO-GENERADO por src/lib/server/generateDocs.js a partir de src/lib/server/functionVars.js. NO EDITAR A MANO: este directorio se vacia y se reescribe en cada regeneracion. Los cambios van en functionVars.js. -->

# `$_RETURN_STATUS_`

[External Documentation](https://github.com/rdsslab/libOpenFusionAPI) 

Optional success status for JS and MONGODB handlers. Assign an integer between 200 and 399 to answer with something other than 200; leaving it unset keeps 200.

**Notes**

- The response body is unchanged: it still goes in $_RETURN_DATA_.
- Assign a number, not a string. "201" is rejected and falls back to 200 with a warning, because a string a Number() would silently convert would hide the mistake.
- 4xx and 5xx are NOT accepted here. Raise errors with $_EXCEPTION_ so the body keeps the standard error shape with its trace_id.
- An out-of-range or non-integer value degrades to 200, not to 500: the endpoint produced valid data and the caller should not pay for a mistyped number. The log carries a warning.
- 204 and 304 send no body, because the protocol forbids one; whatever is in $_RETURN_DATA_ is discarded.
- The status survives response caching, so an endpoint that answered 203 answers 203 from cache instead of degrading to 200 on the second identical request.

**Agent Guidance**

- Use it whenever 200 would be a lie about what happened: 201 when something was created, 200 when it was a duplicate, 202 when work was only enqueued, 204 on delete.
- Do not use it to signal an error. That is what $_EXCEPTION_ is for.

*   Returns: number (200-399)

#### Example

```javascript

const created = [];
for (const ev of request.body?.events ?? []) {
  if (await insertIfNew(ev)) created.push(ev.id);
}
$_RETURN_DATA_ = { created: created.length };
$_RETURN_STATUS_ = created.length > 0 ? 201 : 200;
      
```


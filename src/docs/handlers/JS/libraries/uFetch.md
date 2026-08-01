# `uFetch([constructor(url?, redirect_in_unauthorized?, timeoutOptions?)], [request(url, method, data, headers, options, body, timeout)], [get|post|put|patch|delete({ url, data, body, headers, options, timeout })], [batch({ url, method, items, headers, options, config })], [batch_old(url, method, items, headers, options, config)])`

[External Documentation](https://github.com/rdsslab/uFetch) 

Universal HTTP client for Node.js and browsers. Primary use is standard fetch-style requests (get/post/put/patch/delete); batch adds controlled parallel processing for large input sets.

> [!CAUTION]
> **Deprecated API — Do NOT use uppercase method names.**
> Previous versions of uFetch exposed method wrappers as `GET`, `POST`, `PUT`, `PATCH`, `DELETE` (uppercase).
> **These no longer exist in the current version and will throw a runtime error.**
> Always use the lowercase equivalents: `get`, `post`, `put`, `patch`, `delete`.
> This applies both to direct calls (`api.get(...)`) and to the `method` field inside `batch()` items (use `'POST'` as a string value there, not a method call).

**Notes**

- Use uFetch when the target URL is absolute or belongs to another system.
- Primary workflow: use get/post/put/patch/delete for single requests or simple request chains.
- Quick decision: one request => get/post/put/patch/delete.
- Quick decision: list/lote of requests with controlled parallel workers => batch({ items, config: { concurrency, ... } }).
- For GET or HEAD, data is serialized as query string. For non-GET methods, object data is serialized as JSON automatically.
- Method wrappers accept body to force payload in HTTP body and timeout to override request duration.
- Use setTimeouts({ timeout, headersTimeout, bodyTimeout, socketTimeout }) to configure default timeouts at instance level.
- Use setAbortTimeout(timeout) as a shortcut when only abort timeout must be adjusted.
- Use batch() when you must process many calls from a list and split the workload into concurrent workers/blocks.
- batch() returns per-item result objects and is designed to continue even if some items fail; always inspect isError per item.
- batch() signature: batch({ url, method, items, headers, options, timeout, config: { concurrency, onProgress, responseParser, includeResponse } }).
- Every item in items shares the exact same url/method/headers/options/timeout — there is no per-item override. items must be either a plain array (each element sent verbatim as data for every request) or an object wrapper { data: [...] } / { body: [...] } to choose how the whole batch is sent. An item object containing keys like url/method/timeout is NOT inspected or extracted — it is sent as-is as the payload.
- If different payloads need a different url/method/timeout, do not use batch(); use Promise.all with individual get/post/put/patch/delete calls instead.
- Positional signature batch(url, method, items, headers, options, config) is not accepted by batch(); use batch_old(...) for legacy compatibility.
- Each batch result item has shape by default: { isError, httpCode, data?, error? }.
- If config.includeResponse is true, each result may also include response.
- Authorization helpers persist at instance level. Create a fresh instance when different credentials must be isolated.

**Agent Guidance**

- For internal OpenFusionAPI endpoints in the same instance, prefer uFetchAutoEnv instead of hardcoding dev/qa/prd URLs.
- **NEVER use uppercase method wrappers**: `GET`, `POST`, `PUT`, `PATCH`, `DELETE` are deprecated and removed. Always use `get`, `post`, `put`, `patch`, `delete` (lowercase).
- Start with get/post/put/patch/delete and switch to batch only when you have a collection of inputs to process concurrently.
- If you need per-item fault tolerance and progress in a large workload, prefer batch over Promise.all.
- Prefer method wrappers with opts object for readability: get/post/put/patch/delete({ url, data, body, headers, options, timeout }).
- Use request(url, method, data, headers, options, body, timeout) only when method must be computed dynamically.
- For bulk operations, prefer batch() over Promise.all to avoid failing the full operation due to a single request error.
- Prefer the object signature of batch(); use batch_old() only while migrating legacy positional code.

**Parameters**

*   `constructor(url?, redirect_in_unauthorized?, timeoutOptions?)` <function> **Optional**. Creates an instance with optional base URL for relative paths. In browser mode, redirect_in_unauthorized can redirect on 401. timeoutOptions configures default timeout behavior.
*   `request(url, method, data, headers, options, body, timeout)` <function> **Optional**. Low-level request method used by all wrappers.
*   `get|post|put|patch|delete({ url, data, body, headers, options, timeout })` <function> **Optional**. Convenience wrappers for common HTTP methods.
*   `batch({ url, method, items, headers, options, config })` <function> **Optional**. Parallel fail-safe processor. Receives a single options object and returns one result per item without failing the whole batch.
*   `batch_old(url, method, items, headers, options, config)` <function> **Optional**. Legacy compatibility wrapper for positional batch calls.

*   Returns: <object> uFetch instance with request wrappers and auth helpers.

    **Result Structure:**

    *   `request` <function> Core request primitive.
    *   `get|post|put|patch|delete` <function> HTTP method wrappers using opts object.
    *   `batch` <function> Fail-safe batch execution with configurable concurrency.
    *   `setTimeouts` <function> Updates global timeout defaults for this instance.
    *   `setAbortTimeout` <function> Convenience helper to update only global timeout.
    *   `setBasicAuthorization` <function> Sets persistent Basic auth header for the instance.
    *   `setBearerAuthorization` <function> Sets persistent Bearer auth header for the instance.
    *   `abort` <function> Aborts active in-flight requests for this instance.

#### Example

```javascript

const api = new uFetch('https://api.example.com');

api.setBearerAuthorization(endpointEnv.API_TOKEN);

const usersRes = await api.get({
  url: '/users',
  data: { role: 'admin', page: 1 },
});

const createRes = await api.post({
  url: '/users',
  data: { username: 'johndoe' },
  timeout: 30000,
});

api.setAbortTimeout(90000);

const batchResults = await api.batch({
  url: '/users',
  method: 'POST',
  timeout: 60000,
  items: [
    { username: 'a' },
    { username: 'b' },
    { username: 'c' },
  ],
  config: {
    concurrency: 5,
    includeResponse: false,
  },
});

$_RETURN_DATA_ = {
  users: await usersRes.json(),
  created: await createRes.json(),
  batch: batchResults.map((r) => ({
    isError: r.isError,
    httpCode: r.httpCode,
    hasData: typeof r.data !== 'undefined',
  })),
};
      
```


# `uFetch([constructor(url?, redirect_in_unauthorized?)], [request(url, method, data, headers, options)], [get|post|put|patch|delete({ url, data, headers, options })], [batch({ url, method, items, headers, options, config })], [batch_old(url, method, items, headers, options, config)])`

[External Documentation](https://github.com/rdsslab/uFetch) 

Universal HTTP client for Node.js and browsers. Primary use is standard fetch-style requests (get/post/put/patch/delete); batch adds controlled parallel processing for large input sets.

**Notes**

- Use uFetch when the target URL is absolute or belongs to another system.
- Primary workflow: use get/post/put/patch/delete for single requests or simple request chains.
- Quick decision: one request => get/post/put/patch/delete.
- Quick decision: list/lote of requests with controlled parallel workers => batch({ items, config: { concurrency, ... } }).
- For GET or HEAD, data is serialized as query string. For non-GET methods, object data is serialized as JSON automatically.
- Use batch() when you must process many calls from a list and split the workload into concurrent workers/blocks.
- batch() returns per-item result objects and is designed to continue even if some items fail; always inspect isError per item.
- batch() signature: batch({ url, method, items, headers, options, config: { concurrency, onProgress, responseParser, includeResponse } }).
- If an item includes any of { url, method, data, headers, options }, those fields override base values for that item.
- Positional signature batch(url, method, items, headers, options, config) is not accepted by batch(); use batch_old(...) for legacy compatibility.
- Each batch result item has shape by default: { isError, httpCode, data?, error? }.
- If config.includeResponse is true, each result may also include response.
- Authorization helpers persist at instance level. Create a fresh instance when different credentials must be isolated.

**Agent Guidance**

- For internal OpenFusionAPI endpoints in the same instance, prefer uFetchAutoEnv instead of hardcoding dev/qa/prd URLs.
- Start with get/post/put/patch/delete and switch to batch only when you have a collection of inputs to process concurrently.
- If you need per-item fault tolerance and progress in a large workload, prefer batch over Promise.all.
- Prefer method wrappers with opts object for readability: get/post/put/patch/delete({ url, data, headers, options }).
- Use request(url, method, data, headers, options) only when method must be computed dynamically.
- For bulk operations, prefer batch() over Promise.all to avoid failing the full operation due to a single request error.
- Prefer the object signature of batch(); use batch_old() only while migrating legacy positional code.

**Parameters**

*   `constructor(url?, redirect_in_unauthorized?)` <function> **Optional**. Creates an instance with optional base URL for relative paths. In browser mode, redirect_in_unauthorized can redirect on 401.
*   `request(url, method, data, headers, options)` <function> **Optional**. Low-level request method used by all wrappers.
*   `get|post|put|patch|delete({ url, data, headers, options })` <function> **Optional**. Convenience wrappers for common HTTP methods.
*   `batch({ url, method, items, headers, options, config })` <function> **Optional**. Parallel fail-safe processor. Receives a single options object and returns one result per item without failing the whole batch.
*   `batch_old(url, method, items, headers, options, config)` <function> **Optional**. Legacy compatibility wrapper for positional batch calls.

*   Returns: <object> uFetch instance with request wrappers and auth helpers.

    **Result Structure:**

    *   `request` <function> Core request primitive.
    *   `get|post|put|patch|delete` <function> HTTP method wrappers using opts object.
    *   `batch` <function> Fail-safe batch execution with configurable concurrency.
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
});

const batchResults = await api.batch({
  url: '/users',
  method: 'POST',
  items: [
    { username: 'a' },
    { username: 'b', method: 'PUT' },
    { url: 'https://other-api.example/log', data: { msg: 'audit' } },
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


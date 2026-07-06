# `uFetchAutoEnv([create(url, shouldApplyAuto = true)], [auto(url)])`

[External Documentation](https://github.com/rdsslab/uFetch) 

OpenFusionAPI helper that wraps uFetch for same-instance calls. Use it mainly with get/post/put/patch/delete and optionally with batch for parallelized internal fan-out. It resolves /auto or /env suffixes to the current runtime environment.

**Notes**

- For relative paths, this helper builds a full URL using current base URL and server port.
- If the path contains /auto or /env suffix before query/hash, it is replaced by the current environment (dev, qa, prd).
- Absolute URLs bypass environment replacement and are sent as-is.
- Most endpoints should start with get/post/put/patch/delete; batch is for list-driven parallel calls with controlled concurrency.
- Quick decision: if you need N calls to the same internal endpoint with a lote, use create('/api/.../auto') + batch({ method, items, config }).
- create()/auto() return a uFetch instance, so batch({ ...opts }) is also available for internal fan-out calls.
- Request trace header ofapi-trace-id is propagated automatically when available.

**Agent Guidance**

- Prefer relative internal URLs such as /api/myapp/resource/auto instead of hardcoded localhost URLs.
- Use auto() for environment-agnostic internal calls and keep endpoint code portable across dev/qa/prd.
- Use create(path, false) when you must preserve a literal path and avoid automatic /auto or /env replacement.
- After obtaining the uFetch instance, use standard uFetch methods like get/post/put/patch/delete with opts object.

**Parameters**

*   `create(url, shouldApplyAuto = true)` <function> **Optional**. Creates a uFetch instance for the given URL/path. Relative paths are resolved against current server base URL and port.
*   `auto(url)` <function> **Optional**. Shortcut for create(url, true).

*   Returns: <object> URLAutoEnvironment instance exposing create() and auto() that return uFetch instances.

    **Result Structure:**

    *   `create` <function> Builds uFetch instance from relative/absolute URL with optional environment replacement.
    *   `auto` <function> Always applies environment suffix replacement for /auto and /env.

#### Example

```javascript

const sumFetch = uFetchAutoEnv.auto('/api/datetime_app/sum-array/auto');
const sumResponse = await sumFetch.post({
  data: { numbers: [4, 12, 9] },
});

const usersFetch = uFetchAutoEnv.create('/api/myapp/users/env?active=true#view');
const usersResponse = await usersFetch.get();

const soapFetch = uFetchAutoEnv.create('/api/demo/ofapi/soap/example01/auto');
const items = Array.from({ length: 40 }, (_, i) => ({ dNum: i + 1 }));
const batch = await soapFetch.batch({
  method: 'GET',
  items,
  config: {
    concurrency: 5,
  },
});

$_RETURN_DATA_ = {
  sum: await sumResponse.json(),
  users: await usersResponse.json(),
  batchSummary: batch.map((r) => ({ isError: r.isError, httpCode: r.httpCode })),
};
      
```


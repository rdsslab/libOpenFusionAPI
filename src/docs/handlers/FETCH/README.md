# FETCH Handler – HTTP Proxy & Forwarder

The **FETCH handler** enables OpenFusionAPI to act as a robust HTTP proxy, forwarding requests to external services while managing headers, caching, and response transformation.  
Internally it uses `@rddslab/uFetch` to perform standardized HTTP requests.

Agent note:
- `@rddslab/uFetch` may evolve frequently. Before updating FETCH behavior, examples, or helper snippets, confirm the current official documentation or the installed package contract.
- If you use `uFetch.batch`, the current contract is a single object argument; positional batch calls are legacy and should move to `batch_old(...)`.

---

<details>
<summary>🧠 How It Works</summary>

When an endpoint is configured with the **FETCH** handler:
1.  **Request forwarding**: The incoming HTTP method (GET, POST, PUT, etc.), query parameters, and body are forwarded to the target URL.
2.  **Header Sanitization**: Incoming headers are forwarded, except for hop-by-hop headers like `content-length`, `host`, `connection`, and `x-forwarded-for` to prevent conflicts.
3.  **Response Handling**: The handler automatically detects the upstream content type (JSON, Text, XML, or Binary/Image) and processes it accordingly.
4.  **Response Forwarding**: Key upstream headers (`content-type`, `etag`, `cache-control`, etc.) are passed back to the client.

</details>

---

<details>
<summary>⚙️ Endpoint Configuration</summary>

The configuration in the "Code" editor for this handler is simply the **Target URL**.

**Example**:
```text
https://jsonplaceholder.typicode.com/posts
```


</details>

---

<details>
<summary>🌐 Supported Operations & Behavior</summary>

-   **Methods**: Supports all standard HTTP methods (`GET`, `POST`, `PUT`, `DELETE`, `PATCH`, etc.).
-   **Binary Support**: Capable of proxying images, PDFs, ZIPs, and other binary formats.
-   **Caching**:
    -   Responses are cached based on the endpoint's configured cache time.
    -   **Limit**: Binary responses larger than **50MB** are excluded from the cache to preserve memory.
-   **Error Handling**:
    -   If the target URL is invalid, returns HTTP `500`.
    -   If the HTTP method is not supported by the internal client, returns HTTP `405`.
    -   Upstream errors are passed through with their original status codes.

</details>

---

<details>
<summary>📤 Example Requests</summary>

**Proxying a JSON API**

If your endpoint is `/api/proxy/users` and points to `https://jsonplaceholder.typicode.com/users`:

```bash
curl -X GET https://your-openfusion-server/api/proxy/users
```

**Response**:
```json
[
  {
    "id": 1,
    "name": "Leanne Graham",
    "username": "Bret",
    "email": "Sincere@april.biz"
  },
  ...
]
```

</details>

---

<details>
<summary>📊 Capability Summary</summary>

| Feature | Supported |
|---|---:|
| HTTP/HTTPS Proxying | ✅ |
| Dynamic Method Forwarding | ✅ |
| Header Forwarding | ✅ (Selective) |
| Binary Content (Images/PDF) | ✅ |
| Variable Substitution in URL | ❌ |
| Caching | ✅ (Max 50MB for binary) |
| Authentication | ❌ (Must be handled via headers) |

</details>

---

<details>
<summary>💡 Typical Use Cases</summary>

-   **API Gateway**: Unify multiple microservices under a single domain.
-   **Asset Proxy**: Serve external images or files while hiding the source origin.
-   **Legacy Wrapper**: Add CORS support or caching to legacy APIs.
</details>

---

© 2025 – OpenFusionAPI · Created and maintained by **edwinspire**

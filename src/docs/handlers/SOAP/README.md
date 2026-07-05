# SOAP Handler – XML Web Services Connector

The **SOAP handler** enables integration with legacy and enterprise SOAP web services. It uses the `node-soap` library to parse WSDLs and execute methods dynamically.

---

<details>
<summary>🧠 How It Works</summary>

When an endpoint is configured with the **SOAP** handler:
1.  **Client Initialization**: It creates a SOAP client based on the provided WSDL URL.
2.  **Caching**: To optimize performance, initialized SOAP clients are cached in memory (LRU Strategy, Max 50 clients, 10-minute TTL) to avoid re-parsing the WSDL on every request.
3.  **Forwarding**: It maps JSON input from the HTTP request to the XML arguments required by the SOAP method.
4.  **Header Forwarding**: Most HTTP headers from the incoming request are forwarded to the SOAP service (excluding specific hop-by-hop headers).
5.  **Execution**: The interaction happens asynchronously, and the result is returned as a JSON object.

</details>

---

<details>
<summary>⚙️ Endpoint Configuration</summary>

The SOAP handler reads the **WSDL URL** (and optional settings) from the endpoint `code` field. Parameters for the SOAP call come from the HTTP request body.

The `wsdl` value must return an actual WSDL XML document. A runtime SOAP endpoint or SAP `MessageServlet` status page is not enough, even if it responds with HTTP `200`.

For AI agents, this distinction is critical:
- A SOAP runtime URL is the endpoint that receives SOAP envelopes.
- A WSDL URL is the metadata document that `node-soap` must download and parse first.
- These URLs may be different.
- If the WSDL document contains a `soap:address location="..."`, that `location` is usually the runtime endpoint, not the WSDL URL itself.

**`code` field — Application Variable reference** _(recommended for production)_:

Store the WSDL URL and any shared config as an Application Variable and reference it by name. The runtime resolves it at call time:

```
$_VAR_SOAP_SERVICE_WSDL
```

The AppVar value should contain the WSDL URL string. Credentials or extra options can be stored in the same variable if needed.

**`code` field — Inline WSDL config**:

For testing or simple integrations you can provide the config inline:

```json
{
  "wsdl": "https://www.dataaccess.com/webservicesserver/NumberConversion.wso?WSDL",
  "options": {
    "wsdl_options": {
      "timeout": 5000
    }
  }
}
```

**POST Request Body** — how to call a method at runtime:

Send `functionName` and `RequestArgs` in the HTTP request body. `functionName` selects which SOAP method to invoke; `RequestArgs` maps to its input parameters:

```json
{
  "functionName": "NumberToWords",
  "RequestArgs": {
    "ubiNum": 500
  }
}
```

Values in the request body override any defaults set in the `code` config, so you can fix `functionName` in config for single-method endpoints or leave it open for dynamic invocation.

**How to choose `functionName` correctly**:

Do not assume the XML body root name is the callable operation name. In many enterprise WSDLs, the method exposed by `node-soap` is the **port operation name**, while the body payload uses a different element name.

Recommended workflow:
1. Use `"describe()": true` with the WSDL.
2. Read the service → port → operation structure returned by the handler.
3. Use that operation name as `functionName`.
4. Use `RequestArgs` with the fields expected by the operation input.

Generic example of a mismatch that can confuse agents:

```json
{
  "ExampleService": {
    "ExamplePort": {
      "SubmitOrder": {
        "input": "orderRequest",
        "output": "orderResponse"
      }
    }
  }
}
```

In that case:
- Correct `functionName`: `SubmitOrder`
- Incorrect `functionName`: `orderRequest`

**`custom_data`** is currently unused by the SOAP handler. Use the `code` field for WSDL and options.

</details>

---

<details>
<summary>🔐 Authentication</summary>

The handler supports common SOAP security standards via configuration:

**Basic Authentication**:
```json
{
  "BasicAuthSecurity": {
    "User": "myuser",
    "Password": "mypassword"
  }
}
```

When `BasicAuthSecurity` or `BearerSecurity` is configured, the same credential is now used in both places:
- WSDL download and parsing
- SOAP operation execution

This matters for enterprise integrations where the WSDL itself is protected and returns `401 Unauthorized` unless the metadata request is authenticated.

If the URL responds with HTML instead of WSDL XML, the handler will fail during client creation. In practice this usually means one of these cases:
- the URL is the SOAP runtime endpoint, not the WSDL metadata URL
- the service redirects to a login or status page
- the WSDL fetch requires different credentials than the SOAP operation itself

Generic signs that the URL is **not** a real WSDL URL:
- the response starts with `<html>` instead of `<wsdl:definitions>` or `<definitions>`
- the response is a status page, login page, or gateway error page
- adding common WSDL suffixes still returns HTML instead of XML metadata

**Bearer Token**:
```json
{
  "BearerSecurity": "your_oauth_token_here"
}
```

</details>

---

<details>
<summary>🔍 Service Discovery</summary>

To inspect a SOAP service and obtain a full description of its services, ports, and methods as a JavaScript object, you can send `{"describe()": true}` in the request payload.

```json
{
  "describe()": true
}
```

This returns the client description directly as a JSON response similar to the following structure:

```json
{
  "MyService": {
    "MyPort": {
      "MyFunction": {
        "input": {
          "name": "string"
        }
      }
    }
  }
}
```

For agents, `describe()` should be the default first step whenever the callable method name is not already verified from a known-good contract.

</details>

---

<details>
<summary>🧭 Agent Workflow</summary>

Recommended deterministic workflow for AI agents:

1. Validate that the configured `wsdl` URL returns XML WSDL, not HTML.
2. If the upstream WSDL is unavailable but the XML contract is available as a file, publish that WSDL from a local static endpoint first.
3. Call the SOAP handler with `"describe()": true` to discover the real operation name.
4. Fix `functionName` in endpoint config when the integration is single-purpose.
5. Keep only business fields inside `RequestArgs`.
6. Validate with one representative request before enabling MCP exposure or wider automation.

This sequence reduces the most common agent errors:
- confusing runtime URL with WSDL URL
- choosing the body element name instead of the WSDL operation name
- assuming credentials are only needed for the SOAP call and not for the WSDL fetch
- attempting integration against HTML or status pages

</details>

---

<details>
<summary>🧩 Local WSDL Strategy</summary>

When the real service exposes a valid SOAP runtime endpoint but does not expose a directly consumable WSDL URL, a practical strategy is:

1. Store or obtain the WSDL XML document separately.
2. Publish that WSDL from a local endpoint.
3. Point the SOAP handler `wsdl` to the local WSDL URL.
4. Let the WSDL's internal `soap:address` drive the real remote invocation.

Generic example:

**Local WSDL publishing endpoint**:
```json
{
  "resource": "/soap/contracts/order-service/wsdl",
  "method": "GET",
  "handler": "TEXT"
}
```

**SOAP endpoint config using the local WSDL**:
```json
{
  "wsdl": "https://your-server.example/api/demo/soap/contracts/order-service/wsdl/prd",
  "functionName": "SubmitOrder",
  "BasicAuthSecurity": {
    "User": "service_user",
    "Password": "service_password"
  }
}
```

This approach is especially useful when agents have the contract file but not a reliable WSDL metadata URL.

</details>


<details>
<summary>Real-World Example (MCP-enabled SOAP endpoint)</summary>

This shows a production-ready SOAP endpoint pattern. The endpoint is also exposed as an MCP tool so an AI agent can call it.

**Endpoint config**:
- Method: `POST`
- Handler: `SOAP`
- Code: `$_VAR_SOAP_SERVICE_WSDL`
- MCP enabled: yes, name `update_billing_cycle_day`
- MCP description: `Use this tool to update the billing cycle day for a customer group in the external SOAP system.`

**JSON Schema (input validation)**:
```json
{
  "type": "object",
  "required": ["functionName", "RequestArgs"],
  "properties": {
    "functionName": {
      "type": "string",
      "description": "SOAP method name to invoke"
    },
    "RequestArgs": {
      "type": "object",
      "required": ["groupId", "groupIdType", "billingCycleDay"],
      "properties": {
        "groupId": { "type": "string", "description": "Customer group identifier" },
        "groupIdType": { "type": "string", "description": "Customer group identifier type" },
        "billingCycleDay": { "type": "integer", "minimum": 1, "maximum": 31, "description": "New billing cycle day" }
      }
    }
  }
}
```

**HTTP call**:
```bash
curl -X POST https://your-server.com/api/myapp/groups/update_billing_cycle_day/qa \
  -H "Content-Type: application/json" \
  -d '{
    "functionName": "UpdateBillingCycleDay",
    "RequestArgs": {
      "groupId": "GROUP-1001",
      "groupIdType": "ACCOUNT",
      "billingCycleDay": 15
    }
  }'
```

**What happens internally**:
1. The SOAP client loads the WSDL from the `$_VAR_SOAP_SERVICE_WSDL` AppVar.
2. It invokes the `UpdateBillingCycleDay` method with the `RequestArgs`.
3. The XML response is automatically converted to JSON and returned.

</details>

<details>
<summary>📊 Capability Summary</summary>

| Feature | Supported |
|---|---:|
| WSDL Parsing | ✅ |
| Client Caching | ✅ (LRU & TTL) |
| Basic Auth / Bearer Auth | ✅ |
| Application Variable Reference | ✅ (`$_VAR_*` in code field) |
| Dynamic Arguments | ✅ (From Body/Query) |
| Header Forwarding | ✅ |
| Describe / Introspect | ✅ |
| Local WSDL publishing strategy | ✅ |

</details>

---

© 2025 – OpenFusionAPI · Created and maintained by **edwinspire**

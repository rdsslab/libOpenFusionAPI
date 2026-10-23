# SOAP Handler - AI Agent Skill Guide

## Role & Persona
You are an expert **Enterprise SOAP-to-REST Integration Engineer**. You specialize in mapping legacy SOAP web services to modern REST interfaces with minimal configuration.

## AI Safety & Consultation Guidelines

- **Clarification Requirement**: If you receive an instruction that is unclear, ambiguous, or lacks sufficient detail, you **must** stop and consult the user to clarify how to proceed before making any changes. Do not make assumptions.
- **Negative Impact Notification**: If you detect that a proposed change could negatively impact the system, database structure, security, performance, or backwards compatibility, you **must** notify the user with a detailed list of potential consequences and obtain their explicit approval before proceeding.
- **Testing Timeout Precaution**: When testing endpoints using the `execute_endpoint_test` tool, if the endpoint performs heavy operations (such as Puppeteer PDF generation, external HTTP requests, or intensive database/caching actions), you **must** set the `timeout_ms` parameter to `90000` (90 seconds) or more to prevent false-positive client-side gateway/network timeout errors.

## Core Instructions & Constraints
1.  **SOAP Configuration (`custom_data`)**: The `custom_data` object is the heart of the SOAP handler. It must contain:
    - `wsdl`: The absolute HTTP URL to the upstream WSDL service description.
      - *Example*: `http://www.dneonline.com/calculator.asmx?WSDL`
    - `functionName`: The exact SOAP operation name to invoke as defined in the WSDL (the WSDL **operation/port** name, not the XML body root element name). Use `"describe()": true` to discover it.
      - *Example*: `Add`
    - `endpoint` (Optional): URL that receives the actual SOAP envelopes. When omitted, the handler sends the request to the `soap:address location` embedded in the WSDL. Use it to override the runtime target (e.g. the WSDL is a local copy or a different environment).
    - `options` (Optional): Additional options for the `soap` Node.js library. This handler internally uses the npm package `soap` (specifically, `soap.createClient()`). Therefore, the `options` property accepts any native client configurations supported by the `soap` package (such as `request`, `forceSoap12Headers`, `valueKey`, `disableCache`, etc.). Refer to the official `soap` library documentation to configure advanced options correctly.
2.  **Input Parameters Mapping**:
    - The SOAP handler automatically reads the incoming HTTP request payload (POST body keys, or GET query fields) and maps them as arguments to the SOAP request body.
    - Precedence (highest first): endpoint config (`custom_data`/`code`) > request body > request query. The three are combined with a **deep merge**, not a replacement: the config wins on each key it defines, and the body and query still contribute every key the config does not mention. So a config of `{a: 1}` with a body of `{a: 2, b: 3}` sends `{a: 1, b: 3}` — the endpoint does not ignore unknown body fields, so do not rely on the config to filter what a caller may pass.
    - On GET, only query fields are mapped into `RequestArgs`, so `functionName` must be provided in the endpoint config.
    - Double check the expected uppercase/lowercase names of fields in the WSDL.
3.  **Response Conversion**:
    - The SOAP response XML is automatically converted to a clean JSON object structure before returning it to the client.
4.  **Service Description (`describe()`)**:
    - You can obtain a description of the SOAP services, ports, and methods as a JavaScript object.
    - To trigger this behavior, send `{"describe()": true}` in the request payload.
    - The response will be similar to:
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


## Common Payload Shape for Creation/Updates
When using `endpoint_upsert` with `handler: "SOAP"` to create/update an endpoint:
- `idapp`: UUID of the application.
- `resource`: HTTP resource path.
- `method`: HTTP Verb (usually `POST` or `GET`).
- `handler`: `SOAP`.
- `custom_data`: Object containing `wsdl`, `functionName`, and optional `endpoint`, `options`. When `custom_data.wsdl` is present the handler uses `custom_data` as the configuration and ignores `code`; otherwise the configuration is read from `code`. See "Core Instructions & Constraints" above for full details.

**Application Variables in SOAP**: an AppVar reference can be used in two ways:
1. The **whole** `code` field is the AppVar name (`$_VAR_SOAP_SERVICE_WSDL`) and the variable holds the entire JSON configuration. The handler only reads `code` when `custom_data.wsdl` is absent: if `custom_data` already carries a `wsdl`, it is used inline and `code` is ignored entirely. The AppVar value must be a JSON configuration object (it is parsed as JSON), not a bare WSDL URL string.
2. **Inside** the JSON configuration (from `code` or `custom_data`), at any depth: any string value that is exactly a `$_VAR_*` name is replaced by that variable's value at call time (e.g. `"BasicAuthSecurity": "$_VAR_SAP_PO_AUTH"`). A name that matches the pattern but does not exist in the endpoint's environment fails with `400`; values sent by the caller in query/body are never replaced.

Names must match `^\$_VAR_[A-Z0-9_]+$` and are validated on save — see the "Shared Application Variables Skill" section at the end of this document.

## Minimal Working Example / Template
* **Custom Data (`custom_data`)**:
```json
{
  "wsdl": "http://www.dneonline.com/calculator.asmx?WSDL",
  "functionName": "Add"
}
```
* **Request Payload (POST body)**:
```json
{
  "RequestArgs": {
    "intA": 5,
    "intB": 10
  }
}
```

---

If a SOAP call fails because the remote service returns HTML/text (port wrong, gateway error, missing endpoint), the handler responds with `502 Bad Gateway` and an English message that reveals the called URL, its source (`endpoint` or `soap:address`), the HTTP status/content-type, and a short preview of the response body. Network errors (`ECONNREFUSED`, timeouts) are captured with the same code. No message modifications are required by the agent; only verify the endpoint/port or WSDL address when this symptom appears.

# Shared Application Variables Skill

<!-- include: skills/APPVARS.md -->

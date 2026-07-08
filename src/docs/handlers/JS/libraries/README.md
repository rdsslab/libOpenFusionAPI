# JS Handler Libraries Index

Below is the index of available libraries and functions inside the JS handler VM sandbox.

| Library / Variable | Signature | Description | Recommended Use Case |
|---|---|---|---|
| [\$_CUSTOM_HEADERS_](./$_CUSTOM_HEADERS_.md) | `$_CUSTOM_HEADERS_` | Map of custom response headers to send together with $_RETURN_DATA_. | Set headers here before assigning binary or special response payloads to $_RETURN_DATA_. |
| [\$_ENV_](./$_ENV_.md) | `$_ENV_` | Current runtime environment (dev, qa, prd). | This variable is injected automatically based on the server environment and can be used for environment-specific logic in handlers. |
| [\$_EXCEPTION_](./$_EXCEPTION_.md) | `$_EXCEPTION_(message, [data], [statusCode])` | Interrupts the program flow and throws an exception with a specific message and status code. | - |
| [\$_RETURN_DATA_](./$_RETURN_DATA_.md) | `$_RETURN_DATA_` | Primary output slot for JS handlers. | Prefer assigning to $_RETURN_DATA_ over calling reply.send() directly unless you need low-level Fastify control. |
| [AbortController](./AbortController.md) | `AbortController()` | A controller object that allows you to abort one or more Web APIs (like fetch requests). | - |
| [Array](./Array.md) | `Array()` | Global Array constructor. | - |
| [Blob](./Blob.md) | `Blob()` | Global Blob constructor. | - |
| [Boolean](./Boolean.md) | `Boolean()` | Global Boolean constructor. | - |
| [Buffer](./Buffer.md) | `Buffer()` | Global Buffer constructor (Node. | - |
| [Date](./Date.md) | `Date()` | Constructor for creating and managing dates. | - |
| [FormData](./FormData.md) | `FormData()` | Global FormData constructor. | - |
| [JSON](./JSON.md) | `JSON` | A built-in object that contains methods for parsing JavaScript Object Notation (JSON) and converting values to JSON. | - |
| [Math](./Math.md) | `Math` | A built-in object that has properties and methods for mathematical constants and functions. | - |
| [Number](./Number.md) | `Number()` | Global Number constructor. | - |
| [Object](./Object.md) | `Object()` | Global Object constructor. | - |
| [OpenAI](./OpenAI.md) | `OpenAI` | Official OpenAI SDK for calling language, reasoning, and multimodal models from JS handlers. | Use this when the endpoint must call an external OpenAI model directly instead of delegating to another internal endpoint. |
| [Promise](./Promise.md) | `Promise()` | Global Promise constructor. | - |
| [PromiseSequence](./PromiseSequence.md) | `PromiseSequence` | Utility for processing async tasks sequentially or in controlled batches. | Use this when order matters or when downstream systems require throttled execution. |
| [RegExp](./RegExp.md) | `RegExp()` | Global RegExp constructor. | - |
| [String](./String.md) | `String()` | Global String constructor. | - |
| [askAIWithTools](./askAIWithTools.md) | `askAIWithTools(options.provider, [options.provider.provider|modelProvider|name|vendor], options.provider.model, [options.provider.baseUrl|baseURL], [options.provider.apiKey|api_key], [options.provider.azureApiKey|azure_api_key], [options.provider.apiVersion|api_version|api-version], [options.provider.clientName], [options.provider.clientVersion], [options.provider.defaultQuery|default_query], [options.provider.headers], [options.provider.temperature], [options.provider.maxTokens|max_tokens], [options.provider.toolChoice|tool_choice], [options.provider.timeout], [options.provider.responseTimeout|responseTimeoutMs|runTimeout], options.prompts, [options.mcpServers], [options.mcpServers[].name], options.mcpServers[].url, [options.mcpServers[].headers], [options.mcpServers[].timeout], [options.mcpServers[].transportPriority], [options.maxToolRounds], [options.includeDiagnostics], [options.signal])` | Generic AI helper that accepts a provider configuration, connects to the selected AI service, and optionally enables MCP tools from one or more MCP servers during the conversation. | Prefer this helper over askIAWithMCP for new work because it is provider-agnostic and easier to parameterize from request bodies or App Vars. |
| [askIAWithMCP](./askIAWithMCP.md) | `askIAWithMCP(options.ai, [options.ai.modelProvider], options.ai.model, [options.ai.baseUrl|baseURL], [options.ai.apiKey|api_key], [options.ai.azureApiKey|azure_api_key], [options.ai.apiVersion|api_version|api-version], [options.ai.defaultQuery|default_query], [options.ai.temperature], [options.ai.maxTokens|max_tokens], [options.ai.toolChoice|tool_choice], [options.ai.headers], [options.ai.organization], [options.ai.project], [options.ai.timeout], [options.ai.responseTimeout|responseTimeoutMs|runTimeout], options.prompts, [options.mcpServers], [options.mcpServers[].name], options.mcpServers[].url, [options.mcpServers[].headers], [options.mcpServers[].timeout], [options.mcpServers[].transportPriority], [options.maxToolRounds], [options.includeDiagnostics], [options.signal])` | Legacy compatibility wrapper over askAIWithTools. | Use this only when you must preserve the old `ai` field shape. Otherwise use askAIWithTools. |
| [askIAWithProviderMCP](./askIAWithProviderMCP.md) | `askIAWithProviderMCP(options.provider, [options.provider.provider|modelProvider|name|vendor], options.provider.model, [options.provider.baseUrl|baseURL], [options.provider.apiKey|api_key], [options.provider.azureApiKey|azure_api_key], [options.provider.apiVersion|api_version|api-version], [options.provider.temperature], [options.provider.maxTokens|max_tokens], [options.provider.toolChoice|tool_choice], [options.provider.timeout], [options.provider.responseTimeout|responseTimeoutMs|runTimeout], options.prompts, [options.mcpServers], [options.maxToolRounds], [options.includeDiagnostics], [options.signal])` | Primary provider-first AI helper for JS handlers. | Prefer this helper when you are writing new JS handler code and want the name to communicate clearly that both the provider and MCP servers are configurable inputs. |
| [clearInterval](./clearInterval.md) | `clearInterval()` | Cancels a timed, repeating action which was previously established by a call to setInterval(). | - |
| [clearTimeout](./clearTimeout.md) | `clearTimeout()` | Cancels a timeout previously established by calling setTimeout(). | - |
| [console](./console.md) | `console` | Provides access to the browser/runtime debugging console. | - |
| [createAIProviderMCPClient](./createAIProviderMCPClient.md) | `createAIProviderMCPClient(options.provider, [options.mcpServers])` | Low-level MCP-aware AI client factory. | Prefer askIAWithProviderMCP for normal one-shot AI+MCP calls. |
| [createImageFromHTML](./createImageFromHTML.md) | `createImageFromHTML([html], [url], [type], [quality], [fullPage])` | Renders HTML content or a URL into an image buffer. | Use this when the endpoint must return a screenshot-like image artifact generated on demand. |
| [createPDFFromHTML](./createPDFFromHTML.md) | `createPDFFromHTML([html], [url], [format], [landscape], [margin], [printBackground])` | Generates a PDF document from an HTML string or a URL. | Use this for report exports, tickets, or printable documents assembled inside the handler. |
| [crypto](./crypto.md) | `crypto` | Node. | - |
| [dnsPromises](./dnsPromises.md) | `dnsPromises` | The DNS module enables name resolution functions. | - |
| [forge](./forge.md) | `forge` | A native implementation of TLS (and various other cryptographic tools) in JavaScript. | - |
| [json_to_xlsx_buffer](./json_to_xlsx_buffer.md) | `json_to_xlsx_buffer([data])` | Builds an XLSX workbook in memory and returns the binary buffer plus download metadata. | If the endpoint should download a file, set $_CUSTOM_HEADERS_ from the returned metadata and assign only result.buffer to $_RETURN_DATA_. |
| [jwt](./jwt.md) | `jwt` | An implementation of JSON Web Tokens. | - |
| [listMcpTools](./listMcpTools.md) | `listMcpTools(options.mcpServers, [options.clientName], [options.clientVersion])` | Connects to one or more MCP servers and returns the discovered tools without running an AI conversation. | Use this for diagnostics, capability discovery, or to verify that a remote MCP server exposes the expected tools before calling askIAWithMCP. |
| [luxon](./luxon.md) | `luxon` | Friendly wrapper for JavaScript dates and times. | - |
| [mongoose](./mongoose.md) | `mongoose` | MongoDB ODM for defining schemas, models, and queries with validation support. | Prefer MONGODB handlers for direct data access endpoints; use mongoose in JS handlers when you need schema logic, orchestration, or mixed business rules. |
| [nodemailer](./nodemailer.md) | `nodemailer` | Nodemailer makes sending email from a Node. | The runtime wrapper strips mailOptions.envelope.size before sendMail() so untrusted request bodies cannot inject that SMTP parameter. |
| [ofapi](./ofapi.md) | `ofapi` | OpenFusionAPI runtime helpers exposed to JS handlers. | Use ofapi.throw when you need a structured HTTP error from JS handler code. |
| [parseFloat](./parseFloat.md) | `parseFloat()` | Parses a string argument and returns a floating point number. | - |
| [parseInt](./parseInt.md) | `parseInt()` | Parses a string argument and returns an integer of the specified radix. | - |
| [pdfjs](./pdfjs.md) | `pdfjs` | PDF parsing library for reading text, metadata, and page structure from PDF documents. | Use this when the endpoint must inspect uploaded or downloaded PDFs; do not use it for PDF generation workflows. |
| [reply](./reply.md) | `reply` | Fastify Reply object for low-level response control. | Use reply directly only when $_RETURN_DATA_ and $_CUSTOM_HEADERS_ are not enough for the desired response behavior. |
| [request](./request.md) | `request` | Fastify Request object with body, query, headers, params, and request metadata. | For GET endpoints, use request.query. For JSON POST endpoints, use request.body. |
| [request_xlsx_body_to_json](./request_xlsx_body_to_json.md) | `request_xlsx_body_to_json(request)` | Reads uploaded XLSX files from a multipart/form-data request and converts their sheets into JSON rows. | Use this helper only when the endpoint receives an uploaded spreadsheet; do not use it for plain JSON requests. |
| [sequelize](./sequelize.md) | `sequelize` | Sequelize is a modern TypeScript and Node. | Choose sequelize here only when you need transactions, model logic, or multi-step orchestration in JS instead of a single SQL statement. |
| [sequentialPromises](./sequentialPromises.md) | `sequentialPromises` | Legacy alias of PromiseSequence kept for backward compatibility. | Deprecated alias. Prefer PromiseSequence in new endpoint code. |
| [setTimeout](./setTimeout.md) | `setTimeout()` | Schedules execution of a one-time callback after delay milliseconds. | - |
| [uFetch](./uFetch.md) | `uFetch([constructor(url?, redirect_in_unauthorized?)], [request(url, method, data, headers, options)], [get|post|put|patch|delete({ url, data, headers, options })], [batch({ url, method, items, headers, options, config })], [batch_old(url, method, items, headers, options, config)])` | Universal HTTP client for Node. | For internal OpenFusionAPI endpoints in the same instance, prefer uFetchAutoEnv instead of hardcoding dev/qa/prd URLs. |
| [uFetchAutoEnv](./uFetchAutoEnv.md) | `uFetchAutoEnv([create(url, shouldApplyAuto = true)], [auto(url)])` | OpenFusionAPI helper that wraps uFetch for same-instance calls. | Prefer relative internal URLs such as /api/myapp/resource/auto instead of hardcoded localhost URLs. |
| [uuid](./uuid.md) | `uuid` | UUID package to generate RFC4122 UUIDs. | - |
| [xlsx](./xlsx.md) | `xlsx` | SheetJS Community Edition offers battle-tested open-source solutions for extracting useful data from almost any complex spreadsheet and generating new spreadsheets that will work with legacy and modern software alike. | Use xlsx when you need direct workbook/worksheet operations. Use json_to_xlsx_buffer when you only need a quick downloadable XLSX file. |
| [xlsx_style](./xlsx_style.md) | `xlsx_style` | Styled XLSX builder based on SheetJS, useful when the exported workbook needs fonts, fills, borders, or alignment. | Prefer xlsx_style over xlsx when presentation matters in the generated spreadsheet. |
| [xml2js](./xml2js.md) | `xml2js` | Simple XML to JavaScript object converter. | - |
| [xmlCrypto](./xmlCrypto.md) | `xmlCrypto` | It is a Node. | - |
| [xmlFormatter](./xmlFormatter.md) | `xmlFormatter` | Formats XML into a readable, pretty-printed string. | Useful for debugging SOAP/XML payloads before returning them or saving them to logs. |
| [xmldom](./xmldom.md) | `xmldom` | A JavaScript implementation of W3C DOM for Node. | - |
| [z](./z.md) | `z` | Zod schema builder and validator, exposed in the JS handler as the variable z. | The runtime key is z, even though the imported module is named Zod in this source file. |

> Auto-generated from `src/lib/server/generateDocs.js`.

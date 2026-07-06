# `askIAWithMCP(options.ai, [options.ai.modelProvider], options.ai.model, [options.ai.baseUrl|baseURL], [options.ai.apiKey|api_key], [options.ai.azureApiKey|azure_api_key], [options.ai.apiVersion|api_version|api-version], [options.ai.defaultQuery|default_query], [options.ai.temperature], [options.ai.maxTokens|max_tokens], [options.ai.toolChoice|tool_choice], [options.ai.headers], [options.ai.organization], [options.ai.project], [options.ai.timeout], [options.ai.responseTimeout|responseTimeoutMs|runTimeout], options.prompts, [options.mcpServers], [options.mcpServers[].name], options.mcpServers[].url, [options.mcpServers[].headers], [options.mcpServers[].timeout], [options.mcpServers[].transportPriority], [options.maxToolRounds], [options.includeDiagnostics], [options.signal])`

[External Documentation](https://github.com/rdsslab/libOpenFusionAPI) 

Legacy compatibility wrapper over askAIWithTools. It accepts `options.ai` instead of `options.provider`, then runs a chat completion and can connect the model to MCP servers so it can discover and invoke tools during the conversation.

**Notes**

- This helper is intended to be called from the JS handler. It is no longer tied to a dedicated handler.
- For new work, prefer askAIWithTools. This wrapper exists so older endpoints that already pass `ai` continue working without code changes.
- `askIAWithProviderMCP` is the clearer modern name when you want a provider-first function signature without the legacy `ai` wrapper field.
- The wrapper maps `options.ai` to the new generic `options.provider` contract internally.
- Built-in provider presets currently available in this repo are: `openai`, `openai-compatible`, `azure-openai` (alias `azure`), `ollama`, `anthropic` (alias `claude`), and `google-gemini` (aliases `google` and `gemini`).
- For local Ollama, a common config is `{ modelProvider: 'ollama', model: 'qwen2.5-coder:1.5b', baseUrl: 'http://localhost:11434', temperature: 0.1, timeout: 1800000, responseTimeout: 120000 }`.
- For Azure OpenAI, set `modelProvider: 'azure-openai'`, use the Azure OpenAI base URL, and provide `apiVersion` or `defaultQuery: { 'api-version': '...' }`.
- If `baseUrl` is present and `apiKey` is omitted, the helper injects a placeholder key so local OpenAI-compatible servers can still be called.
- Native Anthropic support is available through the `anthropic` or `claude` provider preset and requires an Anthropic API key plus a valid Anthropic model name.
- Native Google support is available through the `google`, `gemini`, or `google-gemini` provider preset and requires a Google GenAI API key or Vertex AI settings. If `model` is omitted there, the helper defaults to `gemini-2.5-flash`.
- `timeout` controls the provider client's HTTP timeout. `responseTimeout` or `runTimeout` can also be set when you want a hard deadline for the overall AI response wait.
- MCP tools are exposed to the model as OpenAI function tools. The helper will connect, list tools, execute tool calls, and continue the conversation until it reaches a final answer or the round limit.
- Prompt roles should normally be `system`, `user`, `assistant`, and the helper itself manages `tool` messages internally during tool rounds.
- For GET endpoints, prompt arrays usually arrive as a JSON string in `request.query.prompts`, so parse them before calling this helper.
- When the output looks inconsistent, enable `includeDiagnostics` and inspect `messages`, `tools`, and `toolExecutions` before assuming hidden state.

**Agent Guidance**

- Use this only when you must preserve the old `ai` field shape. Otherwise use askAIWithTools.
- If you are generating new handler code from scratch, prefer askIAWithProviderMCP or askAIWithTools instead of this legacy wrapper.
- Use this helper when the endpoint needs an AI response and may need tool access through one or more MCP servers.
- For plain OpenAI, use `modelProvider: 'openai'` with `apiKey` and an OpenAI model such as `gpt-4o-mini`.
- For custom OpenAI-compatible gateways, use `modelProvider: 'openai-compatible'` and set `baseUrl` explicitly.
- For Azure OpenAI, use `modelProvider: 'azure-openai'` or `azure`, set the deployment name in `model`, and provide `baseUrl` plus `apiVersion`.
- For Ollama, use `modelProvider: 'ollama'`, a local model name, and optionally a custom `baseUrl` if it is not running on the default host.
- For Anthropic, use `modelProvider: 'anthropic'` or `claude`, plus `apiKey` and a native Anthropic model name such as `claude-3-7-sonnet-latest`.
- For Google Gemini, use `modelProvider: 'google'`, `gemini`, or `google-gemini`, plus `apiKey` and a Gemini model such as `gemini-2.5-flash`.
- Use aliases intentionally: `azure` resolves to `azure-openai`, `claude` resolves to `anthropic`, and `google` or `gemini` resolve to `google-gemini`.
- Prefer passing prompts as structured messages when system or multi-turn context matters.
- If MCP capabilities are unknown, call `listMcpTools` first and only then call `askIAWithMCP` with the chosen servers.
- For JS endpoints that rely on Application Variables, prefer `$_APP_VARS_['$_VAR_NAME']` in generated code because it is explicit and avoids scope-name ambiguity.
- If the task is informational, provide only read-only MCP servers or read-only tools when possible.

**Parameters**

*   `options.ai` <object> AI provider configuration. Must include at least `model`. Built-in presets currently available in this repo are `openai`, `openai-compatible`, `azure-openai`, `ollama`, `anthropic`, `claude`, `google`, `gemini`, and `google-gemini`.
*   `options.ai.modelProvider` <string> **Optional**. Provider preset selector. Supported values are `openai`, `openai-compatible`, `azure-openai`, `azure`, `ollama`, `anthropic`, `claude`, `google`, `gemini`, and `google-gemini`.
*   `options.ai.model` <string> Exact model name to invoke. This field is required.
*   `options.ai.baseUrl|baseURL` <string> **Optional**. Optional OpenAI-compatible base URL. Example: `http://localhost:11434` for Ollama. For Azure OpenAI, use the Azure resource OpenAI path such as `https://your-resource.openai.azure.com/openai` or the matching `cognitiveservices.azure.com/openai` endpoint.
*   `options.ai.apiKey|api_key` <string> **Optional**. Provider API key when required. If omitted and `baseUrl` is present, the helper uses a placeholder key for local OpenAI-compatible servers.
*   `options.ai.azureApiKey|azure_api_key` <string> **Optional**. Optional Azure OpenAI API key. When present, the helper also injects it into the `api-key` header expected by Azure OpenAI.
*   `options.ai.apiVersion|api_version|api-version` <string> **Optional**. Optional Azure OpenAI API version. When provided, the helper sends it as `defaultQuery['api-version']`.
*   `options.ai.defaultQuery|default_query` <object> **Optional**. Optional default query parameters passed to the AI provider HTTP client. This is especially useful for Azure OpenAI preview versions.
*   `options.ai.temperature` <number> **Optional**. Sampling temperature sent to the provider.
*   `options.ai.maxTokens|max_tokens` <integer> **Optional**. Maximum output tokens for the completion.
*   `options.ai.toolChoice|tool_choice` <string|object> **Optional**. Optional tool selection policy passed to the provider when MCP tools are available.
*   `options.ai.headers` <object> **Optional**. Optional extra HTTP headers sent to the AI provider.
*   `options.ai.organization` <string> **Optional**. Optional provider organization identifier.
*   `options.ai.project` <string> **Optional**. Optional provider project identifier.
*   `options.ai.timeout` <integer> **Optional**. Default: `60000`. HTTP timeout in milliseconds for provider requests.
*   `options.ai.responseTimeout|responseTimeoutMs|runTimeout` <integer> **Optional**. Optional overall wait timeout in milliseconds for the AI response cycle. Unlike `timeout`, this aborts the helper run even if the provider SDK itself does not stop promptly.
*   `options.prompts` <string|array> Prompt input. Accepts a string, an array of strings, or an array of chat messages like `{ role, content }`. Structured messages are preferred when system instructions or multi-turn context matter.
*   `options.mcpServers` <array<object>> **Optional**. Default: ``. Optional MCP server definitions. Each item can include `name`, `url`, `headers`, `timeout`, and `transportPriority`.
*   `options.mcpServers[].name` <string> **Optional**. Friendly MCP server name used in diagnostics and tool aliases.
*   `options.mcpServers[].url` <string> HTTP endpoint of the MCP server. Required for each server entry.
*   `options.mcpServers[].headers` <object> **Optional**. Optional headers for authenticating against the MCP server.
*   `options.mcpServers[].timeout` <integer> **Optional**. Optional timeout in milliseconds for fallback RPC requests.
*   `options.mcpServers[].transportPriority` <array<string>> **Optional**. Optional ordered list of transport strategies, typically `['streamable-http', 'legacy-sse-http']`.
*   `options.maxToolRounds` <integer> **Optional**. Default: `6`. Maximum number of tool-execution rounds before forcing a final answer.
*   `options.includeDiagnostics` <boolean> **Optional**. When true, returns execution metadata including tool calls, messages, and resolved MCP server info.
*   `options.signal` <AbortSignal> **Optional**. Optional AbortSignal used to cancel the provider request.

*   Returns: <string|object> Returns the assistant text by default. When `includeDiagnostics` is true, returns an object with `text`, `provider`, `model`, `messages`, `tools`, `toolExecutions`, and `mcpServers`.

#### Example

```javascript

const result = await askIAWithMCP({
  ai: {
    modelProvider: 'ollama',
    model: 'qwen2.5-coder:1.5b',
    baseUrl: 'http://localhost:11434',
    temperature: 0.1,
    timeout: 1800000,
    responseTimeout: 120000,
  },
  mcpServers: [
    {
      name: 'openfusion_system_remote_prd',
      url: 'https://example.com/api/system/mcp/server/prd',
    },
  ],
  prompts: [
    {
      role: 'user',
      content: 'List the available applications using MCP tools if needed.',
    },
  ],
  includeDiagnostics: true,
});

$_RETURN_DATA_ = result;
// Azure OpenAI example
const result = await askIAWithMCP({
  ai: {
    modelProvider: 'azure-openai',
    model: 'gpt-4o-mini',
    baseUrl: 'https://diegomperezcentralus-resource.cognitiveservices.azure.com/openai',
    apiVersion: '2025-01-01-preview',
    azureApiKey: $_APP_VARS_['$_VAR_AZURE_OPENAI_API_KEY'],
    timeout: 1800000,
    responseTimeout: 120000,
  },
  prompts: [
    {
      role: 'user',
      content: 'Hola',
    },
  ],
});

$_RETURN_DATA_ = result;

// Native Anthropic example
const anthropicResult = await askIAWithMCP({
  ai: {
    modelProvider: 'anthropic',
    model: 'claude-3-7-sonnet-latest',
    apiKey: $_APP_VARS_['$_VAR_ANTHROPIC_API_KEY'],
    responseTimeout: 120000,
  },
  prompts: [{ role: 'user', content: 'Hola desde Anthropic' }],
});

$_RETURN_DATA_ = anthropicResult;

// Google Gemini example
const geminiResult = await askIAWithMCP({
  ai: {
    modelProvider: 'gemini',
    model: 'gemini-2.5-flash',
    apiKey: $_APP_VARS_['$_VAR_GOOGLE_GENAI_API_KEY'],
    responseTimeout: 120000,
  },
  prompts: [{ role: 'user', content: 'Hola desde Gemini' }],
});

$_RETURN_DATA_ = geminiResult;
      
```


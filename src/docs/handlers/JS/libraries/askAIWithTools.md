# `askAIWithTools(options.provider, [options.provider.provider|modelProvider|name|vendor], options.provider.model, [options.provider.baseUrl|baseURL], [options.provider.apiKey|api_key], [options.provider.azureApiKey|azure_api_key], [options.provider.apiVersion|api_version|api-version], [options.provider.clientName], [options.provider.clientVersion], [options.provider.defaultQuery|default_query], [options.provider.headers], [options.provider.temperature], [options.provider.maxTokens|max_tokens], [options.provider.toolChoice|tool_choice], [options.provider.timeout], [options.provider.responseTimeout|responseTimeoutMs|runTimeout], options.prompts, [options.mcpServers], [options.mcpServers[].name], options.mcpServers[].url, [options.mcpServers[].headers], [options.mcpServers[].timeout], [options.mcpServers[].transportPriority], [options.maxToolRounds], [options.includeDiagnostics], [options.signal])`

[External Documentation](https://github.com/rdsslab/libOpenFusionAPI) 

Generic AI helper that accepts a provider configuration, connects to the selected AI service, and optionally enables MCP tools from one or more MCP servers during the conversation.

**Notes**

- This helper is the recommended entry point for new JS endpoints that must be configurable across multiple AI providers.
- `askIAWithProviderMCP` is the equally capable provider-first alias when you want the function name itself to emphasize MCP-enabled provider execution.
- The minimum valid call is `provider.model + prompts`. In practice, most remote providers also need an API key.
- Built-in provider presets currently available in this repo are: `openai`, `openai-compatible`, `azure-openai` (alias `azure`), `ollama`, `anthropic` (alias `claude`), and `google-gemini` (aliases `google` and `gemini`).
- `openai` and `openai-compatible` use the OpenAI Chat Completions shape. Use `openai-compatible` when routing to a custom compatible base URL.
- Azure OpenAI uses the SDK Azure client path internally, including `api-version` handling and deployment-aware routes.
- Local Ollama can be called without a real API key because the helper injects a placeholder key when a base URL is present and no key is provided.
- Native Anthropic support is available through the `anthropic` or `claude` provider preset and requires an Anthropic API key plus a valid Anthropic model name.
- Native Google support is available through the `google`, `gemini`, or `google-gemini` provider preset and requires a Google GenAI API key or Vertex AI settings. If `model` is omitted there, the helper defaults to `gemini-2.5-flash`.
- `timeout` controls the provider client's HTTP timeout. `responseTimeout` or `runTimeout` can also be set when you want a hard deadline for the overall AI response wait.
- If you pass MCP servers, the helper will prepend a system instruction that explains the available tools and their mutating vs read-only intent.
- MCP tools are exposed to the model as OpenAI function tools. The helper connects, lists tools, executes tool calls, and continues the conversation until it reaches a final answer or the round limit.

**Agent Guidance**

- Prefer this helper over askIAWithMCP for new work because it is provider-agnostic and easier to parameterize from request bodies or App Vars.
- Use askIAWithProviderMCP when you want the function name to make it obvious that both the provider and MCP servers are first-class inputs.
- Always provide `provider.model`. Also provide `provider.provider` when you want a known preset to resolve base URL and behavior automatically.
- For plain OpenAI, use `provider: 'openai'` with `apiKey` and optionally override `baseUrl` when you are not using the default OpenAI endpoint.
- For custom OpenAI-compatible gateways or self-hosted providers, use `provider: 'openai-compatible'` and set `baseUrl`.
- For Azure OpenAI, provide `provider: 'azure-openai'`, the deployment name in `model`, the Azure OpenAI base URL, and `apiVersion`.
- For Ollama, provide `provider: 'ollama'`, a local model name, and optionally a custom `baseUrl` if it is not running on the default host.
- For Anthropic, provide `provider: 'anthropic'` or `provider: 'claude'`, plus `apiKey` and a native Anthropic model name such as `claude-3-7-sonnet-latest`.
- For Google Gemini, provide `provider: 'google'`, `provider: 'gemini'`, or `provider: 'google-gemini'`, plus `apiKey` and a Gemini model such as `gemini-2.5-flash`.
- Use the preset aliases intentionally: `azure` resolves to `azure-openai`, `claude` resolves to `anthropic`, and `google` or `gemini` resolve to `google-gemini`.
- If MCP capabilities are unknown, call listMcpTools first and only then call askAIWithTools with the selected servers.
- Store provider defaults and API keys in Application Variables whenever possible instead of hardcoding them into endpoint code.
- When generating endpoint code, prefer one canonical request body shape and document it explicitly in the endpoint JSON schema.
- If the task is informational, provide only read-only MCP servers or read-only tools when possible.

**Parameters**

*   `options.provider` <object> Provider configuration. Must include at least `model`. Built-in presets currently available in this repo are `openai`, `openai-compatible`, `azure-openai`, `ollama`, `anthropic`, `claude`, `google`, `gemini`, and `google-gemini`.
*   `options.provider.provider|modelProvider|name|vendor` <string> **Optional**. Provider preset selector. Supported values are `openai`, `openai-compatible`, `azure-openai`, `azure`, `ollama`, `anthropic`, `claude`, `google`, `gemini`, and `google-gemini`. If omitted, the helper assumes `openai-compatible`.
*   `options.provider.model` <string> Exact model or deployment name to invoke. This field is always required. For Azure OpenAI, pass the deployment name here.
*   `options.provider.baseUrl|baseURL` <string> **Optional**. Optional provider base URL override. If omitted, the helper uses the preset default when available. Use this when routing through a gateway or a custom OpenAI-compatible endpoint.
*   `options.provider.apiKey|api_key` <string> **Optional**. Provider API key for OpenAI-compatible providers. Required unless the selected provider is local and works with a placeholder key, such as Ollama.
*   `options.provider.azureApiKey|azure_api_key` <string> **Optional**. Azure OpenAI API key when using the Azure provider preset.
*   `options.provider.apiVersion|api_version|api-version` <string> **Optional**. Azure OpenAI API version. This is recommended when the provider is Azure OpenAI.
*   `options.provider.clientName` <string> **Optional**. Optional MCP client name used while connecting to MCP servers.
*   `options.provider.clientVersion` <string> **Optional**. Optional MCP client version used while connecting to MCP servers.
*   `options.provider.defaultQuery|default_query` <object> **Optional**. Optional default query parameters passed to the AI provider client.
*   `options.provider.headers` <object> **Optional**. Optional extra HTTP headers sent to the AI provider.
*   `options.provider.temperature` <number> **Optional**. Sampling temperature sent to the provider.
*   `options.provider.maxTokens|max_tokens` <integer> **Optional**. Maximum output tokens for the completion.
*   `options.provider.toolChoice|tool_choice` <string|object> **Optional**. Optional tool selection policy passed to the provider when MCP tools are available.
*   `options.provider.timeout` <integer> **Optional**. Default: `60000`. HTTP timeout in milliseconds for provider requests.
*   `options.provider.responseTimeout|responseTimeoutMs|runTimeout` <integer> **Optional**. Optional overall wait timeout in milliseconds for the AI response cycle. Unlike `timeout`, this aborts the helper run even if the provider SDK itself does not stop promptly.
*   `options.prompts` <string|array> Prompt input. Accepts a string, an array of strings, or an array of structured chat messages like `{ role, content }`.
*   `options.mcpServers` <array<object>> **Optional**. Default: ``. Optional MCP server definitions. Each item can include `name`, `url`, `headers`, `timeout`, and `transportPriority`.
*   `options.mcpServers[].name` <string> **Optional**. Friendly MCP server name used in diagnostics and generated tool aliases.
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

const body = request.body || {};

// Canonical request body shape:
// {
//   provider: {
//     provider: 'openai-compatible',
//     model: 'gpt-4o-mini',
//     apiKey: '...optional if preset is local...',
//     baseUrl: '...optional override...',
//     temperature: 0.1,
//     timeout: 1800000,
//     responseTimeout: 120000
//   },
//   mcpServers: [{ name, url, headers?, timeout?, transportPriority? }],
//   prompts: [{ role, content }],
//   includeDiagnostics: true,
//   maxToolRounds: 6
// }

if (!body.provider?.model) {
  $_EXCEPTION_('The request body must include provider.model.', { body }, 400);
}

if (!(body.prompts ?? body.prompt ?? body.messages)) {
  $_EXCEPTION_('The request body must include prompts, prompt, or messages.', { body }, 400);
}

const result = await askAIWithTools({
  provider: {
    provider: body.provider?.provider ?? 'openai-compatible',
    model: body.provider?.model ?? 'gpt-4o-mini',
    apiKey: body.provider?.apiKey ?? $_APP_VARS_['$_VAR_AI_API_KEY'],
    baseUrl: body.provider?.baseUrl,
    temperature: body.provider?.temperature ?? 0.1,
    timeout: body.provider?.timeout ?? 1800000,
    responseTimeout: body.provider?.responseTimeout ?? body.provider?.responseTimeoutMs ?? body.provider?.runTimeout ?? 120000,
  },
  mcpServers: Array.isArray(body.mcpServers) ? body.mcpServers : [],
  prompts: body.prompts ?? body.prompt ?? body.messages,
  includeDiagnostics: body.includeDiagnostics ?? true,
  maxToolRounds: body.maxToolRounds ?? 6,
});

$_RETURN_DATA_ = result;

// Azure OpenAI example
const azureResult = await askAIWithTools({
  provider: {
    provider: 'azure-openai',
    model: 'gpt-4o-mini',
    baseUrl: 'https://your-resource.cognitiveservices.azure.com/openai',
    apiVersion: '2025-01-01-preview',
    azureApiKey: $_APP_VARS_['$_VAR_AZURE_OPENAI_API_KEY'],
  },
  prompts: [{ role: 'user', content: 'Hola' }],
});

// Native OpenAI example
const openAIResult = await askAIWithTools({
  provider: {
    provider: 'openai',
    model: 'gpt-4o-mini',
    apiKey: $_APP_VARS_['$_VAR_OPENAI_API_KEY'],
    responseTimeout: 120000,
  },
  prompts: [{ role: 'user', content: 'Hola desde OpenAI' }],
});

// Ollama example
const ollamaResult = await askAIWithTools({
  provider: {
    provider: 'ollama',
    model: 'qwen2.5-coder:1.5b',
    baseUrl: 'http://localhost:11434',
    temperature: 0.1,
    timeout: 1800000,
    responseTimeout: 120000,
  },
  prompts: [{ role: 'user', content: 'Hola desde Ollama' }],
});

// Native Anthropic example
const claudeResult = await askAIWithTools({
  provider: {
    provider: 'claude',
    model: 'claude-3-7-sonnet-latest',
    apiKey: $_APP_VARS_['$_VAR_ANTHROPIC_API_KEY'],
    responseTimeout: 120000,
  },
  prompts: [{ role: 'user', content: 'Hola desde Claude nativo' }],
});

// Google Gemini example
const geminiResult = await askAIWithTools({
  provider: {
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    apiKey: $_APP_VARS_['$_VAR_GOOGLE_GENAI_API_KEY'],
    responseTimeout: 120000,
  },
  prompts: [{ role: 'user', content: 'Hola desde Gemini' }],
});
      
```


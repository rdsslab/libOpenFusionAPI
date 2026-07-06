# `askIAWithProviderMCP(options.provider, [options.provider.provider|modelProvider|name|vendor], options.provider.model, [options.provider.baseUrl|baseURL], [options.provider.apiKey|api_key], [options.provider.azureApiKey|azure_api_key], [options.provider.apiVersion|api_version|api-version], [options.provider.temperature], [options.provider.maxTokens|max_tokens], [options.provider.toolChoice|tool_choice], [options.provider.timeout], [options.provider.responseTimeout|responseTimeoutMs|runTimeout], options.prompts, [options.mcpServers], [options.maxToolRounds], [options.includeDiagnostics], [options.signal])`

[External Documentation](https://github.com/rdsslab/libOpenFusionAPI) 

Primary provider-first AI helper for JS handlers. It accepts `options.provider`, can connect to one or more MCP servers, exposes those tools to the model, executes tool calls, and returns either the final text or rich diagnostics.

**Notes**

- This is the canonical provider-first helper in `ia.js`. Use it when you want the function name itself to make the provider+MCP contract explicit.
- It shares the same runtime behavior as `askAIWithTools`; the difference is naming and intent clarity, not capability.
- If you do not need MCP, you can still call this helper with only `provider + prompts`.
- If you do need MCP, pass `mcpServers` and the helper will discover tools, expose them to the model, execute them, and continue until the model returns a final answer or the round limit is reached.
- Use `includeDiagnostics` when you need to inspect `toolExecutions` or message flow before changing prompts or provider settings.
- Use `responseTimeout` or `runTimeout` when you need a hard deadline for the overall AI wait, especially with slower local or remote providers.

**Agent Guidance**

- Prefer this helper when you are writing new JS handler code and want the name to communicate clearly that both the provider and MCP servers are configurable inputs.
- Use `askAIWithTools` interchangeably only when brevity matters. Treat both functions as the same runtime capability.
- Use `askIAWithMCP` only when you must preserve legacy payloads that already send `ai` instead of `provider`.
- If the provider is unknown or controlled by request/App Vars, this helper is usually the clearest option for generated endpoint code.
- If MCP capabilities are unknown, call `listMcpTools` first and then call this helper with the selected MCP servers.
- If the task is informational, prefer read-only MCP servers or read-only tools and keep `maxToolRounds` low unless the workflow genuinely needs multiple tool steps.

**Parameters**

*   `options.provider` <object> Provider configuration. Must include at least `model`. Built-in presets currently available in this repo are `openai`, `openai-compatible`, `azure-openai`, `ollama`, `anthropic`, `claude`, `google`, `gemini`, and `google-gemini`.
*   `options.provider.provider|modelProvider|name|vendor` <string> **Optional**. Provider preset selector. Supported values are `openai`, `openai-compatible`, `azure-openai`, `azure`, `ollama`, `anthropic`, `claude`, `google`, `gemini`, and `google-gemini`. If omitted, the helper assumes `openai-compatible`.
*   `options.provider.model` <string> Exact model or deployment name to invoke. This field is always required. For Azure OpenAI, pass the deployment name here.
*   `options.provider.baseUrl|baseURL` <string> **Optional**. Optional provider base URL override. Use this for custom OpenAI-compatible hosts, Ollama, or Azure OpenAI resource paths.
*   `options.provider.apiKey|api_key` <string> **Optional**. Provider API key for OpenAI-compatible or native providers when required. Local Ollama can work without a real key when `baseUrl` is set.
*   `options.provider.azureApiKey|azure_api_key` <string> **Optional**. Azure OpenAI API key when using the Azure provider preset.
*   `options.provider.apiVersion|api_version|api-version` <string> **Optional**. Azure OpenAI API version. Recommended whenever the provider is Azure OpenAI.
*   `options.provider.temperature` <number> **Optional**. Sampling temperature sent to the provider.
*   `options.provider.maxTokens|max_tokens` <integer> **Optional**. Maximum output tokens for the completion.
*   `options.provider.toolChoice|tool_choice` <string|object> **Optional**. Optional tool selection policy passed to the provider when MCP tools are available.
*   `options.provider.timeout` <integer> **Optional**. Default: `60000`. HTTP timeout in milliseconds for provider requests.
*   `options.provider.responseTimeout|responseTimeoutMs|runTimeout` <integer> **Optional**. Optional overall wait timeout in milliseconds for the AI response cycle. Unlike `timeout`, this aborts the helper run even if the provider SDK itself does not stop promptly.
*   `options.prompts` <string|array> Prompt input. Accepts a string, an array of strings, or an array of structured chat messages like `{ role, content }`.
*   `options.mcpServers` <array<object>> **Optional**. Default: ``. Optional MCP server definitions. Each item can include `name`, `url`, `headers`, `timeout`, and `transportPriority`.
*   `options.maxToolRounds` <integer> **Optional**. Default: `6`. Maximum number of tool-execution rounds before forcing a final answer.
*   `options.includeDiagnostics` <boolean> **Optional**. When true, returns execution metadata including tool calls, messages, and resolved MCP server info.
*   `options.signal` <AbortSignal> **Optional**. Optional AbortSignal used to cancel the provider request.

*   Returns: <string|object> Returns the assistant text by default. When `includeDiagnostics` is true, returns an object with `text`, `provider`, `model`, `messages`, `toolExecutions`, and `mcpServers`.

#### Example

```javascript

const result = await askIAWithProviderMCP({
  provider: {
    provider: 'azure-openai',
    model: 'gpt-4o-mini',
    baseUrl: 'https://your-resource.cognitiveservices.azure.com/openai',
    apiVersion: '2025-01-01-preview',
    azureApiKey: $_APP_VARS_['$_VAR_AZURE_OPENAI_API_KEY'],
    responseTimeout: 120000,
  },
  mcpServers: [
    {
      name: 'exa',
      url: 'https://mcp.exa.ai/mcp',
    },
  ],
  prompts: [
    {
      role: 'user',
      content: 'Use MCP if needed and answer with the official Exa MCP page title only.',
    },
  ],
  includeDiagnostics: true,
  maxToolRounds: 4,
});

$_RETURN_DATA_ = result;
      
```


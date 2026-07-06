# `createAIProviderMCPClient(options.provider, [options.mcpServers])`

[External Documentation](https://github.com/rdsslab/libOpenFusionAPI) 

Low-level MCP-aware AI client factory. Use this when you need explicit connect/list/run/close control instead of a single helper call.

**Notes**

- This is for advanced handler logic such as custom retries, preflight tool inspection, or manual MCP fallback execution.
- Always close the client in a finally block to release MCP transports cleanly.

**Agent Guidance**

- Prefer askIAWithProviderMCP for normal one-shot AI+MCP calls.
- Use this client only when the handler must inspect tool catalogs, retry with custom logic, or execute a fallback flow after a model fails to use tools correctly.

**Parameters**

*   `options.provider` <object> Provider configuration with the same shape accepted by askIAWithProviderMCP.
*   `options.mcpServers` <array<object>> **Optional**. Default: ``. MCP server list to connect before running or listing tools.

*   Returns: <AIProviderMCPClient> Client instance with connect(), listTools(), run(), close(), and runtime access for advanced flows.

#### Example

```javascript

const client = createAIProviderMCPClient({
  provider: {
    provider: 'ollama',
    model: 'qwen2.5-coder:1.5b',
    baseUrl: 'http://localhost:11434',
  },
  mcpServers: [{ name: 'exa', url: 'https://mcp.exa.ai/mcp' }],
});

try {
  await client.connect();
  const tools = await client.listTools();
  const result = await client.run({
    prompts: [{ role: 'user', content: 'Usa MCP si hace falta.' }],
    includeDiagnostics: true,
  });

  $_RETURN_DATA_ = { tools, result };
} finally {
  await client.close();
}
      
```


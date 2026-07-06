# `listMcpTools(options.mcpServers, [options.clientName], [options.clientVersion])`

[External Documentation](https://github.com/rdsslab/libOpenFusionAPI) 

Connects to one or more MCP servers and returns the discovered tools without running an AI conversation.

**Notes**

- Use this for diagnostics, capability discovery, or to verify that a remote MCP server exposes the expected tools before calling askIAWithMCP.

**Parameters**

*   `options.mcpServers` <array<object>> List of MCP server definitions to inspect.
*   `options.clientName` <string> **Optional**. Optional MCP client name used during connection.
*   `options.clientVersion` <string> **Optional**. Optional MCP client version used during connection.

*   Returns: Array of MCP server descriptors with their resolved tool list.

#### Example

```javascript

const tools = await listMcpTools({
  mcpServers: [
    {
      name: 'openfusion_system_remote_prd',
      url: 'https://example.com/api/system/mcp/server/prd',
    },
  ],
});

$_RETURN_DATA_ = tools;
      
```


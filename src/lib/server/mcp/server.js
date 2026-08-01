import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { jsonSchemaToZod } from "./utils.js";
import {version} from "../version.js";

function getServer() {
  // Create an MCP server
  const server = new McpServer({
    name: "OpenFusionAPI MCP Server",
    version: version,
  });

  /*
  // Add an addition tool
  server.registerTool(
    "add",
    {
      title: "Addition Tool",
      description: "Add two numbers",
      inputSchema: {
        a: z.number().describe("First number"),
        b: z.number().describe("Second number"),
      },
    },
    async ({ a, b }) => ({
      content: [{ type: "text", text: String(a + b) }],
    })
  );
  */

  return server;
}

export {
  getServer,
  StdioServerTransport,
  StreamableHTTPServerTransport,
  jsonSchemaToZod,
};

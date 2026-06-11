import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerShoplineTools } from "./tools/register.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "shopline-mcp-server",
    version: "1.0.0",
  });
  registerShoplineTools(server);
  return server;
}

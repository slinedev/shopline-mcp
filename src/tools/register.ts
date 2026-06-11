import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { toolSpecs } from "../generated/toolSpecs.js";
import { buildInputSchema } from "../schemas.js";
import { toToolError, toToolResult } from "../shared/helpers.js";
import type { ToolSpec } from "../types.js";
import { customHandlers } from "./custom.js";
import { executeGenericTool } from "./generic.js";

export const SHOPLINE_TOOL_SPECS: readonly ToolSpec[] = toolSpecs as readonly ToolSpec[];

async function executeTool(spec: ToolSpec, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const custom = customHandlers[spec.name];
  if (custom) return custom(args);
  return executeGenericTool({ spec, args });
}

export function registerShoplineTools(server: McpServer): void {
  for (const spec of SHOPLINE_TOOL_SPECS) {
    server.registerTool(
      spec.name,
      {
        title: spec.name,
        description: spec.description,
        inputSchema: buildInputSchema(spec.params),
        annotations: spec.write
          ? {
              readOnlyHint: false,
              destructiveHint: true,
              idempotentHint: false,
              openWorldHint: true,
            }
          : {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
      },
      async (args) => {
        try {
          const output = await executeTool(spec, args as Record<string, unknown>);
          return toToolResult(output);
        } catch (error) {
          return toToolError(error);
        }
      },
    );
  }
}

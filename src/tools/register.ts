import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { withShoplineStore } from "../config.js";
import { toolSpecs } from "../generated/toolSpecs.js";
import { buildToolInputSchema } from "../schemas.js";
import { toToolError, toToolResult } from "../shared/helpers.js";
import type { ToolSpec } from "../types.js";
import { registerAssistantTools } from "./assistant.js";
import { customHandlers } from "./custom.js";
import { executeGenericTool } from "./generic.js";
import { assertWriteApproved, buildWritePreview } from "./operationPlan.js";

export const SHOPLINE_TOOL_SPECS: readonly ToolSpec[] = toolSpecs as readonly ToolSpec[];

async function executeTool(spec: ToolSpec, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (spec.write && args.dry_run === true) return buildWritePreview(spec, args);
  if (spec.write) assertWriteApproved(spec, args);
  const custom = customHandlers[spec.name];
  if (custom) return custom(args);
  return executeGenericTool({ spec, args });
}

export function registerShoplineTools(server: McpServer): void {
  registerAssistantTools(server);

  for (const spec of SHOPLINE_TOOL_SPECS) {
    server.registerTool(
      spec.name,
      {
        title: spec.name,
        description: spec.description,
        inputSchema: buildToolInputSchema(spec.params, { write: spec.write }),
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
          const toolArgs = args as Record<string, unknown>;
          const output = await withShoplineStore(toolArgs.store_alias, async () => executeTool(spec, toolArgs));
          return toToolResult(output);
        } catch (error) {
          return toToolError(error);
        }
      },
    );
  }
}

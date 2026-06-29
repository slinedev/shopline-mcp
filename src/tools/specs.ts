import { toolSpecs } from "../generated/toolSpecs.js";
import type { ToolSpec } from "../types.js";
import { v14ToolSpecs } from "../v14/toolSpecs.js";

export const SHOPLINE_TOOL_SPECS: readonly ToolSpec[] = toolSpecs as readonly ToolSpec[];
export const V14_TOOL_SPECS: readonly ToolSpec[] = v14ToolSpecs;
export const ALL_SHOPLINE_TOOL_SPECS: readonly ToolSpec[] = [...SHOPLINE_TOOL_SPECS, ...V14_TOOL_SPECS];

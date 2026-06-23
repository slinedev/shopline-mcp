import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ENDPOINTS } from "../src/config.js";
import { customHandlers } from "../src/tools/custom.js";
import { SHOPLINE_TOOL_SPECS } from "../src/tools/register.js";
import type { ParamSpec, ToolSpec } from "../src/types.js";

interface PythonBaseline {
  readonly toolCount: number;
  readonly readCount: number;
  readonly writeCount: number;
  readonly tools: readonly PythonTool[];
}

interface PythonTool {
  readonly name: string;
  readonly module: string;
  readonly write: boolean;
  readonly description: string;
  readonly params: readonly PythonParam[];
  readonly docEndpoints: readonly { method: string; path: string }[];
}

interface PythonParam {
  readonly name: string;
  readonly kind: string;
  readonly optional: boolean;
  readonly hasDefault: boolean;
  readonly default: unknown;
  readonly description: string;
  readonly enum?: readonly string[];
}

const baseline = JSON.parse(readFileSync("tests/fixtures/python-tool-baseline.json", "utf8")) as PythonBaseline;

function byName<T extends { readonly name: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.name, item]));
}

function normalizeParam(param: ParamSpec | PythonParam) {
  return {
    name: param.name,
    kind: param.kind,
    optional: param.optional,
    hasDefault: param.hasDefault,
    default: param.default,
    description: param.description,
    enum: "enum" in param ? param.enum : undefined,
  };
}

describe("Python parity baseline", () => {
  it("keeps the full Python tool surface intact", () => {
    const specsByName = byName(SHOPLINE_TOOL_SPECS);
    const baselineByName = byName(baseline.tools);

    expect(SHOPLINE_TOOL_SPECS).toHaveLength(baseline.toolCount);
    expect(SHOPLINE_TOOL_SPECS.filter((tool) => !tool.write)).toHaveLength(baseline.readCount);
    expect(SHOPLINE_TOOL_SPECS.filter((tool) => tool.write)).toHaveLength(baseline.writeCount);
    expect([...specsByName.keys()].sort()).toEqual([...baselineByName.keys()].sort());

    for (const pythonTool of baseline.tools) {
      const spec = specsByName.get(pythonTool.name);
      expect(spec, pythonTool.name).toBeDefined();
      expect(spec?.module).toBe(pythonTool.module);
      expect(spec?.write).toBe(pythonTool.write);
      expect(spec?.description).toBe(pythonTool.description);
      expect(spec?.params.map(normalizeParam)).toEqual(pythonTool.params.map(normalizeParam));
      expect(spec?.docEndpoints).toEqual(pythonTool.docEndpoints);
    }
  });

  it("keeps every write tool executable through metadata or an explicit custom handler", () => {
    const missingExecutionPath = SHOPLINE_TOOL_SPECS.filter((tool: ToolSpec) => {
      if (!tool.write) return false;
      if (customHandlers[tool.name]) return false;
      return tool.operations.length === 0 || tool.operations.some((operation) => !ENDPOINTS[operation.endpointKey]);
    }).map((tool) => tool.name);

    expect(missingExecutionPath).toEqual([]);
  });
});

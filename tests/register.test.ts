import { describe, expect, it } from "vitest";

import { SHOPLINE_TOOL_SPECS } from "../src/tools/register.js";

describe("tool registration metadata", () => {
  it("keeps the Python baseline tool count and read/write split", () => {
    expect(SHOPLINE_TOOL_SPECS).toHaveLength(143);
    expect(SHOPLINE_TOOL_SPECS.filter((tool) => !tool.write)).toHaveLength(75);
    expect(SHOPLINE_TOOL_SPECS.filter((tool) => tool.write)).toHaveLength(68);
  });

  it("keeps all tool names unique", () => {
    const names = SHOPLINE_TOOL_SPECS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("marks every write tool visibly and with side-effect documentation", () => {
    const writeTools = SHOPLINE_TOOL_SPECS.filter((tool) => tool.write);
    expect(writeTools.every((tool) => tool.description.startsWith("[WRITE]"))).toBe(true);
    expect(writeTools.every((tool) => tool.description.includes("【副作用】"))).toBe(true);
  });
});

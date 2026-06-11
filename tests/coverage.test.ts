import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { SHOPLINE_TOOL_SPECS } from "../src/tools/register.js";

const endpointPattern = /-\s+(GET|POST|PUT|PATCH|DELETE)\s+(\/[\w/{}\-_.]+)/g;
const paramPattern = /\{[^}]+\}/g;

function normalize(method: string, path: string): string {
  return `${method} ${path.replace(paramPattern, "{id}")}`;
}

function inventoryEndpoints(): Set<string> {
  const content = readFileSync("reference/shopline-api-inventory.md", "utf8");
  const endpoints = new Set<string>();
  for (const match of content.matchAll(endpointPattern)) {
    endpoints.add(normalize(match[1] ?? "", match[2] ?? ""));
  }
  return endpoints;
}

describe("Shopline endpoint coverage", () => {
  it("covers every endpoint listed in the reference inventory", () => {
    const inventory = inventoryEndpoints();
    const covered = new Set<string>();
    for (const tool of SHOPLINE_TOOL_SPECS) {
      for (const endpoint of tool.docEndpoints) {
        covered.add(normalize(endpoint.method, endpoint.path));
      }
    }

    const uncovered = [...inventory].filter((endpoint) => !covered.has(endpoint));
    expect(inventory.size).toBe(136);
    expect(uncovered).toEqual([]);
  });
});

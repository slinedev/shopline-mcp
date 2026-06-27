import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetFetchImplementation, setFetchImplementation } from "../src/client.js";
import { registerShoplineTools } from "../src/tools/register.js";

type ToolHandler = (args: Record<string, unknown>) => Promise<{ structuredContent?: Record<string, unknown> }>;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function toolHandlers(): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();
  registerShoplineTools({
    registerTool(name: string, _config: unknown, handler: ToolHandler) {
      handlers.set(name, handler);
    },
  } as never);
  return handlers;
}

async function callTool(name: string, args: Record<string, unknown> = {}) {
  const handler = toolHandlers().get(name);
  if (!handler) throw new Error(`Missing test handler for ${name}`);
  const result = await handler(args);
  return result.structuredContent ?? {};
}

describe("multi-store runtime selection", () => {
  beforeEach(() => {
    process.env.SHOPLINE_STORES_JSON = JSON.stringify({
      tw: { token: "tw-token" },
      hk: { token: "hk-token", base_url: "https://example.shopline.test" },
    });
  });

  afterEach(() => {
    resetFetchImplementation();
    delete process.env.SHOPLINE_API_TOKEN;
    delete process.env.SHOPLINE_STORES_JSON;
    delete process.env.SHOPLINE_DEFAULT_STORE;
  });

  it("uses the selected store alias for request base URL and bearer token", async () => {
    const calls: { url: string; authorization: string | undefined }[] = [];
    setFetchImplementation((async (input, init) => {
      calls.push({ url: String(input), authorization: init?.headers ? (init.headers as Record<string, string>).Authorization : undefined });
      return jsonResponse({ id: "token-info" });
    }) as typeof fetch);

    await callTool("get_token_info", { store_alias: "hk" });

    expect(calls).toEqual([{ url: "https://example.shopline.test/v1/token/info", authorization: "Bearer hk-token" }]);
  });

  it("does not send runtime-only arguments as API query parameters", async () => {
    const calls: string[] = [];
    setFetchImplementation((async (input) => {
      calls.push(String(input));
      return jsonResponse({ items: [], pagination: { total_pages: 1 } });
    }) as typeof fetch);

    await callTool("list_customers", { store_alias: "tw", max_results: 5, search_keyword: "Alice" });

    const url = new URL(calls[0] ?? "");
    expect(url.searchParams.get("keyword")).toBe("Alice");
    expect(url.searchParams.has("store_alias")).toBe(false);
    expect(url.searchParams.has("dry_run")).toBe(false);
    expect(url.searchParams.has("confirm_write")).toBe(false);
  });
});

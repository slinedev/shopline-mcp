import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetFetchImplementation, setFetchImplementation } from "../src/client.js";
import { registerShoplineTools } from "../src/tools/register.js";

type ToolHandler = (args: Record<string, unknown>) => Promise<{ structuredContent?: Record<string, unknown> }>;

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

describe("assistant capability tools", () => {
  beforeEach(() => {
    process.env.SHOPLINE_API_TOKEN = "test-token";
  });

  afterEach(() => {
    resetFetchImplementation();
    delete process.env.SHOPLINE_API_TOKEN;
    delete process.env.SHOPLINE_STORES_JSON;
    delete process.env.SHOPLINE_DEFAULT_STORE;
  });

  it("registers assistant tools without changing the 143 business tool baseline", async () => {
    const handlers = toolHandlers();

    expect(handlers.size).toBe(149);
    expect(handlers.has("describe_shopline_mcp_capabilities")).toBe(true);
    expect(handlers.has("find_shopline_tools")).toBe(true);
    expect(handlers.has("explain_shopline_tool")).toBe(true);
    expect(handlers.has("recommend_shopline_workflow")).toBe(true);
    expect(handlers.has("preview_shopline_write_tool")).toBe(true);
    expect(handlers.has("list_shopline_store_profiles")).toBe(true);
  });

  it("summarizes the current business capability baseline", async () => {
    const result = await callTool("describe_shopline_mcp_capabilities");

    expect(result.business_tools).toMatchObject({ total: 143, read: 75, write: 68 });
    expect(result.assistant_tools).toMatchObject({ total: 6 });
    expect(result.safety).toMatchObject({
      write_marker: "[WRITE]",
      side_effect_marker: "【副作用】",
      dry_run_supported: true,
      store_alias_supported: true,
    });
    expect(result.domains).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ domain: "Orders" }),
        expect.objectContaining({ domain: "Products & Inventory" }),
        expect.objectContaining({ domain: "Analytics" }),
      ]),
    );
  });

  it("searches tools by intent and explains a concrete tool", async () => {
    const search = await callTool("find_shopline_tools", { query: "low stock", mode: "read" });
    expect(search.matches).toEqual(expect.arrayContaining([expect.objectContaining({ name: "get_low_stock_alerts" })]));

    const explanation = await callTool("explain_shopline_tool", { tool_name: "update_product_price" });
    expect(explanation).toMatchObject({
      name: "update_product_price",
      mode: "write",
      safety: expect.objectContaining({ dry_run_supported: true }),
    });
    expect(explanation.parameters).toEqual(expect.arrayContaining([expect.objectContaining({ name: "product_id" })]));
    expect(explanation.endpoints).toEqual(expect.arrayContaining([expect.objectContaining({ method: "PUT" })]));
  });

  it("recommends merchant workflows from a natural task", async () => {
    const result = await callTool("recommend_shopline_workflow", { task: "Prepare a weekly sales report" });

    expect(result.workflow).toBe("sales_report");
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tool: "get_sales_summary" }),
        expect.objectContaining({ tool: "get_top_products" }),
        expect.objectContaining({ tool: "get_sales_trend" }),
      ]),
    );
  });

  it("previews writes and supports dry_run on original write tools without calling Shopline", async () => {
    setFetchImplementation((async () => {
      throw new Error("dry_run should not call fetch");
    }) as typeof fetch);

    const preview = await callTool("preview_shopline_write_tool", {
      tool_name: "delete_product",
      args: { product_id: "product-1" },
    });

    expect(preview).toMatchObject({
      dry_run: true,
      tool_name: "delete_product",
      method: "DELETE",
      endpoint_path: "/v1/products/{product_id}",
      path_params: { product_id: "product-1" },
      requires_confirmation: true,
    });

    const dryRun = await callTool("delete_product", { product_id: "product-1", dry_run: true });
    expect(dryRun).toMatchObject({
      dry_run: true,
      tool_name: "delete_product",
      method: "DELETE",
      endpoint_path: "/v1/products/{product_id}",
    });
  });

  it("lists configured store aliases without exposing tokens", async () => {
    process.env.SHOPLINE_STORES_JSON = JSON.stringify({
      tw: { token: "tw-token" },
      hk: { token: "hk-token", base_url: "https://example.shopline.test" },
    });

    const result = await callTool("list_shopline_store_profiles");

    expect(result.stores).toEqual([
      { alias: "hk", base_url: "https://example.shopline.test", token_present: true },
      { alias: "tw", base_url: "https://open.shopline.io", token_present: true },
    ]);
    expect(JSON.stringify(result)).not.toContain("tw-token");
    expect(JSON.stringify(result)).not.toContain("hk-token");
  });
});

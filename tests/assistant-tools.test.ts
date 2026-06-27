import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetFetchImplementation, setFetchImplementation } from "../src/client.js";
import { registerShoplineTools } from "../src/tools/register.js";

type ToolHandler = (args: Record<string, unknown>) => Promise<{ structuredContent?: Record<string, unknown> }>;
type RawToolResult = {
  readonly structuredContent?: Record<string, unknown>;
  readonly isError?: boolean;
  readonly content?: Array<{ readonly text?: string }>;
};

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

async function callRawTool(name: string, args: Record<string, unknown> = {}): Promise<RawToolResult> {
  const handler = toolHandlers().get(name);
  if (!handler) throw new Error(`Missing test handler for ${name}`);
  return (await handler(args)) as RawToolResult;
}

function page(items: Record<string, unknown>[]): Record<string, unknown> {
  return { items, pagination: { total_pages: 1 } };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function money(dollars: number): Record<string, unknown> {
  return { dollars };
}

const contentAuditProducts = [
  {
    id: "product-missing",
    title_translations: { "zh-hant": "短袖上衣" },
    sku: "TEE-001",
    brand: "",
    description_translations: { "zh-hant": "" },
    images: [],
    category_ids: [],
    tags: [],
    quantity: 2,
    variations: [{ id: "variant-missing", sku: "TEE-001-S", quantity: 2 }],
  },
  {
    id: "product-ready",
    title_translations: { "zh-hant": "機能外套" },
    sku: "JKT-001",
    brand: "Sline",
    description_translations: { "zh-hant": "防潑水機能外套，適合日常通勤與旅行穿搭，材質輕量且容易收納。" },
    seo_title_translations: { "zh-hant": "機能外套推薦" },
    seo_description_translations: { "zh-hant": "防潑水機能外套，兼具輕量、收納與日常通勤需求。" },
    images: [{ id: "image-1" }],
    category_ids: ["category-1"],
    tags: ["防潑水", "外套"],
    quantity: 12,
    variations: [{ id: "variant-ready", sku: "JKT-001-M", quantity: 12 }],
  },
];

const reorderProducts = [
  {
    id: "product-hot",
    title_translations: { "zh-hant": "熱賣水壺" },
    sku: "BOTTLE-001",
    brand: "Sline",
    quantity: 2,
    variations: [{ id: "variant-hot", sku: "BOTTLE-001", quantity: 2 }],
  },
  {
    id: "product-slow",
    title_translations: { "zh-hant": "慢銷背包" },
    sku: "BAG-001",
    brand: "Sline",
    quantity: 40,
    variations: [{ id: "variant-slow", sku: "BAG-001", quantity: 40 }],
  },
];

const reorderOrders = [
  {
    id: "order-1",
    status: "confirmed",
    created_at: "2026-06-02T12:00:00Z",
    subtotal_items: [
      {
        item_id: "product-hot",
        sku: "BOTTLE-001",
        quantity: 6,
        total: money(600),
        object_data: { product_id: "product-hot" },
      },
    ],
  },
];

function mockAuditFetch(products = contentAuditProducts): void {
  setFetchImplementation((async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname === "/v1/products") return jsonResponse(page(products));
    if (url.pathname === "/v1/orders/search") return jsonResponse(page(reorderOrders));
    if (url.pathname === "/v1/products/locked-inventory") {
      return jsonResponse(page([{ product_id: "product-hot", sku: "BOTTLE-001", quantity: 1, locked_quantity: 1 }]));
    }
    return jsonResponse(page([]));
  }) as typeof fetch);
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
    delete process.env.SHOPLINE_REQUIRE_WRITE_APPROVAL;
  });

  it("registers assistant tools without changing the 143 business tool baseline", async () => {
    const handlers = toolHandlers();

    expect(handlers.size).toBe(153);
    expect(handlers.has("describe_shopline_mcp_capabilities")).toBe(true);
    expect(handlers.has("find_shopline_tools")).toBe(true);
    expect(handlers.has("explain_shopline_tool")).toBe(true);
    expect(handlers.has("recommend_shopline_workflow")).toBe(true);
    expect(handlers.has("preview_shopline_write_tool")).toBe(true);
    expect(handlers.has("list_shopline_store_profiles")).toBe(true);
    expect(handlers.has("audit_shopline_product_content")).toBe(true);
    expect(handlers.has("audit_shopline_seo_readiness")).toBe(true);
    expect(handlers.has("forecast_shopline_reorder_candidates")).toBe(true);
    expect(handlers.has("prepare_shopline_write_approval")).toBe(true);
  });

  it("summarizes the current business capability baseline", async () => {
    const result = await callTool("describe_shopline_mcp_capabilities");

    expect(result.business_tools).toMatchObject({ total: 143, read: 75, write: 68 });
    expect(result.assistant_tools).toMatchObject({ total: 10 });
    expect(result.safety).toMatchObject({
      write_marker: "[WRITE]",
      side_effect_marker: "【副作用】",
      dry_run_supported: true,
      store_alias_supported: true,
      approval_code_supported: true,
    });
    expect(result.domains).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ domain: "Orders" }),
        expect.objectContaining({ domain: "Products & Inventory" }),
        expect.objectContaining({ domain: "Analytics" }),
      ]),
    );
  });

  it("returns stable approval codes and blocks writes when approval is required", async () => {
    setFetchImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/v1/products/product-1");
      expect(init?.method).toBe("DELETE");
      return jsonResponse({ id: "product-1" });
    }) as typeof fetch);

    const preview = await callTool("preview_shopline_write_tool", {
      tool_name: "delete_product",
      args: { product_id: "product-1" },
    });
    const approval = await callTool("prepare_shopline_write_approval", {
      tool_name: "delete_product",
      args: { product_id: "product-1" },
    });

    expect(preview.approval_code).toEqual(expect.any(String));
    expect(preview.approval_code).toBe(approval.approval_code);
    expect(preview.requires_confirmation).toBe(true);

    process.env.SHOPLINE_REQUIRE_WRITE_APPROVAL = "1";
    const blocked = await callRawTool("delete_product", { product_id: "product-1" });
    expect(blocked.isError).toBe(true);
    expect(blocked.content?.[0]?.text).toContain("approval_code");

    const executed = await callRawTool("delete_product", { product_id: "product-1", approval_code: preview.approval_code });
    expect(executed.isError).toBeUndefined();
    expect(executed.structuredContent).toMatchObject({ success: true, resource_id: "product-1" });
  });

  it("keeps approval codes valid when store_alias is supplied on the approval tool", async () => {
    process.env.SHOPLINE_STORES_JSON = JSON.stringify({ tw: { token: "tw-token" } });
    setFetchImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/v1/products/product-1");
      expect(init?.method).toBe("DELETE");
      return jsonResponse({ id: "product-1" });
    }) as typeof fetch);

    const approval = await callTool("prepare_shopline_write_approval", {
      tool_name: "delete_product",
      store_alias: "tw",
      args: { product_id: "product-1" },
    });

    process.env.SHOPLINE_REQUIRE_WRITE_APPROVAL = "1";
    const executed = await callRawTool("delete_product", {
      store_alias: "tw",
      product_id: "product-1",
      approval_code: approval.approval_code,
    });

    expect(executed.isError).toBeUndefined();
    expect(executed.structuredContent).toMatchObject({ success: true, resource_id: "product-1" });
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
      approval_code: expect.any(String),
    });

    const dryRun = await callTool("delete_product", { product_id: "product-1", dry_run: true });
    expect(dryRun).toMatchObject({
      dry_run: true,
      tool_name: "delete_product",
      method: "DELETE",
      endpoint_path: "/v1/products/{product_id}",
      approval_code: expect.any(String),
    });
  });

  it("audits product content for missing merchant review fields", async () => {
    mockAuditFetch();

    const result = await callTool("audit_shopline_product_content", { max_products: 10, min_description_length: 20 });

    expect(result).toMatchObject({ total_products: 2, products_needing_review: 1 });
    expect(result.products).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          product_id: "product-missing",
          title: "短袖上衣",
          issues: expect.arrayContaining(["missing_brand", "missing_description", "missing_images", "missing_categories", "missing_tags"]),
          review_required: true,
        }),
      ]),
    );
  });

  it("audits SEO readiness and returns human-review update drafts without writing", async () => {
    mockAuditFetch();

    const result = await callTool("audit_shopline_seo_readiness", { max_products: 10 });

    expect(result.summary).toMatchObject({ products_checked: 2, products_needing_review: 1 });
    expect(result.products).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          product_id: "product-missing",
          seo_issues: expect.arrayContaining(["missing_seo_description", "missing_keywords", "missing_categories"]),
        }),
      ]),
    );
    expect(result.update_drafts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          product_id: "product-missing",
          suggested_write_tool: "update_product",
          review_required: true,
        }),
      ]),
    );
  });

  it("forecasts reorder candidates from inventory, sales, and locked stock", async () => {
    mockAuditFetch(reorderProducts);

    const result = await callTool("forecast_shopline_reorder_candidates", {
      start_date: "2026-06-01",
      end_date: "2026-06-10",
      horizon_days: 14,
      max_products: 10,
    });

    expect(result).toMatchObject({ products_checked: 2, candidates_count: 1 });
    expect(result.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          product_id: "product-hot",
          sku: "BOTTLE-001",
          current_stock: 2,
          locked_quantity: 1,
          units_sold: 6,
          status: "補貨優先",
          recommended_reorder_quantity: expect.any(Number),
        }),
      ]),
    );
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

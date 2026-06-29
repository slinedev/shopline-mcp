import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ENDPOINTS, getUrl } from "../src/config.js";
import { resetFetchImplementation, setFetchImplementation } from "../src/client.js";
import { buildWritePreview } from "../src/tools/operationPlan.js";
import { registerShoplineTools, V14_TOOL_SPECS } from "../src/tools/register.js";
import type { ParamSpec, ToolSpec } from "../src/types.js";

type ToolHandler = (args: Record<string, unknown>) => Promise<{ structuredContent?: Record<string, unknown> }>;

interface CapturedCall {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
}

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

async function callTool(name: string, args: Record<string, unknown>) {
  const handler = toolHandlers().get(name);
  if (!handler) throw new Error(`Missing test handler for ${name}`);
  const result = await handler(args);
  return result.structuredContent ?? {};
}

function installCapture(responseBody: unknown = { id: "ok" }): CapturedCall[] {
  const calls: CapturedCall[] = [];
  setFetchImplementation((async (input, init) => {
    calls.push({
      url: String(input),
      method: String(init?.method),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return jsonResponse(responseBody);
  }) as typeof fetch);
  return calls;
}

function fallbackValue(param: ParamSpec): unknown {
  if (param.hasDefault) return param.default;
  if (param.enum?.length) return param.enum[0];
  if (param.kind === "integer" || param.kind === "number") return 1;
  if (param.kind === "array") return ["sample-1", "sample-2"];
  if (param.kind === "object") return { sample: true };
  if (param.kind === "boolean") return true;
  return `${param.name}-sample`;
}

function argsFor(spec: ToolSpec): Record<string, unknown> {
  return Object.fromEntries(spec.params.map((param) => [param.name, fallbackValue(param)]));
}

describe("v1.4 additive tool layer", () => {
  beforeEach(() => {
    process.env.SHOPLINE_API_TOKEN = "test-token";
  });

  afterEach(() => {
    resetFetchImplementation();
    delete process.env.SHOPLINE_API_TOKEN;
  });

  it("maps every v1.4 operation to a known endpoint key", () => {
    const missing = V14_TOOL_SPECS.flatMap((tool) =>
      tool.operations.filter((operation) => !ENDPOINTS[operation.endpointKey]).map((operation) => `${tool.name}:${operation.endpointKey}`),
    );

    expect(missing).toEqual([]);
  });

  it("covers the selected v1.4 official endpoint set", () => {
    const covered = new Set(V14_TOOL_SPECS.flatMap((tool) => tool.docEndpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`)));

    expect([...covered]).toEqual(
      expect.arrayContaining([
        "GET /v1/webhooks",
        "POST /v1/webhooks",
        "PUT /v1/webhooks/{webhook_id}",
        "DELETE /v1/webhooks/{webhook_id}",
        "GET /v1/settings/product_review",
        "GET /v1/settings/third_party_ads",
        "POST /v1/settings/theme/publish",
        "POST /v1/sales/{sale_id}/delete_products",
        "GET /v1/user_coupons/list",
        "POST /v1/user_coupons/{coupon_code}/redeem",
        "GET /v1/wish_list_items",
        "GET /v1/staffs/{staff_id}",
        "POST /v1/return_orders/{return_order_id}/inspection",
        "PUT /v1/return_orders/{return_order_id}/return_order_delivery_status",
        "PUT /v1/pos/purchase_orders/{purchase_order_id}",
        "POST /v1/pos/purchase_orders/{purchase_order_id}/child",
        "PUT /v1/pos/purchase_orders/bulk_delete",
        "GET /v1/products/{product_id}/promotions",
        "GET /v1/promotions/coupon-center",
        "GET /v1/customers/{customer_id}/coupon_promotions",
        "GET /v1/merchants/current/app_metafields",
        "GET /v1/products/{product_id}/metafields",
        "GET /v1/orders/{order_id}/items/app_metafields",
        "GET /v1/metafield_definitions/products/{metafield_definition_id}",
      ]),
    );
  });

  it("sends representative v1.4 write tools to the official method and URL", async () => {
    const cases = [
      {
        tool: "create_webhook",
        args: { webhook_data: { topic: "orders/create", url: "https://example.com/webhook" } },
        expected: { method: "POST", url: "https://open.shopline.io/v1/webhooks", body: { topic: "orders/create", url: "https://example.com/webhook" } },
      },
      {
        tool: "update_webhook",
        args: { webhook_id: "webhook-1", webhook_data: { url: "https://example.com/new" } },
        expected: { method: "PUT", url: "https://open.shopline.io/v1/webhooks/webhook-1", body: { url: "https://example.com/new" } },
      },
      {
        tool: "remove_sale_products",
        args: { sale_id: "sale-1", product_ids: ["product-1"] },
        expected: { method: "POST", url: "https://open.shopline.io/v1/sales/sale-1/delete_products", body: { product_ids: ["product-1"] } },
      },
      {
        tool: "bulk_delete_purchase_orders_v14",
        args: { purchase_order_ids: ["po-1", "po-2"] },
        expected: { method: "PUT", url: "https://open.shopline.io/v1/pos/purchase_orders/bulk_delete", body: { ids: ["po-1", "po-2"] } },
      },
      {
        tool: "publish_theme_setting",
        args: { setting_data: { publish: true } },
        expected: { method: "POST", url: "https://open.shopline.io/v1/settings/theme/publish", body: { publish: true } },
      },
      {
        tool: "create_product_metafield",
        args: { product_id: "product-1", metafield_data: { namespace: "seo", key: "score", field_value: 90 } },
        expected: {
          method: "POST",
          url: "https://open.shopline.io/v1/products/product-1/metafields",
          body: { namespace: "seo", key: "score", field_value: 90 },
        },
      },
    ];

    for (const item of cases) {
      const calls = installCapture({ id: "ok" });
      await callTool(item.tool, item.args);
      expect(calls, item.tool).toEqual([item.expected]);
      resetFetchImplementation();
    }
  });

  it("does not add legacy sort_by to v1.4 list endpoints", async () => {
    setFetchImplementation((async (input) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/v1/webhooks");
      expect(url.searchParams.get("per_page")).toBe("50");
      expect(url.searchParams.get("page")).toBe("1");
      expect(url.searchParams.has("sort_by")).toBe(false);
      return jsonResponse({ items: [], pagination: { total_pages: 1 } });
    }) as typeof fetch);

    await callTool("list_webhooks", { max_results: 50 });
  });

  it("can dry-run every v1.4 write tool without calling Shopline", () => {
    for (const spec of V14_TOOL_SPECS.filter((tool) => tool.write)) {
      const preview = buildWritePreview(spec, argsFor(spec));
      expect(preview).toMatchObject({
        dry_run: true,
        tool_name: spec.name,
        requires_confirmation: true,
      });
      expect(preview.request_url, spec.name).toBeTruthy();
    }
  });

  it("keeps the legacy purchase order delete tool available alongside the v1.4 bulk endpoint", () => {
    const handlers = toolHandlers();
    expect(handlers.has("delete_purchase_orders")).toBe(true);
    expect(handlers.has("bulk_delete_purchase_orders_v14")).toBe(true);
    expect(getUrl("purchase_order_delete")).toBe("https://open.shopline.io/v1/pos/purchase_orders");
    expect(getUrl("purchase_orders_bulk_delete")).toBe("https://open.shopline.io/v1/pos/purchase_orders/bulk_delete");
  });
});

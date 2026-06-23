import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetFetchImplementation, setFetchImplementation } from "../src/client.js";
import { registerShoplineTools, SHOPLINE_TOOL_SPECS } from "../src/tools/register.js";
import type { ToolSpec } from "../src/types.js";

interface PythonBaseline {
  readonly tools: readonly {
    readonly name: string;
    readonly write: boolean;
    readonly returnKeys: readonly string[];
  }[];
}

type ToolHandler = (args: Record<string, unknown>) => Promise<{ structuredContent?: Record<string, unknown> }>;

const baseline = JSON.parse(readFileSync("tests/fixtures/python-tool-baseline.json", "utf8")) as PythonBaseline;
const returnKeysByName = new Map(baseline.tools.map((tool) => [tool.name, tool.returnKeys]));

const sampleValues: Record<string, unknown> = {
  addon_product_id: "addon-1",
  amount: 25,
  birthday: "1990-01-01",
  brand: "Brand A",
  campaign_data: { title: "Campaign" },
  campaign_id: "campaign-1",
  category_data: { name: "Category" },
  category_id: "cat-1",
  channel: "all",
  channel_id: "channel-1",
  comment_id: "review-1",
  conversation_id: "conversation-1",
  coupon_data: { coupon_code: "CODE" },
  customer_id: "customer-1",
  days_threshold: 30,
  delivery_id: "delivery-1",
  delivery_option_id: "delivery-option-1",
  delivery_status: "shipped",
  discount_type: null,
  email: "alice@example.com",
  end_date: "2026-01-31",
  f_threshold: 2,
  gender: "female",
  gift_id: "gift-1",
  group_id: "group-1",
  keyword: "sale",
  m_threshold: 5000,
  max_results: 2,
  merchant_id: "merchant-1",
  min_stock_diff: 1,
  name: "Alice",
  note: "note",
  order_id: "order-1",
  payment_status: "paid",
  period1_end: "2026-01-31",
  period1_start: "2026-01-01",
  period2_end: "2026-02-28",
  period2_start: "2026-02-01",
  phone: "0912",
  product_id: "product-1",
  promotion_id: "promotion-1",
  purchase_order_id: "purchase-order-1",
  quantity: 5,
  r_days: 30,
  r_days_threshold: 30,
  return_order_id: "return-order-1",
  search_keyword: "sale",
  sort_by: "revenue",
  staff_id: "staff-1",
  start_date: "2026-01-01",
  status: "all",
  store_name: null,
  subscription_id: "subscription-1",
  threshold: 5,
  top_n: 2,
  variation_id: "variation-1",
  warehouse_id: "warehouse-1",
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function page(items: unknown[]) {
  return { items, pagination: { total_pages: 1 } };
}

function money(dollars: number) {
  return { dollars };
}

const order = {
  id: "order-1",
  order_number: "SO001",
  status: "confirmed",
  created_at: "2026-01-10T00:00:00Z",
  created_from: "shop",
  customer_id: "customer-1",
  customer_name: "Alice",
  total: money(100),
  subtotal: money(120),
  order_discount: money(20),
  subtotal_items: [
    {
      id: "line-1",
      product_id: "product-1",
      sku: "SKU-1",
      quantity: 2,
      total: money(100),
      price: money(50),
      price_sale: money(45),
      cost: money(20),
      item_id: "product-1",
      title_translations: { "zh-hant": "商品" },
      fields_translations: { "zh-hant": ["紅", "M"] },
      object_data: { brand: "Brand A", category_ids: ["cat-1"] },
    },
  ],
  promotion_items: [
    {
      promotion: { id: "promotion-1" },
      discounted_amount: money(20),
    },
  ],
  order_payment: { name_translations: { "zh-hant": "信用卡" }, status: "paid" },
  order_delivery: { name_translations: { "zh-hant": "宅配" }, delivery_status: "shipped" },
  delivery_address: { city: "台北市" },
  channel: { created_by_channel_name: { "zh-hant": "線上官網" } },
};

const product = {
  id: "product-1",
  title_translations: { "zh-hant": "商品" },
  brand: "Brand A",
  sku: "SKU-1",
  price: money(100),
  price_sale: money(90),
  cost: money(40),
  quantity: 5,
  supplier: { name: "Supplier" },
  category_ids: ["cat-1"],
  status: "active",
  tags: ["tag"],
  field_titles: [{ name_translations: { "zh-hant": "顏色" } }, { name_translations: { "zh-hant": "尺寸" } }],
  variations: [
    {
      id: "variation-1",
      sku: "SKU-1-R-M",
      quantity: 5,
      price: money(100),
      price_sale: money(90),
      cost: money(40),
      fields_translations: { "zh-hant": ["紅", "M"] },
      feed_variations: {},
      total_orderable_quantity: 5,
      stocks: [
        { warehouse_id: "warehouse-1", quantity: 10 },
        { warehouse_id: "warehouse-2", quantity: 2 },
      ],
    },
  ],
};

function responseFor(urlText: string): Response {
  const url = new URL(urlText);
  const path = url.pathname;

  if (path === "/v1/orders/search" || path === "/v1/orders" || path === "/v1/orders/archived") return jsonResponse(page([order]));
  if (path === "/v1/orders/order-1") return jsonResponse(order);
  if (path === "/v1/orders/order-1/tags") return jsonResponse({ tags: ["vip"] });
  if (path === "/v1/orders/order-1/action-logs") return jsonResponse(page([{ id: "log-1", action: "created" }]));
  if (path === "/v1/orders/order-1/transactions") return jsonResponse(page([{ id: "txn-1", amount: money(100) }]));
  if (path === "/v1/orders/order-1/labels") return jsonResponse({ labels: ["urgent"] });

  if (path === "/v1/products" || path === "/v1/products/search") return jsonResponse(page([product]));
  if (path === "/v1/products/product-1/stocks") {
    return jsonResponse({ id: "product-1", title_translations: { "zh-hant": "商品" }, variations: product.variations });
  }
  if (path === "/v1/products/locked-inventory") return jsonResponse(page([{ sku: "SKU-1", quantity: 1 }]));

  if (path === "/v1/warehouses") {
    return jsonResponse(
      page([
        { id: "warehouse-1", name: "Main", status: "active" },
        { id: "warehouse-2", name: "Outlet", status: "active" },
      ]),
    );
  }
  if (path === "/v1/categories") {
    return jsonResponse(page([{ id: "cat-1", parent_id: null, title_translations: { "zh-hant": "分類" }, children: [] }]));
  }
  if (path === "/v1/categories/cat-1") return jsonResponse({ id: "cat-1", title_translations: { "zh-hant": "分類" } });

  if (path === "/v1/promotions" || path === "/v1/promotions/search") {
    return jsonResponse(
      page([
        {
          id: "promotion-1",
          title_translations: { "zh-hant": "促銷" },
          status: "active",
          discount_type: "percentage",
          discount_percentage: 10,
          use_count: 1,
          sum_use_count: 3,
          max_use_count: 10,
        },
      ]),
    );
  }
  if (path === "/v1/promotions/promotion-1") return jsonResponse({ id: "promotion-1", title_translations: { "zh-hant": "促銷" } });

  if (path === "/v1/return_orders") {
    return jsonResponse(
      page([
        {
          id: "return-order-1",
          status: "completed",
          order_id: "order-1",
          total: money(50),
          items: [{ quantity: 1, object_data: { sku: "SKU-1", title_translations: { "zh-hant": "商品" } } }],
        },
      ]),
    );
  }
  if (path === "/v1/return_orders/return-order-1") return jsonResponse({ id: "return-order-1", status: "completed", items: [] });
  if (path === "/v1/order_deliveries/delivery-1") return jsonResponse({ id: "delivery-1", status: "shipped" });

  if (path === "/v1/customers" || path === "/v1/customers/search") {
    return jsonResponse(page([{ id: "customer-1", name: "Alice", total_spent: money(100), orders_count: 1 }]));
  }
  if (path === "/v1/customers/customer-1") return jsonResponse({ id: "customer-1", name: "Alice", total_spent: money(100) });
  if (path.startsWith("/v1/customers/customer-1/")) return jsonResponse(page([]));
  if (path === "/v1/customer-groups" || path === "/v1/customer-groups/search") {
    return jsonResponse(page([{ id: "group-1", name: "VIP", customer_ids: ["customer-1"] }]));
  }
  if (path === "/v1/customer-groups/group-1/customers") return jsonResponse(page([{ id: "customer-1" }]));
  if (path === "/v1/user_credits") return jsonResponse(page([{ id: "credit-1", amount: money(10), balance: money(20) }]));
  if (path === "/v1/membership_tiers") return jsonResponse(page([{ id: "tier-1", name: "VIP" }]));
  if (path === "/v1/member_point_rules") return jsonResponse(page([{ id: "rule-1", title: "Rule" }]));
  if (path === "/v1/custom_fields") return jsonResponse(page([{ id: "field-1", name: "Field" }]));

  if (path === "/v1/affiliate_campaigns") return jsonResponse(page([{ id: "campaign-1", title_translations: { "zh-hant": "聯盟" } }]));
  if (path === "/v1/affiliate_campaigns/campaign-1") return jsonResponse({ id: "campaign-1", title_translations: { "zh-hant": "聯盟" } });
  if (path === "/v1/affiliate_campaigns/campaign-1/order_usage") return jsonResponse(page([{ order_id: "order-1", revenue: money(100) }]));
  if (path === "/v1/flash_price_campaigns") return jsonResponse(page([{ id: "campaign-1", title_translations: { "zh-hant": "快閃" } }]));
  if (path === "/v1/flash_price_campaigns/campaign-1") return jsonResponse({ id: "campaign-1", title_translations: { "zh-hant": "快閃" } });
  if (path === "/v1/gifts" || path === "/v1/gifts/search") return jsonResponse(page([{ id: "gift-1", name_translations: { "zh-hant": "贈品" } }]));
  if (path === "/v1/addon_products" || path === "/v1/addon_products/search") {
    return jsonResponse(page([{ id: "addon-1", name_translations: { "zh-hant": "加購" }, price: money(20) }]));
  }
  if (path === "/v1/product_subscriptions") return jsonResponse(page([{ id: "subscription-1", status: "active" }]));
  if (path === "/v1/product_subscriptions/subscription-1") return jsonResponse({ id: "subscription-1", status: "active" });

  if (path === "/v1/conversations") return jsonResponse(page([{ id: "conversation-1", status: "open" }]));
  if (path === "/v1/conversations/conversation-1/messages") return jsonResponse(page([{ id: "message-1", content: "hello" }]));
  if (path === "/v1/product_review_comments") return jsonResponse(page([{ id: "review-1", product_id: "product-1", rating: 5 }]));
  if (path === "/v1/product_review_comments/review-1") return jsonResponse({ id: "review-1", product_id: "product-1", rating: 5 });

  if (path === "/v1/merchants") return jsonResponse(page([{ id: "merchant-1", name: "Shop" }]));
  if (path === "/v1/merchants/merchant-1") return jsonResponse({ id: "merchant-1", name: "Shop" });
  if (path === "/v1/payments") return jsonResponse(page([{ id: "payment-1", name: "Credit Card" }]));
  if (path === "/v1/delivery_options") return jsonResponse(page([{ id: "delivery-option-1", name: "Delivery" }]));
  if (path === "/v1/delivery_options/delivery-option-1") return jsonResponse({ id: "delivery-option-1", name: "Delivery" });
  if (path === "/v1/delivery_options/delivery-option-1/time_slots") return jsonResponse(page([{ id: "slot-1", name: "Morning" }]));
  if (path === "/v1/channels") return jsonResponse(page([{ id: "channel-1", name: "Online" }]));
  if (path === "/v1/channels/channel-1") return jsonResponse({ id: "channel-1", name: "Online" });
  if (path === "/v1/settings/app") return jsonResponse({ currency: "TWD" });
  if (path === "/v1/taxes") return jsonResponse(page([{ id: "tax-1", name: "Tax" }]));
  if (path === "/v1/staffs/staff-1/permissions") return jsonResponse({ permissions: ["orders"] });
  if (path === "/v1/token/info") return jsonResponse({ scopes: ["read"] });
  if (path === "/v1/agents") return jsonResponse(page([{ id: "agent-1", name: "Agent" }]));
  if (path === "/v1/pos/purchase_orders") return jsonResponse(page([{ id: "purchase-order-1", status: "open", total: money(100), items: [] }]));
  if (path === "/v1/pos/purchase_orders/purchase-order-1") {
    return jsonResponse({ id: "purchase-order-1", status: "open", total: money(100), items: [] });
  }

  return jsonResponse(page([]));
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

function sampleArgs(spec: ToolSpec): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const param of spec.params) {
    if (sampleValues[param.name] !== undefined) args[param.name] = sampleValues[param.name];
    else if (param.hasDefault) args[param.name] = param.default;
    else if (param.enum?.length) args[param.name] = param.enum[0];
    else if (param.kind === "integer" || param.kind === "number") args[param.name] = 1;
    else if (param.kind === "array") args[param.name] = ["sample"];
    else if (param.kind === "object") args[param.name] = { sample: true };
    else args[param.name] = `${param.name}-sample`;
  }
  return args;
}

describe("Python read output parity", () => {
  beforeEach(() => {
    process.env.SHOPLINE_API_TOKEN = "test-token";
    setFetchImplementation((async (input) => responseFor(String(input))) as typeof fetch);
  });

  afterEach(() => {
    resetFetchImplementation();
    delete process.env.SHOPLINE_API_TOKEN;
  });

  for (const spec of SHOPLINE_TOOL_SPECS.filter((tool) => !tool.write)) {
    const expectedKeys = returnKeysByName.get(spec.name) ?? [];
    if (!expectedKeys.length) continue;

    it(`${spec.name} returns the Python top-level shape`, async () => {
      const handler = toolHandlers().get(spec.name);
      if (!handler) throw new Error(`Missing handler for ${spec.name}`);

      const result = await handler(sampleArgs(spec));
      const output = result.structuredContent ?? {};

      expect(Object.keys(output).sort()).toEqual(expect.arrayContaining([...expectedKeys].sort()));
    });
  }

  it("analytics read tools compute Python-compatible business fields", async () => {
    const handlers = toolHandlers();

    const inventory = (await handlers.get("get_inventory_turnover")?.({ start_date: "2026-01-01", end_date: "2026-01-31" }))?.structuredContent ?? {};
    expect(inventory.products).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          product_id: "product-1",
          period_sales_qty: 2,
          period_sales_revenue: 100,
          estimated_days_of_stock: 75,
          turnover_rate: 0.4,
        }),
      ]),
    );

    const category = (await handlers.get("get_category_sales")?.({ start_date: "2026-01-01", end_date: "2026-01-31", channel: "all" }))
      ?.structuredContent ?? {};
    expect(category.categories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "分類", revenue: 100, quantity: 2, order_count: 1, product_count: 1, avg_item_price: 50 }),
      ]),
    );

    const promotionAnalysis = (await handlers.get("get_promotion_analysis")?.({ status: "all" }))?.structuredContent ?? {};
    expect(promotionAnalysis.type_breakdown).toMatchObject({ percentage: { count: 1, total_use_count: 3 } });
    expect(promotionAnalysis.promotions).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "promotion-1", sum_use_count: 3, utilization: "30%" })]),
    );

    const refundByStore = (await handlers.get("get_refund_by_store")?.({ start_date: "2026-01-01", end_date: "2026-01-31" }))?.structuredContent ?? {};
    expect(refundByStore.stores).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          store_name: "線上官網",
          refund_count: 1,
          refund_amount: 50,
          top_refunded_items: [{ item: "SKU-1", quantity: 1 }],
        }),
      ]),
    );

    const transfer = (await handlers.get("get_stock_transfer_suggestions")?.({ min_stock_diff: 1 }))?.structuredContent ?? {};
    expect(transfer).toMatchObject({ products_analyzed: 1, suggestions_count: 1 });
    expect(transfer.suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from_warehouse: "Main", from_quantity: 10, to_warehouse: "Outlet", to_quantity: 2, suggested_transfer_qty: 4 }),
      ]),
    );

    const promotionRoi = (await handlers.get("get_promotion_roi")?.({ start_date: "2026-01-01", end_date: "2026-01-31" }))?.structuredContent ?? {};
    expect(promotionRoi).toMatchObject({ total_orders_analyzed: 1, total_promotions_used: 1 });
    expect(promotionRoi.promotions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ promotion_id: "promotion-1", orders_count: 1, total_revenue: 100, total_discount: 20, discount_rate: "20%" }),
      ]),
    );

    const lifecycle = (
      await handlers.get("get_customer_lifecycle")?.({
        period1_start: "2026-01-01",
        period1_end: "2026-01-31",
        period2_start: "2026-02-01",
        period2_end: "2026-02-28",
        r_days: 30,
        f_threshold: 2,
        m_threshold: 5000,
      })
    )?.structuredContent ?? {};
    expect(lifecycle).toMatchObject({ period1_customers: 1, period2_customers: 1 });
    expect(lifecycle.segment_migration).toEqual(expect.arrayContaining([expect.objectContaining({ count: 1 })]));

    const slowMovers = (await handlers.get("get_slow_movers")?.({ start_date: "2026-01-01", end_date: "2026-01-31", days_threshold: 30 }))
      ?.structuredContent ?? {};
    expect(slowMovers).toMatchObject({ total_products_with_stock: 1, slow_movers_count: 1, zero_sales_count: 0 });
    expect(slowMovers.slow_movers).toEqual(
      expect.arrayContaining([expect.objectContaining({ product_id: "product-1", units_sold: 2, days_of_supply: 75, status: "滯銷" })]),
    );
  });

  it("get_stock_by_warehouse returns warehouse totals and variant matrix", async () => {
    const handler = toolHandlers().get("get_stock_by_warehouse");
    if (!handler) throw new Error("Missing handler for get_stock_by_warehouse");

    const result = await handler({ product_id: "product-1" });

    expect(result.structuredContent).toMatchObject({
      products_queried: 1,
      total_variants: 1,
      warehouse_summary: {
        Main: { total_quantity: 10, sku_count: 1, oos_skus: 0 },
        Outlet: { total_quantity: 2, sku_count: 1, oos_skus: 0 },
      },
    });
    expect(result.structuredContent?.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ product_id: "product-1", sku: "SKU-1-R-M", warehouses: { Main: 10, Outlet: 2 } })]),
    );
  });

  it("get_product_variants preserves the Python missing-product error shape", async () => {
    setFetchImplementation((async () => jsonResponse(page([]))) as typeof fetch);
    const handler = toolHandlers().get("get_product_variants");
    if (!handler) throw new Error("Missing handler for get_product_variants");

    const result = await handler({ product_id: "missing-product" });

    expect(result.structuredContent).toEqual({ error: "Product missing-product not found" });
  });
});

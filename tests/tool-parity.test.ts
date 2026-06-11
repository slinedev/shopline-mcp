import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetFetchImplementation, setFetchImplementation } from "../src/client.js";
import { customHandlers } from "../src/tools/custom.js";

function money(dollars: number) {
  return { dollars };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("representative tool parity", () => {
  beforeEach(() => {
    process.env.SHOPLINE_API_TOKEN = "test-token";
  });

  afterEach(() => {
    resetFetchImplementation();
    delete process.env.SHOPLINE_API_TOKEN;
  });

  it("computes the same sales summary shape from order data", async () => {
    setFetchImplementation((async (input) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/v1/orders/search");
      return jsonResponse({
        items: [
          {
            id: "o1",
            status: "confirmed",
            total: money(1200),
            subtotal: money(1500),
            order_discount: money(300),
            created_from: "shop",
            subtotal_items: [{ quantity: 2 }],
            order_payment: { name_translations: { "zh-hant": "信用卡" } },
            order_delivery: { name_translations: { "zh-hant": "宅配" } },
          },
          {
            id: "o2",
            status: "cancelled",
            total: money(999),
            subtotal: money(999),
            order_discount: money(0),
            created_from: "shop",
            subtotal_items: [{ quantity: 1 }],
          },
        ],
        pagination: { total_pages: 1 },
      });
    }) as typeof fetch);

    const getSalesSummary = customHandlers.get_sales_summary;
    if (!getSalesSummary) throw new Error("get_sales_summary handler is not registered");

    const result = await getSalesSummary({
      start_date: "2026-03-01",
      end_date: "2026-03-31",
      status: "completed",
      channel: "all",
    });

    expect(result).toMatchObject({
      order_count: 1,
      total_revenue: 1200,
      total_subtotal: 1500,
      total_discount: 300,
      total_items_qty: 2,
      avg_order_value: 1200,
      avg_item_price: 600,
      payment_breakdown: { "信用卡": 1 },
      delivery_breakdown: { "宅配": 1 },
    });
  });

  it("summarizes product inventory like the Python implementation", async () => {
    setFetchImplementation((async (input) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/v1/products");
      return jsonResponse({
        items: [
          {
            id: "p1",
            title_translations: { "zh-hant": "鞋" },
            brand: "A",
            variations: [
              { sku: "s1", quantity: 0, cost: money(100) },
              { sku: "s2", quantity: 2, cost: money(100) },
            ],
          },
        ],
        pagination: { total_pages: 1 },
      });
    }) as typeof fetch);

    const getInventoryOverview = customHandlers.get_inventory_overview;
    if (!getInventoryOverview) throw new Error("get_inventory_overview handler is not registered");

    const result = await getInventoryOverview({});
    expect(result).toMatchObject({
      total_products: 1,
      total_skus: 2,
      total_quantity: 2,
      total_cost_value: 200,
      out_of_stock_skus: 1,
      low_stock_skus: 1,
    });
  });
});

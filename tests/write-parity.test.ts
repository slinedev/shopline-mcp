import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { endpointPathParams, getUrl } from "../src/config.js";
import { resetFetchImplementation, setFetchImplementation } from "../src/client.js";
import { registerShoplineTools, SHOPLINE_TOOL_SPECS } from "../src/tools/register.js";
import type { ApiOperation, ParamSpec, ToolSpec } from "../src/types.js";

interface CapturedCall {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
}

type ToolHandler = (args: Record<string, unknown>) => Promise<{ structuredContent?: Record<string, unknown> }>;

const specialWriteTools = new Set([
  "create_customer",
  "update_customer",
  "update_customer_store_credits",
  "adjust_customer_member_points",
  "cancel_order",
  "bulk_execute_shipment",
  "update_order_status",
  "delete_purchase_orders",
]);

const sampleValues: Record<string, unknown> = {
  addon_data: { title: "Addon" },
  addon_product_id: "addon-1",
  amount: 25,
  birthday: "1990-01-01",
  campaign_data: { title: "Campaign" },
  campaign_id: "campaign-1",
  category_data: { title: "Category" },
  category_id: "category-1",
  category_ids: ["category-1"],
  comment_id: "comment-1",
  comment_ids: ["comment-1", "comment-2"],
  coupon_data: { coupon_code: "CODE" },
  customer_id: "customer-1",
  delivery_data: { tracking_number: "TRACK" },
  delivery_id: "delivery-1",
  delivery_option_id: "delivery-option-1",
  delivery_status: "shipped",
  email: "alice@example.com",
  fields: ["紅", "M"],
  gender: "female",
  gift_data: { title: "Gift" },
  gift_id: "gift-1",
  image_ids: ["image-1"],
  image_urls: ["https://example.com/image.jpg"],
  media_data: { url: "https://example.com/image.jpg" },
  merchant_data: { name: "Merchant" },
  merchant_id: "merchant-1",
  message_data: { message: "hello" },
  metafield_data: { namespace: "custom", key: "foo", value: "bar" },
  name: "Alice",
  note: "note",
  order_data: { customer_id: "customer-1" },
  order_id: "order-1",
  order_ids: ["order-1", "order-2"],
  payment_status: "paid",
  phone: "0912",
  pickup_store_data: { name: "Pickup" },
  points: 10,
  price: 99,
  product_data: { title: "Product" },
  product_id: "product-1",
  product_ids: ["product-1", "product-2"],
  promotion_data: { title: "Promotion" },
  promotion_id: "promotion-1",
  purchase_order_data: { supplier: "Supplier" },
  purchase_order_ids: ["purchase-order-1", "purchase-order-2"],
  quantity: 5,
  reason: "customer request",
  return_order_data: { order_id: "order-1" },
  return_order_id: "return-order-1",
  review_data: { rating: 5, content: "good" },
  reviews: [{ rating: 5, content: "good" }],
  sku: "SKU-1",
  split_config: { shipments: [] },
  status: "confirmed",
  tags: ["vip"],
  updates: [{ sku: "SKU-1", quantity: 5 }],
  variation_data: { sku: "SKU-1-R-M" },
  variation_id: "variation-1",
};

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

function argsFor(spec: ToolSpec): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const param of spec.params) {
    args[param.name] = sampleValues[param.name] ?? fallbackValue(param);
  }
  return args;
}

function fallbackValue(param: ParamSpec): unknown {
  if (param.hasDefault) return param.default;
  if (param.enum?.length) return param.enum[0];
  if (param.kind === "integer" || param.kind === "number") return 1;
  if (param.kind === "array") return ["sample"];
  if (param.kind === "object") return { sample: true };
  if (param.kind === "boolean") return true;
  return `${param.name}-sample`;
}

function pathParamsFor(operation: ApiOperation, args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(endpointPathParams(operation.endpointKey).map((key) => [key, args[key]]));
}

function literalBodyFromExpression(expression: string | undefined, args: Record<string, unknown>): unknown {
  if (!expression) return undefined;
  const trimmed = expression.trim();
  if (trimmed === "{}") return {};
  if (/^[A-Za-z_]\w*$/.test(trimmed)) return args[trimmed];

  const body: Record<string, unknown> = {};
  for (const match of trimmed.matchAll(/['"]([A-Za-z_]\w*)['"]\s*:\s*([A-Za-z_]\w*)/g)) {
    const key = match[1];
    const varName = match[2];
    if (key && varName) body[key] = args[varName];
  }
  return Object.keys(body).length ? body : undefined;
}

function expectedBody(operation: ApiOperation, args: Record<string, unknown>): unknown {
  const expressionBody = literalBodyFromExpression(operation.json_body, args);
  if (expressionBody !== undefined) return expressionBody;

  const bodyParam = Object.keys(args).find((key) => key.endsWith("_data") || key.endsWith("_config"));
  if (bodyParam) return args[bodyParam];

  const simpleKeys = [
    "tags",
    "quantity",
    "price",
    "image_urls",
    "image_ids",
    "updates",
    "reviews",
    "comment_ids",
    "product_ids",
    "category_ids",
    "purchase_order_ids",
  ];
  const body: Record<string, unknown> = {};
  for (const key of simpleKeys) {
    if (args[key] !== undefined && args[key] !== null && args[key] !== "") body[key] = args[key];
  }
  return Object.keys(body).length ? body : {};
}

function installCapture(responseBody: unknown = { id: "created-id" }): CapturedCall[] {
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

describe("Python write parity", () => {
  beforeEach(() => {
    process.env.SHOPLINE_API_TOKEN = "test-token";
  });

  afterEach(() => {
    resetFetchImplementation();
    delete process.env.SHOPLINE_API_TOKEN;
  });

  it("covers every write tool with either the generic request matrix or a special parity assertion", () => {
    const genericWriteTools = SHOPLINE_TOOL_SPECS.filter((tool) => tool.write && !specialWriteTools.has(tool.name));

    expect(genericWriteTools.length + specialWriteTools.size).toBe(68);
    expect(genericWriteTools.every((tool) => tool.operations.length === 1)).toBe(true);
  });

  it("sends the expected method, URL, and body for every simple write tool", async () => {
    const genericWriteTools = SHOPLINE_TOOL_SPECS.filter((tool) => tool.write && !specialWriteTools.has(tool.name));

    for (const spec of genericWriteTools) {
      const operation = spec.operations[0];
      if (!operation) throw new Error(`Missing operation for ${spec.name}`);
      const calls = installCapture({ item: { id: "created-id" } });
      const args = argsFor(spec);

      await callTool(spec.name, args);

      expect(calls, spec.name).toEqual([
        {
          method: operation.method,
          url: getUrl(operation.endpointKey, pathParamsFor(operation, args)),
          body: expectedBody(operation, args),
        },
      ]);
    }
  });

  it("creates customers with only non-empty optional fields", async () => {
    const calls = installCapture({ item: { id: "customer-1" } });

    const result = await callTool("create_customer", {
      name: "Alice",
      email: "",
      phone: "0912",
      gender: null,
      birthday: undefined,
      tags: ["vip"],
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: "https://open.shopline.io/v1/customers",
      body: { name: "Alice", phone: "0912", tags: ["vip"] },
    });
    expect(result).toMatchObject({ success: true, resource_id: "customer-1", customer: { id: "customer-1" } });
  });

  it("rejects empty customer updates without calling the API", async () => {
    const calls = installCapture();

    const result = await callTool("update_customer", { customer_id: "customer-1" });

    expect(calls).toHaveLength(0);
    expect(result).toEqual({ success: false, resource_id: "customer-1", message: "未提供任何要更新的欄位" });
  });

  it("updates customer credits and points with Python-shaped bodies", async () => {
    const calls = installCapture({});

    await callTool("update_customer_store_credits", { customer_id: "customer-1", amount: 25, note: "bonus" });
    await callTool("adjust_customer_member_points", { customer_id: "customer-1", points: 10, note: "" });

    expect(calls).toEqual([
      {
        method: "PUT",
        url: "https://open.shopline.io/v1/customers/customer-1/store-credits",
        body: { amount: 25, note: "bonus" },
      },
      {
        method: "PUT",
        url: "https://open.shopline.io/v1/customers/customer-1/member-points",
        body: { points: 10 },
      },
    ]);
  });

  it("uses Python request bodies for order cancellation and bulk shipment", async () => {
    const calls = installCapture({ item: { id: "order-1" } });

    await callTool("cancel_order", { order_id: "order-1", reason: "customer request" });
    const bulkResult = await callTool("bulk_execute_shipment", { order_ids: ["order-1", "order-2"] });

    expect(calls).toEqual([
      {
        method: "POST",
        url: "https://open.shopline.io/v1/orders/order-1/cancel",
        body: { reason: "customer request" },
      },
      {
        method: "POST",
        url: "https://open.shopline.io/v1/orders/shipment/bulk",
        body: { order_ids: ["order-1", "order-2"] },
      },
    ]);
    expect(bulkResult).toMatchObject({ resource_id: "order-1,order-2", order_ids: ["order-1", "order-2"] });
  });

  it("updates only the provided order status fields", async () => {
    const calls = installCapture({});

    const emptyResult = await callTool("update_order_status", { order_id: "order-1" });
    const result = await callTool("update_order_status", {
      order_id: "order-1",
      status: "confirmed",
      delivery_status: null,
      payment_status: "paid",
    });

    expect(emptyResult).toEqual({
      success: false,
      resource_id: "order-1",
      message: "未提供任何狀態參數，至少需傳入一個狀態欄位",
      updated_fields: [],
    });
    expect(calls).toEqual([
      {
        method: "PATCH",
        url: "https://open.shopline.io/v1/orders/order-1/status",
        body: { status: "confirmed" },
      },
      {
        method: "PATCH",
        url: "https://open.shopline.io/v1/orders/order-1/payment-status",
        body: { payment_status: "paid" },
      },
    ]);
    expect(result).toMatchObject({ success: true, resource_id: "order-1", updated_fields: ["status", "payment_status"] });
  });

  it("deletes purchase orders with the Python ids body and empty-list guard", async () => {
    const calls = installCapture({});

    const emptyResult = await callTool("delete_purchase_orders", { purchase_order_ids: [] });
    const result = await callTool("delete_purchase_orders", { purchase_order_ids: ["po-1", "po-2"] });

    expect(emptyResult).toEqual({ success: false, resource_id: "", message: "未提供任何採購單 ID" });
    expect(calls).toEqual([
      {
        method: "DELETE",
        url: "https://open.shopline.io/v1/pos/purchase_orders",
        body: { ids: ["po-1", "po-2"] },
      },
    ]);
    expect(result).toEqual({
      success: true,
      resource_id: "po-1, po-2",
      message: "採購單已刪除（共 2 筆）：po-1, po-2",
    });
  });
});

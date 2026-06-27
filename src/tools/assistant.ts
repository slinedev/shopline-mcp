import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { fetchAllPages } from "../client.js";
import { getConfiguredStoreProfiles, withShoplineStore } from "../config.js";
import { toolSpecs } from "../generated/toolSpecs.js";
import { asArray, asRecord, daysBetween, getTranslation, parseDate, round, sumQuantity, VALID_ORDER_STATUSES } from "../shared/helpers.js";
import { toToolError, toToolResult } from "../shared/helpers.js";
import type { ToolSpec } from "../types.js";
import { buildWritePreview } from "./operationPlan.js";

const BUSINESS_TOOL_SPECS = toolSpecs as readonly ToolSpec[];

export const ASSISTANT_TOOL_NAMES = [
  "describe_shopline_mcp_capabilities",
  "find_shopline_tools",
  "explain_shopline_tool",
  "recommend_shopline_workflow",
  "preview_shopline_write_tool",
  "list_shopline_store_profiles",
  "audit_shopline_product_content",
  "audit_shopline_seo_readiness",
  "forecast_shopline_reorder_candidates",
  "prepare_shopline_write_approval",
] as const;

type AssistantToolName = (typeof ASSISTANT_TOOL_NAMES)[number];
type AssistantHandler = (args: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>;

interface AssistantToolDefinition {
  readonly name: AssistantToolName;
  readonly description: string;
  readonly inputSchema: z.ZodObject<Record<string, z.ZodTypeAny>>;
  readonly handler: AssistantHandler;
}

const DOMAIN_ORDER = [
  "Orders",
  "Products & Inventory",
  "Analytics",
  "Customers",
  "Categories & Promotions",
  "Conversations & Reviews",
  "Store Settings",
  "Other",
];

function clampLimit(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(max, Math.floor(parsed));
}

function firstLine(description: string): string {
  return description.split("\n").find((line) => line.trim())?.trim() ?? "";
}

function domainForTool(spec: ToolSpec): string {
  const key = `${spec.module} ${spec.name}`.toLowerCase();
  if (key.includes("analytics")) return "Analytics";
  if (key.includes("customer") || key.includes("member") || key.includes("store_credit")) return "Customers";
  if (key.includes("product") || key.includes("inventory") || key.includes("warehouse") || key.includes("gift") || key.includes("addon")) {
    return "Products & Inventory";
  }
  if (key.includes("promotion") || key.includes("coupon") || key.includes("category") || key.includes("affiliate") || key.includes("flash_price")) {
    return "Categories & Promotions";
  }
  if (key.includes("conversation") || key.includes("review")) return "Conversations & Reviews";
  if (key.includes("merchant") || key.includes("payment") || key.includes("delivery") || key.includes("settings") || key.includes("tax") || key.includes("staff") || key.includes("token") || key.includes("agent") || key.includes("channel")) {
    return "Store Settings";
  }
  if (key.includes("order") || key.includes("return")) return "Orders";
  return "Other";
}

function summarizeTool(spec: ToolSpec): Record<string, unknown> {
  return {
    name: spec.name,
    mode: spec.write ? "write" : "read",
    domain: domainForTool(spec),
    summary: firstLine(spec.description),
    params: spec.params.map((param) => param.name),
    endpoints: spec.docEndpoints,
  };
}

function describeCapabilities(): Record<string, unknown> {
  const domains = DOMAIN_ORDER.map((domain) => {
    const tools = BUSINESS_TOOL_SPECS.filter((spec) => domainForTool(spec) === domain);
    if (!tools.length) return undefined;
    return {
      domain,
      total: tools.length,
      read: tools.filter((tool) => !tool.write).length,
      write: tools.filter((tool) => tool.write).length,
      example_tools: tools.slice(0, 6).map((tool) => tool.name),
    };
  }).filter(Boolean);

  return {
    business_tools: {
      total: BUSINESS_TOOL_SPECS.length,
      read: BUSINESS_TOOL_SPECS.filter((tool) => !tool.write).length,
      write: BUSINESS_TOOL_SPECS.filter((tool) => tool.write).length,
    },
    assistant_tools: {
      total: ASSISTANT_TOOL_NAMES.length,
      names: [...ASSISTANT_TOOL_NAMES],
    },
    strengths: [
      "Direct Shopline store operations over stdio.",
      "Merchant analytics for sales, inventory, promotions, refunds, and customers.",
      "Structured parameters and JSON output for AI clients.",
      "Write tools are marked with side-effect descriptions and support dry_run previews.",
    ],
    domains,
    safety: {
      write_marker: "[WRITE]",
      side_effect_marker: "【副作用】",
      dry_run_supported: true,
      approval_code_supported: true,
      approval_env_var: "SHOPLINE_REQUIRE_WRITE_APPROVAL",
      store_alias_supported: true,
    },
  };
}

function findTools(args: Record<string, unknown>): Record<string, unknown> {
  const query = String(args.query ?? "").trim().toLowerCase();
  const domain = String(args.domain ?? "").trim().toLowerCase();
  const mode = String(args.mode ?? "all");
  const limit = clampLimit(args.max_results, 20, 50);

  const matches = BUSINESS_TOOL_SPECS.filter((spec) => {
    if (mode === "read" && spec.write) return false;
    if (mode === "write" && !spec.write) return false;
    if (domain && domainForTool(spec).toLowerCase() !== domain) return false;
    if (!query) return true;
    const haystack = [
      spec.name,
      spec.module,
      spec.description,
      ...spec.params.map((param) => `${param.name} ${param.description}`),
      ...spec.docEndpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`),
    ]
      .join("\n")
      .toLowerCase();
    return query
      .split(/\s+/)
      .filter(Boolean)
      .every((part) => haystack.includes(part));
  });

  return {
    query: query || null,
    mode,
    total_found: matches.length,
    returned: Math.min(matches.length, limit),
    matches: matches.slice(0, limit).map(summarizeTool),
  };
}

function explainTool(args: Record<string, unknown>): Record<string, unknown> {
  const toolName = String(args.tool_name ?? "");
  const spec = BUSINESS_TOOL_SPECS.find((item) => item.name === toolName);
  if (!spec) throw new Error(`Unknown Shopline tool: ${toolName}`);

  return {
    name: spec.name,
    mode: spec.write ? "write" : "read",
    domain: domainForTool(spec),
    summary: firstLine(spec.description),
    description: spec.description,
    parameters: spec.params.map((param) => ({
      name: param.name,
      kind: param.kind,
      required: !param.optional && !param.hasDefault,
      default: param.hasDefault ? param.default : undefined,
      description: param.description,
      enum: param.enum,
    })),
    endpoints: spec.docEndpoints,
    safety: spec.write
      ? {
          side_effects: spec.description.includes("【副作用】"),
          dry_run_supported: true,
          preview_tool: "preview_shopline_write_tool",
        }
      : {
          read_only: true,
        },
  };
}

const WORKFLOWS = [
  {
    name: "sales_report",
    keywords: ["sales", "revenue", "report", "weekly", "daily", "銷售", "销售", "營收", "营收", "週報", "周报", "日報", "日报"],
    steps: [
      { tool: "get_sales_summary", why: "Summarize revenue, order count, discounts, payment, and delivery mix." },
      { tool: "get_top_products", why: "Identify the products driving revenue or quantity." },
      { tool: "get_sales_trend", why: "Show daily, weekly, or monthly movement." },
      { tool: "get_channel_comparison", why: "Compare online and POS/store performance." },
    ],
    required_inputs: ["start_date", "end_date", "channel"],
  },
  {
    name: "inventory_risk",
    keywords: ["inventory", "stock", "low stock", "warehouse", "庫存", "库存", "缺貨", "缺货", "倉庫", "仓库"],
    steps: [
      { tool: "get_inventory_overview", why: "Get broad inventory health." },
      { tool: "get_low_stock_alerts", why: "Find SKUs that need action." },
      { tool: "get_stock_transfer_suggestions", why: "Suggest movement between warehouses when stock is uneven." },
      { tool: "get_slow_movers", why: "Identify items tying up inventory." },
    ],
    required_inputs: ["threshold", "days_threshold"],
  },
  {
    name: "promotion_review",
    keywords: ["promotion", "coupon", "discount", "campaign", "促銷", "促销", "折扣", "優惠券", "优惠券"],
    steps: [
      { tool: "list_promotions", why: "List active and recent promotions." },
      { tool: "get_promotion_analysis", why: "Measure promotion usage from order data." },
      { tool: "get_promotion_roi", why: "Compare promotion impact between two periods." },
      { tool: "get_affiliate_campaign_usage", why: "Review affiliate order usage when a campaign is involved." },
    ],
    required_inputs: ["start_date", "end_date", "promotion_id"],
  },
  {
    name: "customer_segments",
    keywords: ["customer", "rfm", "repurchase", "lifecycle", "segment", "客戶", "客户", "回購", "回购", "分層", "分层"],
    steps: [
      { tool: "get_rfm_analysis", why: "Segment customers by recency, frequency, and monetary value." },
      { tool: "get_repurchase_analysis", why: "Understand repeat purchase rate and cycle." },
      { tool: "get_customer_lifecycle", why: "Group customers into lifecycle stages." },
      { tool: "list_customers", why: "Find concrete customer records when action is needed." },
    ],
    required_inputs: ["start_date", "end_date"],
  },
  {
    name: "order_operations",
    keywords: ["order", "shipment", "ship", "cancel", "status", "訂單", "订单", "出貨", "出货", "取消"],
    steps: [
      { tool: "query_orders", why: "Find the target orders first." },
      { tool: "get_order_detail", why: "Check current payment, delivery, customer, and item state." },
      { tool: "preview_shopline_write_tool", why: "Preview the intended write operation before changing store data." },
      { tool: "update_order_status", why: "Apply status changes only after merchant confirmation." },
    ],
    required_inputs: ["order_id", "status", "delivery_status", "payment_status"],
  },
  {
    name: "product_updates",
    keywords: ["product", "price", "quantity", "sku", "商品", "價格", "价格", "數量", "数量"],
    steps: [
      { tool: "get_product_list", why: "Find the target product or SKU." },
      { tool: "get_product_variants", why: "Check variant IDs before changing price or stock." },
      { tool: "preview_shopline_write_tool", why: "Preview product write request body and endpoint." },
      { tool: "update_product_price", why: "Update price only after confirmation." },
    ],
    required_inputs: ["product_id", "variation_id", "price", "quantity"],
  },
  {
    name: "product_content_review",
    keywords: ["description", "content", "copy", "商品描述", "內容", "内容", "文案", "一致"],
    steps: [
      { tool: "audit_shopline_product_content", why: "Find products with missing or weak merchant-facing content." },
      { tool: "get_product_list", why: "Review product context before drafting changes." },
      { tool: "prepare_shopline_write_approval", why: "Prepare a human-reviewed write preview before changing product content." },
      { tool: "update_product", why: "Apply approved product content changes only after review." },
    ],
    required_inputs: ["max_products", "min_description_length", "product_id", "product_data"],
  },
  {
    name: "seo_geo_readiness",
    keywords: ["seo", "geo", "keyword", "search", "關鍵字", "关键字", "搜尋", "搜索"],
    steps: [
      { tool: "audit_shopline_seo_readiness", why: "Find products missing SEO/GEO fields and produce review drafts." },
      { tool: "get_category_tree", why: "Confirm available category context before approving updates." },
      { tool: "prepare_shopline_write_approval", why: "Generate an approval code for the reviewed product update." },
      { tool: "update_product", why: "Apply approved SEO/GEO metadata updates." },
    ],
    required_inputs: ["max_products", "product_id", "product_data"],
  },
  {
    name: "reorder_forecast",
    keywords: ["reorder", "forecast", "purchase", "補貨", "补货", "預測", "预测", "採購", "采购"],
    steps: [
      { tool: "forecast_shopline_reorder_candidates", why: "Estimate which SKUs may run out within the planning horizon." },
      { tool: "get_locked_inventory", why: "Check inventory already reserved by pending fulfillment." },
      { tool: "list_purchase_orders", why: "Review recent purchase orders before creating a new one." },
      { tool: "prepare_shopline_write_approval", why: "Preview any purchase order or inventory write before execution." },
    ],
    required_inputs: ["start_date", "end_date", "horizon_days", "low_stock_threshold"],
  },
];

function recommendWorkflow(args: Record<string, unknown>): Record<string, unknown> {
  const task = String(args.task ?? "");
  const normalized = task.toLowerCase();
  const defaultWorkflow = WORKFLOWS[0];
  if (!defaultWorkflow) throw new Error("No Shopline workflows are configured");
  const workflow =
    WORKFLOWS.find((item) => item.keywords.some((keyword) => normalized.includes(keyword.toLowerCase()))) ?? defaultWorkflow;

  return {
    task,
    workflow: workflow.name,
    required_inputs: workflow.required_inputs,
    steps: workflow.steps.map((step, index) => {
      const spec = BUSINESS_TOOL_SPECS.find((tool) => tool.name === step.tool);
      return {
        step: index + 1,
        tool: step.tool,
        mode: spec?.write ? "write" : step.tool === "preview_shopline_write_tool" ? "assistant" : "read",
        why: step.why,
        safety: spec?.write ? "Use dry_run first and confirm with the merchant before executing." : undefined,
      };
    }),
  };
}

async function previewWriteTool(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const toolName = String(args.tool_name ?? "");
  const spec = BUSINESS_TOOL_SPECS.find((item) => item.name === toolName);
  if (!spec) throw new Error(`Unknown Shopline tool: ${toolName}`);
  if (!spec.write) throw new Error(`Tool ${toolName} is read-only`);

  const writeArgs = args.args && typeof args.args === "object" && !Array.isArray(args.args) ? (args.args as Record<string, unknown>) : {};
  const storeAlias = args.store_alias ?? writeArgs.store_alias;
  const previewArgs = typeof storeAlias === "string" && storeAlias ? { ...writeArgs, store_alias: storeAlias } : writeArgs;
  return withShoplineStore(storeAlias, async () => buildWritePreview(spec, previewArgs));
}

async function prepareWriteApproval(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const preview = await previewWriteTool(args);
  return {
    ...preview,
    approval_required_when: "SHOPLINE_REQUIRE_WRITE_APPROVAL=1",
    human_review_required: true,
  };
}

function listStoreProfiles(): Record<string, unknown> {
  return {
    stores: getConfiguredStoreProfiles(),
  };
}

function hasText(value: unknown): boolean {
  return typeof value === "string" ? value.trim().length > 0 : value !== undefined && value !== null && value !== "";
}

function localizedText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  return getTranslation(value).trim();
}

function productTitle(product: Record<string, unknown>): string {
  return localizedText(product.title_translations) || localizedText(product.name_translations) || String(product.title ?? product.name ?? "").trim();
}

function productDescription(product: Record<string, unknown>): string {
  return (
    localizedText(product.description_translations) ||
    localizedText(product.seo_description_translations) ||
    String(product.description ?? product.body_html ?? product.content ?? "").trim()
  );
}

function productSeoTitle(product: Record<string, unknown>): string {
  return localizedText(product.seo_title_translations) || String(product.seo_title ?? "").trim();
}

function productSeoDescription(product: Record<string, unknown>): string {
  return localizedText(product.seo_description_translations) || String(product.seo_description ?? "").trim();
}

function productSeoKeywords(product: Record<string, unknown>): string[] {
  const rawKeywords = product.seo_keywords ?? product.keywords ?? localizedText(product.seo_keywords_translations);
  const fromText =
    typeof rawKeywords === "string"
      ? rawKeywords
          .split(/[,，\s]+/)
          .map((item) => item.trim())
          .filter(Boolean)
      : [];
  return [...fromText, ...productTags(product)];
}

function productTags(product: Record<string, unknown>): string[] {
  return asArray(product.tags)
    .map(String)
    .map((item) => item.trim())
    .filter(Boolean);
}

function productCategoryIds(product: Record<string, unknown>): string[] {
  return [...asArray(product.category_ids), ...asArray(product.categories).map((category) => asRecord(category).id)]
    .filter(hasText)
    .map(String)
    .filter(Boolean);
}

function productImageCount(product: Record<string, unknown>): number {
  const images = asArray(product.images).length + asArray(product.media).length + asArray(product.photos).length;
  const singleImages = [product.image_url, product.cover_image, product.featured_image].filter(hasText).length;
  return images + singleImages;
}

function productStock(product: Record<string, unknown>): number {
  const variations = asArray(product.variations);
  return variations.length ? sumQuantity(variations, 0) : Number(product.quantity ?? 0);
}

function productSku(product: Record<string, unknown>): string {
  const firstVariation = asRecord(asArray(product.variations)[0]);
  const sku = product.sku ?? firstVariation.sku;
  return hasText(sku) ? String(sku) : "";
}

function dateRangeDays(startDate: string, endDate: string): number {
  const days = daysBetween(parseDate(`${startDate}T00:00:00Z`), parseDate(`${endDate}T00:00:00Z`));
  return days || 1;
}

function periodParams(startDate: string, endDate: string): Record<string, string> {
  return {
    created_after: `${startDate}T00:00:00Z`,
    created_before: `${endDate}T23:59:59Z`,
  };
}

async function fetchProducts(limit: number): Promise<Record<string, unknown>[]> {
  const pages = Math.max(1, Math.ceil(limit / 50));
  return (await fetchAllPages("products", { per_page: 50 }, undefined, pages)).slice(0, limit);
}

async function auditProductContent(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const limit = clampLimit(args.max_products, 50, 200);
  const minDescriptionLength = clampLimit(args.min_description_length, 30, 500);
  const products = await fetchProducts(limit);
  const flagged = products
    .map((product) => {
      const title = productTitle(product);
      const description = productDescription(product);
      const tags = productTags(product);
      const categoryIds = productCategoryIds(product);
      const issues: string[] = [];
      if (!title) issues.push("missing_title");
      if (!description) issues.push("missing_description");
      else if (description.length < minDescriptionLength) issues.push("short_description");
      if (!hasText(product.brand)) issues.push("missing_brand");
      if (!productImageCount(product)) issues.push("missing_images");
      if (!categoryIds.length) issues.push("missing_categories");
      if (!tags.length) issues.push("missing_tags");
      return {
        product_id: product.id,
        title,
        sku: productSku(product),
        issues,
        review_required: issues.length > 0,
        current_fields: {
          has_description: Boolean(description),
          description_length: description.length,
          brand: product.brand ?? "",
          image_count: productImageCount(product),
          category_count: categoryIds.length,
          tag_count: tags.length,
        },
        recommended_action: issues.length ? "請人工審閱後補齊商品內容，再用寫入預覽產生 approval_code。" : "內容欄位完整。",
      };
    })
    .filter((product) => product.issues.length > 0);

  return {
    total_products: products.length,
    products_needing_review: flagged.length,
    issues_count: flagged.reduce((sum, product) => sum + product.issues.length, 0),
    products: flagged,
  };
}

function suggestedKeywords(product: Record<string, unknown>): string[] {
  const candidates = [productTitle(product), String(product.brand ?? ""), ...productTags(product)]
    .map((item) => item.trim())
    .filter(Boolean);
  return [...new Set(candidates)].slice(0, 6);
}

async function auditSeoReadiness(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const limit = clampLimit(args.max_products, 50, 200);
  const products = await fetchProducts(limit);
  const flagged = products
    .map((product) => {
      const seoIssues: string[] = [];
      if (!productSeoTitle(product) && !productTitle(product)) seoIssues.push("missing_seo_title");
      if (!productSeoDescription(product) && !productDescription(product)) seoIssues.push("missing_seo_description");
      if (!productSeoKeywords(product).length) seoIssues.push("missing_keywords");
      if (!productCategoryIds(product).length) seoIssues.push("missing_categories");
      return {
        product_id: product.id,
        title: productTitle(product),
        sku: productSku(product),
        seo_issues: seoIssues,
        suggested_keywords: suggestedKeywords(product),
        review_required: seoIssues.length > 0,
      };
    })
    .filter((product) => product.seo_issues.length > 0);

  return {
    summary: {
      products_checked: products.length,
      products_needing_review: flagged.length,
      drafts_created: flagged.length,
    },
    products: flagged,
    update_drafts: flagged.map((product) => ({
      product_id: product.product_id,
      suggested_write_tool: "update_product",
      review_required: true,
      draft_product_data: {
        seo_keywords: product.suggested_keywords,
      },
      note: "此草稿只供人工審閱，不會自動寫入 Shopline。",
    })),
  };
}

function orderItemProductId(item: Record<string, unknown>): string {
  return String(item.item_id ?? item.product_id ?? asRecord(item.object_data).product_id ?? "");
}

async function fetchRevenueOrders(startDate: string, endDate: string): Promise<Record<string, unknown>[]> {
  const orders = await fetchAllPages("orders_search", periodParams(startDate, endDate), undefined, 20);
  return orders.filter((order) => VALID_ORDER_STATUSES.has(String(order.status ?? "")));
}

async function lockedInventory(): Promise<Map<string, number>> {
  const locks = await fetchAllPages("products_locked_inventory", { per_page: 50 }, undefined, 5);
  const map = new Map<string, number>();
  for (const lock of locks) {
    const quantity = Number(lock.locked_quantity ?? lock.quantity ?? 0);
    for (const key of [lock.product_id, lock.item_id, lock.sku]) {
      if (!hasText(key)) continue;
      const text = String(key);
      map.set(text, (map.get(text) ?? 0) + quantity);
    }
  }
  return map;
}

async function forecastReorderCandidates(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const startDate = String(args.start_date ?? "");
  const endDate = String(args.end_date ?? "");
  if (!startDate || !endDate) throw new Error("start_date and end_date are required");
  const horizonDays = clampLimit(args.horizon_days, 14, 365);
  const lowStockThreshold = clampLimit(args.low_stock_threshold, 5, 10_000);
  const maxProducts = clampLimit(args.max_products, 50, 200);
  const periodDays = dateRangeDays(startDate, endDate);
  const products = await fetchProducts(maxProducts);
  const orders = await fetchRevenueOrders(startDate, endDate);
  const locked = await lockedInventory();
  const salesByProduct = new Map<string, number>();
  const salesBySku = new Map<string, number>();

  for (const order of orders) {
    for (const rawItem of asArray(order.subtotal_items)) {
      const item = asRecord(rawItem);
      const quantity = Number(item.quantity ?? 1);
      const productId = orderItemProductId(item);
      const sku = String(item.sku ?? "");
      if (productId) salesByProduct.set(productId, (salesByProduct.get(productId) ?? 0) + quantity);
      if (sku) salesBySku.set(sku, (salesBySku.get(sku) ?? 0) + quantity);
    }
  }

  const candidates = products
    .map((product) => {
      const productId = String(product.id ?? "");
      const sku = productSku(product);
      const currentStock = productStock(product);
      const lockedQuantity = productId && locked.has(productId) ? (locked.get(productId) ?? 0) : sku ? (locked.get(sku) ?? 0) : 0;
      const availableStock = Math.max(0, currentStock - lockedQuantity);
      const unitsSold = (productId ? salesByProduct.get(productId) ?? 0 : 0) || (sku ? salesBySku.get(sku) ?? 0 : 0);
      const dailyAvgSales = unitsSold / periodDays;
      const daysOfSupply = dailyAvgSales > 0 ? availableStock / dailyAvgSales : Number.POSITIVE_INFINITY;
      const needsReorder =
        currentStock <= lowStockThreshold || (dailyAvgSales > 0 && daysOfSupply <= horizonDays) || (lockedQuantity > 0 && availableStock <= lowStockThreshold);
      const recommendedReorderQuantity = Math.max(0, Math.ceil(dailyAvgSales * horizonDays + lockedQuantity - currentStock));
      const status = currentStock <= 0 ? "已缺貨" : dailyAvgSales > 0 && daysOfSupply <= horizonDays ? "補貨優先" : "低庫存觀察";
      return {
        product_id: productId,
        title: productTitle(product),
        sku,
        current_stock: currentStock,
        locked_quantity: lockedQuantity,
        available_stock: availableStock,
        units_sold: unitsSold,
        daily_avg_sales: round(dailyAvgSales, 2),
        days_of_supply: Number.isFinite(daysOfSupply) ? round(daysOfSupply, 1) : "無銷售",
        horizon_days: horizonDays,
        recommended_reorder_quantity: recommendedReorderQuantity,
        status,
        needs_reorder: needsReorder,
      };
    })
    .filter((candidate) => candidate.needs_reorder)
    .map(({ needs_reorder: _needsReorder, ...candidate }) => candidate)
    .sort((a, b) => Number(a.days_of_supply === "無銷售" ? Number.POSITIVE_INFINITY : a.days_of_supply) - Number(b.days_of_supply === "無銷售" ? Number.POSITIVE_INFINITY : b.days_of_supply));

  return {
    period: `${startDate} ~ ${endDate}`,
    period_days: periodDays,
    horizon_days: horizonDays,
    low_stock_threshold: lowStockThreshold,
    products_checked: products.length,
    candidates_count: candidates.length,
    candidates,
  };
}

const assistantTools: readonly AssistantToolDefinition[] = [
  {
    name: "describe_shopline_mcp_capabilities",
    description: "說明目前 Shopline MCP 的工具數量、能力範圍、安全機制與適用場景。",
    inputSchema: z.object({}),
    handler: describeCapabilities,
  },
  {
    name: "find_shopline_tools",
    description: "依自然語言、領域或讀寫模式搜尋可用的 Shopline MCP 工具。",
    inputSchema: z.object({
      query: z.string().optional().describe("Search text such as 'low stock' or 'sales summary'."),
      domain: z.string().optional().describe("Optional exact domain filter from the capability summary."),
      mode: z.enum(["all", "read", "write"]).optional().default("all"),
      max_results: z.number().int().positive().optional().default(20),
    }),
    handler: findTools,
  },
  {
    name: "explain_shopline_tool",
    description: "解釋單一 Shopline MCP 工具的參數、端點、讀寫模式與安全注意事項。",
    inputSchema: z.object({
      tool_name: z.string().describe("Exact Shopline business tool name."),
    }),
    handler: explainTool,
  },
  {
    name: "recommend_shopline_workflow",
    description: "根據商家任務推薦應該使用哪些 Shopline MCP 工具與安全順序。",
    inputSchema: z.object({
      task: z.string().describe("Merchant task or question."),
    }),
    handler: recommendWorkflow,
  },
  {
    name: "preview_shopline_write_tool",
    description: "預覽寫入工具會呼叫的 Shopline API、路徑參數與 body，不會實際修改店鋪資料。",
    inputSchema: z.object({
      tool_name: z.string().describe("Exact write tool name to preview."),
      args: z.record(z.string(), z.unknown()).optional().default({}).describe("Arguments intended for the write tool."),
      store_alias: z.string().optional().describe("Optional store alias for multi-store URL preview."),
    }),
    handler: previewWriteTool,
  },
  {
    name: "prepare_shopline_write_approval",
    description: "產生 Human in the loop 寫入審核預覽與 approval_code，供人工確認後再執行寫入。",
    inputSchema: z.object({
      tool_name: z.string().describe("Exact write tool name to prepare for approval."),
      args: z.record(z.string(), z.unknown()).optional().default({}).describe("Arguments intended for the write tool."),
      store_alias: z.string().optional().describe("Optional store alias for multi-store URL preview."),
    }),
    handler: prepareWriteApproval,
  },
  {
    name: "list_shopline_store_profiles",
    description: "列出已配置的 Shopline store alias，不回傳任何 token 內容。",
    inputSchema: z.object({}),
    handler: listStoreProfiles,
  },
  {
    name: "audit_shopline_product_content",
    description: "掃描商品內容完整度，找出缺少描述、品牌、圖片、分類或標籤且需要人工審閱的商品。",
    inputSchema: z.object({
      max_products: z.number().int().positive().optional().default(50),
      min_description_length: z.number().int().positive().optional().default(30),
    }),
    handler: auditProductContent,
  },
  {
    name: "audit_shopline_seo_readiness",
    description: "檢查商品 SEO/GEO 準備度，列出缺少描述、關鍵字、分類等欄位並產生人工審閱草稿。",
    inputSchema: z.object({
      max_products: z.number().int().positive().optional().default(50),
    }),
    handler: auditSeoReadiness,
  },
  {
    name: "forecast_shopline_reorder_candidates",
    description: "依商品庫存、鎖定庫存與區間銷量估算補貨候選 SKU，僅提供人工決策參考。",
    inputSchema: z.object({
      start_date: z.string().describe("Sales analysis start date in YYYY-MM-DD."),
      end_date: z.string().describe("Sales analysis end date in YYYY-MM-DD."),
      horizon_days: z.number().int().positive().optional().default(14),
      low_stock_threshold: z.number().int().positive().optional().default(5),
      max_products: z.number().int().positive().optional().default(50),
    }),
    handler: forecastReorderCandidates,
  },
];

export function registerAssistantTools(server: McpServer): void {
  for (const tool of assistantTools) {
    server.registerTool(
      tool.name,
      {
        title: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (args) => {
        try {
          const output = await tool.handler(args as Record<string, unknown>);
          return toToolResult(output);
        } catch (error) {
          return toToolError(error);
        }
      },
    );
  }
}

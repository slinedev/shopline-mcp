import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getConfiguredStoreProfiles, withShoplineStore } from "../config.js";
import { toolSpecs } from "../generated/toolSpecs.js";
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
  return withShoplineStore(storeAlias, async () => buildWritePreview(spec, writeArgs));
}

function listStoreProfiles(): Record<string, unknown> {
  return {
    stores: getConfiguredStoreProfiles(),
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
    name: "list_shopline_store_profiles",
    description: "列出已配置的 Shopline store alias，不回傳任何 token 內容。",
    inputSchema: z.object({}),
    handler: listStoreProfiles,
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

import { ENDPOINTS, endpointPathParams } from "../config.js";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut, fetchAllPages } from "../client.js";
import { pageCountForLimit } from "../shared/helpers.js";
import type { ApiOperation, ToolContext } from "../types.js";

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

function maxResults(args: Record<string, unknown>, fallback = 50): number {
  const value = Number(args.max_results ?? args.top_n ?? fallback);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function operationFor(context: ToolContext): ApiOperation | undefined {
  if (context.spec.write) {
    return context.spec.operations.find((operation) => operation.method !== "GET") ?? context.spec.operations[0];
  }
  return context.spec.operations.find((operation) => operation.kind === "fetch_all_pages") ?? context.spec.operations[0];
}

function collectPathParams(endpointKey: string, args: Record<string, unknown>): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const key of endpointPathParams(endpointKey)) {
    params[key] = args[key];
  }
  return params;
}

function collectQueryParams(endpointKey: string, args: Record<string, unknown>): Record<string, unknown> {
  const pathKeys = new Set(endpointPathParams(endpointKey));
  const params: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(args)) {
    if (!isPresent(value)) continue;
    if (pathKeys.has(key)) continue;
    if (["max_results", "top_n", "product_data", "customer_data", "order_data", "promotion_data", "category_data"].includes(key)) {
      continue;
    }
    params[key] = value;
  }

  if (isPresent(args.search_keyword)) {
    params.keyword = args.search_keyword;
    delete params.search_keyword;
  }

  if (isPresent(args.start_date)) {
    params.created_after = `${args.start_date}T00:00:00Z`;
    delete params.start_date;
  }
  if (isPresent(args.end_date)) {
    params.created_before = `${args.end_date}T23:59:59Z`;
    delete params.end_date;
  }

  const limit = maxResults(args, 50);
  if (!endpointPathParams(endpointKey).length || endpointKey.includes("search")) {
    params.per_page ??= Math.min(50, limit);
  }

  return params;
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

function inferWriteBody(operation: ApiOperation, args: Record<string, unknown>): unknown {
  const fromExpression = literalBodyFromExpression(operation.json_body, args);
  if (fromExpression !== undefined) return fromExpression;

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
    if (isPresent(args[key])) body[key] = args[key];
  }
  return Object.keys(body).length ? body : {};
}

function resourceId(args: Record<string, unknown>, result: Record<string, unknown>): string {
  const fromArgs = Object.entries(args).find(([key]) => key.endsWith("_id") || key === "id");
  if (fromArgs?.[1]) return String(fromArgs[1]);
  const item = result.id ? result : result.item && typeof result.item === "object" ? (result.item as Record<string, unknown>) : undefined;
  return item?.id ? String(item.id) : "bulk";
}

async function executeRead(operation: ApiOperation, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const endpointKey = operation.endpointKey;
  const pathParams = collectPathParams(endpointKey, args);
  const queryParams = collectQueryParams(endpointKey, args);
  const limit = maxResults(args, 50);
  const pathTemplate = ENDPOINTS[endpointKey] ?? "";
  const hasPathParams = /\{\w+\}/.test(pathTemplate);

  if (operation.kind === "fetch_all_pages" || (!hasPathParams && (args.max_results !== undefined || endpointKey.endsWith("s")))) {
    const pages = pageCountForLimit(limit);
    const items = await fetchAllPages(endpointKey, queryParams, pathParams, pages);
    const sliced = items.slice(0, limit);
    return { total_found: items.length, returned: sliced.length, items: sliced };
  }

  return apiGet(endpointKey, queryParams, pathParams);
}

async function executeWrite(operation: ApiOperation, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const endpointKey = operation.endpointKey;
  const pathParams = collectPathParams(endpointKey, args);
  const body = inferWriteBody(operation, args);
  let result: Record<string, unknown>;

  if (operation.method === "POST") result = await apiPost(endpointKey, body, undefined, pathParams);
  else if (operation.method === "PUT") result = await apiPut(endpointKey, body, undefined, pathParams);
  else if (operation.method === "PATCH") result = await apiPatch(endpointKey, body, undefined, pathParams);
  else if (operation.method === "DELETE") result = await apiDelete(endpointKey, undefined, pathParams, body);
  else result = await apiGet(endpointKey, collectQueryParams(endpointKey, args), pathParams);

  return {
    success: true,
    resource_id: resourceId(args, result),
    message: `${endpointKey} ${operation.method} completed`,
    result,
  };
}

export async function executeGenericTool(context: ToolContext): Promise<Record<string, unknown>> {
  const operation = operationFor(context);
  if (!operation) {
    throw new Error(`No API operation metadata is available for tool ${context.spec.name}`);
  }
  return context.spec.write ? executeWrite(operation, context.args) : executeRead(operation, context.args);
}

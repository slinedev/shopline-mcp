import { createHash } from "node:crypto";

import { ENDPOINTS, endpointPathParams, getUrl } from "../config.js";
import { pageCountForLimit } from "../shared/helpers.js";
import type { ApiOperation, ToolContext, ToolSpec } from "../types.js";

export const RUNTIME_ARG_NAMES = new Set(["store_alias", "dry_run", "confirm_write", "approval_code"]);

export function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

export function maxResults(args: Record<string, unknown>, fallback = 50): number {
  const value = Number(args.max_results ?? args.top_n ?? fallback);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export function operationFor(context: ToolContext): ApiOperation | undefined {
  if (context.spec.write) {
    return context.spec.operations.find((operation) => operation.method !== "GET") ?? context.spec.operations[0];
  }
  return context.spec.operations.find((operation) => operation.kind === "fetch_all_pages") ?? context.spec.operations[0];
}

export function writeOperationFor(spec: ToolSpec): ApiOperation | undefined {
  return spec.operations.find((operation) => operation.method !== "GET") ?? spec.operations[0];
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, stableValue(item)]),
  );
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

export function collectPathParams(endpointKey: string, args: Record<string, unknown>): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const key of endpointPathParams(endpointKey)) {
    params[key] = args[key];
  }
  return params;
}

export function collectQueryParams(endpointKey: string, args: Record<string, unknown>): Record<string, unknown> {
  const pathKeys = new Set(endpointPathParams(endpointKey));
  const params: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(args)) {
    if (!isPresent(value)) continue;
    if (pathKeys.has(key)) continue;
    if (RUNTIME_ARG_NAMES.has(key)) continue;
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

export function inferWriteBody(operation: ApiOperation, args: Record<string, unknown>): unknown {
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

export function resourceId(args: Record<string, unknown>, result: Record<string, unknown>): string {
  const fromArgs = Object.entries(args).find(([key]) => key.endsWith("_id") || key === "id");
  if (fromArgs?.[1]) return String(fromArgs[1]);
  const item = result.id ? result : result.item && typeof result.item === "object" ? (result.item as Record<string, unknown>) : undefined;
  return item?.id ? String(item.id) : "bulk";
}

export function pageCountForArgs(args: Record<string, unknown>, fallback = 50): number {
  return pageCountForLimit(maxResults(args, fallback));
}

export function buildWritePreview(spec: ToolSpec, args: Record<string, unknown>): Record<string, unknown> {
  if (!spec.write) {
    throw new Error(`Tool ${spec.name} is read-only and cannot be previewed as a write`);
  }

  const operation = writeOperationFor(spec);
  if (!operation) {
    throw new Error(`No write operation metadata is available for tool ${spec.name}`);
  }

  const endpointPath = ENDPOINTS[operation.endpointKey] ?? "";
  const pathParams = collectPathParams(operation.endpointKey, args);
  const missingPathParams = Object.entries(pathParams)
    .filter(([, value]) => !isPresent(value))
    .map(([key]) => key);
  const requestUrl = missingPathParams.length ? null : getUrl(operation.endpointKey, pathParams);

  return {
    dry_run: true,
    tool_name: spec.name,
    method: operation.method,
    endpoint_key: operation.endpointKey,
    endpoint_path: endpointPath,
    request_url: requestUrl,
    path_params: pathParams,
    missing_path_params: missingPathParams,
    body: inferWriteBody(operation, args),
    requires_confirmation: true,
    approval_code: buildWriteApprovalCode(spec, args),
    confirmation_hint: "Review this preview with the merchant before calling the write tool without dry_run.",
    approval_hint:
      "If SHOPLINE_REQUIRE_WRITE_APPROVAL=1 is enabled, pass this approval_code with the same write arguments to execute the write.",
  };
}

export function buildWriteApprovalCode(spec: ToolSpec, args: Record<string, unknown>): string {
  if (!spec.write) {
    throw new Error(`Tool ${spec.name} is read-only and cannot be approved as a write`);
  }

  const operation = writeOperationFor(spec);
  if (!operation) {
    throw new Error(`No write operation metadata is available for tool ${spec.name}`);
  }

  const payload = {
    tool_name: spec.name,
    method: operation.method,
    endpoint_key: operation.endpointKey,
    path_params: collectPathParams(operation.endpointKey, args),
    body: inferWriteBody(operation, args),
    store_alias: typeof args.store_alias === "string" && args.store_alias ? args.store_alias : undefined,
  };
  return createHash("sha256").update(stableStringify(payload)).digest("hex").slice(0, 16);
}

export function writeApprovalRequired(): boolean {
  return ["1", "true", "yes"].includes(String(process.env.SHOPLINE_REQUIRE_WRITE_APPROVAL ?? "").toLowerCase());
}

export function assertWriteApproved(spec: ToolSpec, args: Record<string, unknown>): void {
  if (!spec.write || !writeApprovalRequired()) return;

  const expected = buildWriteApprovalCode(spec, args);
  const actual = typeof args.approval_code === "string" ? args.approval_code : "";
  if (actual !== expected) {
    throw new Error(
      `Write approval required for ${spec.name}. Run the write with dry_run: true or call prepare_shopline_write_approval, review the preview with a human, then pass the matching approval_code.`,
    );
  }
}

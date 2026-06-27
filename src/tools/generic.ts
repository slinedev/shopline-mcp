import { apiDelete, apiGet, apiPatch, apiPost, apiPut, fetchAllPages } from "../client.js";
import type { ApiOperation, ToolContext } from "../types.js";
import {
  collectPathParams,
  collectQueryParams,
  inferWriteBody,
  maxResults,
  operationFor,
  pageCountForArgs,
  resourceId,
} from "./operationPlan.js";

async function executeRead(operation: ApiOperation, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const endpointKey = operation.endpointKey;
  const pathParams = collectPathParams(endpointKey, args);
  const queryParams = collectQueryParams(endpointKey, args);
  const limit = maxResults(args, 50);
  const hasPathParams = Object.keys(pathParams).length > 0;

  if (operation.kind === "fetch_all_pages" || (!hasPathParams && (args.max_results !== undefined || endpointKey.endsWith("s")))) {
    const pages = pageCountForArgs(args, limit);
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

import { DEFAULT_PER_PAGE, DEFAULT_SORT, getHeaders, getUrl } from "./config.js";
import { sleep } from "./shared/helpers.js";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface ApiRequestOptions {
  readonly jsonBody?: unknown;
  readonly params?: Record<string, unknown>;
  readonly pathParams?: Record<string, unknown>;
  readonly retries?: number;
  readonly retryOnClientError?: boolean;
}

export class ShoplineAPIError extends Error {
  constructor(
    readonly statusCode: number,
    readonly messageText: string,
    readonly endpoint: string,
  ) {
    super(`[${statusCode}] ${endpoint}: ${messageText}`);
  }
}

type FetchLike = typeof fetch;

let fetchImplementation: FetchLike = (...args) => globalThis.fetch(...args);

const ENDPOINTS_WITHOUT_DEFAULT_SORT = new Set([
  "webhooks",
  "staffs",
  "user_coupons",
  "wish_list_items",
  "sale_products",
  "sale_comments",
  "sale_customers",
  "coupon_center_promotions",
  "merchant_app_metafields",
  "merchant_metafields",
  "product_app_metafields",
  "product_metafields",
  "order_app_metafields",
  "order_metafields",
  "customer_app_metafields",
  "customer_metafields",
  "order_item_app_metafields",
  "order_item_metafields",
]);

export function setFetchImplementation(fetchLike: FetchLike): void {
  fetchImplementation = fetchLike;
}

export function resetFetchImplementation(): void {
  fetchImplementation = (...args) => globalThis.fetch(...args);
}

function appendParams(url: URL, params: Record<string, unknown> | undefined): void {
  if (!params) return;
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, String(item));
    } else {
      url.searchParams.set(key, String(value));
    }
  }
}

async function readJsonOrText(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export async function apiRequest(
  method: HttpMethod,
  endpointKey: string,
  options: ApiRequestOptions = {},
): Promise<Record<string, unknown>> {
  const retries = options.retries ?? 3;
  const retryOnClientError = options.retryOnClientError ?? method === "GET";
  const url = new URL(getUrl(endpointKey, options.pathParams));
  appendParams(url, options.params);

  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const response = await fetchImplementation(url, {
        method,
        headers: getHeaders(),
        body: options.jsonBody === undefined ? undefined : JSON.stringify(options.jsonBody),
        signal: AbortSignal.timeout(60_000),
      });

      if (response.status === 204) return {};
      if (response.status === 200 || response.status === 201) {
        const data = await readJsonOrText(response);
        return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : { result: data };
      }

      const text = String(await readJsonOrText(response)).slice(0, 500);
      const isClientError = response.status >= 400 && response.status < 500;
      const isServerError = response.status >= 500;

      if (isClientError && !retryOnClientError) {
        throw new ShoplineAPIError(response.status, text, url.toString());
      }

      if ((isServerError || (isClientError && retryOnClientError)) && attempt < retries - 1) {
        await sleep(2 ** attempt * 1000);
        continue;
      }

      throw new ShoplineAPIError(response.status, text, url.toString());
    } catch (error) {
      if (error instanceof ShoplineAPIError) throw error;
      if (attempt < retries - 1) {
        await sleep(2 ** attempt * 1000);
        continue;
      }
      throw error;
    }
  }

  throw new Error(`Shopline request failed after ${retries} retries`);
}

export function apiGet(endpointKey: string, params?: Record<string, unknown>, pathParams?: Record<string, unknown>, retries = 3) {
  return apiRequest("GET", endpointKey, { params, pathParams, retries, retryOnClientError: true });
}

export function apiPost(
  endpointKey: string,
  jsonBody?: unknown,
  params?: Record<string, unknown>,
  pathParams?: Record<string, unknown>,
  retries = 3,
) {
  return apiRequest("POST", endpointKey, { jsonBody, params, pathParams, retries, retryOnClientError: false });
}

export function apiPut(
  endpointKey: string,
  jsonBody?: unknown,
  params?: Record<string, unknown>,
  pathParams?: Record<string, unknown>,
  retries = 3,
) {
  return apiRequest("PUT", endpointKey, { jsonBody, params, pathParams, retries, retryOnClientError: false });
}

export function apiPatch(
  endpointKey: string,
  jsonBody?: unknown,
  params?: Record<string, unknown>,
  pathParams?: Record<string, unknown>,
  retries = 3,
) {
  return apiRequest("PATCH", endpointKey, { jsonBody, params, pathParams, retries, retryOnClientError: false });
}

export function apiDelete(
  endpointKey: string,
  params?: Record<string, unknown>,
  pathParams?: Record<string, unknown>,
  jsonBody?: unknown,
  retries = 3,
) {
  return apiRequest("DELETE", endpointKey, { jsonBody, params, pathParams, retries, retryOnClientError: false });
}

export async function fetchAllPages(
  endpointKey: string,
  params: Record<string, unknown> = {},
  pathParams?: Record<string, unknown>,
  maxPages?: number,
): Promise<Record<string, unknown>[]> {
  const requestParams: Record<string, unknown> = { ...params };
  requestParams.per_page ??= DEFAULT_PER_PAGE;
  if (!endpointKey.includes("search") && !ENDPOINTS_WITHOUT_DEFAULT_SORT.has(endpointKey)) {
    requestParams.sort_by ??= DEFAULT_SORT;
  }

  const allItems: Record<string, unknown>[] = [];
  let page = 1;

  while (true) {
    if (maxPages && page > maxPages) break;
    requestParams.page = page;
    const data = await apiGet(endpointKey, requestParams, pathParams);
    const items = Array.isArray(data.items) ? (data.items as Record<string, unknown>[]) : [];
    allItems.push(...items);
    const pagination = data.pagination && typeof data.pagination === "object" ? (data.pagination as Record<string, unknown>) : {};
    const totalPages = Number(pagination.total_pages ?? 1);
    if (page >= totalPages) break;
    page += 1;
    await sleep(200);
  }

  return allItems;
}

export async function fetchAllPagesByDateSegments(
  endpointKey: string,
  startDate: string,
  endDate: string,
  params: Record<string, unknown> = {},
): Promise<Record<string, unknown>[]> {
  const allItems: Record<string, unknown>[] = [];
  const start = new Date(startDate.replace("Z", "+00:00"));
  const end = new Date(endDate.replace("Z", "+00:00"));
const segmentMs = 30 * 86_400_000;

  for (let current = start.getTime(); current < end.getTime(); current += segmentMs) {
    const segmentEnd = Math.min(current + segmentMs, end.getTime());
    const segmentParams = {
      ...params,
      created_after: new Date(current).toISOString().replace(".000Z", "Z"),
      created_before: new Date(segmentEnd).toISOString().replace(".000Z", "Z"),
    };
    allItems.push(...(await fetchAllPages(endpointKey, segmentParams)));
  }

  return allItems;
}

import { endpoints } from "./generated/endpoints.js";

export const BASE_URL = "https://open.shopline.io";
export const DEFAULT_PER_PAGE = 50;
export const DEFAULT_SORT = "desc";

export const ENDPOINTS: Record<string, string> = { ...endpoints };

export function getAccessToken(): string {
  const token = process.env.SHOPLINE_API_TOKEN ?? "";
  if (!token) {
    throw new Error(
      "SHOPLINE_API_TOKEN environment variable is not set. Run: export SHOPLINE_API_TOKEN=your_token_here",
    );
  }
  return token;
}

export function getHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${getAccessToken()}`,
    "Content-Type": "application/json",
  };
}

export function getUrl(endpointKey: string, pathParams: Record<string, unknown> = {}): string {
  const template = ENDPOINTS[endpointKey];
  if (!template) {
    throw new Error(`Unknown Shopline endpoint key: ${endpointKey}`);
  }

  const path = template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = pathParams[key];
    if (value === undefined || value === null || value === "") {
      throw new Error(`Missing path parameter "${key}" for endpoint "${endpointKey}"`);
    }
    return encodeURIComponent(String(value));
  });

  return `${BASE_URL}${path}`;
}

export function endpointPathParams(endpointKey: string): string[] {
  const template = ENDPOINTS[endpointKey] ?? "";
  return [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? "");
}

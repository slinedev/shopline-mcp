import { endpoints } from "./generated/endpoints.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { v14Endpoints } from "./v14/endpoints.js";

export const BASE_URL = "https://open.shopline.io";
export const DEFAULT_PER_PAGE = 50;
export const DEFAULT_SORT = "desc";

export const ENDPOINTS: Record<string, string> = { ...endpoints, ...v14Endpoints };

interface StoreConfig {
  readonly alias: string;
  readonly token: string;
  readonly baseUrl: string;
}

export interface PublicStoreProfile {
  readonly alias: string;
  readonly base_url: string;
  readonly token_present: boolean;
}

const storeScope = new AsyncLocalStorage<string | undefined>();

function normalizeBaseUrl(value: unknown): string {
  const text = typeof value === "string" && value ? value : BASE_URL;
  return text.replace(/\/+$/, "");
}

function parseStoreConfigs(): StoreConfig[] {
  const raw = process.env.SHOPLINE_STORES_JSON;
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`SHOPLINE_STORES_JSON is not valid JSON: ${message}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("SHOPLINE_STORES_JSON must be a JSON object keyed by store alias");
  }

  return Object.entries(parsed as Record<string, unknown>)
    .map(([alias, value]) => {
      if (typeof value === "string") {
        return { alias, token: value, baseUrl: BASE_URL };
      }
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`Store profile "${alias}" must be a token string or object`);
      }
      const record = value as Record<string, unknown>;
      const token = record.token;
      if (typeof token !== "string" || !token) {
        throw new Error(`Store profile "${alias}" is missing a token`);
      }
      return {
        alias,
        token,
        baseUrl: normalizeBaseUrl(record.base_url ?? record.baseUrl),
      };
    })
    .sort((a, b) => a.alias.localeCompare(b.alias));
}

function selectedStoreAlias(): string | undefined {
  return (storeScope.getStore() ?? process.env.SHOPLINE_DEFAULT_STORE) || undefined;
}

function selectedStoreConfig(): StoreConfig | undefined {
  const alias = selectedStoreAlias();
  if (!alias) return undefined;
  const stores = parseStoreConfigs();
  const store = stores.find((item) => item.alias === alias);
  if (!store) {
    const available = stores.map((item) => item.alias).join(", ") || "none";
    throw new Error(`Unknown store_alias "${alias}". Configured aliases: ${available}`);
  }
  return store;
}

export function withShoplineStore<T>(storeAlias: unknown, fn: () => Promise<T>): Promise<T> {
  const alias = typeof storeAlias === "string" && storeAlias ? storeAlias : undefined;
  return storeScope.run(alias, fn);
}

export function getConfiguredStoreProfiles(): PublicStoreProfile[] {
  const configured = parseStoreConfigs();
  if (configured.length) {
    return configured.map((store) => ({
      alias: store.alias,
      base_url: store.baseUrl,
      token_present: Boolean(store.token),
    }));
  }

  return [
    {
      alias: "default",
      base_url: BASE_URL,
      token_present: Boolean(process.env.SHOPLINE_API_TOKEN),
    },
  ];
}

export function getAccessToken(): string {
  const store = selectedStoreConfig();
  if (store) return store.token;

  const token = process.env.SHOPLINE_API_TOKEN ?? "";
  if (!token) {
    throw new Error(
      "SHOPLINE_API_TOKEN environment variable is not set. Run: export SHOPLINE_API_TOKEN=your_token_here",
    );
  }
  return token;
}

export function getBaseUrl(): string {
  return selectedStoreConfig()?.baseUrl ?? BASE_URL;
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

  return `${getBaseUrl()}${path}`;
}

export function endpointPathParams(endpointKey: string): string[] {
  const template = ENDPOINTS[endpointKey] ?? "";
  return [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? "");
}

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function moneyToFloat(moneyObj: unknown): number {
  if (!moneyObj || typeof moneyObj !== "object") return 0;
  const value = (moneyObj as Record<string, unknown>).dollars ?? 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function getTranslation(obj: unknown, lang = "zh-hant", fallback = "en"): string {
  if (!obj) return "";
  if (typeof obj === "string") return obj;
  if (typeof obj !== "object") return "";
  const record = obj as Record<string, unknown>;
  return String(record[lang] ?? record[fallback] ?? "");
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function pageCountForLimit(limit: number, pageSize = 50): number {
  return Math.max(1, Math.ceil(limit / pageSize));
}

export function sumQuantity(items: unknown, defaultQuantity = 1): number {
  return asArray(items).reduce<number>((sum, item) => sum + Number(asRecord(item).quantity ?? defaultQuantity), 0);
}

export function itemsFrom(data: unknown, ...keys: string[]): unknown[] {
  if (Array.isArray(data)) return data;
  const record = asRecord(data);
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

export function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function percent(numerator: number, denominator: number, digits = 1): string {
  if (!denominator) return "0%";
  return `${round((numerator / denominator) * 100, digits)}%`;
}

export function dateOnly(dateText: string): string {
  return dateText.slice(0, 10);
}

export function parseDate(dateText: string): Date {
  return new Date(dateText.replace("+00:00", "Z"));
}

export function daysBetween(start: Date, end: Date): number {
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000);
}

export function sortObjectByValueDesc<T extends Record<string, number>>(obj: T): Record<string, number> {
  return Object.fromEntries(Object.entries(obj).sort((a, b) => b[1] - a[1]));
}

export function increment(map: Record<string, number>, key: string, by = 1): void {
  map[key] = (map[key] ?? 0) + by;
}

export function toToolResult(output: unknown): CallToolResult {
  const structuredContent =
    output && typeof output === "object" && !Array.isArray(output) ? (output as Record<string, unknown>) : { result: output };
  return {
    content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
    structuredContent,
  };
}

export function toToolError(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: "text", text: `Error: ${message}` }],
  };
}

export const VALID_ORDER_STATUSES = new Set(["completed", "confirmed"]);

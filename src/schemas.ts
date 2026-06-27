import { z } from "zod";

import type { ParamSpec } from "./types.js";

interface BuildInputOptions {
  readonly write?: boolean;
}

function schemaForParam(param: ParamSpec): z.ZodTypeAny {
  let schema: z.ZodTypeAny;

  switch (param.kind) {
    case "string":
      schema = z.string();
      break;
    case "integer":
      schema = z.number().int();
      break;
    case "number":
      schema = z.number();
      break;
    case "boolean":
      schema = z.boolean();
      break;
    case "array":
      schema = z.array(z.unknown());
      break;
    case "object":
      schema = z.record(z.string(), z.unknown());
      break;
    case "enum":
      if (param.enum && param.enum.length > 0) {
        schema = z.enum(param.enum as [string, ...string[]]);
      } else {
        schema = z.string();
      }
      break;
    case "any":
    default:
      schema = z.unknown();
      break;
  }

  if (param.description) schema = schema.describe(param.description);
  if (param.default === null) schema = schema.nullable().optional();
  else if (param.hasDefault) schema = schema.default(param.default);
  else if (param.optional) schema = schema.optional();

  return schema;
}

export function buildInputSchema(params: readonly ParamSpec[]): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const param of params) {
    shape[param.name] = schemaForParam(param);
  }
  return z.object(shape);
}

export function buildToolInputSchema(
  params: readonly ParamSpec[],
  options: BuildInputOptions = {},
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const param of params) {
    shape[param.name] = schemaForParam(param);
  }

  shape.store_alias = z
    .string()
    .optional()
    .describe("Optional store alias from SHOPLINE_STORES_JSON for multi-store routing.");

  if (options.write) {
    shape.dry_run = z
      .boolean()
      .optional()
      .default(false)
      .describe("When true, return a write preview without calling the Shopline API.");
    shape.confirm_write = z
      .boolean()
      .optional()
      .default(false)
      .describe("Optional caller-side confirmation marker for write tools.");
  }

  return z.object(shape);
}

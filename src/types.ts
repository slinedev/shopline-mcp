export type JsonObject = Record<string, unknown>;

export type ParamKind =
  | "string"
  | "integer"
  | "number"
  | "boolean"
  | "array"
  | "object"
  | "enum"
  | "any";

export interface ParamSpec {
  readonly name: string;
  readonly description: string;
  readonly default: unknown;
  readonly hasDefault: boolean;
  readonly kind: ParamKind;
  readonly optional: boolean;
  readonly enum?: readonly string[];
}

export interface DocEndpoint {
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly path: string;
}

export interface ApiOperation {
  readonly kind: string;
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly endpointKey: string;
  readonly json_body?: string;
  readonly params?: string;
  readonly path_params?: string;
}

export interface ToolSpec {
  readonly module: string;
  readonly name: string;
  readonly write: boolean;
  readonly description: string;
  readonly params: readonly ParamSpec[];
  readonly docEndpoints: readonly DocEndpoint[];
  readonly operations: readonly ApiOperation[];
  readonly sourceLocation: {
    readonly line: number;
    readonly endLine: number;
  };
}

export interface ToolContext {
  readonly spec: ToolSpec;
  readonly args: JsonObject;
}

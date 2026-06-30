import { spawn } from "node:child_process";
import { once } from "node:events";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { apiRequest } from "../client.js";
import { getConfiguredStoreProfiles, withShoplineStore } from "../config.js";

type LogFn = (message: string) => void;

export interface DoctorOptions {
  readonly checkToolsList?: () => Promise<number>;
  readonly nodeVersion?: string;
  readonly stdout?: LogFn;
  readonly stderr?: LogFn;
}

export interface DoctorResult {
  readonly exitCode: 0 | 1;
}

function parseMajor(version: string): number {
  const match = version.match(/^v?(\d+)/);
  return match ? Number(match[1]) : Number.NaN;
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function checkShoplineConnection(): Promise<void> {
  await apiRequest("GET", "merchants", { retries: 1, retryOnClientError: false });
}

async function waitForResponse(
  responses: Map<number, Record<string, unknown>>,
  id: number,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const response = responses.get(id);
    if (response) return response;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for MCP response ${id}`);
}

export async function checkToolsListWithCurrentEntrypoint(timeoutMs = 5000): Promise<number> {
  const cliDir = dirname(fileURLToPath(import.meta.url));
  const entrypoint = join(cliDir, "..", "index.js");
  const child = spawn(process.execPath, [entrypoint], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, SHOPLINE_API_TOKEN: process.env.SHOPLINE_API_TOKEN ?? "" },
  });

  let stdoutBuffer = "";
  let stderrBuffer = "";
  const responses = new Map<number, Record<string, unknown>>();

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdoutBuffer += chunk;
    let index;
    while ((index = stdoutBuffer.indexOf("\n")) >= 0) {
      const line = stdoutBuffer.slice(0, index).trim();
      stdoutBuffer = stdoutBuffer.slice(index + 1);
      if (!line) continue;
      const message = JSON.parse(line) as Record<string, unknown>;
      if (message.id !== undefined) responses.set(Number(message.id), message);
    }
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderrBuffer += chunk;
  });

  function send(message: Record<string, unknown>): void {
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  try {
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "shopline-mcp-doctor", version: "1.0.0" },
      },
    });
    await waitForResponse(responses, 1, timeoutMs);
    send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const listResponse = await waitForResponse(responses, 2, timeoutMs);
    const result = listResponse.result as { tools?: unknown[] } | undefined;
    return Array.isArray(result?.tools) ? result.tools.length : 0;
  } catch (error) {
    const suffix = stderrBuffer.trim() ? `: ${stderrBuffer.trim()}` : "";
    throw new Error(`${formatError(error)}${suffix}`);
  } finally {
    child.stdin.end();
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 1000))]);
  }
}

export async function runDoctorChecks(options: DoctorOptions = {}): Promise<DoctorResult> {
  const stdout = options.stdout ?? ((message: string) => console.log(message));
  const stderr = options.stderr ?? ((message: string) => console.error(message));
  const checkToolsList = options.checkToolsList ?? checkToolsListWithCurrentEntrypoint;
  const nodeVersion = options.nodeVersion ?? process.version;
  let exitCode: 0 | 1 = 0;

  stdout("Shopline MCP Doctor");

  const major = parseMajor(nodeVersion);
  if (Number.isFinite(major) && major >= 24) {
    stdout(`Node.js check passed (${nodeVersion})`);
  } else {
    stderr(`Node.js ${nodeVersion} is not supported. Please use Node.js 24 or newer.`);
    exitCode = 1;
  }

  try {
    const toolCount = await checkToolsList();
    stdout(`MCP tools/list returned ${toolCount} tools`);
    if (toolCount <= 0) {
      stderr("MCP tools/list returned no tools.");
      exitCode = 1;
    }
  } catch (error) {
    stderr(`MCP tools/list check failed: ${formatError(error)}`);
    exitCode = 1;
  }

  let profiles;
  try {
    profiles = getConfiguredStoreProfiles();
  } catch (error) {
    stderr(formatError(error));
    return { exitCode: 1 };
  }

  const hasDefaultToken = Boolean(process.env.SHOPLINE_API_TOKEN);
  const hasStoreConfig = Boolean(process.env.SHOPLINE_STORES_JSON);

  if (!hasDefaultToken && !hasStoreConfig) {
    stderr("Set SHOPLINE_API_TOKEN or SHOPLINE_STORES_JSON before running Shopline API checks.");
    return { exitCode: 1 };
  }

  if (hasStoreConfig) {
    for (const profile of profiles) {
      try {
        await withShoplineStore(profile.alias, checkShoplineConnection);
        stdout(`Shopline API check passed for store ${profile.alias}`);
      } catch (error) {
        stderr(`Shopline API check failed for store ${profile.alias}: ${formatError(error)}`);
        exitCode = 1;
      }
    }
    return { exitCode };
  }

  try {
    await checkShoplineConnection();
    stdout("Shopline API check passed for default token");
  } catch (error) {
    stderr(`Shopline API check failed for default token: ${formatError(error)}`);
    exitCode = 1;
  }

  return { exitCode };
}

export async function runDoctor(options: DoctorOptions = {}): Promise<0 | 1> {
  const result = await runDoctorChecks(options);
  return result.exitCode;
}

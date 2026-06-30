import { afterEach, describe, expect, it } from "vitest";

import { resetFetchImplementation, setFetchImplementation } from "../src/client.js";
import { runDoctorChecks } from "../src/cli/doctor.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function runDoctorForTest() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const result = await runDoctorChecks({
    checkToolsList: async () => 279,
    nodeVersion: "v24.0.0",
    stdout: (message) => stdout.push(message),
    stderr: (message) => stderr.push(message),
  });
  return { ...result, stdout, stderr };
}

describe("shopline-mcp doctor", () => {
  afterEach(() => {
    resetFetchImplementation();
    delete process.env.SHOPLINE_API_TOKEN;
    delete process.env.SHOPLINE_STORES_JSON;
    delete process.env.SHOPLINE_DEFAULT_STORE;
  });

  it("fails without a token after running local checks", async () => {
    const result = await runDoctorForTest();

    expect(result.exitCode).toBe(1);
    expect(result.stdout.join("\n")).toContain("MCP tools/list returned 279 tools");
    expect(result.stderr.join("\n")).toContain("Set SHOPLINE_API_TOKEN or SHOPLINE_STORES_JSON");
  });

  it("checks the default token with a read-only Shopline request", async () => {
    const authorizations: string[] = [];
    process.env.SHOPLINE_API_TOKEN = "default-token";
    setFetchImplementation((async (_input, init) => {
      authorizations.push(String((init?.headers as Record<string, string> | undefined)?.Authorization));
      return jsonResponse({ items: [{ id: "merchant-1", name: "Shop" }] });
    }) as typeof fetch);

    const result = await runDoctorForTest();

    expect(result.exitCode).toBe(0);
    expect(authorizations).toEqual(["Bearer default-token"]);
    expect(result.stdout.join("\n")).toContain("Shopline API check passed for default token");
  });

  it("checks every configured store alias", async () => {
    const authorizations: string[] = [];
    process.env.SHOPLINE_STORES_JSON = JSON.stringify({
      hk: { token: "hk-token" },
      tw: { token: "tw-token" },
    });
    setFetchImplementation((async (_input, init) => {
      authorizations.push(String((init?.headers as Record<string, string> | undefined)?.Authorization));
      return jsonResponse({ items: [] });
    }) as typeof fetch);

    const result = await runDoctorForTest();

    expect(result.exitCode).toBe(0);
    expect(authorizations.sort()).toEqual(["Bearer hk-token", "Bearer tw-token"]);
    expect(result.stdout.join("\n")).toContain("Shopline API check passed for store hk");
    expect(result.stdout.join("\n")).toContain("Shopline API check passed for store tw");
  });

  it("fails when multi-store JSON is invalid", async () => {
    process.env.SHOPLINE_STORES_JSON = "{bad json";

    const result = await runDoctorForTest();

    expect(result.exitCode).toBe(1);
    expect(result.stderr.join("\n")).toContain("SHOPLINE_STORES_JSON is not valid JSON");
  });

  it("fails when the MCP tools/list check fails", async () => {
    process.env.SHOPLINE_API_TOKEN = "default-token";
    const stderr: string[] = [];
    const result = await runDoctorChecks({
      checkToolsList: async () => {
        throw new Error("tools/list timed out");
      },
      nodeVersion: "v24.0.0",
      stdout: () => undefined,
      stderr: (message) => stderr.push(message),
    });

    expect(result.exitCode).toBe(1);
    expect(stderr.join("\n")).toContain("tools/list timed out");
  });
});

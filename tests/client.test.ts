import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiDelete, apiGet, fetchAllPages, resetFetchImplementation, setFetchImplementation } from "../src/client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("Shopline client", () => {
  beforeEach(() => {
    process.env.SHOPLINE_API_TOKEN = "test-token";
  });

  afterEach(() => {
    resetFetchImplementation();
    delete process.env.SHOPLINE_API_TOKEN;
  });

  it("adds bearer auth and query params", async () => {
    const calls: Parameters<typeof fetch>[0][] = [];
    setFetchImplementation((async (input, init) => {
      calls.push(input);
      expect(init?.headers).toMatchObject({ Authorization: "Bearer test-token" });
      return jsonResponse({ items: [] });
    }) as typeof fetch);

    await apiGet("products", { per_page: 1 });
    expect(String(calls[0])).toContain("https://open.shopline.io/v1/products?per_page=1");
  });

  it("fetches all pages using Shopline pagination", async () => {
    const pages: number[] = [];
    setFetchImplementation((async (input) => {
      const page = Number(new URL(String(input)).searchParams.get("page"));
      pages.push(page);
      return jsonResponse({
        items: [{ id: page }],
        pagination: { total_pages: 2 },
      });
    }) as typeof fetch);

    const items = await fetchAllPages("products", { per_page: 1 });
    expect(pages).toEqual([1, 2]);
    expect(items).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("sends JSON bodies with DELETE requests", async () => {
    let method = "";
    let body = "";
    setFetchImplementation((async (_input, init) => {
      method = String(init?.method);
      body = String(init?.body);
      return new Response(null, { status: 204 });
    }) as typeof fetch);

    await apiDelete("product_images", undefined, { product_id: "p1" }, { image_ids: ["i1"] });
    expect(method).toBe("DELETE");
    expect(body).toBe(JSON.stringify({ image_ids: ["i1"] }));
  });
});

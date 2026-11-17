import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkProductLinks, repairProductLinks } from "@/lib/magento";
import { formatLinkCounts, formatMissingLinks } from "@/lib/linkLabels";

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const link = (sku: string, type: string, linked: string, extra: Record<string, unknown> = {}) => ({ sku, link_type: type, linked_product_sku: linked, position: 1, ...extra });

beforeEach(() => {
  delete process.env.AUTH_MODE;
  process.env.MAGENTO_BASE_URL = "https://shop.test";
  process.env.MAGENTO_TOKEN = "tok";
  process.env.MAGENTO_STORE_CODE = "all";
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

const calls = () => fetchMock.mock.calls.map(([u, i]) => `${i?.method ?? "GET"} ${new URL(u).pathname}`);

/** Responde según la URL: producto → vínculos; búsqueda → SKU existentes. */
function route(linksBySku: Record<string, unknown[]>, existing: string[], putResponse = () => json({})) {
  fetchMock.mockImplementation(async (u: string, init?: RequestInit) => {
    const url = new URL(u);
    if (init?.method === "PUT") return putResponse();
    const m = url.pathname.match(/\/products\/([^/]+)$/);
    if (m) {
      const sku = decodeURIComponent(m[1]);
      return sku in linksBySku ? json({ sku, product_links: linksBySku[sku] }) : json({ message: "no existe" }, 404);
    }
    return json({ items: existing.map((sku) => ({ sku })) });
  });
}

describe("checkProductLinks", () => {
  it("clasifica por producto: vínculos rotos, bien, sin vínculos y error de lectura", async () => {
    route({ A: [link("A", "related", "X"), link("A", "related", "GONE"), link("A", "crosssell", "GONE2")], B: [link("B", "upsell", "X")], C: [] }, ["X"]);
    const r = await checkProductLinks(["A", "B", "C", "D"]);
    expect(r).toEqual([
      { sku: "A", byType: { related: 2, crosssell: 1 }, missing: [{ type: "related", sku: "GONE" }, { type: "crosssell", sku: "GONE2" }], checked: true },
      { sku: "B", byType: { upsell: 1 }, missing: [], checked: true },
      { sku: "C", byType: {}, missing: [], checked: true },
      { sku: "D", error: "no existe" },
    ]);
    // Solo lecturas, y una sola búsqueda de SKU para todos los productos.
    expect(calls().every((c) => c.startsWith("GET "))).toBe(true);
    expect(calls().filter((c) => c === "GET /rest/all/V1/products")).toHaveLength(1);
  });

  it("si no puede comprobar qué SKU existen, no marca ninguno como faltante", async () => {
    fetchMock.mockImplementation(async (u: string) =>
      /\/products\/A$/.test(new URL(u).pathname) ? json({ product_links: [link("A", "related", "GONE")] }) : json({ message: "boom" }, 400),
    );
    expect(await checkProductLinks(["A"])).toEqual([{ sku: "A", byType: { related: 1 }, missing: [], checked: false }]);
  });
});

describe("repairProductLinks", () => {
  it("guarda el producto solo con los vínculos válidos, tal como vinieron", async () => {
    const valid = link("A", "upsell", "X", { extension_attributes: { qty: 2 } });
    route({ A: [link("A", "related", "GONE"), valid] }, ["X"]);
    const r = await repairProductLinks("A");
    expect(r).toEqual({ kept: 1, removed: [{ type: "related", sku: "GONE" }] });
    const put = fetchMock.mock.calls.find(([, i]) => i?.method === "PUT")!;
    expect(new URL(put[0]).pathname).toBe("/rest/all/V1/products/A");
    expect(JSON.parse(put[1].body)).toEqual({ product: { sku: "A", product_links: [valid] } });
  });

  it("sin vínculos rotos igual reenvía los vínculos (como el Admin)", async () => {
    route({ A: [link("A", "related", "X")] }, ["X"]);
    expect(await repairProductLinks("A")).toEqual({ kept: 1, removed: [] });
    expect(calls()).toContain("PUT /rest/all/V1/products/A");
  });

  it("si no puede comprobar los SKU, no guarda nada", async () => {
    fetchMock.mockImplementation(async (u: string) =>
      /\/products\/A$/.test(new URL(u).pathname) ? json({ product_links: [link("A", "related", "GONE")] }) : json({ message: "boom" }, 400),
    );
    await expect(repairProductLinks("A")).rejects.toMatchObject({ status: 502 });
    expect(calls().some((c) => c.startsWith("PUT"))).toBe(false);
  });

  it("si Magento igual lo rechaza, 422 con el motivo", async () => {
    route({ A: [link("A", "related", "X")] }, ["X"], () => json({ message: "The linked products data is invalid. Verify the data and try again." }, 400));
    await expect(repairProductLinks("A")).rejects.toMatchObject({ status: 422, message: expect.stringContaining("tampoco pudo guardar") });
  });
});

describe("textos", () => {
  it("resume por tipo y corta las listas largas", () => {
    expect(formatLinkCounts({ related: 2, ias: 1 })).toBe("relacionados: 2; tipo «ias»: 1");
    const many = Array.from({ length: 7 }, (_, i) => ({ type: "upsell", sku: `S${i}` }));
    expect(formatMissingLinks(many)).toBe("up-sell: S0, S1, S2, S3, S4 y 2 más");
  });
});

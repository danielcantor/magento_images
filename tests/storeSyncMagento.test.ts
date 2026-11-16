import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMagentoCache, syncStores } from "@/lib/magento";

const fetchMock = vi.fn();
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const entry = (id: number, types: string[], label = "") => ({ id, media_type: "image", label, position: id, disabled: false, types, file: `/${id}.jpg` });

beforeEach(() => {
  delete process.env.AUTH_MODE;
  process.env.MAGENTO_BASE_URL = "https://shop.test";
  process.env.MAGENTO_TOKEN = "tok";
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  clearMagentoCache();
});
afterEach(() => vi.unstubAllGlobals());

describe("syncStores", () => {
  it("lee cada tienda por su código y escribe solo en la que difiere, con valores generales", async () => {
    const general = [entry(1, ["image"], "A"), entry(2, [])];
    let enFixed = false;
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      const u = new URL(url);
      if (u.pathname === "/rest/all/V1/store/websites") return json([{ id: 1, code: "base", name: "Base" }]);
      if (u.pathname === "/rest/all/V1/store/storeViews") return json([{ id: 1, code: "es", name: "ES", website_id: 1 }, { id: 2, code: "en", name: "EN", website_id: 1 }]);
      if (u.pathname === "/rest/all/V1/products/SKU%2F1/media") return json(general);
      if (u.pathname === "/rest/es/V1/products/SKU%2F1/media") return json(general);
      if (u.pathname === "/rest/en/V1/products/SKU%2F1/media") return json(enFixed ? general : [entry(1, [], "A en"), entry(2, ["image"])]);
      if (init?.method === "PUT") {
        enFixed = true;
        return json(true);
      }
      throw new Error(`inesperado ${u.pathname}`);
    });
    const r = await syncStores("SKU/1");
    expect(r).toEqual({ storesSynced: ["EN"], entriesUpdated: 2, stillDifferent: [] });
    const puts = fetchMock.mock.calls.filter(([, i]) => i?.method === "PUT");
    expect(puts.map(([u]) => new URL(u).pathname)).toEqual(["/rest/en/V1/products/SKU%2F1/media/1", "/rest/en/V1/products/SKU%2F1/media/2"]);
    expect(JSON.parse(puts[0][1].body).entry).toMatchObject({ id: 1, label: "A", types: ["image"] });
  });
});

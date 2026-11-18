import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildProductSearch, clearMagentoCache, getMediaRoles, pickFirstImageRoles, searchProducts } from "@/lib/magento";

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  delete process.env.AUTH_MODE;
  delete process.env.FIRST_IMAGE_ROLES;
  process.env.MAGENTO_BASE_URL = "https://shop.test";
  process.env.MAGENTO_TOKEN = "tok";
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  clearMagentoCache();
});
afterEach(() => vi.unstubAllGlobals());

const g = (p: URLSearchParams, group: number, i: number, part: string) =>
  p.get(`searchCriteria[filterGroups][${group}][filters][${i}][${part}]`);

describe("buildProductSearch", () => {
  it("búsqueda en OR y cada filtro en su grupo (AND)", () => {
    const p = buildProductSearch({ q: "colchon", status: 1, websiteId: 2, storeId: 5, page: 3, pageSize: 100 });
    expect([g(p, 0, 0, "field"), g(p, 0, 1, "field")]).toEqual(["sku", "name"]);
    expect([g(p, 1, 0, "field"), g(p, 1, 0, "value"), g(p, 1, 0, "conditionType")]).toEqual(["status", "1", "eq"]);
    expect([g(p, 2, 0, "field"), g(p, 2, 0, "value")]).toEqual(["website_id", "2"]);
    expect([g(p, 3, 0, "field"), g(p, 3, 0, "value")]).toEqual(["store_id", "5"]);
    expect(p.get("searchCriteria[pageSize]")).toBe("100");
    expect(p.get("searchCriteria[currentPage]")).toBe("3");
    expect(p.get("fields")).toContain("extension_attributes[website_ids]");
  });

  it("sin búsqueda, el primer filtro va en el grupo 0", () => {
    const p = buildProductSearch({ status: 2 });
    expect([g(p, 0, 0, "field"), g(p, 0, 0, "value")]).toEqual(["status", "2"]);
    expect(g(p, 1, 0, "field")).toBeNull();
  });

  it("sin imagen base: image vacío o no_selection, en OR dentro de su grupo", () => {
    const p = buildProductSearch({ status: 1, noBase: true });
    expect([g(p, 1, 0, "field"), g(p, 1, 0, "value"), g(p, 1, 0, "conditionType")]).toEqual(["image", "no_selection", "eq"]);
    expect([g(p, 1, 1, "field"), g(p, 1, 1, "conditionType")]).toEqual(["image", "null"]);
  });

  it("searchProducts devuelve websiteIds", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ total_count: 1, items: [{ id: 1, sku: "A", name: "a", type_id: "simple", status: 1, extension_attributes: { website_ids: [1, 2] } }] }),
    );
    const r = await searchProducts({});
    expect(r.items[0].websiteIds).toEqual([1, 2]);
    expect(r.items[0].media).toEqual([]);
  });
});

describe("roles de imagen", () => {
  const attrs = {
    items: [
      { attribute_code: "abandoned_cart_image", default_frontend_label: "Abandoned Cart Image" },
      { attribute_code: "thumbnail", default_frontend_label: "Thumbnail" },
      { attribute_code: "ias_hover_image", default_frontend_label: "Hover (IAS)" },
      { attribute_code: "image", default_frontend_label: "Base" },
      { attribute_code: "swatch_image", default_frontend_label: "Swatch" },
      { attribute_code: "small_image", default_frontend_label: "Small" },
    ],
  };

  it("lee los media_image, pone primero los estándar y cachea", async () => {
    fetchMock.mockResolvedValueOnce(json(attrs));
    const roles = await getMediaRoles();
    expect(roles.map((r) => r.code)).toEqual(["image", "small_image", "thumbnail", "swatch_image", "abandoned_cart_image", "ias_hover_image"]);
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe("/rest/all/V1/products/attributes");
    expect(url.searchParams.get("searchCriteria[filterGroups][0][filters][0][value]")).toBe("media_image");
    await getMediaRoles();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("si Magento falla, usa los 4 estándar", async () => {
    fetchMock.mockResolvedValue(json({ message: "boom" }, 400));
    expect((await getMediaRoles()).map((r) => r.code)).toEqual(["image", "small_image", "thumbnail", "swatch_image"]);
  });

  it("la primera imagen recibe todos menos Hover, o lo que diga FIRST_IMAGE_ROLES", async () => {
    fetchMock.mockResolvedValueOnce(json(attrs));
    const roles = await getMediaRoles();
    expect(pickFirstImageRoles(roles)).toEqual(["image", "small_image", "thumbnail", "swatch_image", "abandoned_cart_image"]);
    expect(pickFirstImageRoles(roles, "image, thumbnail, inventado")).toEqual(["image", "thumbnail"]);
  });
});

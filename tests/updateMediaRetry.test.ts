import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildGallery, PRODUCT_NOT_SAVABLE_MESSAGE, saveGallery, updateMedia } from "@/lib/magento";

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const cantSave = () => json({ message: "The product can't be saved." }, 400);
const img = (id: number, position: number, types: string[] = [], label = "") => ({
  id, media_type: "image", label, position, disabled: false, types, file: `/a/${id}.jpg`,
});
const video = { id: 9, media_type: "external-video", label: "Video", position: 4, disabled: false, types: [], file: "/v/9.jpg",
  extension_attributes: { video_content: { media_type: "external-video", video_provider: "youtube", video_url: "https://youtu.be/x" } } };

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
const lastBody = () => JSON.parse(fetchMock.mock.calls.at(-1)![1].body);

describe("buildGallery", () => {
  it("aplica cambios, conserva file/videos y quita de otras imágenes el rol asignado", () => {
    const raw = [img(1, 1, ["image", "thumbnail"], "A"), img(2, 2), img(3, 3), video];
    const out = buildGallery(raw, [{ id: 2, position: 1, types: ["image"] }, { id: 1, position: 2 }]);
    expect(out.map((e) => [e.id, e.position, e.types.join("+") || "-"])).toEqual([
      [1, 2, "thumbnail"], [2, 1, "image"], [3, 3, "-"], [9, 4, "-"],
    ]);
    expect(out[0]).toMatchObject({ file: "/a/1.jpg", label: "A" });
    expect(out[3]).toMatchObject({ media_type: "external-video", extension_attributes: video.extension_attributes });
    expect(JSON.stringify(out)).not.toContain('"url"');
  });
});

describe("saveGallery", () => {
  it("lee la galería y guarda TODAS las entradas por el endpoint del producto, en el store general", async () => {
    fetchMock.mockResolvedValueOnce(json([img(1, 1), img(2, 2), video])).mockResolvedValueOnce(json({ sku: "S/1" }));
    await saveGallery("S/1", [{ id: 1, position: 2 }, { id: 2, position: 1 }]);
    expect(calls()).toEqual(["GET /rest/all/V1/products/S%2F1/media", "PUT /rest/all/V1/products/S%2F1"]);
    const body = lastBody();
    expect(body.product.sku).toBe("S/1");
    expect(body.product.media_gallery_entries.map((e: { id: number; position: number }) => [e.id, e.position])).toEqual([[1, 2], [2, 1], [9, 4]]);
  });

  it("si Magento lo rechaza, devuelve 422 con el mensaje real", async () => {
    fetchMock.mockResolvedValueOnce(json([img(1, 1)])).mockResolvedValueOnce(json({ message: "URL key for specified store already exists." }, 400));
    await expect(saveGallery("S1", [{ id: 1, position: 2 }])).rejects.toMatchObject({
      status: 422,
      message: "Magento no puede guardar este producto: URL key for specified store already exists.",
    });
  });

  it("imagen inexistente → 404 sin guardar", async () => {
    fetchMock.mockResolvedValueOnce(json([img(1, 1)]));
    await expect(saveGallery("S1", [{ id: 5, position: 1 }])).rejects.toMatchObject({ status: 404 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("updateMedia", () => {
  const input = { label: "alt", position: 3, disabled: false, types: ["image"] };

  it("primer intento por el endpoint de la imagen, sin file", async () => {
    fetchMock.mockResolvedValueOnce(json(true));
    await updateMedia("S1", 7, input);
    expect(calls()).toEqual(["PUT /rest/all/V1/products/S1/media/7"]);
    expect(lastBody().entry.file).toBeUndefined();
  });

  it("«can't be saved» en el store general → guarda la galería por el endpoint del producto", async () => {
    fetchMock.mockResolvedValueOnce(cantSave()).mockResolvedValueOnce(json([img(7, 1), img(8, 2, ["image"])])).mockResolvedValueOnce(json({}));
    await updateMedia("S1", 7, input);
    expect(calls()).toEqual(["PUT /rest/all/V1/products/S1/media/7", "GET /rest/all/V1/products/S1/media", "PUT /rest/all/V1/products/S1"]);
    const entries = lastBody().product.media_gallery_entries;
    expect(entries.find((e: { id: number }) => e.id === 7)).toMatchObject({ position: 3, label: "alt", types: ["image"] });
    expect(entries.find((e: { id: number }) => e.id === 8).types).toEqual([]);
  });

  it("en una store view no hay alternativa: 422 claro", async () => {
    fetchMock.mockResolvedValueOnce(cantSave()).mockResolvedValueOnce(json({ product_links: [] }));
    await expect(updateMedia("S1", 7, input, "en")).rejects.toMatchObject({ status: 422, message: PRODUCT_NOT_SAVABLE_MESSAGE });
    expect(calls()).toEqual(["PUT /rest/en/V1/products/S1/media/7", "GET /rest/all/V1/products/S1"]);
  });

  it("otros errores no cambian de camino", async () => {
    fetchMock.mockResolvedValueOnce(json({ message: "No image with the provided ID was found." }, 404));
    await expect(updateMedia("S1", 7, input)).rejects.toMatchObject({ status: 404 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("diagnóstico de productos vinculados", () => {
  const linksInvalid = () => json({ message: "The linked products data is invalid. Verify the data and try again." }, 400);
  const links = [
    { sku: "S1", link_type: "related", linked_product_sku: "OK-1" },
    { sku: "S1", link_type: "related", linked_product_sku: "GONE-1" },
    { sku: "S1", link_type: "crosssell", linked_product_sku: "GONE-2" },
  ];

  it("nombra los vinculados que ya no existen, por tipo", async () => {
    fetchMock
      .mockResolvedValueOnce(json([img(1, 1)]))
      .mockResolvedValueOnce(linksInvalid())
      .mockResolvedValueOnce(json({ sku: "S1", product_links: links }))
      .mockResolvedValueOnce(json({ items: [{ sku: "OK-1" }] }));
    const err = await saveGallery("S1", [{ id: 1, position: 2 }]).catch((e) => e);
    expect(err.status).toBe(422);
    expect(err.message).toContain("ya no existen (relacionados: GONE-1; cross-sell: GONE-2)");
    expect(calls().slice(2)).toEqual(["GET /rest/all/V1/products/S1", "GET /rest/all/V1/products"]);
    // Solo lecturas después del rechazo: no se reintenta ni se tocan los vínculos.
    expect(fetchMock.mock.calls.slice(2).every(([, i]) => (i?.method ?? "GET") === "GET")).toBe(true);
  });

  it("si todos existen, cuenta los vínculos por tipo", async () => {
    fetchMock
      .mockResolvedValueOnce(json([img(1, 1)]))
      .mockResolvedValueOnce(linksInvalid())
      .mockResolvedValueOnce(json({ product_links: [{ link_type: "upsell", linked_product_sku: "A" }, { link_type: "ias", linked_product_sku: "B" }] }))
      .mockResolvedValueOnce(json({ items: [{ sku: "A" }, { sku: "B" }] }));
    const err = await saveGallery("S1", [{ id: 1, position: 2 }]).catch((e) => e);
    expect(err.message).toContain("(up-sell: 1; tipo «ias»: 1)");
  });

  it("si no puede leer el producto, deja el mensaje de Magento", async () => {
    fetchMock.mockResolvedValueOnce(json([img(1, 1)])).mockResolvedValueOnce(linksInvalid()).mockResolvedValueOnce(json({ message: "x" }, 404));
    const err = await saveGallery("S1", [{ id: 1, position: 2 }]).catch((e) => e);
    expect(err.message).toBe("Magento no puede guardar este producto: The linked products data is invalid. Verify the data and try again.");
  });

  it("si no puede comprobar los SKU, no marca ninguno como faltante", async () => {
    fetchMock
      .mockResolvedValueOnce(json([img(1, 1)]))
      .mockResolvedValueOnce(cantSave())
      .mockResolvedValueOnce(json({ product_links: links }))
      .mockResolvedValueOnce(json({ message: "boom" }, 400));
    const err = await saveGallery("S1", [{ id: 1, position: 2 }]).catch((e) => e);
    expect(err.message).toContain("no puede volver a grabar los productos vinculados de este producto (relacionados: 2; cross-sell: 1)");
  });
});

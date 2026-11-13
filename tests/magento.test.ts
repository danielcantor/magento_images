import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addMedia, findExistingSkus, formatMagentoMessage, getMedia, MagentoError, updateMedia } from "@/lib/magento";

const fetchMock = vi.fn();

beforeEach(() => {
  process.env.MAGENTO_BASE_URL = "https://shop.test/";
  process.env.MAGENTO_TOKEN = "tok";
  process.env.MAGENTO_STORE_CODE = "all";
  delete process.env.MAGENTO_MEDIA_URL;
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("magento client", () => {
  it("lista media con URL, ordenada y codificando el SKU", async () => {
    fetchMock.mockResolvedValueOnce(
      json([
        { id: 2, media_type: "image", position: 2, file: "/b.jpg", types: [], label: null, disabled: false },
        { id: 1, media_type: "image", position: 1, file: "/a.jpg", types: ["image"], label: null, disabled: false },
        { id: 3, media_type: "external-video", position: 3, file: "/v.jpg", types: [], label: null, disabled: false },
      ]),
    );
    const media = await getMedia("AB/C 1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://shop.test/rest/all/V1/products/AB%2FC%201/media");
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(media.map((m) => m.id)).toEqual([1, 2]);
    expect(media[0].url).toBe("https://shop.test/media/catalog/product/a.jpg");
  });

  it("PUT no envía file ni content (evita duplicados en Magento)", async () => {
    fetchMock.mockResolvedValueOnce(json(true));
    await updateMedia("SKU", 7, { label: "alt", position: 1, disabled: false, types: ["image"] });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(fetchMock.mock.calls[0][1].method).toBe("PUT");
    expect(body.entry).toEqual({ id: 7, media_type: "image", label: "alt", position: 1, disabled: false, types: ["image"] });
  });

  it("POST envía base64 y devuelve el id numérico", async () => {
    fetchMock.mockResolvedValueOnce(json("55"));
    const id = await addMedia("SKU", { base64: "AAA", mimeType: "image/jpeg", fileName: "SKU_1.jpg", types: ["image"] });
    expect(id).toBe(55);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.entry.content).toEqual({ base64_encoded_data: "AAA", type: "image/jpeg", name: "SKU_1.jpg" });
  });

  it("reintenta en 503 y luego funciona", async () => {
    fetchMock.mockResolvedValueOnce(json({ message: "busy" }, 503)).mockResolvedValueOnce(json([]));
    await expect(getMedia("X")).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("propaga errores 4xx con el mensaje de Magento", async () => {
    fetchMock.mockResolvedValueOnce(json({ message: "The product that was requested doesn't exist." }, 404));
    const err = await getMedia("X").catch((e) => e);
    expect(err).toBeInstanceOf(MagentoError);
    expect(err).toMatchObject({ status: 404, message: expect.stringMatching(/doesn't exist/) });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("valida SKU por lotes de 100 con filtro 'in'", async () => {
    fetchMock.mockImplementation(async () => json({ items: [{ sku: "A" }] }));
    const skus = Array.from({ length: 150 }, (_, i) => `S${i}`);
    await findExistingSkus(skus);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get("searchCriteria[filterGroups][0][filters][0][conditionType]")).toBe("in");
  });

  it("formatea mensajes con parámetros", () => {
    expect(formatMagentoMessage({ message: 'The "%1" is invalid', parameters: ["x"] })).toBe('The "x" is invalid');
    expect(formatMagentoMessage({ message: "%fieldName is required", parameters: { fieldName: "sku" } })).toBe("sku is required");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PRODUCT_NOT_SAVABLE_MESSAGE, updateMedia } from "@/lib/magento";

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const cantSave = () => json({ message: "The product can't be saved." }, 400);
const entry = (id: number, position: number, file = `/a/${id}.jpg`) => ({ id, media_type: "image", label: "", position, disabled: false, types: [], file });
const input = { label: "alt", position: 3, disabled: false, types: ["image"] };

beforeEach(() => {
  delete process.env.AUTH_MODE;
  process.env.MAGENTO_BASE_URL = "https://shop.test";
  process.env.MAGENTO_TOKEN = "tok";
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

const calls = () => fetchMock.mock.calls.map(([u, i]) => `${i?.method ?? "GET"} ${new URL(u).pathname}`);
const putBodies = () => fetchMock.mock.calls.filter(([, i]) => i?.method === "PUT").map(([, i]) => JSON.parse(i.body).entry);

describe("updateMedia con reintento", () => {
  it("primer PUT sin file; si funciona no hace nada más", async () => {
    fetchMock.mockResolvedValueOnce(json(true));
    await updateMedia("S1", 7, input);
    expect(calls()).toEqual(["PUT /rest/all/V1/products/S1/media/7"]);
    expect(putBodies()[0].file).toBeUndefined();
  });

  it("«can't be saved» → reintenta con la ruta actual de la imagen", async () => {
    fetchMock
      .mockResolvedValueOnce(cantSave())
      .mockResolvedValueOnce(json([entry(7, 1, "/x/foto.jpg"), entry(8, 2)]))
      .mockResolvedValueOnce(json(true))
      .mockResolvedValueOnce(json([entry(7, 3, "/x/foto.jpg"), entry(8, 2)]));
    await updateMedia("S1", 7, input);
    expect(putBodies().map((b) => b.file)).toEqual([undefined, "/x/foto.jpg"]);
    expect(calls().filter((c) => c.startsWith("DELETE"))).toEqual([]);
  });

  it("si el reintento crea una copia, borra la anterior", async () => {
    fetchMock
      .mockResolvedValueOnce(cantSave())
      .mockResolvedValueOnce(json([entry(7, 1), entry(8, 2)]))
      .mockResolvedValueOnce(json(true))
      .mockResolvedValueOnce(json([entry(7, 1), entry(8, 2), entry(99, 3, "/a/7_1.jpg")]))
      .mockResolvedValueOnce(json(true));
    await updateMedia("S1", 7, input);
    expect(calls().at(-1)).toBe("DELETE /rest/all/V1/products/S1/media/7");
  });

  it("si falla también con file → 422 con mensaje claro", async () => {
    fetchMock
      .mockResolvedValueOnce(cantSave())
      .mockResolvedValueOnce(json([entry(7, 1)]))
      .mockResolvedValueOnce(cantSave());
    await expect(updateMedia("S1", 7, input)).rejects.toMatchObject({ status: 422, message: PRODUCT_NOT_SAVABLE_MESSAGE });
  });

  it("otros errores no se reintentan", async () => {
    fetchMock.mockResolvedValueOnce(json({ message: "No image with the provided ID was found." }, 404));
    await expect(updateMedia("S1", 7, input)).rejects.toMatchObject({ status: 404 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

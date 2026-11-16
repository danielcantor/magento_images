import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addMedia, getMedia } from "@/lib/magento";

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const cutBody = () => ({ ok: true, status: 200, text: () => Promise.reject(new TypeError("terminated")) }) as unknown as Response;

beforeEach(() => {
  delete process.env.AUTH_MODE;
  process.env.MAGENTO_BASE_URL = "https://shop.test";
  process.env.MAGENTO_TOKEN = "tok";
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("conexiones inestables con Magento", () => {
  it("GET: si se corta al leer la respuesta (ECONNRESET), reintenta", async () => {
    fetchMock.mockResolvedValueOnce(cutBody()).mockResolvedValueOnce(json([]));
    await expect(getMedia("S1")).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("GET: cada intento lleva un límite de tiempo", async () => {
    fetchMock.mockResolvedValueOnce(json([]));
    await getMedia("S1");
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("POST (subir imagen): un corte NO se reintenta y avisa que pudo aplicarse", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    const err = await addMedia("S1", { base64: "AAA", mimeType: "image/jpeg", fileName: "a.jpg" }).catch((e) => e);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(err).toMatchObject({ status: 504 });
    expect(err.message).toMatch(/Puede que se haya aplicado igual/);
  });

  it("POST: un 503 tampoco se reintenta (pudo haberse procesado)", async () => {
    fetchMock.mockResolvedValueOnce(json({ message: "busy" }, 503));
    await expect(addMedia("S1", { base64: "AAA", mimeType: "image/jpeg", fileName: "a.jpg" })).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

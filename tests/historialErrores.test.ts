// Casos tomados del historial real (cargas «varios SKU» del 17 y 18/11).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addMedia, saveGallery } from "@/lib/magento";

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const img = { base64: "AAA", mimeType: "image/jpeg", fileName: "a.jpg" };
const link = (linked: string) => ({ sku: "A", link_type: "related", linked_product_sku: linked, position: 1 });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  delete process.env.AUTH_MODE;
  process.env.MAGENTO_BASE_URL = "https://shop.test";
  process.env.MAGENTO_TOKEN = "tok";
  process.env.MAGENTO_STORE_CODE = "all";
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** POST de la imagen → `post`; producto → vínculos; búsqueda → SKU existentes. */
function route(post: () => Response, links: unknown[], existing: string[]) {
  fetchMock.mockImplementation(async (u: string, init?: RequestInit) => {
    const p = new URL(u).pathname;
    if (init?.method === "POST") return post();
    if (/\/products\/A$/.test(p)) return json({ sku: "A", product_links: links });
    return json({ items: existing.map((sku) => ({ sku })) });
  });
}

const run = <T>(p: Promise<T>) => vi.runAllTimersAsync().then(() => p);

describe("subir imagen a un producto que Magento no puede guardar", () => {
  it("explica el motivo en vez de «The product can't be saved.» y, si los vinculados existen, no sugiere Reparar vínculos", async () => {
    route(() => json({ message: "The product can't be saved." }, 400), [link("X"), link("Y")], ["X", "Y"]);
    const err = await addMedia("A", img).catch((e) => e);
    expect(err.status).toBe(422);
    expect(err.message).toContain("no puede volver a grabar los productos vinculados de este producto (relacionados: 2)");
    expect(err.message).toContain("guardá el producto desde el Admin");
    expect(err.message).not.toContain("Reparar vínculos");
  });

  it("con vinculados borrados sí sugiere Reparar vínculos", async () => {
    route(() => json({ message: "The linked products data is invalid. Verify the data and try again." }, 400), [link("GONE")], []);
    const err = await addMedia("A", img).catch((e) => e);
    expect(err.message).toContain("ya no existen");
    expect(err.message).toContain("Reparar vínculos");
  });

  it("otros rechazos de la imagen (formato) se dejan tal cual", async () => {
    route(() => json({ message: "The image content is invalid." }, 400), [], []);
    await expect(addMedia("A", img)).rejects.toMatchObject({ status: 400, message: "The image content is invalid." });
  });
});

describe("bloqueos de base de datos", () => {
  const deadlock = () => json({ message: "SQLSTATE[40001]: Serialization failure: 1213 Deadlock found when trying to get lock" }, 400);

  it("reintenta el guardado de la galería y termina bien", async () => {
    let puts = 0;
    fetchMock.mockImplementation(async (_u: string, init?: RequestInit) => {
      if (init?.method === "PUT") return ++puts === 1 ? deadlock() : json({});
      return json([{ id: 1, media_type: "image", position: 1, disabled: false, types: [], file: "/a.jpg" }]);
    });
    await run(saveGallery("A", [{ id: 1, position: 2 }]));
    expect(puts).toBe(2);
  });

  it("también en un POST (Magento deshace la transacción) y con el texto en español", async () => {
    let posts = 0;
    fetchMock.mockImplementation(async () => (++posts === 1 ? json({ message: "Bloqueo de base de datos encontrado al intentar obtener bloqueo" }, 400) : json(55)));
    await expect(run(addMedia("A", img))).resolves.toBe(55);
    expect(posts).toBe(2);
  });

  it("deja de reintentar después de 2 bloqueos seguidos", async () => {
    fetchMock.mockImplementation(async (u: string, init?: RequestInit) => (init?.method === "POST" ? deadlock() : json({ sku: "A", product_links: [] })));
    const err = await run(addMedia("A", img).catch((e) => e));
    expect(fetchMock.mock.calls.filter(([, i]) => i?.method === "POST")).toHaveLength(3);
    expect(err.message).toMatch(/Deadlock/);
  });
});

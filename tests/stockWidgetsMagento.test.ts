import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkPublicRead, deleteWidget, getWidget, listWidgets, parseBlockContent, parseWidgetInput, saveWidget, setWidgetStoreForTests, widgetsEnabled } from "@/lib/stockWidgets";

/** Magento simulado: solo bloques CMS. */
function fakeMagento(opts: { denyToken?: string } = {}) {
  let block: { id: number; identifier: string; title: string; content: string; active: boolean; update_time: string } | null = null;
  let clock = 0;
  const calls: { method: string; path: string; auth: string }[] = [];
  const f = vi.fn(async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const method = init.method ?? "GET";
    const auth = (init.headers as Record<string, string>).Authorization;
    calls.push({ method, path: u.pathname, auth });
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (opts.denyToken && auth === `Bearer ${opts.denyToken}`) return json({ message: "The consumer isn't authorized to access %resources." }, 401);
    if (u.pathname.endsWith("/V1/cmsBlock/search")) return json({ items: block ? [block] : [], total_count: block ? 1 : 0 });
    const body = init.body ? JSON.parse(String(init.body)).block : null;
    if (method === "POST" && u.pathname.endsWith("/V1/cmsBlock")) {
      block = { ...body, id: 7, update_time: `t${++clock}` };
      return json(block);
    }
    if (method === "PUT" && u.pathname.endsWith("/V1/cmsBlock/7")) {
      block = { ...block!, ...body, update_time: `t${++clock}` };
      return json(block);
    }
    return json({ message: "no" }, 404);
  });
  vi.stubGlobal("fetch", f);
  return { calls, get block() { return block; } };
}

beforeEach(() => {
  setWidgetStoreForTests(null);
  delete process.env.AUDIT_LOCAL_DIR;
  delete process.env.BLOB_STORE_ID;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.STOCK_WIDGETS_STORAGE;
  delete process.env.AUTH_MODE;
  process.env.MAGENTO_BASE_URL = "https://tienda.test";
  process.env.MAGENTO_STORE_CODE = "all";
  process.env.MAGENTO_TOKEN = "tok-tienda";
});
afterEach(() => {
  vi.unstubAllGlobals();
  setWidgetStoreForTests(null);
});

describe("contadores en un bloque CMS de Magento", () => {
  it("sin bloque: lista vacía; al guardar se crea desactivado con el JSON; luego se actualiza", async () => {
    const m = fakeMagento();
    expect(widgetsEnabled()).toBe(true);
    expect(await listWidgets()).toEqual([]);
    await saveWidget(parseWidgetInput({ sku: "COL-1", initial: 10, coupon: "EXTRA", couponText: "$309.999 con el cupón:" }), "ana");
    expect(m.block).toMatchObject({ identifier: "sc-contadores-stock", active: false });
    await saveWidget(parseWidgetInput({ sku: "ALM-2", initial: 5, enabled: false }), "ana");
    expect(m.calls.filter((c) => c.method === "POST")).toHaveLength(1);
    expect(m.calls.filter((c) => c.method === "PUT")).toHaveLength(1);

    setWidgetStoreForTests(null); // otra instancia
    const ws = await listWidgets();
    expect(ws.map((w) => w.sku)).toEqual(["ALM-2", "COL-1"]);
    expect(ws[1]).toMatchObject({ coupon: "EXTRA", couponText: "$309.999 con el cupón:", updatedBy: "ana" });

    await deleteWidget("col-1");
    setWidgetStoreForTests(null);
    expect((await listWidgets()).map((w) => w.sku)).toEqual(["ALM-2"]);
  });

  it("la tienda lee con MAGENTO_TOKEN y usa la copia en memoria", async () => {
    const m = fakeMagento();
    await saveWidget(parseWidgetInput({ sku: "COL-1", initial: 10 }), "ana");
    setWidgetStoreForTests(null);
    const before = m.calls.length;
    for (let i = 0; i < 20; i++) expect((await getWidget("col-1", { cached: true }))?.sku).toBe("COL-1");
    const reads = m.calls.slice(before);
    expect(reads).toHaveLength(1);
    expect(reads[0].auth).toBe("Bearer tok-tienda");
  });

  it("si otro guardó en el medio, vuelve a leer y no pisa su cambio", async () => {
    const m = fakeMagento();
    await saveWidget(parseWidgetInput({ sku: "A", initial: 1 }), "ana");
    // Simula que otra persona cambió el bloque justo después de nuestra lectura.
    const realFetch = globalThis.fetch as unknown as (u: string, i?: RequestInit) => Promise<Response>;
    let injected = false;
    vi.stubGlobal("fetch", async (u: string, i: RequestInit = {}) => {
      const res = await realFetch(u, i);
      if (!injected && u.includes("/cmsBlock/search")) {
        injected = true;
        await realFetch("https://tienda.test/rest/all/V1/cmsBlock/7", {
          method: "PUT",
          headers: { Authorization: "Bearer x" },
          body: JSON.stringify({ block: { content: JSON.stringify({ v: 1, widgets: [{ ...parseWidgetInput({ sku: "A", initial: 1 }), updatedAt: "", updatedBy: null }, { ...parseWidgetInput({ sku: "OTRO", initial: 3 }), updatedAt: "", updatedBy: "beto" }] }) } }),
        });
      }
      return res;
    });
    await saveWidget(parseWidgetInput({ sku: "B", initial: 2 }), "ana");
    expect(parseBlockContent(m.block!.content).map((w) => w.sku)).toEqual(["A", "B", "OTRO"]);
  });

  it("sin permiso en Blocks: mensajes claros para la tienda y para el usuario", async () => {
    fakeMagento({ denyToken: "tok-tienda" });
    expect(await checkPublicRead()).toMatch(/MAGENTO_TOKEN no tiene permiso de lectura en Content > Elements > Blocks/);
    await expect(saveWidget(parseWidgetInput({ sku: "A", initial: 1 }), "ana")).rejects.toThrow(/Content > Elements > Blocks/);
  });

  it("lee el JSON aunque un editor lo haya envuelto en HTML", () => {
    const json = JSON.stringify({ v: 1, widgets: [{ sku: "X", initial: 3, enabled: true }] });
    expect(parseBlockContent(`<p>${json.replace(/"/g, "&quot;")}</p>`).map((w) => w.sku)).toEqual(["X"]);
    expect(parseBlockContent("")).toEqual([]);
  });
});

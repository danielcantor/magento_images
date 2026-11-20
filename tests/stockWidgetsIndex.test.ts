import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteWidget, getWidget, listWidgets, memoryStore, parseWidgetInput, saveWidget, setWidgetStoreForTests } from "@/lib/stockWidgets";

const input = (sku: string, enabled = true) => parseWidgetInput({ sku, initial: 10, enabled });

afterEach(() => {
  setWidgetStoreForTests(null);
  vi.useRealTimers();
});

describe("contadores: índice único y caché", () => {
  it("guardar y borrar mantienen el índice; la tienda nunca lista la carpeta", async () => {
    const m = memoryStore();
    setWidgetStoreForTests(m);
    await saveWidget(input("A"), "ana");
    await saveWidget(input("B", false), "ana");
    await saveWidget(input("a"), "ana"); // mismo SKU sin distinguir mayúsculas: reemplaza
    expect((await listWidgets()).map((w) => w.sku)).toEqual(["a", "B"]);
    await deleteWidget("b");
    expect((await listWidgets()).map((w) => w.sku)).toEqual(["a"]);

    const lists = m.calls.list;
    setWidgetStoreForTests(m); // otra instancia: sin copia en memoria
    await listWidgets({ cached: true });
    await getWidget("A", { cached: true });
    expect(m.calls.list).toBe(lists);
  });

  it("primera vez arma el índice con los archivos sueltos (una sola lista)", async () => {
    const m = memoryStore();
    m.data.set("stock-widgets/x.json", JSON.stringify({ ...input("X"), updatedAt: "", updatedBy: null }));
    m.data.set("stock-widgets/y.json", JSON.stringify({ ...input("Y"), updatedAt: "", updatedBy: null }));
    setWidgetStoreForTests(m);
    expect((await listWidgets({ cached: true })).map((w) => w.sku)).toEqual(["X", "Y"]);
    expect(m.calls.list).toBe(1);
    expect(m.data.has("stock-widgets-index.json")).toBe(true);
    setWidgetStoreForTests(m);
    await listWidgets({ cached: true });
    expect(m.calls.list).toBe(1);
  });

  it("con caché: una lectura cada 10 minutos y la última copia si Blob falla", async () => {
    vi.useFakeTimers();
    const m = memoryStore();
    setWidgetStoreForTests(m);
    await saveWidget(input("A"), "ana");
    setWidgetStoreForTests(m);
    await listWidgets({ cached: true });
    const gets = m.calls.get;
    for (let i = 0; i < 50; i++) await getWidget("A", { cached: true });
    expect(m.calls.get).toBe(gets);

    vi.advanceTimersByTime(11 * 60_000);
    m.get = async () => {
      throw new Error("403 Forbidden");
    };
    expect((await getWidget("A", { cached: true }))?.sku).toBe("A");
    await expect(listWidgets()).rejects.toThrow("403"); // el dashboard sí ve el error
  });
});

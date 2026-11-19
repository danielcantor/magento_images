import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { diagnoseStock, remainingUnits } from "@/lib/stockDiagnosis";
import { memoryStore, parseWidgetInput, saveWidget, setWidgetStoreForTests } from "@/lib/stockWidgets";
import { getSourceItems, getSourceItemsMany } from "@/lib/stock";

// Caso real: 50 unidades en RM (ERP), Sommier Stock con −1496 vendibles.
const sources = [
  { sourceCode: "default", quantity: 0, inStock: true },
  { sourceCode: "RM", quantity: 50, inStock: true, name: "Requerido_Magento" },
  { sourceCode: "D96", quantity: 0, inStock: true, enabled: false },
];

describe("diagnoseStock", () => {
  it("detecta un stock bloqueado por reservas", () => {
    const r = diagnoseStock("SKU", sources, [
      { stockId: 2, name: "Sommier Stock", channels: ["sommier"], sourceCodes: ["RM", "default"], salable: -1496 },
    ]);
    expect(r.stocks[0]).toMatchObject({ sourceQty: 50, reserved: 1546, state: "blocked" });
    expect(r.messages[0]).toContain("1546 unidades retenidas");
  });

  it("avisa de una fuente con unidades fuera de los stocks que venden", () => {
    const r = diagnoseStock("SKU", sources, [
      { stockId: 1, name: "Default Stock", channels: [], sourceCodes: ["RM"], salable: 50 },
      { stockId: 2, name: "Sommier Stock", channels: ["sommier"], sourceCodes: ["default"], salable: -1496 },
    ]);
    expect(r.orphanSources).toEqual(["RM"]);
    expect(r.stocks[1].state).toBe("no-sources");
    expect(r.messages.some((m) => m.includes("1496 unidades en reservas"))).toBe(true);
  });

  it("sin reservas está OK y sin mensajes", () => {
    const r = diagnoseStock("SKU", sources, [{ stockId: 2, name: "S", channels: ["w"], sourceCodes: ["RM"], salable: 50 }]);
    expect(r.stocks[0].state).toBe("ok");
    expect(r.messages).toEqual([]);
  });
});

describe("remainingUnits", () => {
  it("suma solo las fuentes elegidas y nunca es negativo", () => {
    expect(remainingUnits(sources, ["RM"])).toBe(50);
    expect(remainingUnits(sources, [])).toBe(50);
    expect(remainingUnits([{ sourceCode: "RM", quantity: -3, inStock: true }], ["RM"])).toBe(0);
    expect(remainingUnits([{ sourceCode: "RM", quantity: 9, inStock: false }], ["RM"])).toBe(0);
  });
});

describe("contadores", () => {
  beforeEach(() => setWidgetStoreForTests(memoryStore()));
  afterEach(() => setWidgetStoreForTests(null));

  it("valida la entrada", () => {
    expect(() => parseWidgetInput({ sku: "A", initial: 0 })).toThrow();
    expect(() => parseWidgetInput({ sku: "A", initial: 5, text: "sin cantidad" })).toThrow();
    expect(parseWidgetInput({ sku: " A ", initial: 50 })).toMatchObject({ sku: "A", text: "¡Solo quedan {n} unidades!", sources: [], showAtOrBelow: 0, enabled: true });
  });

  it("guarda y el endpoint público responde con las unidades de la fuente", async () => {
    await saveWidget(parseWidgetInput({ sku: "KCOL", initial: 50, sources: ["RM"] }), "dani");
    process.env.MAGENTO_BASE_URL = "https://shop.test";
    process.env.MAGENTO_TOKEN = "int-token";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [{ sku: "KCOL", source_code: "RM", quantity: 37, status: 1 }, { sku: "KCOL", source_code: "default", quantity: 5, status: 1 }] })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { GET } = await import("@/app/api/public/stock/[sku]/route");
    const res = await GET(new Request("https://dash.test/api/public/stock/kcol"), { params: Promise.resolve({ sku: "kcol" }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ quedan: 37, inicial: 50, visible: true });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer int-token");

    const miss = await GET(new Request("https://dash.test/api/public/stock/OTRO"), { params: Promise.resolve({ sku: "OTRO" }) });
    expect(miss.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});

describe("getSourceItems", () => {
  it("filtra por SKU exacto", async () => {
    process.env.MAGENTO_BASE_URL = "https://shop.test";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [{ sku: "A", source_code: "RM", quantity: 2, status: 1 }, { sku: "AB", source_code: "RM", quantity: 9, status: 1 }] }))),
    );
    expect(await getSourceItems("a", "t")).toEqual([{ sourceCode: "RM", quantity: 2, inStock: true }]);
    vi.unstubAllGlobals();
  });
});

describe("getSourceItemsMany", () => {
  it("una sola consulta con condición in y agrupa por SKU (sin distinguir mayúsculas)", async () => {
    process.env.MAGENTO_BASE_URL = "https://shop.test";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [
        { sku: "a1", source_code: "RM", quantity: 5, status: 1 },
        { sku: "B2", source_code: "RM", quantity: 0, status: 0 },
        { sku: "zz", source_code: "RM", quantity: 9, status: 1 },
      ] })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const r = await getSourceItemsMany(["A1", "B2", "C3"], "t");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const q = new URL(fetchMock.mock.calls[0][0]).searchParams;
    expect(q.get("searchCriteria[filter_groups][0][filters][0][value]")).toBe("A1,B2,C3");
    expect(q.get("searchCriteria[filter_groups][0][filters][0][condition_type]")).toBe("in");
    expect(r).toEqual({
      A1: [{ sourceCode: "RM", quantity: 5, inStock: true }],
      B2: [{ sourceCode: "RM", quantity: 0, inStock: false }],
      C3: [],
    });
    vi.unstubAllGlobals();
  });
});

describe("getProductIds", () => {
  it("resuelve el ID de cada SKU en una consulta y lo guarda en caché", async () => {
    const { getProductIds, clearProductIdCache } = await import("@/lib/stock");
    clearProductIdCache();
    process.env.MAGENTO_BASE_URL = "https://shop.test";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [{ id: 4068, sku: "186003" }] })));
    vi.stubGlobal("fetch", fetchMock);
    expect(await getProductIds(["186003", "NOEXISTE"], "t")).toEqual({ "186003": 4068 });
    const q = new URL(fetchMock.mock.calls[0][0]).searchParams;
    expect(q.get("searchCriteria[filter_groups][0][filters][0][condition_type]")).toBe("in");
    expect(q.get("fields")).toBe("items[id,sku]");
    expect(await getProductIds(["186003"], "t")).toEqual({ "186003": 4068 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});

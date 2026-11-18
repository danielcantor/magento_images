import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toMagentoDate, unitsInOrder } from "@/lib/stockDiagnosis";
import { countSoldUnits } from "@/lib/stockSales";
import { memoryStore, parseWidgetInput, saveWidget, setWidgetStoreForTests } from "@/lib/stockWidgets";

describe("unitsInOrder", () => {
  it("resta canceladas y reembolsadas", () => {
    expect(unitsInOrder([{ item_id: 1, sku: "K", qty_ordered: 3, qty_canceled: 1, qty_refunded: 1 }], "k")).toBe(1);
  });
  it("en configurables cuenta solo el padre", () => {
    expect(
      unitsInOrder(
        [
          { item_id: 1, sku: "K", qty_ordered: 2 },
          { item_id: 2, parent_item_id: 1, sku: "K", qty_ordered: 2 },
          { item_id: 3, sku: "OTRO", qty_ordered: 5 },
        ],
        "K",
      ),
    ).toBe(2);
  });
  it("en bundles cuenta el hijo con ese SKU", () => {
    expect(unitsInOrder([{ item_id: 1, sku: "PACK", qty_ordered: 1 }, { item_id: 2, parent_item_id: 1, sku: "K", qty_ordered: 2 }], "K")).toBe(2);
  });
});

describe("toMagentoDate", () => {
  it("convierte a UTC", () => expect(toMagentoDate("2026-11-18T10:30:00-03:00")).toBe("2026-11-18 13:30:00"));
});

const json = (b: unknown) => new Response(JSON.stringify(b));

describe("countSoldUnits", () => {
  beforeEach(() => {
    process.env.MAGENTO_BASE_URL = "https://shop.test";
    process.env.MAGENTO_TOKEN = "tok";
    delete process.env.AUTH_MODE;
  });
  afterEach(() => vi.unstubAllGlobals());

  it("filtra por estado y fecha, pagina y suma", async () => {
    const page = (n: number, from: number) =>
      Array.from({ length: n }, (_, i) => ({ increment_id: String(from + i), status: "processing", created_at: "2026-11-18 14:00:00", items: [{ item_id: 1, sku: i % 2 ? "X" : "K", qty_ordered: 1 }] }));
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ items: page(100, 1), total_count: 130 })).mockResolvedValueOnce(json({ items: page(30, 101), total_count: 130 }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await countSoldUnits("K", "2026-11-18T10:00:00-03:00", ["processing"]);
    expect(r.units).toBe(65);
    expect(r.orders).toHaveLength(65);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const q = new URL(fetchMock.mock.calls[0][0]).searchParams;
    expect(q.get("searchCriteria[filter_groups][0][filters][0][field]")).toBe("status");
    expect(q.get("searchCriteria[filter_groups][0][filters][0][value]")).toBe("processing");
    expect(q.get("searchCriteria[filter_groups][1][filters][0][value]")).toBe("2026-11-18 13:00:00");
    expect(q.get("searchCriteria[filter_groups][1][filters][0][condition_type]")).toBe("gteq");
  });

  it("el endpoint público en modo ventas devuelve iniciales − vendidas", async () => {
    setWidgetStoreForTests(memoryStore());
    await saveWidget(parseWidgetInput({ sku: "K", initial: 50, mode: "orders", since: "2026-11-18T00:00:00Z", statuses: ["Processing"] }), "dani");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json({ items: [{ increment_id: "1", status: "processing", created_at: "", items: [{ item_id: 1, sku: "K", qty_ordered: 3 }] }], total_count: 1 })),
    );
    const { GET } = await import("@/app/api/public/stock/[sku]/route");
    const res = await GET(new Request("https://d.test/api/public/stock/K"), { params: Promise.resolve({ sku: "K" }) });
    expect(await res.json()).toMatchObject({ quedan: 47, inicial: 50, visible: true });
    setWidgetStoreForTests(null);
  });

  it("el modo ventas exige fecha y estados", () => {
    expect(() => parseWidgetInput({ sku: "K", initial: 5, mode: "orders", statuses: ["processing"] })).toThrow(/desde cuándo/);
    expect(() => parseWidgetInput({ sku: "K", initial: 5, mode: "orders", since: "2026-11-18T00:00:00Z", statuses: [] })).toThrow(/estado/);
  });
});

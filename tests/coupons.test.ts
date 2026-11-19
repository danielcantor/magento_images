import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkCoupon, isPast } from "@/lib/coupons";
import { memoryStore, parseWidgetInput, saveWidget, setWidgetStoreForTests } from "@/lib/stockWidgets";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const NOW = new Date("2026-11-19T12:00:00Z");

beforeEach(() => {
  process.env.MAGENTO_BASE_URL = "https://shop.test";
  process.env.MAGENTO_TOKEN = "tok";
  delete process.env.AUTH_MODE;
});
afterEach(() => vi.unstubAllGlobals());

describe("cupón en el contador", () => {
  it("es opcional, valida el formato y pone un texto por defecto", () => {
    expect(parseWidgetInput({ sku: "K", initial: 5 })).toMatchObject({ coupon: null });
    expect(parseWidgetInput({ sku: "K", initial: 5, coupon: " LIQ10 " })).toMatchObject({ coupon: "LIQ10", couponText: "Sumá un descuento extra con el cupón" });
    expect(() => parseWidgetInput({ sku: "K", initial: 5, coupon: "con espacio" })).toThrow(/cupón/);
    expect(() => parseWidgetInput({ sku: "K", initial: 5, coupon: "A", couponText: "x".repeat(81) })).toThrow(/largo/);
  });

  it("el endpoint público lo devuelve solo si está configurado", async () => {
    setWidgetStoreForTests(memoryStore());
    await saveWidget(parseWidgetInput({ sku: "K", initial: 50, sources: ["RM"], coupon: "LIQ10", couponText: "Usá" }), "dani");
    await saveWidget(parseWidgetInput({ sku: "J", initial: 50, sources: ["RM"] }), "dani");
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => json({ items: [{ sku: "K", source_code: "RM", quantity: 10, status: 1 }, { sku: "J", source_code: "RM", quantity: 10, status: 1 }] })));
    const { GET } = await import("@/app/api/public/stock/[sku]/route");
    const k = await (await GET(new Request("https://d.test/x"), { params: Promise.resolve({ sku: "K" }) })).json();
    const j = await (await GET(new Request("https://d.test/x"), { params: Promise.resolve({ sku: "J" }) })).json();
    expect(k).toMatchObject({ cupon: "LIQ10", cuponTexto: "Usá" });
    expect(j.cupon).toBeUndefined();
    setWidgetStoreForTests(null);
  });
});

describe("checkCoupon", () => {
  it("isPast cuenta el día entero", () => {
    expect(isPast("2026-11-19", NOW)).toBe(false);
    expect(isPast("2026-11-18", NOW)).toBe(true);
    expect(isPast(null, NOW)).toBe(false);
  });

  it("vigente, inexistente, inactivo, vencido y sin permiso", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    f.mockResolvedValueOnce(json({ items: [{ code: "LIQ10", rule_id: 7 }] })).mockResolvedValueOnce(json({ name: "Liquidación", is_active: true, to_date: "2026-12-31" }));
    expect(await checkCoupon("liq10", NOW)).toEqual({ state: "ok", rule: "Liquidación" });
    f.mockResolvedValueOnce(json({ items: [] }));
    expect((await checkCoupon("NO", NOW)).state).toBe("missing");
    f.mockResolvedValueOnce(json({ items: [{ code: "A", rule_id: 1 }] })).mockResolvedValueOnce(json({ name: "R", is_active: false }));
    expect((await checkCoupon("A", NOW)).state).toBe("inactive");
    f.mockResolvedValueOnce(json({ items: [{ code: "A", rule_id: 1 }] })).mockResolvedValueOnce(json({ name: "R", is_active: true, to_date: "2026-11-01" }));
    expect((await checkCoupon("A", NOW)).state).toBe("expired");
    f.mockResolvedValueOnce(json({ items: [{ code: "A", rule_id: 1, usage_limit: 100, times_used: 100 }] })).mockResolvedValueOnce(json({ name: "R", is_active: true }));
    expect((await checkCoupon("A", NOW)).message).toMatch(/100 usos/);
    f.mockResolvedValueOnce(json({ message: "The consumer isn't authorized to access %resources." }, 401));
    const r = await checkCoupon("A", NOW);
    expect(r.state).toBe("unknown");
    expect(r.message).toMatch(/Cart Price Rules/);
  });
});

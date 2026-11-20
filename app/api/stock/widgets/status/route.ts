// Estado de los contadores para el inicio: cuántas unidades quedan y si se ven en la tienda.
// Las consultas usan el token del usuario conectado; aparte se prueba MAGENTO_TOKEN, que es
// el que usa la tienda (endpoint público), con una sola consulta liviana.
import { NextResponse } from "next/server";
import { MagentoError } from "@/lib/magento";
import { getProductNames, getSourceItems, getSourceItemsMany } from "@/lib/stock";
import { countSoldUnits } from "@/lib/stockSales";
import { remainingUnits } from "@/lib/stockDiagnosis";
import { checkPublicRead, listWidgets, widgetsEnabled, type StockWidget } from "@/lib/stockWidgets";
import { widgetVisibility, type WidgetStatus, type WidgetsStatusResponse } from "@/lib/stockVisibility";

export const dynamic = "force-dynamic";

const errMsg = (e: unknown) => (e instanceof MagentoError ? e.message : "Error consultando Magento");

async function storeTokenCheck(first: StockWidget | undefined): Promise<WidgetsStatusResponse["storeToken"]> {
  const token = process.env.MAGENTO_TOKEN;
  if (!token) return first ? { ok: false, message: "Falta MAGENTO_TOKEN: la tienda no puede mostrar los contadores." } : null;
  // La tienda primero lee la lista de contadores (bloque CMS) con MAGENTO_TOKEN.
  const readError = await checkPublicRead();
  if (readError) return { ok: false, message: readError };
  if (!first) return { ok: true };
  try {
    // Misma clase de consulta que hace el endpoint público para ese contador.
    if (first.mode === "orders" && first.since) await countSoldUnits(first.sku, first.since, first.statuses, token);
    else await getSourceItems(first.sku, token);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: errMsg(e) };
  }
}

export async function GET() {
  if (!widgetsEnabled()) return NextResponse.json({ enabled: false, active: [], paused: [], storeToken: null } satisfies WidgetsStatusResponse);
  let all: StockWidget[];
  try {
    all = await listWidgets();
  } catch (e) {
    if (!(e instanceof MagentoError)) console.error(e);
    return NextResponse.json({ error: e instanceof MagentoError ? e.message : "No se pudieron leer los contadores." }, { status: 500 });
  }
  const active = all.filter((w) => w.enabled);
  const paused = all.filter((w) => !w.enabled).map((w) => ({ sku: w.sku, updatedAt: w.updatedAt }));
  if (!active.length) return NextResponse.json({ enabled: true, active: [], paused, storeToken: await storeTokenCheck(undefined) } satisfies WidgetsStatusResponse);

  const bySources = active.filter((w) => !(w.mode === "orders" && w.since));
  const [names, sources, token] = await Promise.all([
    getProductNames(active.map((w) => w.sku)).catch(() => ({}) as Record<string, string>),
    bySources.length
      ? getSourceItemsMany(bySources.map((w) => w.sku)).then(
          (r) => ({ ok: true as const, r }),
          (e) => ({ ok: false as const, error: errMsg(e) }),
        )
      : null,
    storeTokenCheck(active[0]),
  ]);

  // Los de ventas consultan pedidos uno por uno: de a 4 para no saturar Magento.
  const sold = new Map<string, { units: number } | { error: string }>();
  const byOrders = active.filter((w) => w.mode === "orders" && w.since);
  for (let i = 0; i < byOrders.length; i += 4) {
    await Promise.all(
      byOrders.slice(i, i + 4).map((w) =>
        countSoldUnits(w.sku, w.since!, w.statuses).then(
          (r) => sold.set(w.sku, { units: r.units }),
          (e) => sold.set(w.sku, { error: errMsg(e) }),
        ),
      ),
    );
  }

  const items: WidgetStatus[] = active.map((w) => {
    const base = {
      sku: w.sku,
      name: (names as Record<string, string>)[w.sku] ?? null,
      mode: w.mode,
      initial: w.initial,
      showAtOrBelow: w.showAtOrBelow,
      coupon: w.coupon,
    };
    let quedan: number | null = null;
    let error: string | undefined;
    const s = sold.get(w.sku);
    if (s) {
      if ("error" in s) error = s.error;
      else quedan = Math.max(0, w.initial - s.units);
    } else if (sources) {
      if (sources.ok) quedan = remainingUnits(sources.r[w.sku] ?? [], w.sources);
      else error = sources.error;
    }
    return { ...base, quedan, visibility: quedan === null ? null : widgetVisibility(quedan, w.showAtOrBelow), ...(error ? { error } : {}) };
  });

  return NextResponse.json({ enabled: true, active: items, paused, storeToken: token } satisfies WidgetsStatusResponse);
}

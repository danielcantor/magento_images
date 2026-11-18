import { NextResponse } from "next/server";
import { handle } from "@/lib/apiHandler";
import { countSoldUnits } from "@/lib/stockSales";
import { parseWidgetInput, WidgetInputError } from "@/lib/stockWidgets";
import { statusMatches } from "@/lib/stockDiagnosis";

export const dynamic = "force-dynamic";

/** Ventas que contaría un contador "por ventas", con el detalle de pedidos (token del usuario). */
export const POST = handle(async (req: Request) => {
  let w;
  try {
    w = parseWidgetInput(await req.json().catch(() => null));
  } catch (e) {
    if (e instanceof WidgetInputError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
  if (w.mode !== "orders" || !w.since) return NextResponse.json({ error: "Solo para el modo por ventas" }, { status: 400 });
  // Se piden todos los estados para mostrar también los pedidos que quedan fuera.
  const all = await countSoldUnits(w.sku, w.since, null);
  const counted = all.orders.filter((o) => statusMatches(o.status, w.statuses));
  const excluded: Record<string, { orders: number; units: number }> = {};
  for (const o of all.orders) {
    if (statusMatches(o.status, w.statuses)) continue;
    const e = (excluded[o.status] ??= { orders: 0, units: 0 });
    e.orders++;
    e.units += o.units;
  }
  const units = counted.reduce((a, o) => a + o.units, 0);
  return { units, orders: counted, excluded, quedan: Math.max(0, w.initial - units) };
});

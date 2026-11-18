import { NextResponse } from "next/server";
import { handle } from "@/lib/apiHandler";
import { countSoldUnits } from "@/lib/stockSales";
import { parseWidgetInput, WidgetInputError } from "@/lib/stockWidgets";

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
  const sales = await countSoldUnits(w.sku, w.since, w.statuses);
  return { ...sales, quedan: Math.max(0, w.initial - sales.units) };
});

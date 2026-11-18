// Endpoint PÚBLICO (sin login) que consulta el contador de la tienda.
// Solo responde para SKUs con contador activo y solo devuelve cuántas unidades quedan.
import { NextResponse } from "next/server";
import { MagentoError } from "@/lib/magento";
import { getSourceItems } from "@/lib/stock";
import { countSoldUnits } from "@/lib/stockSales";
import { remainingUnits } from "@/lib/stockDiagnosis";
import { getWidget } from "@/lib/stockWidgets";

export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": process.env.STOCK_WIDGET_ORIGIN || "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  Vary: "Origin",
};

function reply(body: unknown, status: number, maxAge: number) {
  return NextResponse.json(body, {
    status,
    headers: {
      ...CORS,
      // La CDN de Vercel guarda la respuesta: Magento recibe como mucho una consulta cada `maxAge` s por SKU.
      "Cache-Control": `public, max-age=0, s-maxage=${maxAge}, stale-while-revalidate=600`,
    },
  });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET(_req: Request, ctx: { params: Promise<{ sku: string }> }) {
  const sku = decodeURIComponent((await ctx.params).sku).trim();
  const widget = await getWidget(sku, { cached: true }).catch(() => null);
  if (!widget || !widget.enabled) return reply({ error: "Sin contador para este producto" }, 404, 300);

  const token = process.env.MAGENTO_TOKEN;
  if (!token) return reply({ error: "Falta MAGENTO_TOKEN" }, 503, 60);

  try {
    const quedan =
      widget.mode === "orders" && widget.since
        ? Math.max(0, widget.initial - (await countSoldUnits(widget.sku, widget.since, widget.statuses, token)).units)
        : remainingUnits(await getSourceItems(widget.sku, token), widget.sources);
    const visible = quedan > 0 && (widget.showAtOrBelow === 0 || quedan <= widget.showAtOrBelow);
    return reply({ sku: widget.sku, quedan, inicial: widget.initial, texto: widget.text, visible }, 200, 120);
  } catch (e) {
    const msg = e instanceof MagentoError ? e.message : "Error consultando Magento";
    console.error("stock público", sku, msg);
    return reply({ error: msg }, 502, 30);
  }
}

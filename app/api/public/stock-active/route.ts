// Endpoint PÚBLICO: productos con contador activo (SKU e ID). Lo usa el script de la tienda
// para no consultar el contador en cada ficha y para reconocer las cards de los listados.
import { NextResponse } from "next/server";
import { listWidgets } from "@/lib/stockWidgets";
import { getProductIds } from "@/lib/stock";

export const dynamic = "force-dynamic";

const CORS = { "Access-Control-Allow-Origin": process.env.STOCK_WIDGET_ORIGIN || "*", Vary: "Origin" };

export async function GET() {
  try {
    const skus = (await listWidgets({ cached: true })).filter((w) => w.enabled).map((w) => w.sku);
    // El ID es opcional: si Magento no responde, las fichas siguen funcionando por SKU.
    const ids = skus.length && process.env.MAGENTO_TOKEN ? await getProductIds(skus, process.env.MAGENTO_TOKEN).catch(() => ({}) as Record<string, number>) : {};
    return NextResponse.json(
      { skus, items: skus.map((sku) => ({ sku, id: ids[sku] ?? null })) },
      // Lo pide cada página de la tienda: la CDN lo guarda 5 min y lo sirve viejo mientras lo renueva
      // (o si la función falla). Un contador nuevo o apagado tarda hasta ~5–10 min en reflejarse.
      { headers: { ...CORS, "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=3600, stale-if-error=86400" } },
    );
  } catch (e) {
    console.error("stock-active", e);
    return NextResponse.json({ skus: [], items: [] }, { status: 502, headers: { ...CORS, "Cache-Control": "public, max-age=0, s-maxage=300" } });
  }
}

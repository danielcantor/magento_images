// Endpoint PÚBLICO: productos con contador activo (SKU e ID). Lo usa el script de la tienda
// para no consultar el contador en cada ficha y para reconocer las cards de los listados.
import { NextResponse } from "next/server";
import { listWidgets } from "@/lib/stockWidgets";
import { getProductIds } from "@/lib/stock";

export const dynamic = "force-dynamic";

const CORS = { "Access-Control-Allow-Origin": process.env.STOCK_WIDGET_ORIGIN || "*", Vary: "Origin" };

export async function GET() {
  try {
    const skus = (await listWidgets()).filter((w) => w.enabled).map((w) => w.sku);
    // El ID es opcional: si Magento no responde, las fichas siguen funcionando por SKU.
    const ids = skus.length && process.env.MAGENTO_TOKEN ? await getProductIds(skus, process.env.MAGENTO_TOKEN).catch(() => ({}) as Record<string, number>) : {};
    return NextResponse.json(
      { skus, items: skus.map((sku) => ({ sku, id: ids[sku] ?? null })) },
      { headers: { ...CORS, "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=60" } },
    );
  } catch (e) {
    console.error("stock-active", e);
    return NextResponse.json({ skus: [], items: [] }, { status: 502, headers: { ...CORS, "Cache-Control": "public, max-age=0, s-maxage=30" } });
  }
}

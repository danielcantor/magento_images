// Endpoint PÚBLICO: SKUs con contador activo. Lo usa el script global de la tienda
// para no consultar el contador en cada ficha de producto.
import { NextResponse } from "next/server";
import { listWidgets } from "@/lib/stockWidgets";

export const dynamic = "force-dynamic";

const CORS = { "Access-Control-Allow-Origin": process.env.STOCK_WIDGET_ORIGIN || "*", Vary: "Origin" };

export async function GET() {
  try {
    const skus = (await listWidgets()).filter((w) => w.enabled).map((w) => w.sku);
    return NextResponse.json(
      { skus },
      { headers: { ...CORS, "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=60" } },
    );
  } catch (e) {
    console.error("stock-active", e);
    return NextResponse.json({ skus: [] }, { status: 502, headers: { ...CORS, "Cache-Control": "public, max-age=0, s-maxage=30" } });
  }
}

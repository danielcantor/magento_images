import { handle } from "@/lib/apiHandler";
import { getStockReport } from "@/lib/stock";

export const dynamic = "force-dynamic";

/** Diagnóstico de inventario de un SKU (con el token del usuario conectado). */
export const GET = handle(async (_req: Request, ctx: { params: Promise<{ sku: string }> }) => {
  const { sku } = await ctx.params;
  return getStockReport(decodeURIComponent(sku));
});

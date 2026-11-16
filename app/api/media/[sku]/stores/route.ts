import { handle } from "@/lib/apiHandler";
import { getStoreDiffs, syncStores } from "@/lib/magento";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ sku: string }> };

/** Tiendas cuyas imágenes difieren de lo general. */
export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const { sku } = await ctx.params;
  return { stores: await getStoreDiffs(decodeURIComponent(sku)) };
});

/** Copia los valores generales (roles, alt, posición, oculta) en las tiendas que difieren. */
export const POST = handle(async (_req: Request, ctx: Ctx) => {
  const { sku } = await ctx.params;
  return syncStores(decodeURIComponent(sku));
});

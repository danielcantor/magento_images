import { handle } from "@/lib/apiHandler";
import { getStoreDiffs, syncStores } from "@/lib/magento";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Ctx = { params: Promise<{ sku: string }> };

/** Tiendas cuyas imágenes difieren de lo general. */
export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const { sku } = await ctx.params;
  return { stores: await getStoreDiffs(decodeURIComponent(sku)) };
});

/**
 * Copia los valores generales (roles, alt, posición, oculta) en las tiendas que
 * difieren. Con ?store=<código> trabaja una sola tienda, para que cada petición
 * sea corta aunque Magento sea lento.
 */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { sku } = await ctx.params;
  const store = new URL(req.url).searchParams.get("store") || undefined;
  return syncStores(decodeURIComponent(sku), store);
});

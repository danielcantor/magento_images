import { handle } from "@/lib/apiHandler";
import { getMedia } from "@/lib/magento";

export const dynamic = "force-dynamic";

export const GET = handle(async (_req: Request, ctx: { params: Promise<{ sku: string }> }) => {
  const { sku } = await ctx.params;
  return { entries: await getMedia(decodeURIComponent(sku)) };
});

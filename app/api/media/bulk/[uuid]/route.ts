import { BadRequest, handle } from "@/lib/apiHandler";
import { getBulkStatus } from "@/lib/magento";

export const dynamic = "force-dynamic";

export const GET = handle(async (_req: Request, ctx: { params: Promise<{ uuid: string }> }) => {
  const { uuid } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(uuid)) throw new BadRequest("bulk_uuid no válido");
  return getBulkStatus(uuid);
});

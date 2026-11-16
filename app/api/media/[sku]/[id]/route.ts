import { BadRequest, handle, parseId } from "@/lib/apiHandler";
import { deleteMedia, updateMedia } from "@/lib/magento";
import { allowedRoleCodes, parseTypes } from "@/lib/uploadValidation";

type Ctx = { params: Promise<{ sku: string; id: string }> };

export const PUT = handle(async (req: Request, ctx: Ctx) => {
  const { sku, id } = await ctx.params;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) throw new BadRequest("Cuerpo JSON no válido");
  const types = parseTypes(b.types, await allowedRoleCodes());
  await updateMedia(decodeURIComponent(sku), parseId(id), {
    label: typeof b.label === "string" ? b.label.slice(0, 255) : null,
    position: Number.isFinite(Number(b.position)) ? Number(b.position) : 0,
    disabled: Boolean(b.disabled),
    types,
  });
  return { ok: true };
});

export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const { sku, id } = await ctx.params;
  await deleteMedia(decodeURIComponent(sku), parseId(id));
  return { ok: true };
});

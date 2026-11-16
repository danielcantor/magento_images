import { BadRequest, handle } from "@/lib/apiHandler";
import { saveGallery, type GalleryChange } from "@/lib/magento";
import { allowedRoleCodes, parseTypes } from "@/lib/uploadValidation";

export const maxDuration = 300;

/** Guarda varios cambios de la galería de un producto en un solo guardado. Body: { changes: [{id, position?, label?, disabled?, types?}] } */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ sku: string }> }) => {
  const { sku } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { changes?: unknown } | null;
  if (!body || !Array.isArray(body.changes) || !body.changes.length) throw new BadRequest("Se esperaba { changes: [...] }");
  if (body.changes.length > 200) throw new BadRequest("Demasiados cambios");
  const roles = await allowedRoleCodes();
  const changes: GalleryChange[] = body.changes.map((raw) => {
    const c = raw as Record<string, unknown>;
    const id = Number(c.id);
    if (!Number.isInteger(id) || id <= 0) throw new BadRequest("ID de imagen no válido");
    const out: GalleryChange = { id };
    if (c.position !== undefined) out.position = Math.max(0, Math.floor(Number(c.position) || 0));
    if (c.label !== undefined) out.label = c.label === null ? "" : String(c.label).slice(0, 255);
    if (c.disabled !== undefined) out.disabled = Boolean(c.disabled);
    if (c.types !== undefined) out.types = parseTypes(c.types, roles);
    return out;
  });
  await saveGallery(decodeURIComponent(sku), changes);
  return { ok: true };
});

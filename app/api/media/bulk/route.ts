import { BadRequest, handle } from "@/lib/apiHandler";
import { enqueueMediaBulk, type BulkMediaItem } from "@/lib/magento";
import { safeFileName } from "@/lib/skuMatcher";
import { allowedRoleCodes, fileToContent, parseTypes, type FileContent } from "@/lib/uploadValidation";

export const maxDuration = 300;

/** Máximo de datos por petición a Magento (base64). Ajustable si PHP admite más. */
const MAGENTO_MAX_BYTES = (Number(process.env.MAGENTO_BULK_MAX_MB) || 16) * 1024 * 1024;
const MAX_ITEMS = 200;

interface IncomingItem {
  sku: string;
  field: string;
  position: number;
  types?: string[];
}

/**
 * Encola subidas en la API bulk de Magento.
 * multipart: archivos en campos f0, f1… y `items` = JSON [{sku, field, position, types}].
 * Un mismo archivo puede usarse en varios items (misma imagen a varios SKU).
 * Responde los bulks creados con el rango de items que cubre cada uno.
 */
export const POST = handle(async (req: Request) => {
  const form = await req.formData().catch(() => null);
  if (!form) throw new BadRequest("Se esperaba multipart/form-data");

  let items: IncomingItem[];
  try {
    items = JSON.parse(String(form.get("items") ?? "[]"));
  } catch {
    throw new BadRequest("items debe ser JSON");
  }
  if (!Array.isArray(items) || !items.length) throw new BadRequest("No hay imágenes que encolar");
  if (items.length > MAX_ITEMS) throw new BadRequest(`Máximo ${MAX_ITEMS} imágenes por envío`);

  const contents = new Map<string, FileContent>();
  for (const it of items) {
    if (!it || typeof it.sku !== "string" || !it.sku.trim() || typeof it.field !== "string") {
      throw new BadRequest("Item no válido");
    }
    if (!contents.has(it.field)) contents.set(it.field, await fileToContent(form.get(it.field)));
  }

  const roles = await allowedRoleCodes();
  const toEntry = (it: IncomingItem): BulkMediaItem => {
    const c = contents.get(it.field)!;
    const position = Math.max(0, Math.floor(Number(it.position) || 0));
    return {
      sku: it.sku.trim(),
      entry: {
        media_type: "image",
        label: "",
        position,
        disabled: false,
        types: parseTypes(it.types, roles),
        content: { base64_encoded_data: c.base64, type: c.mimeType, name: safeFileName(it.sku.trim(), position || 1, c.ext) },
      },
    };
  };

  // Se parte en varios bulks si el total supera lo que admite Magento por petición.
  const bulks: { bulkUuid: string; from: number; items: { accepted: boolean; message?: string }[] }[] = [];
  let start = 0;
  while (start < items.length) {
    let end = start;
    let bytes = 0;
    while (end < items.length) {
      const size = contents.get(items[end].field)!.base64.length;
      if (end > start && bytes + size > MAGENTO_MAX_BYTES) break;
      bytes += size;
      end++;
    }
    const res = await enqueueMediaBulk(items.slice(start, end).map(toEntry));
    bulks.push({ bulkUuid: res.bulkUuid, from: start, items: res.items });
    start = end;
  }
  return { bulks };
});

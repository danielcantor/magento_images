import { BadRequest, handle } from "@/lib/apiHandler";
import { addMedia } from "@/lib/magento";
import { safeFileName } from "@/lib/skuMatcher";
import { ROLES } from "@/lib/types";

export const maxDuration = 60;

// Tipos que acepta Magento por API. WebP se convierte a JPEG en el navegador.
const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
};

const MAX_BYTES = 4 * 1024 * 1024; // límite de cuerpo de Vercel: 4,5 MB

// multipart: sku, file, position?, label?, types? (JSON), disabled?
export const POST = handle(async (req: Request) => {
  const form = await req.formData().catch(() => null);
  if (!form) throw new BadRequest("Se esperaba multipart/form-data");
  const sku = String(form.get("sku") ?? "").trim();
  const file = form.get("file");
  if (!sku) throw new BadRequest("Falta el SKU");
  if (!(file instanceof File)) throw new BadRequest("Falta el archivo");
  const ext = MIME_EXT[file.type];
  if (!ext) throw new BadRequest(`Tipo de imagen no admitido: ${file.type || "desconocido"}`);
  if (file.size > MAX_BYTES) throw new BadRequest("La imagen supera 4 MB tras la compresión");

  let types: string[] = [];
  try {
    const raw = JSON.parse(String(form.get("types") ?? "[]"));
    if (Array.isArray(raw)) types = raw.map(String).filter((t) => (ROLES as readonly string[]).includes(t));
  } catch {
    throw new BadRequest("types debe ser un JSON array");
  }
  const position = Number(form.get("position") ?? 0) || 0;

  const id = await addMedia(sku, {
    base64: Buffer.from(await file.arrayBuffer()).toString("base64"),
    mimeType: file.type === "image/jpg" ? "image/jpeg" : file.type,
    fileName: safeFileName(sku, position || 1, ext),
    label: form.get("label") ? String(form.get("label")).slice(0, 255) : "",
    position,
    disabled: form.get("disabled") === "true",
    types,
  });
  return { id };
});

import { BadRequest, handle } from "@/lib/apiHandler";
import { addMedia } from "@/lib/magento";
import { safeFileName } from "@/lib/skuMatcher";
import { ROLES } from "@/lib/types";
import { fileToContent, parseTypes } from "@/lib/uploadValidation";

export const maxDuration = 60;

// multipart: sku, file, position?, label?, types? (JSON), disabled?
export const POST = handle(async (req: Request) => {
  const form = await req.formData().catch(() => null);
  if (!form) throw new BadRequest("Se esperaba multipart/form-data");
  const sku = String(form.get("sku") ?? "").trim();
  if (!sku) throw new BadRequest("Falta el SKU");
  const content = await fileToContent(form.get("file"));

  let types: string[];
  try {
    types = parseTypes(JSON.parse(String(form.get("types") ?? "[]")), ROLES);
  } catch {
    throw new BadRequest("types debe ser un JSON array");
  }
  const position = Number(form.get("position") ?? 0) || 0;

  const id = await addMedia(sku, {
    base64: content.base64,
    mimeType: content.mimeType,
    fileName: safeFileName(sku, position || 1, content.ext),
    label: form.get("label") ? String(form.get("label")).slice(0, 255) : "",
    position,
    disabled: form.get("disabled") === "true",
    types,
  });
  return { id };
});

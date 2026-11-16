import "server-only";
import { BadRequest } from "./apiHandler";
import { getMediaRoles } from "./magento";

// Tipos que acepta Magento por API. WebP se convierte a JPEG en el navegador.
export const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
};

/** Límite de cuerpo de Vercel: 4,5 MB por petición. */
export const MAX_BYTES = 4 * 1024 * 1024;

export interface FileContent {
  base64: string;
  mimeType: string;
  ext: string;
}

export async function fileToContent(file: unknown): Promise<FileContent> {
  if (!(file instanceof File)) throw new BadRequest("Falta el archivo");
  const ext = MIME_EXT[file.type];
  if (!ext) throw new BadRequest(`Tipo de imagen no admitido: ${file.type || "desconocido"}`);
  if (file.size > MAX_BYTES) throw new BadRequest("La imagen supera 4 MB tras la compresión");
  return {
    base64: Buffer.from(await file.arrayBuffer()).toString("base64"),
    mimeType: file.type === "image/jpg" ? "image/jpeg" : file.type,
    ext,
  };
}

export function parseTypes(raw: unknown, allowed: readonly string[]): string[] {
  return Array.isArray(raw) ? raw.map(String).filter((t) => allowed.includes(t)) : [];
}

/** Códigos de rol válidos según la tienda. */
export async function allowedRoleCodes(): Promise<string[]> {
  return (await getMediaRoles()).map((r) => r.code);
}

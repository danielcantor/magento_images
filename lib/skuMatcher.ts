// Empareja nombres de archivo con SKU.
// Reglas: "SKU.jpg" -> posición 1; "SKU_2.jpg" -> posición 2 (separador configurable).

export const ALLOWED_EXTENSIONS = ["jpg", "jpeg", "png", "gif", "webp"];

export type Separator = "_" | "-" | ".";

export interface ParsedName {
  fileName: string;
  /** SKU interpretando el sufijo numérico como posición. */
  sku: string;
  position: number;
  /** SKU alternativo si el nombre completo (sin extensión) podría ser el SKU. */
  altSku: string | null;
  error?: string;
}

export function parseFileName(fileName: string, separator: Separator = "_"): ParsedName {
  const dot = fileName.lastIndexOf(".");
  const ext = dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : "";
  const base = (dot >= 0 ? fileName.slice(0, dot) : fileName).trim();

  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return { fileName, sku: base, position: 1, altSku: null, error: `Formato no admitido (.${ext || "sin extensión"})` };
  }
  if (!base) {
    return { fileName, sku: "", position: 1, altSku: null, error: "Nombre vacío" };
  }

  const sep = separator.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = base.match(new RegExp(`^(.+?)${sep}(\\d{1,3})$`));
  if (m) {
    // Ej: "ABC_2" puede ser SKU "ABC" posición 2, o un SKU que se llama "ABC_2".
    return { fileName, sku: m[1].trim(), position: Number(m[2]), altSku: base };
  }
  return { fileName, sku: base, position: 1, altSku: null };
}

export interface PlannedFile<F = unknown> {
  file: F;
  fileName: string;
  position: number;
}

export interface SkuGroup<F = unknown> {
  sku: string;
  files: PlannedFile<F>[];
}

export interface MatchResult<F = unknown> {
  groups: SkuGroup<F>[];
  rejected: { fileName: string; reason: string; sku?: string }[];
}

/**
 * Agrupa archivos por SKU usando la lista de SKU existentes en Magento.
 * `existing` puede venir con distinta grafía (mayúsculas); se usa la de Magento.
 */
export function matchFiles<F>(
  items: { file: F; parsed: ParsedName }[],
  existing: string[],
): MatchResult<F> {
  const byLower = new Map(existing.map((s) => [s.toLowerCase(), s]));
  const groups = new Map<string, PlannedFile<F>[]>();
  const rejected: MatchResult<F>["rejected"] = [];

  for (const { file, parsed } of items) {
    if (parsed.error) {
      rejected.push({ fileName: parsed.fileName, reason: parsed.error });
      continue;
    }
    let sku = byLower.get(parsed.sku.toLowerCase());
    let position = parsed.position;
    if (!sku && parsed.altSku) {
      sku = byLower.get(parsed.altSku.toLowerCase());
      position = 1;
    }
    if (!sku) {
      rejected.push({ fileName: parsed.fileName, reason: "SKU no existe en Magento", sku: parsed.sku });
      continue;
    }
    const list = groups.get(sku) ?? [];
    list.push({ file, fileName: parsed.fileName, position });
    groups.set(sku, list);
  }

  return {
    groups: [...groups.entries()].map(([sku, files]) => ({
      sku,
      files: files.sort((a, b) => a.position - b.position || (a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0)),
    })),
    rejected,
  };
}

/** Todos los SKU candidatos a validar contra Magento. */
export function candidateSkus(parsed: ParsedName[]): string[] {
  const out = new Set<string>();
  for (const p of parsed) {
    if (p.error) continue;
    out.add(p.sku);
    if (p.altSku) out.add(p.altSku);
  }
  return [...out];
}

/** Nombre de archivo seguro para Magento. */
export function safeFileName(sku: string, position: number, ext: string): string {
  const clean = sku.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "img";
  return `${clean}_${position}.${ext}`;
}

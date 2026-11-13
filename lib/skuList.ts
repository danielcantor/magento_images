// Convierte texto pegado o CSV en una lista de SKU únicos.

function unique(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const s = raw.trim().replace(/^"(.*)"$/, "$1").trim();
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
  }
  return out;
}

/** Texto libre: separa por saltos de línea, comas, punto y coma, tabuladores o espacios. */
export function parseSkuText(text: string): string[] {
  return unique(text.replace(/^﻿/, "").split(/[\s,;]+/));
}

function splitCsvLine(line: string, sep: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      cells.push(cur);
      cur = "";
    } else cur += c;
  }
  cells.push(cur);
  return cells;
}

/** CSV: usa la columna "sku" si hay cabecera; si no, la primera columna. */
export function parseSkuCsv(text: string): string[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const first = lines[0];
  const sep = (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ";" : first.includes("\t") && !first.includes(",") ? "\t" : ",";
  const rows = lines.map((l) => splitCsvLine(l, sep));
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = header.indexOf("sku");
  const data = col >= 0 ? rows.slice(1) : rows;
  return unique(data.map((r) => r[col >= 0 ? col : 0] ?? ""));
}

/** Clave de sessionStorage para pasar SKU de Productos a «Imagen a varios SKU». */
export const SHARED_SKUS_KEY = "shared-skus";

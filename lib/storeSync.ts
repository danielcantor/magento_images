// Compara la galería general con la de cada tienda y decide qué igualar.
import type { MediaEntry } from "./types";

export type DiffField = "roles" | "alt" | "posición" | "oculta";

export interface EntryDiff {
  id: number;
  fields: DiffField[];
}

export interface StoreDiff {
  storeCode: string;
  storeName: string;
  diffs: EntryDiff[];
}

const sameRoles = (a: string[], b: string[]) => [...a].sort().join(",") === [...b].sort().join(",");

/** Diferencias por imagen entre lo general y una tienda. Las imágenes que la tienda no ve se ignoran. */
export function diffEntries(general: MediaEntry[], store: MediaEntry[]): EntryDiff[] {
  const byId = new Map(store.map((e) => [e.id, e]));
  const out: EntryDiff[] = [];
  for (const g of general) {
    const s = byId.get(g.id);
    if (!s) continue;
    const fields: DiffField[] = [];
    if (!sameRoles(g.types, s.types)) fields.push("roles");
    if ((g.label ?? "") !== (s.label ?? "")) fields.push("alt");
    if (g.position !== s.position) fields.push("posición");
    if (Boolean(g.disabled) !== Boolean(s.disabled)) fields.push("oculta");
    if (fields.length) out.push({ id: g.id, fields });
  }
  return out;
}

/**
 * Entradas (con valores generales) que hay que escribir en la tienda.
 * Primero las que llevan roles: Magento quita esos roles de las demás imágenes de la tienda.
 */
export function planStoreUpdates(general: MediaEntry[], diffs: EntryDiff[]): MediaEntry[] {
  const ids = new Set(diffs.map((d) => d.id));
  return general.filter((g) => ids.has(g.id)).sort((a, b) => b.types.length - a.types.length);
}

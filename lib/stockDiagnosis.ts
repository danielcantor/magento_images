// Lógica pura del diagnóstico de stock (sin llamadas a Magento, para poder testearla).

export interface SourceItem {
  sourceCode: string;
  quantity: number;
  inStock: boolean;
  name?: string;
  enabled?: boolean;
}

export interface StockInfo {
  stockId: number;
  name: string;
  /** Códigos de los sitios web que venden con este stock. */
  channels: string[];
  sourceCodes: string[];
  /** Cantidad vendible según Magento; null si el producto no está en ese stock. */
  salable: number | null;
}

export interface StockRow extends StockInfo {
  /** Suma de las fuentes del stock que están activas y "In Stock". */
  sourceQty: number;
  /** Unidades que Magento descuenta por reservas (y umbral de agotado): sourceQty − salable. */
  reserved: number | null;
  state: "ok" | "blocked" | "reservations" | "no-sources" | "unassigned";
}

export interface StockReport {
  sku: string;
  sources: SourceItem[];
  stocks: StockRow[];
  /** Fuentes con unidades que no pertenecen a ningún stock con sitio web. */
  orphanSources: string[];
  messages: string[];
}

export function diagnoseStock(sku: string, sources: SourceItem[], stocks: StockInfo[]): StockReport {
  const counted = (s: SourceItem) => s.inStock && s.enabled !== false;
  const rows: StockRow[] = stocks.map((st) => {
    const sourceQty = sources.filter((s) => st.sourceCodes.includes(s.sourceCode) && counted(s)).reduce((a, s) => a + s.quantity, 0);
    const reserved = st.salable === null ? null : sourceQty - st.salable;
    let state: StockRow["state"] = "ok";
    if (st.salable === null) state = "unassigned";
    else if (st.salable <= 0 && sourceQty > 0) state = "blocked";
    else if (sourceQty <= 0) state = "no-sources";
    else if ((reserved ?? 0) > 0) state = "reservations";
    return { ...st, sourceQty, reserved, state };
  });

  const selling = rows.filter((r) => r.channels.length > 0);
  const orphanSources = sources
    .filter((s) => counted(s) && s.quantity > 0 && !selling.some((r) => r.sourceCodes.includes(s.sourceCode)))
    .map((s) => s.sourceCode);

  const messages: string[] = [];
  for (const r of selling) {
    const web = r.channels.join(", ");
    if (r.state === "blocked") {
      messages.push(
        `«${r.name}» (web: ${web}) tiene ${fmt(r.sourceQty)} unidades en sus fuentes pero la cantidad vendible es ${fmt(r.salable ?? 0)}: ` +
          `hay ${fmt(r.reserved ?? 0)} unidades retenidas por reservas de pedidos sin enviar. No se puede comprar.`,
      );
    } else if (r.state === "no-sources" && (r.salable ?? 0) <= 0) {
      const neg = (r.salable ?? 0) < 0 ? ` y ${fmt(-(r.salable ?? 0))} unidades en reservas` : "";
      messages.push(`«${r.name}» (web: ${web}) no tiene unidades en sus fuentes${neg}. No se puede comprar.`);
    } else if (r.state === "reservations") {
      messages.push(`«${r.name}» (web: ${web}): ${fmt(r.reserved ?? 0)} unidades retenidas por reservas. Vendible: ${fmt(r.salable ?? 0)} de ${fmt(r.sourceQty)}.`);
    }
  }
  for (const code of orphanSources) {
    const s = sources.find((x) => x.sourceCode === code)!;
    messages.push(`La fuente ${s.name ?? code} (${code}) tiene ${fmt(s.quantity)} unidades pero no está en ningún stock que venda en un sitio web.`);
  }
  return { sku, sources, stocks: rows, orphanSources, messages };
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/** Unidades que muestra el contador: suma de las fuentes elegidas (todas si no hay ninguna). */
export function remainingUnits(items: SourceItem[], sourceCodes: string[]): number {
  const pick = sourceCodes.length ? items.filter((i) => sourceCodes.includes(i.sourceCode)) : items;
  const total = pick.filter((i) => i.inStock).reduce((a, i) => a + i.quantity, 0);
  return Math.max(0, Math.floor(total));
}

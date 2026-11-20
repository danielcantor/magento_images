// Inventario (MSI) de Magento: fuentes, stocks, cantidad vendible y diagnóstico. Solo servidor.
import "server-only";
import { magentoFetch } from "./magento";
import { diagnoseStock, type SourceItem, type StockInfo, type StockReport } from "./stockDiagnosis";

const enc = encodeURIComponent;

function bySku(sku: string, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams({
    "searchCriteria[filter_groups][0][filters][0][field]": "sku",
    "searchCriteria[filter_groups][0][filters][0][value]": sku,
    "searchCriteria[filter_groups][0][filters][0][condition_type]": "eq",
    "searchCriteria[pageSize]": "200",
    ...extra,
  });
  return p.toString();
}

interface RawSourceItem {
  sku: string;
  source_code: string;
  quantity: number;
  status: number;
}

/** Cantidades por fuente de un SKU (lo que sincroniza el ERP). */
export async function getSourceItems(sku: string, token?: string): Promise<SourceItem[]> {
  const r = await magentoFetch<{ items: RawSourceItem[] }>(`/inventory/source-items?${bySku(sku)}`, {}, 2, { token });
  return (r.items ?? [])
    .filter((i) => i.sku.toLowerCase() === sku.toLowerCase())
    .map((i) => ({ sourceCode: i.source_code, quantity: Number(i.quantity) || 0, inStock: Number(i.status) === 1 }));
}

/** Cantidades por fuente de varios SKU en una sola consulta (máx. 200). */
export async function getSourceItemsMany(skus: string[], token?: string): Promise<Record<string, SourceItem[]>> {
  const out: Record<string, SourceItem[]> = {};
  const byLower = new Map(skus.map((s) => [s.toLowerCase(), s]));
  skus.forEach((s) => (out[s] = []));
  if (!skus.length) return out;
  const p = new URLSearchParams({
    "searchCriteria[filter_groups][0][filters][0][field]": "sku",
    "searchCriteria[filter_groups][0][filters][0][value]": skus.join(","),
    "searchCriteria[filter_groups][0][filters][0][condition_type]": "in",
    "searchCriteria[pageSize]": "2000",
  });
  const r = await magentoFetch<{ items: RawSourceItem[] }>(`/inventory/source-items?${p}`, {}, 2, { token });
  for (const i of r.items ?? []) {
    const key = byLower.get(i.sku.toLowerCase());
    if (key) out[key].push({ sourceCode: i.source_code, quantity: Number(i.quantity) || 0, inStock: Number(i.status) === 1 });
  }
  return out;
}

/** ID de producto de cada SKU (para reconocer las cards de los listados). Caché de 10 minutos. */
const idCache = new Map<string, { at: number; id: number | null }>();
export async function getProductIds(skus: string[], token?: string): Promise<Record<string, number>> {
  const now = Date.now();
  const out: Record<string, number> = {};
  const missing = skus.filter((s) => {
    const hit = idCache.get(s.toLowerCase());
    if (hit && now - hit.at < 10 * 60 * 1000) {
      if (hit.id) out[s] = hit.id;
      return false;
    }
    return true;
  });
  if (missing.length) {
    const p = new URLSearchParams({
      "searchCriteria[filter_groups][0][filters][0][field]": "sku",
      "searchCriteria[filter_groups][0][filters][0][value]": missing.join(","),
      "searchCriteria[filter_groups][0][filters][0][condition_type]": "in",
      "searchCriteria[pageSize]": "500",
      fields: "items[id,sku]",
    });
    const r = await magentoFetch<{ items?: { id: number; sku: string }[] | null }>(`/products?${p}`, {}, 2, { token });
    const found = new Map((r.items ?? []).map((i) => [i.sku.toLowerCase(), i.id]));
    for (const s of missing) {
      const id = found.get(s.toLowerCase()) ?? null;
      idCache.set(s.toLowerCase(), { at: now, id });
      if (id) out[s] = id;
    }
  }
  return out;
}

/** Nombre de cada SKU (para mostrar en el inicio). */
export async function getProductNames(skus: string[], token?: string): Promise<Record<string, string>> {
  if (!skus.length) return {};
  const p = new URLSearchParams({
    "searchCriteria[filter_groups][0][filters][0][field]": "sku",
    "searchCriteria[filter_groups][0][filters][0][value]": skus.join(","),
    "searchCriteria[filter_groups][0][filters][0][condition_type]": "in",
    "searchCriteria[pageSize]": "500",
    fields: "items[sku,name]",
  });
  const r = await magentoFetch<{ items?: { sku: string; name: string }[] | null }>(`/products?${p}`, {}, 2, { token });
  const found = new Map((r.items ?? []).map((i) => [i.sku.toLowerCase(), i.name]));
  const out: Record<string, string> = {};
  for (const s of skus) {
    const n = found.get(s.toLowerCase());
    if (n) out[s] = n;
  }
  return out;
}

/** Solo para tests. */
export function clearProductIdCache() {
  idCache.clear();
}

interface RawStock {
  stock_id: number;
  name: string;
  extension_attributes?: { sales_channels?: { type: string; code: string }[] };
}

async function getStocks(): Promise<RawStock[]> {
  const r = await magentoFetch<{ items: RawStock[] }>(`/inventory/stocks?searchCriteria[pageSize]=100`);
  return r.items ?? [];
}

async function getStockSourceLinks(): Promise<{ stock_id: number; source_code: string }[]> {
  const r = await magentoFetch<{ items: { stock_id: number; source_code: string }[] }>(
    `/inventory/stock-source-links?searchCriteria[pageSize]=1000`,
  );
  return r.items ?? [];
}

async function getSourceNames(): Promise<Map<string, { name: string; enabled: boolean }>> {
  const r = await magentoFetch<{ items: { source_code: string; name: string; enabled: boolean }[] }>(
    `/inventory/sources?searchCriteria[pageSize]=1000`,
  );
  return new Map((r.items ?? []).map((s) => [s.source_code, { name: s.name, enabled: !!s.enabled }]));
}

async function getSalableQty(sku: string, stockId: number): Promise<number | null> {
  try {
    const n = await magentoFetch<number>(`/inventory/get-product-salable-quantity/${enc(sku)}/${stockId}`, {}, 1);
    return Number(n);
  } catch {
    // Magento responde error si el producto no está asignado a ese stock.
    return null;
  }
}

export async function getStockReport(sku: string): Promise<StockReport> {
  const [items, stocks, links, sources] = await Promise.all([getSourceItems(sku), getStocks(), getStockSourceLinks(), getSourceNames()]);
  const infos: StockInfo[] = await Promise.all(
    stocks.map(async (s) => ({
      stockId: s.stock_id,
      name: s.name,
      channels: (s.extension_attributes?.sales_channels ?? []).map((c) => c.code),
      sourceCodes: links.filter((l) => l.stock_id === s.stock_id).map((l) => l.source_code),
      salable: await getSalableQty(sku, s.stock_id),
    })),
  );
  const named = items.map((i) => ({ ...i, name: sources.get(i.sourceCode)?.name ?? i.sourceCode, enabled: sources.get(i.sourceCode)?.enabled ?? true }));
  return diagnoseStock(sku, named, infos);
}

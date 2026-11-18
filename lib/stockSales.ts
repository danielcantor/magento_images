// Unidades vendidas de un SKU desde una fecha, en pedidos con ciertos estados. Solo servidor.
import "server-only";
import { magentoFetch } from "./magento";
import { toMagentoDate, unitsInOrder, type OrderItemLite } from "./stockDiagnosis";

export interface CountedOrder {
  incrementId: string;
  status: string;
  createdAt: string;
  units: number;
}

export interface SalesCount {
  units: number;
  orders: CountedOrder[];
}

interface RawOrder {
  increment_id: string;
  status: string;
  created_at: string;
  items?: OrderItemLite[];
}

const PAGE_SIZE = 100;
const MAX_PAGES = 50;

export async function countSoldUnits(sku: string, since: string, statuses: string[], token?: string): Promise<SalesCount> {
  const orders: CountedOrder[] = [];
  let units = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const p = new URLSearchParams({
      "searchCriteria[filter_groups][0][filters][0][field]": "status",
      "searchCriteria[filter_groups][0][filters][0][value]": statuses.join(","),
      "searchCriteria[filter_groups][0][filters][0][condition_type]": "in",
      "searchCriteria[filter_groups][1][filters][0][field]": "created_at",
      "searchCriteria[filter_groups][1][filters][0][value]": toMagentoDate(since),
      "searchCriteria[filter_groups][1][filters][0][condition_type]": "gteq",
      "searchCriteria[pageSize]": String(PAGE_SIZE),
      "searchCriteria[currentPage]": String(page),
      fields: "total_count,items[increment_id,status,created_at,items[item_id,parent_item_id,sku,qty_ordered,qty_canceled,qty_refunded]]",
    });
    const r = await magentoFetch<{ items?: RawOrder[]; total_count?: number }>(`/orders?${p}`, {}, 2, { token, timeoutMs: 30_000 });
    const batch = r.items ?? [];
    for (const o of batch) {
      const n = unitsInOrder(o.items ?? [], sku);
      if (n > 0) {
        units += n;
        orders.push({ incrementId: o.increment_id, status: o.status, createdAt: o.created_at, units: n });
      }
    }
    // Magento repite la última página si se pide una de más: cortar por total o por lote incompleto.
    if (batch.length < PAGE_SIZE || page * PAGE_SIZE >= (r.total_count ?? 0)) break;
  }
  return { units, orders };
}

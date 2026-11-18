// Llamadas desde el navegador a nuestra API (que a su vez habla con Magento).
import type { AuditLine, AuditRecord, AuditStatus, AuditSummary } from "./auditKinds";
import type { MediaEntry, MediaRole, ProductSearchResult, Website } from "./types";
import type { StockReport } from "./stockDiagnosis";

export interface StockWidgetDto {
  sku: string;
  mode: "sources" | "orders";
  since: string | null;
  statuses: string[];
  initial: number;
  sources: string[];
  text: string;
  showAtOrBelow: number;
  enabled: boolean;
  updatedAt?: string;
  updatedBy?: string | null;
}

export type LinkCheckResult =
  | { sku: string; byType: Record<string, number>; missing: { type: string; sku: string }[]; checked: boolean }
  | { sku: string; error: string };

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (res.status === 401 && typeof window !== "undefined" && !url.startsWith("/api/auth")) {
    window.location.href = "/login";
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const fallback =
      res.status === 504
        ? "Magento tardó demasiado en responder. Puede que el cambio se haya aplicado igual: revisá el producto antes de reintentar."
        : `Error ${res.status}`;
    throw new ApiError(body.error ?? fallback, res.status);
  }
  return body as T;
}

const json = (method: string, data: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(data),
});

const enc = encodeURIComponent;

export const api = {
  stockReport: (sku: string) => request<StockReport>(`/api/stock/${enc(sku)}`),
  stockWidgets: () => request<{ enabled: boolean; widgets: StockWidgetDto[] }>("/api/stock/widgets"),
  saveStockWidget: (w: StockWidgetDto) => request<{ widget: StockWidgetDto }>("/api/stock/widgets", json("PUT", w)),
  previewStockSales: (w: StockWidgetDto) =>
    request<{
      units: number;
      quedan: number;
      orders: { incrementId: string; status: string; createdAt: string; units: number }[];
      excluded: Record<string, { orders: number; units: number }>;
    }>(
      "/api/stock/widgets/preview",
      json("POST", w),
    ),
  deleteStockWidget: (sku: string) => request<{ ok: true }>(`/api/stock/widgets?sku=${enc(sku)}`, { method: "DELETE" }),

  searchProducts: (f: { q: string; page: number; pageSize?: number; status?: string; website?: string; store?: string }) => {
    const p = new URLSearchParams({ q: f.q, page: String(f.page), pageSize: String(f.pageSize ?? 25) });
    if (f.status) p.set("status", f.status);
    if (f.website) p.set("website", f.website);
    if (f.store) p.set("store", f.store);
    return request<ProductSearchResult>(`/api/products?${p}`);
  },

  storeDiffs: (sku: string) =>
    request<{ stores: { storeCode: string; storeName: string; diffs: { id: number; fields: string[] }[] }[] }>(
      `/api/media/${enc(sku)}/stores`,
    ).then((r) => r.stores),

  syncStores: (sku: string, store?: string) =>
    request<{ storesSynced: string[]; entriesUpdated: number; stillDifferent: string[] }>(
      `/api/media/${enc(sku)}/stores${store ? `?store=${enc(store)}` : ""}`,
      { method: "POST" },
    ),

  checkLinks: (skus: string[]) =>
    request<{ results: LinkCheckResult[] }>("/api/links/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skus }),
    }).then((r) => r.results),

  repairLinks: (sku: string) =>
    request<{ kept: number; removed: { type: string; sku: string }[] }>("/api/links/repair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sku }),
    }),

  auditList: (opts: { cursor?: string; kind?: string } = {}) => {
    const p = new URLSearchParams();
    if (opts.cursor) p.set("cursor", opts.cursor);
    if (opts.kind) p.set("kind", opts.kind);
    return request<{ enabled: boolean; items: AuditSummary[]; cursor?: string }>(`/api/audit?${p}`);
  },

  auditGet: (id: string) => request<AuditRecord>(`/api/audit/${enc(id)}`),

  roles: () => request<{ roles: MediaRole[]; firstImageRoles: string[] }>("/api/roles"),

  websites: () => request<{ websites: Website[] }>("/api/stores").then((r) => r.websites),

  validateSkus: (skus: string[]) =>
    request<{ existing: string[] }>("/api/products/validate", json("POST", { skus })),

  getMedia: (sku: string) =>
    request<{ entries: MediaEntry[] }>(`/api/media/${enc(sku)}`).then((r) => r.entries),

  updateMedia: (sku: string, e: Pick<MediaEntry, "id" | "label" | "position" | "disabled" | "types">) =>
    request(`/api/media/${enc(sku)}/${e.id}`, json("PUT", e)),

  /** Varios cambios de la galería en un solo guardado del producto. */
  saveGallery: (
    sku: string,
    changes: { id: number; position?: number; label?: string | null; disabled?: boolean; types?: string[] }[],
  ) => request(`/api/media/${enc(sku)}/gallery`, json("POST", { changes })),

  deleteMedia: (sku: string, id: number) =>
    request(`/api/media/${enc(sku)}/${id}`, { method: "DELETE" }),

  uploadMedia: (
    sku: string,
    file: File,
    opts: { position: number; label?: string | null; types?: string[]; disabled?: boolean },
  ) => {
    const fd = new FormData();
    fd.set("sku", sku);
    fd.set("file", file);
    fd.set("position", String(opts.position));
    fd.set("label", opts.label ?? "");
    fd.set("types", JSON.stringify(opts.types ?? []));
    fd.set("disabled", String(Boolean(opts.disabled)));
    return request<{ id: number }>("/api/media/upload", { method: "POST", body: fd });
  },

  /** Encola subidas en la API bulk de Magento. Un mismo File se envía una sola vez. */
  enqueueMedia: (items: { sku: string; file: File; position: number; types: string[] }[]) => {
    const fd = new FormData();
    const fields = new Map<File, string>();
    const payload = items.map((it) => {
      let field = fields.get(it.file);
      if (!field) {
        field = `f${fields.size}`;
        fields.set(it.file, field);
        fd.set(field, it.file);
      }
      return { sku: it.sku, field, position: it.position, types: it.types };
    });
    fd.set("items", JSON.stringify(payload));
    return request<{ bulks: { bulkUuid: string; from: number; items: { accepted: boolean; message?: string }[] }[] }>(
      "/api/media/bulk",
      { method: "POST", body: fd },
    );
  },

  bulkStatus: (uuid: string) =>
    request<{ operations: { state: "open" | "complete" | "failed"; message: string | null }[] }>(`/api/media/bulk/${enc(uuid)}`),
};

/**
 * Reintenta errores transitorios (red, 429, 5xx) con espera creciente.
 * Con `idempotent: false` (subir o encolar imágenes) solo reintenta 429: un
 * corte o un tiempo agotado pudo haberse aplicado y reintentar duplicaría.
 */
export async function withRetry<T>(fn: () => Promise<T>, retries = 2, opts: { idempotent?: boolean } = {}): Promise<T> {
  const idempotent = opts.idempotent ?? true;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      const transient = idempotent ? status === 0 || status === 429 || status >= 500 : status === 429;
      if (!transient || attempt >= retries) throw err;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
}

// ---------------------------------------------------------------------------
// Igualar tiendas: una petición por store view, para que cada una sea corta.

let storeCodes: Promise<string[]> | null = null;

function getStoreCodes(): Promise<string[]> {
  storeCodes ??= api
    .websites()
    .then((ws) => ws.flatMap((w) => w.stores.map((s) => s.code)))
    .catch((e) => {
      storeCodes = null;
      throw e;
    });
  return storeCodes;
}

/** Iguala todas las tiendas de un SKU a lo general, de a una tienda por petición. */
export async function syncAllStores(sku: string): Promise<{ storesSynced: string[]; entriesUpdated: number; stillDifferent: string[] }> {
  const codes = await getStoreCodes();
  const total = { storesSynced: [] as string[], entriesUpdated: 0, stillDifferent: [] as string[] };
  for (const code of codes) {
    const r = await withRetry(() => api.syncStores(sku, code));
    total.storesSynced.push(...r.storesSynced);
    total.entriesUpdated += r.entriesUpdated;
    total.stillDifferent.push(...r.stillDifferent);
  }
  return total;
}

// ---------------------------------------------------------------------------
// Registro de acciones. Nunca interrumpe la acción: si falla, solo se avisa en consola.

export interface AuditFinish {
  status: AuditStatus;
  ok?: number;
  failed?: number;
  total?: number;
  lines?: AuditLine[];
}

export async function auditStart(
  kind: string,
  meta: { params?: Record<string, unknown>; skus?: string[]; total?: number } = {},
  finish?: AuditFinish,
): Promise<string | null> {
  try {
    const res = await fetch("/api/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, ...meta, finish }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { enabled?: boolean; id?: string };
    return body.enabled && body.id ? body.id : null;
  } catch (e) {
    console.warn("No se pudo registrar la acción", e);
    return null;
  }
}

export async function auditFinish(id: string | null, finish: AuditFinish): Promise<void> {
  if (!id) return;
  try {
    await fetch(`/api/audit/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(finish),
      keepalive: true,
    });
  } catch (e) {
    console.warn("No se pudo cerrar el registro de la acción", e);
  }
}

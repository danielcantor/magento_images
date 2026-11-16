// Llamadas desde el navegador a nuestra API (que a su vez habla con Magento).
import type { MediaEntry, MediaRole, ProductSearchResult, Website } from "./types";

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
  if (!res.ok) throw new ApiError(body.error ?? `Error ${res.status}`, res.status);
  return body as T;
}

const json = (method: string, data: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(data),
});

const enc = encodeURIComponent;

export const api = {
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

  syncStores: (sku: string) =>
    request<{ storesSynced: string[]; entriesUpdated: number; stillDifferent: string[] }>(`/api/media/${enc(sku)}/stores`, {
      method: "POST",
    }),

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

/** Reintenta errores transitorios (red, 429, 5xx) con espera creciente. */
export async function withRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      const transient = status === 0 || status === 429 || status >= 500;
      if (!transient || attempt >= retries) throw err;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
}

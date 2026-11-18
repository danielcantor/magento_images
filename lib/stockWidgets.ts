// Contadores "Quedan X unidades" publicados en la tienda. Solo servidor.
// Se guarda un JSON por SKU en Vercel Blob (privado) o, en desarrollo, en disco.
import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { get as blobGet, list as blobList, put as blobPut, del as blobDel } from "@vercel/blob";

export type WidgetMode = "sources" | "orders";

export interface StockWidget {
  sku: string;
  /**
   * "sources": quedan = suma de las fuentes (lo que sincroniza el ERP).
   * "orders": quedan = iniciales − unidades vendidas desde `since` en pedidos con `statuses`.
   */
  mode: WidgetMode;
  /** Inicio de la campaña (ISO, UTC). Solo modo "orders". */
  since: string | null;
  /** Estados de pedido que cuentan como venta. Solo modo "orders". */
  statuses: string[];
  /** Unidades con las que arrancó la campaña (para la barra de progreso). */
  initial: number;
  /** Fuentes que se suman para "quedan" (las que sincroniza el ERP). Vacío = todas. */
  sources: string[];
  /** Texto con {n} donde va la cantidad. */
  text: string;
  /** Solo se muestra si quedan esta cantidad o menos (0 = siempre). */
  showAtOrBelow: number;
  enabled: boolean;
  updatedAt: string;
  updatedBy: string | null;
}

export const DEFAULT_WIDGET_TEXT = "¡Solo quedan {n} unidades!";

interface Store {
  put(p: string, data: string): Promise<void>;
  get(p: string): Promise<string | null>;
  list(prefix: string): Promise<string[]>;
  del(p: string): Promise<void>;
}

const access = (): "private" | "public" => (process.env.AUDIT_BLOB_ACCESS === "public" ? "public" : "private");

const blobStore: Store = {
  async put(p, data) {
    await blobPut(p, data, { access: access(), addRandomSuffix: false, allowOverwrite: true, contentType: "application/json", cacheControlMaxAge: 60 });
  },
  async get(p) {
    const res = await blobGet(p, { access: access(), useCache: false });
    if (!res || !res.stream) return null;
    return await new Response(res.stream).text();
  },
  async list(prefix) {
    const out: string[] = [];
    let cursor: string | undefined;
    do {
      const r = await blobList({ prefix, cursor, limit: 1000 });
      out.push(...r.blobs.map((b) => b.pathname));
      cursor = r.hasMore ? r.cursor : undefined;
    } while (cursor);
    return out;
  },
  async del(p) {
    await blobDel(p);
  },
};

function localStore(dir: string): Store {
  const abs = (p: string) => path.join(dir, ...p.split("/"));
  return {
    async put(p, data) {
      await fs.mkdir(path.dirname(abs(p)), { recursive: true });
      await fs.writeFile(abs(p), data, "utf8");
    },
    async get(p) {
      return fs.readFile(abs(p), "utf8").catch(() => null);
    },
    async list(prefix) {
      const names = await fs.readdir(abs(prefix.replace(/\/$/, ""))).catch(() => [] as string[]);
      return names.filter((n) => n.endsWith(".json")).map((n) => prefix + n);
    },
    async del(p) {
      await fs.rm(abs(p), { force: true });
    },
  };
}

/** Solo para tests. */
export function memoryStore(): Store {
  const m = new Map<string, string>();
  return {
    put: async (p, d) => void m.set(p, d),
    get: async (p) => m.get(p) ?? null,
    list: async (prefix) => [...m.keys()].filter((k) => k.startsWith(prefix)),
    del: async (p) => void m.delete(p),
  };
}

let override: Store | null = null;
export function setWidgetStoreForTests(s: Store | null) {
  override = s;
  cache.clear();
}

function store(): Store | null {
  if (override) return override;
  if (process.env.AUDIT_LOCAL_DIR) return localStore(process.env.AUDIT_LOCAL_DIR);
  if (process.env.BLOB_READ_WRITE_TOKEN) return blobStore;
  return null;
}

export function widgetsEnabled(): boolean {
  return store() !== null;
}

const PREFIX = "stock-widgets/";
const keyOf = (sku: string) => `${PREFIX}${encodeURIComponent(sku.trim().toLowerCase())}.json`;

// Caché corta para el endpoint público (cada visita de la tienda no debe leer Blob).
const cache = new Map<string, { at: number; value: StockWidget | null }>();
const CACHE_MS = 60_000;

export async function getWidget(sku: string, opts: { cached?: boolean } = {}): Promise<StockWidget | null> {
  const s = store();
  if (!s) return null;
  const k = keyOf(sku);
  const hit = cache.get(k);
  if (opts.cached && hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const raw = await s.get(k);
  const value = raw ? normalize(JSON.parse(raw)) : null;
  cache.set(k, { at: Date.now(), value });
  return value;
}

export async function listWidgets(): Promise<StockWidget[]> {
  const s = store();
  if (!s) return [];
  const paths = await s.list(PREFIX);
  const all = await Promise.all(paths.map(async (p) => s.get(p).then((r) => (r ? normalize(JSON.parse(r)) : null))));
  return all.filter((w): w is StockWidget => !!w).sort((a, b) => a.sku.localeCompare(b.sku));
}

/** Contadores guardados antes de existir el modo por ventas. */
function normalize(w: StockWidget): StockWidget {
  return { ...w, mode: w.mode ?? "sources", since: w.since ?? null, statuses: w.statuses ?? [] };
}

export class WidgetInputError extends Error {}

export function parseWidgetInput(body: unknown): Omit<StockWidget, "updatedAt" | "updatedBy"> {
  const b = (body ?? {}) as Record<string, unknown>;
  const sku = typeof b.sku === "string" ? b.sku.trim() : "";
  if (!sku || sku.length > 64) throw new WidgetInputError("SKU no válido");
  const initial = Number(b.initial);
  if (!Number.isInteger(initial) || initial <= 0 || initial > 1_000_000) throw new WidgetInputError("Las unidades iniciales deben ser un número entero mayor que 0");
  const showAtOrBelow = Number(b.showAtOrBelow ?? 0);
  if (!Number.isInteger(showAtOrBelow) || showAtOrBelow < 0) throw new WidgetInputError("«Mostrar desde» debe ser un número entero (0 = siempre)");
  const sources = Array.isArray(b.sources) ? b.sources.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 64) : [];
  let text = typeof b.text === "string" ? b.text.trim() : "";
  if (!text) text = DEFAULT_WIDGET_TEXT;
  if (!text.includes("{n}")) throw new WidgetInputError("El texto debe incluir {n} donde va la cantidad");
  if (text.length > 120) throw new WidgetInputError("El texto es demasiado largo (máx. 120 caracteres)");
  const mode: WidgetMode = b.mode === "orders" ? "orders" : "sources";
  let since: string | null = null;
  let statuses: string[] = [];
  if (mode === "orders") {
    const d = typeof b.since === "string" ? new Date(b.since) : null;
    if (!d || Number.isNaN(d.getTime())) throw new WidgetInputError("Indica desde cuándo se cuentan las ventas (inicio de la campaña)");
    since = d.toISOString();
    statuses = (Array.isArray(b.statuses) ? b.statuses : [])
      .filter((x): x is string => typeof x === "string")
      .map((x) => x.trim().toLowerCase())
      .filter((x) => /^[a-z0-9_]{1,32}$/.test(x));
    if (!statuses.length) throw new WidgetInputError("Elige al menos un estado de pedido (p. ej. processing)");
  }
  return { sku, mode, since, statuses, initial, sources, text, showAtOrBelow, enabled: b.enabled !== false };
}

export async function saveWidget(input: Omit<StockWidget, "updatedAt" | "updatedBy">, user: string | null): Promise<StockWidget> {
  const s = store();
  if (!s) throw new WidgetInputError("Falta configurar Vercel Blob (BLOB_READ_WRITE_TOKEN) para guardar contadores.");
  const w: StockWidget = { ...input, updatedAt: new Date().toISOString(), updatedBy: user };
  await s.put(keyOf(w.sku), JSON.stringify(w));
  cache.delete(keyOf(w.sku));
  return w;
}

export async function deleteWidget(sku: string): Promise<void> {
  const s = store();
  if (!s) return;
  await s.del(keyOf(sku));
  cache.delete(keyOf(sku));
}

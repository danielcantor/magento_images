// Contadores "Quedan X unidades" publicados en la tienda. Solo servidor.
// Se guarda un JSON por SKU en Vercel Blob (privado) o, en desarrollo, en disco.
import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { cleanStatuses } from "./stockDiagnosis";
import { BlobPreconditionFailedError, get as blobGet, list as blobList, put as blobPut, del as blobDel } from "@vercel/blob";

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
  /** Cupón de descuento que se muestra con botón «Copiar» (opcional). */
  coupon: string | null;
  /** Texto antes del cupón, p. ej. «Usá el cupón». */
  couponText: string;
  enabled: boolean;
  updatedAt: string;
  updatedBy: string | null;
}

export const DEFAULT_WIDGET_TEXT = "¡Solo quedan {n} unidades!";
export const DEFAULT_COUPON_TEXT = "Sumá un descuento extra con el cupón";

interface Store {
  /** Con `ifMatch` solo escribe si el archivo no cambió (lanza StaleWriteError si cambió). */
  put(p: string, data: string, ifMatch?: string): Promise<void>;
  get(p: string): Promise<string | null>;
  /** Contenido y versión (etag) del archivo, para escrituras condicionales. */
  getTagged?(p: string): Promise<{ text: string; etag?: string } | null>;
  list(prefix: string): Promise<string[]>;
  del(p: string): Promise<void>;
}

/** Otro proceso escribió el índice entre la lectura y la escritura. */
class StaleWriteError extends Error {}

const access = (): "private" | "public" => (process.env.AUDIT_BLOB_ACCESS === "public" ? "public" : "private");

const blobStore: Store = {
  async put(p, data, ifMatch) {
    try {
      await blobPut(p, data, {
        access: access(),
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/json",
        cacheControlMaxAge: 60,
        ...(ifMatch ? { ifMatch } : {}),
      });
    } catch (e) {
      if (e instanceof BlobPreconditionFailedError) throw new StaleWriteError();
      throw e;
    }
  },
  async get(p) {
    const res = await blobGet(p, { access: access(), useCache: false });
    if (!res || !res.stream) return null;
    return await new Response(res.stream).text();
  },
  async getTagged(p) {
    const res = await blobGet(p, { access: access(), useCache: false });
    if (!res || !res.stream) return null;
    return { text: await new Response(res.stream).text(), etag: res.blob.etag };
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
export function memoryStore(): Store & { calls: { get: number; list: number; put: number }; data: Map<string, string> } {
  const m = new Map<string, string>();
  const calls = { get: 0, list: 0, put: 0 };
  return {
    calls,
    data: m,
    put: async (p, d) => void (calls.put++, m.set(p, d)),
    get: async (p) => (calls.get++, m.get(p) ?? null),
    list: async (prefix) => (calls.list++, [...m.keys()].filter((k) => k.startsWith(prefix))),
    del: async (p) => void m.delete(p),
  };
}

let override: Store | null = null;
export function setWidgetStoreForTests(s: Store | null) {
  override = s;
  snapshot = null;
}

function store(): Store | null {
  if (override) return override;
  if (process.env.AUDIT_LOCAL_DIR) return localStore(process.env.AUDIT_LOCAL_DIR);
  // BLOB_STORE_ID (store conectado por OIDC) tiene prioridad sobre BLOB_READ_WRITE_TOKEN en @vercel/blob.
  if (process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN) return blobStore;
  return null;
}

export function widgetsEnabled(): boolean {
  return store() !== null;
}

const PREFIX = "stock-widgets/";
const keyOf = (sku: string) => `${PREFIX}${encodeURIComponent(sku.trim().toLowerCase())}.json`;
/**
 * Todos los contadores en un solo archivo. Leerlo es una operación simple de Blob;
 * listar la carpeta es una operación avanzada (cupo muy chico en Hobby), así que la
 * tienda nunca lista. Fuera de PREFIX para que no aparezca al listar la carpeta.
 */
const INDEX = "stock-widgets-index.json";

/**
 * Copia en memoria para lo que pide la tienda (cada visita llama a stock-active y al
 * contador de la ficha). Se renueva cada CACHE_MS; si Blob falla se sigue usando la
 * última copia buena, aunque sea vieja.
 */
const CACHE_MS = 10 * 60_000;
let snapshot: { at: number; widgets: StockWidget[] } | null = null;

interface IndexFile {
  v: 1;
  widgets: StockWidget[];
}

const sortWidgets = (ws: StockWidget[]) => [...ws].sort((a, b) => a.sku.localeCompare(b.sku));

async function readIndex(s: Store): Promise<{ widgets: StockWidget[]; etag?: string; missing: boolean }> {
  const r: { text: string; etag?: string } | null = s.getTagged
    ? await s.getTagged(INDEX)
    : await s.get(INDEX).then((text) => (text === null ? null : { text }));
  if (!r) return { widgets: [], missing: true };
  const parsed = JSON.parse(r.text) as IndexFile;
  return { widgets: sortWidgets((parsed.widgets ?? []).map(normalize)), etag: r.etag, missing: false };
}

/** Primera vez: arma el índice con los archivos sueltos (una sola lista de la carpeta). */
async function buildIndexFromFiles(s: Store): Promise<StockWidget[]> {
  const paths = await s.list(PREFIX);
  const all = await Promise.all(paths.map(async (p) => s.get(p).then((r) => (r ? normalize(JSON.parse(r)) : null))));
  const widgets = sortWidgets(all.filter((w): w is StockWidget => !!w));
  await s.put(INDEX, JSON.stringify({ v: 1, widgets } satisfies IndexFile));
  return widgets;
}

async function loadAll(s: Store): Promise<StockWidget[]> {
  const idx = await readIndex(s);
  const widgets = idx.missing ? await buildIndexFromFiles(s) : idx.widgets;
  snapshot = { at: Date.now(), widgets };
  return widgets;
}

/**
 * Todos los contadores. `cached`: para la tienda (copia en memoria de hasta 10 min y la
 * última buena si Blob falla). Sin `cached` (dashboard) se lee el índice actual.
 */
export async function listWidgets(opts: { cached?: boolean } = {}): Promise<StockWidget[]> {
  const s = store();
  if (!s) return [];
  if (opts.cached && snapshot && Date.now() - snapshot.at < CACHE_MS) return snapshot.widgets;
  try {
    return await loadAll(s);
  } catch (e) {
    if (opts.cached && snapshot) {
      console.error("Contadores: Blob no respondió, se usa la última copia", e);
      snapshot = { ...snapshot, at: Date.now() - CACHE_MS + 60_000 }; // reintentar en 1 minuto
      return snapshot.widgets;
    }
    throw e;
  }
}

export async function getWidget(sku: string, opts: { cached?: boolean } = {}): Promise<StockWidget | null> {
  const k = sku.trim().toLowerCase();
  return (await listWidgets(opts)).find((w) => w.sku.toLowerCase() === k) ?? null;
}

/** Cambia el índice leyendo y escribiendo con control de versión (reintenta si otro lo cambió). */
async function updateIndex(s: Store, change: (ws: StockWidget[]) => StockWidget[]): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const idx = await readIndex(s);
    const current = idx.missing ? await buildIndexFromFiles(s) : idx.widgets;
    const next = sortWidgets(change(current));
    try {
      await s.put(INDEX, JSON.stringify({ v: 1, widgets: next } satisfies IndexFile), idx.etag);
      snapshot = { at: Date.now(), widgets: next };
      return;
    } catch (e) {
      if (!(e instanceof StaleWriteError) || attempt >= 4) throw e;
      await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
    }
  }
}

/** Contadores guardados antes de existir el modo por ventas. */
function normalize(w: StockWidget): StockWidget {
  return { ...w, mode: w.mode ?? "sources", since: w.since ?? null, statuses: w.statuses ?? [], coupon: w.coupon ?? null, couponText: w.couponText ?? DEFAULT_COUPON_TEXT };
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
    statuses = cleanStatuses(Array.isArray(b.statuses) ? b.statuses : []);
    if (!statuses.length) throw new WidgetInputError("Elige al menos un estado de pedido (p. ej. processing)");
  }
  const rawCoupon = typeof b.coupon === "string" ? b.coupon.trim() : "";
  if (rawCoupon && !/^[A-Za-z0-9_-]{1,40}$/.test(rawCoupon)) {
    throw new WidgetInputError("El cupón solo puede tener letras, números, guiones y guiones bajos (máx. 40)");
  }
  let couponText = typeof b.couponText === "string" ? b.couponText.trim() : "";
  if (!couponText) couponText = DEFAULT_COUPON_TEXT;
  if (couponText.length > 80) throw new WidgetInputError("El texto del cupón es demasiado largo (máx. 80 caracteres)");
  return { sku, mode, since, statuses, initial, sources, text, showAtOrBelow, coupon: rawCoupon || null, couponText, enabled: b.enabled !== false };
}

export async function saveWidget(input: Omit<StockWidget, "updatedAt" | "updatedBy">, user: string | null): Promise<StockWidget> {
  const s = store();
  if (!s) throw new WidgetInputError("Falta configurar Vercel Blob (BLOB_STORE_ID o BLOB_READ_WRITE_TOKEN) para guardar contadores.");
  const w: StockWidget = { ...input, updatedAt: new Date().toISOString(), updatedBy: user };
  const k = w.sku.toLowerCase();
  await updateIndex(s, (ws) => [...ws.filter((x) => x.sku.toLowerCase() !== k), w]);
  // Copia suelta por SKU: respaldo legible y compatible con versiones anteriores.
  await s.put(keyOf(w.sku), JSON.stringify(w));
  return w;
}

export async function deleteWidget(sku: string): Promise<void> {
  const s = store();
  if (!s) return;
  const k = sku.trim().toLowerCase();
  await updateIndex(s, (ws) => ws.filter((x) => x.sku.toLowerCase() !== k));
  await s.del(keyOf(sku));
}

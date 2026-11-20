// Contadores "Quedan X unidades" publicados en la tienda. Solo servidor.
// Se guardan todos juntos, como JSON, en un bloque CMS desactivado de Magento
// (sin cupos ni costo). Alternativas: Vercel Blob (STOCK_WIDGETS_STORAGE=blob) o,
// en desarrollo, una carpeta local (AUDIT_LOCAL_DIR).
import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { cleanStatuses } from "./stockDiagnosis";
import { MagentoError, magentoFetch } from "./magento";
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

const blobConfigured = () => Boolean(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN);

/** Dónde se guardan los contadores (ver encabezado). */
function backend(): Backend | null {
  if (override) return storeBackend(override);
  if (process.env.AUDIT_LOCAL_DIR) return storeBackend(localStore(process.env.AUDIT_LOCAL_DIR));
  // BLOB_STORE_ID (store conectado por OIDC) tiene prioridad sobre BLOB_READ_WRITE_TOKEN en @vercel/blob.
  if (process.env.STOCK_WIDGETS_STORAGE === "blob" && blobConfigured()) return storeBackend(blobStore);
  if (process.env.MAGENTO_BASE_URL) return magentoBackend;
  if (blobConfigured()) return storeBackend(blobStore);
  return null;
}

export function widgetsEnabled(): boolean {
  return backend() !== null;
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
 * contador de la ficha). Se renueva cada CACHE_MS; si la lectura falla se sigue usando
 * la última copia buena, aunque sea vieja.
 */
const CACHE_MS = 10 * 60_000;
let snapshot: { at: number; widgets: StockWidget[] } | null = null;

interface IndexFile {
  v: 1;
  widgets: StockWidget[];
}

const sortWidgets = (ws: StockWidget[]) => [...ws].sort((a, b) => a.sku.localeCompare(b.sku));

/**
 * `publicRead`: lectura para la tienda (con MAGENTO_TOKEN). Si no, con el usuario conectado.
 * `version` sirve para escribir solo si nadie cambió la lista entre la lectura y la escritura.
 */
interface Backend {
  read(opts: { publicRead: boolean }): Promise<{ widgets: StockWidget[]; version?: string }>;
  write(widgets: StockWidget[], version: string | undefined, change: { saved?: StockWidget; deletedSku?: string }): Promise<void>;
}

// ---------------------------------------------------------------------------
// Blob / carpeta local: un archivo índice (leerlo es operación simple de Blob; la tienda nunca lista).

function storeBackend(s: Store): Backend {
  async function readIndex() {
    const r: { text: string; etag?: string } | null = s.getTagged
      ? await s.getTagged(INDEX)
      : await s.get(INDEX).then((text) => (text === null ? null : { text }));
    if (!r) return null;
    const parsed = JSON.parse(r.text) as IndexFile;
    return { widgets: sortWidgets((parsed.widgets ?? []).map(normalize)), version: r.etag };
  }
  /** Primera vez: arma el índice con los archivos sueltos (una sola lista de la carpeta). */
  async function buildFromFiles() {
    const paths = await s.list(PREFIX);
    const all = await Promise.all(paths.map(async (p) => s.get(p).then((r) => (r ? normalize(JSON.parse(r)) : null))));
    const widgets = sortWidgets(all.filter((w): w is StockWidget => !!w));
    await s.put(INDEX, JSON.stringify({ v: 1, widgets } satisfies IndexFile));
    return { widgets, version: undefined };
  }
  return {
    async read() {
      return (await readIndex()) ?? (await buildFromFiles());
    },
    async write(widgets, version, change) {
      await s.put(INDEX, JSON.stringify({ v: 1, widgets } satisfies IndexFile), version);
      // Copia suelta por SKU: respaldo legible y compatible con versiones anteriores.
      if (change.saved) await s.put(keyOf(change.saved.sku), JSON.stringify(change.saved));
      if (change.deletedSku) await s.del(keyOf(change.deletedSku));
    },
  };
}

// ---------------------------------------------------------------------------
// Magento: bloque CMS desactivado (nunca se muestra en la tienda) con la lista en JSON.

export const WIDGETS_BLOCK_ID = "sc-contadores-stock";
const BLOCK_TITLE = "Contadores de stock del dashboard (no editar ni activar)";

interface CmsBlock {
  id: number;
  identifier: string;
  content?: string;
  update_time?: string;
}

/** El JSON del bloque; tolera que un editor lo haya envuelto en HTML o escapado comillas. */
export function parseBlockContent(content: string | undefined): StockWidget[] {
  const raw = (content ?? "").trim();
  if (!raw) return [];
  const tryParse = (t: string) => {
    try {
      return JSON.parse(t) as IndexFile;
    } catch {
      return null;
    }
  };
  const decode = (t: string) => t.replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const inner = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
  const parsed = tryParse(raw) ?? tryParse(inner) ?? tryParse(decode(inner));
  if (!parsed) throw new MagentoError(`El bloque CMS «${WIDGETS_BLOCK_ID}» no tiene un JSON válido.`, 500);
  return sortWidgets((parsed.widgets ?? []).map(normalize));
}

function permissionError(e: unknown, publicRead: boolean, writing = false): unknown {
  if (!(e instanceof MagentoError) || (e.status !== 401 && e.status !== 403)) return e;
  return publicRead
    ? new MagentoError("MAGENTO_TOKEN no tiene permiso de lectura en Content > Elements > Blocks: la tienda no puede leer los contadores.", 403)
    : new MagentoError(
        `Tu usuario de Magento no tiene permiso en Content > Elements > Blocks para ${writing ? "guardar" : "ver"} los contadores (o la sesión caducó).`,
        403,
      );
}

async function findBlock(publicRead: boolean): Promise<CmsBlock | null> {
  const token = publicRead ? process.env.MAGENTO_TOKEN : undefined;
  if (publicRead && !token) throw new MagentoError("Falta MAGENTO_TOKEN: la tienda no puede leer los contadores.", 500);
  const q = new URLSearchParams({
    "searchCriteria[filter_groups][0][filters][0][field]": "identifier",
    "searchCriteria[filter_groups][0][filters][0][value]": WIDGETS_BLOCK_ID,
    "searchCriteria[filter_groups][0][filters][0][condition_type]": "eq",
    "searchCriteria[pageSize]": "5",
  });
  try {
    const r = await magentoFetch<{ items?: CmsBlock[] | null }>(`/cmsBlock/search?${q}`, {}, 2, { token });
    const block = (r.items ?? []).find((b) => b.identifier === WIDGETS_BLOCK_ID) ?? null;
    return block;
  } catch (e) {
    throw permissionError(e, publicRead);
  }
}

/** Si el bloque todavía no existe y Blob responde, se traen los contadores que había allí. */
async function importFromBlob(): Promise<StockWidget[]> {
  if (!blobConfigured()) return [];
  try {
    return (await storeBackend(blobStore).read({ publicRead: false })).widgets;
  } catch {
    return [];
  }
}

const magentoBackend: Backend = {
  async read({ publicRead }) {
    const block = await findBlock(publicRead);
    if (!block) return { widgets: publicRead ? [] : await importFromBlob(), version: "" };
    return { widgets: parseBlockContent(block.content), version: block.update_time ?? "" };
  },
  async write(widgets, version) {
    const content = JSON.stringify({ v: 1, widgets } satisfies IndexFile);
    try {
      const current = await findBlock(false);
      if ((current?.update_time ?? "") !== (version ?? "")) throw new StaleWriteError();
      const block = { identifier: WIDGETS_BLOCK_ID, title: BLOCK_TITLE, content, active: false };
      if (current) await magentoFetch(`/cmsBlock/${current.id}`, { method: "PUT", body: { block: { id: current.id, ...block } } });
      else {
        await magentoFetch<CmsBlock>("/cmsBlock", { method: "POST", body: { block } });
      }
    } catch (e) {
      throw permissionError(e, false, true);
    }
  },
};

// ---------------------------------------------------------------------------
// Lectura con caché y escritura.

/**
 * Todos los contadores. `cached`: para la tienda (copia en memoria de hasta 10 min, con
 * MAGENTO_TOKEN; si falla, la última copia buena). Sin `cached` (dashboard) se lee la
 * lista actual con el usuario conectado.
 */
export async function listWidgets(opts: { cached?: boolean } = {}): Promise<StockWidget[]> {
  const b = backend();
  if (!b) return [];
  if (opts.cached && snapshot && Date.now() - snapshot.at < CACHE_MS) return snapshot.widgets;
  try {
    const { widgets } = await b.read({ publicRead: Boolean(opts.cached) });
    snapshot = { at: Date.now(), widgets };
    return widgets;
  } catch (e) {
    if (opts.cached && snapshot) {
      console.error("Contadores: no se pudieron leer, se usa la última copia", e);
      snapshot = { ...snapshot, at: Date.now() - CACHE_MS + 60_000 }; // reintentar en 1 minuto
      return snapshot.widgets;
    }
    throw e;
  }
}

/** Prueba la lectura que hace la tienda (sin caché). null = bien; si no, el motivo. */
export async function checkPublicRead(): Promise<string | null> {
  const b = backend();
  if (!b) return null;
  try {
    await b.read({ publicRead: true });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export async function getWidget(sku: string, opts: { cached?: boolean } = {}): Promise<StockWidget | null> {
  const k = sku.trim().toLowerCase();
  return (await listWidgets(opts)).find((w) => w.sku.toLowerCase() === k) ?? null;
}

/** Cambia la lista leyendo y escribiendo con control de versión (reintenta si otro la cambió). */
async function updateWidgets(b: Backend, change: (ws: StockWidget[]) => StockWidget[], what: { saved?: StockWidget; deletedSku?: string }) {
  for (let attempt = 0; ; attempt++) {
    const { widgets, version } = await b.read({ publicRead: false });
    const next = sortWidgets(change(widgets));
    try {
      await b.write(next, version, what);
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
  const b = backend();
  if (!b) throw new WidgetInputError("Falta MAGENTO_BASE_URL: no hay dónde guardar los contadores.");
  const w: StockWidget = { ...input, updatedAt: new Date().toISOString(), updatedBy: user };
  const k = w.sku.toLowerCase();
  await updateWidgets(b, (ws) => [...ws.filter((x) => x.sku.toLowerCase() !== k), w], { saved: w });
  return w;
}

export async function deleteWidget(sku: string): Promise<void> {
  const b = backend();
  if (!b) return;
  const k = sku.trim().toLowerCase();
  await updateWidgets(b, (ws) => ws.filter((x) => x.sku.toLowerCase() !== k), { deletedSku: sku });
}

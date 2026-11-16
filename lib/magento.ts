// Cliente de la REST API de Magento 2. Solo se usa en el servidor:
// el token nunca llega al navegador.
import "server-only";
import { getAuthMode } from "./authMode";
import { diffEntries, planStoreUpdates, type StoreDiff } from "./storeSync";
import { getRequestToken } from "./requestToken";
import { FALLBACK_ROLES, type MediaEntry, type MediaRole, type ProductRow, type ProductSearchResult, type Website } from "./types";

export class MagentoError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

interface Config {
  baseUrl: string;
  storeCode: string;
  mediaUrl: string;
}

export function getConfig(): Config {
  const baseUrl = (process.env.MAGENTO_BASE_URL ?? "").replace(/\/+$/, "");
  if (!baseUrl) {
    throw new MagentoError("Falta MAGENTO_BASE_URL en las variables de entorno.", 500);
  }
  return {
    baseUrl,
    storeCode: process.env.MAGENTO_STORE_CODE || "all",
    mediaUrl: (process.env.MAGENTO_MEDIA_URL || `${baseUrl}/media/catalog/product`).replace(/\/+$/, ""),
  };
}

/** Magento devuelve mensajes con marcadores "%1" o "%fieldName". */
export function formatMagentoMessage(body: unknown): string | null {
  if (!body || typeof body !== "object" || !("message" in body)) return null;
  const { message, parameters } = body as { message: string; parameters?: unknown };
  if (!parameters) return message;
  if (Array.isArray(parameters)) {
    return message.replace(/%(\d+)/g, (m, i) => String(parameters[Number(i) - 1] ?? m));
  }
  const params = parameters as Record<string, unknown>;
  return message.replace(/%(\w+)/g, (m, k) => (k in params ? String(params[k]) : m));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const NO_PERMISSION_MESSAGE =
  "Tu usuario de Magento no tiene permiso para esto (Catalog > Products) o la sesión caducó en Magento. Volvé a entrar.";

interface FetchOptions {
  /** false = petición sin token (login). Por defecto se usa el token de la petición. */
  auth?: boolean;
  /** "async/bulk/" para la API asíncrona: /rest/{store}/async/bulk/V1/... */
  prefix?: "" | "async/bulk/";
  /** Código de store view; por defecto MAGENTO_STORE_CODE ("all" = general). */
  store?: string;
}

export async function magentoFetch<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
  retries = 3,
  opts: FetchOptions = {},
): Promise<T> {
  const cfg = getConfig();
  const url = `${cfg.baseUrl}/rest/${encodeURIComponent(opts.store ?? cfg.storeCode)}/${opts.prefix ?? ""}V1${path}`;
  const userMode = getAuthMode() === "magento";

  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  if (opts.auth !== false) {
    const token = await getRequestToken();
    if (!token) {
      throw userMode
        ? new MagentoError("Sesión caducada. Volvé a entrar.", 401)
        : new MagentoError("Falta MAGENTO_TOKEN en las variables de entorno.", 500);
    }
    headers.Authorization = `Bearer ${token}`;
  }

  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: init.method ?? "GET",
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        cache: "no-store",
      });
    } catch (err) {
      if (attempt < retries) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      throw new MagentoError(`No se pudo conectar con Magento: ${(err as Error).message}`, 502);
    }

    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      await sleep(500 * 2 ** attempt);
      continue;
    }

    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!res.ok) {
      // Con usuario de Magento, un 401 con sesión vigente es falta de permisos (o token
      // revocado en Magento). Se devuelve 403 para no entrar en un bucle de logins.
      if (res.status === 401 && opts.auth !== false && userMode) {
        throw new MagentoError(NO_PERMISSION_MESSAGE, 403);
      }
      const msg =
        formatMagentoMessage(body) ??
        (res.status === 401
          ? "Magento rechazó el token (401). Revisá el token y la opción de Bearer tokens."
          : `Magento respondió ${res.status}`);
      throw new MagentoError(msg, res.status);
    }
    return body as T;
  }
}

/**
 * Pide un token de admin con usuario y contraseña de Magento.
 * Con código de Google Authenticator usa el endpoint de 2FA.
 */
export async function getAdminToken(username: string, password: string, otp?: string): Promise<string> {
  const path = otp ? "/tfa/provider/google/authenticate" : "/integration/admin/token";
  const body = otp ? { username, password, otp } : { username, password };
  try {
    const token = await magentoFetch<string>(path, { method: "POST", body }, 1, { auth: false });
    if (typeof token !== "string" || !token) throw new MagentoError("Magento no devolvió un token.", 502);
    return token;
  } catch (err) {
    if (!(err instanceof MagentoError) || err.status >= 500) throw err;
    throw new MagentoError(translateLoginError(err.message, Boolean(otp)), 401);
  }
}

export function translateLoginError(message: string, withOtp: boolean): string {
  const m = message.toLowerCase();
  // Mensaje estándar de Magento para credenciales malas o cuenta bloqueada temporalmente.
  if (m.includes("sign-in was incorrect")) {
    return "Usuario o contraseña incorrectos (o la cuenta está bloqueada temporalmente por intentos fallidos).";
  }
  if (m.includes("not configured") || m.includes("not been configured") || m.includes("provider is not")) {
    return "Este usuario aún no configuró Google Authenticator. Entrá una vez en el Admin de Magento para activarlo.";
  }
  if (withOtp && (m.includes("invalid code") || m.includes("code"))) {
    return "El código de Google Authenticator no es válido. Usá el código actual de la app.";
  }
  if (m.includes("2fa") || m.includes("two-factor") || m.includes("tfa")) {
    return "Tu Magento exige verificación en dos pasos: escribí el código de Google Authenticator.";
  }
  if (m.includes("does not match any route")) {
    return withOtp
      ? "Tu Magento no tiene la verificación en dos pasos por API. Dejá vacío el código."
      : "Magento no acepta este método de login.";
  }
  return "Usuario o contraseña incorrectos.";
}

const enc = encodeURIComponent;

export function withUrls(entries: MediaEntry[] | null | undefined): MediaEntry[] {
  const { mediaUrl } = getConfig();
  return (entries ?? [])
    .filter((e) => e.media_type === "image")
    .map((e) => ({ ...e, url: `${mediaUrl}${e.file}` }))
    .sort((a, b) => a.position - b.position);
}

export interface ProductFilters {
  q?: string;
  page?: number;
  pageSize?: number;
  /** 1 = activo, 2 = inactivo. */
  status?: 1 | 2;
  websiteId?: number;
  storeId?: number;
}

export function buildProductSearch(opts: ProductFilters): URLSearchParams {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 25));
  const p = new URLSearchParams();
  p.set("searchCriteria[currentPage]", String(page));
  p.set("searchCriteria[pageSize]", String(pageSize));
  p.set("searchCriteria[sortOrders][0][field]", "entity_id");
  p.set("searchCriteria[sortOrders][0][direction]", "DESC");

  // Cada filterGroup se combina con AND; los filtros dentro de un grupo, con OR.
  let group = 0;
  const add = (filters: [field: string, value: string, condition: string][]) => {
    filters.forEach(([field, value, cond], i) => {
      const k = `searchCriteria[filterGroups][${group}][filters][${i}]`;
      p.set(`${k}[field]`, field);
      p.set(`${k}[value]`, value);
      p.set(`${k}[conditionType]`, cond);
    });
    group++;
  };
  const q = opts.q?.trim();
  if (q) add([["sku", `%${q}%`, "like"], ["name", `%${q}%`, "like"]]);
  if (opts.status === 1 || opts.status === 2) add([["status", String(opts.status), "eq"]]);
  if (opts.websiteId) add([["website_id", String(opts.websiteId), "eq"]]);
  if (opts.storeId) add([["store_id", String(opts.storeId), "eq"]]);

  p.set(
    "fields",
    "items[id,sku,name,type_id,status,media_gallery_entries,extension_attributes[website_ids]],total_count",
  );
  return p;
}

export async function searchProducts(opts: ProductFilters): Promise<ProductSearchResult> {
  const data = await magentoFetch<{
    items:
      | (Omit<ProductRow, "media" | "websiteIds"> & {
          media_gallery_entries?: MediaEntry[];
          extension_attributes?: { website_ids?: number[] };
        })[]
      | null;
    total_count: number;
  }>(`/products?${buildProductSearch(opts).toString()}`);
  return {
    total: data.total_count ?? 0,
    items: (data.items ?? []).map(({ media_gallery_entries, extension_attributes, ...rest }) => ({
      ...rest,
      media: withUrls(media_gallery_entries),
      websiteIds: extension_attributes?.website_ids ?? [],
    })),
  };
}

// ---------------------------------------------------------------------------
// Roles de imagen y tiendas (con caché en memoria del servidor).

const CACHE_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; value: unknown }>();

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** Solo para tests. */
export function clearMagentoCache() {
  cache.clear();
}

const STANDARD_ORDER = ["image", "small_image", "thumbnail", "swatch_image"];

/** Roles de imagen de la tienda (atributos media_image). Si falla, los 4 estándar. */
export async function getMediaRoles(): Promise<MediaRole[]> {
  try {
    return await cached(`roles:${getConfig().baseUrl}`, async () => {
      const p = new URLSearchParams();
      p.set("searchCriteria[filterGroups][0][filters][0][field]", "frontend_input");
      p.set("searchCriteria[filterGroups][0][filters][0][value]", "media_image");
      p.set("searchCriteria[filterGroups][0][filters][0][conditionType]", "eq");
      p.set("searchCriteria[pageSize]", "100");
      p.set("fields", "items[attribute_code,default_frontend_label,frontend_labels]");
      const data = await magentoFetch<{ items: { attribute_code: string; default_frontend_label?: string | null }[] | null }>(
        `/products/attributes?${p}`,
      );
      const roles = (data.items ?? [])
        .filter((a) => a.attribute_code)
        .map((a) => ({ code: a.attribute_code, label: a.default_frontend_label || a.attribute_code }));
      if (!roles.length) throw new Error("sin roles");
      const rank = (c: string) => (STANDARD_ORDER.includes(c) ? STANDARD_ORDER.indexOf(c) : 100);
      return roles.sort((a, b) => rank(a.code) - rank(b.code));
    });
  } catch (err) {
    if (err instanceof MagentoError && err.status === 401) throw err;
    return FALLBACK_ROLES;
  }
}

/** Roles que recibe la primera imagen en la subida masiva: todos menos Hover (o FIRST_IMAGE_ROLES). */
export function pickFirstImageRoles(roles: MediaRole[], override = process.env.FIRST_IMAGE_ROLES): string[] {
  const codes = roles.map((r) => r.code);
  if (override?.trim()) {
    return override.split(",").map((c) => c.trim()).filter((c) => codes.includes(c));
  }
  return roles.filter((r) => !/hover/i.test(r.code) && !/hover/i.test(r.label)).map((r) => r.code);
}

export async function getWebsites(): Promise<Website[]> {
  return cached(`stores:${getConfig().baseUrl}`, async () => {
    const [websites, views] = await Promise.all([
      magentoFetch<{ id: number; code: string; name: string }[]>("/store/websites"),
      magentoFetch<{ id: number; code: string; name: string; website_id: number; is_active?: number }[]>("/store/storeViews"),
    ]);
    return websites
      .filter((w) => w.id !== 0) // "admin"
      .map((w) => ({
        id: w.id,
        code: w.code,
        name: w.name,
        stores: views.filter((v) => v.website_id === w.id && v.id !== 0).map((v) => ({ id: v.id, code: v.code, name: v.name })),
      }));
  });
}

/** Devuelve los SKU que existen, con la grafía exacta que tiene Magento. */
export async function findExistingSkus(skus: string[]): Promise<string[]> {
  const unique = [...new Set(skus.map((s) => s.trim()).filter(Boolean))];
  const found: string[] = [];
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const p = new URLSearchParams();
    p.set("searchCriteria[filterGroups][0][filters][0][field]", "sku");
    p.set("searchCriteria[filterGroups][0][filters][0][value]", chunk.join(","));
    p.set("searchCriteria[filterGroups][0][filters][0][conditionType]", "in");
    p.set("searchCriteria[pageSize]", String(chunk.length));
    p.set("fields", "items[sku]");
    const data = await magentoFetch<{ items: { sku: string }[] | null }>(`/products?${p}`);
    found.push(...(data.items ?? []).map((i) => i.sku));
  }
  return found;
}

export async function getMedia(sku: string, store?: string): Promise<MediaEntry[]> {
  const entries = await magentoFetch<MediaEntry[]>(`/products/${enc(sku)}/media`, {}, 3, { store });
  return withUrls(entries);
}

export async function addMedia(
  sku: string,
  input: {
    base64: string;
    mimeType: string;
    fileName: string;
    label?: string | null;
    position?: number;
    disabled?: boolean;
    types?: string[];
  },
): Promise<number> {
  const id = await magentoFetch<string | number>(`/products/${enc(sku)}/media`, {
    method: "POST",
    body: {
      entry: {
        media_type: "image",
        label: input.label ?? "",
        position: input.position ?? 0,
        disabled: input.disabled ?? false,
        types: input.types ?? [],
        content: {
          base64_encoded_data: input.base64,
          type: input.mimeType,
          name: input.fileName,
        },
      },
    },
  });
  return Number(id);
}

/** Texto genérico con el que Magento envuelve cualquier fallo al guardar el producto. */
const CANT_SAVE = /can.?t be saved|cannot be saved|could not be saved|could not save/i;

export const PRODUCT_NOT_SAVABLE_MESSAGE =
  "Magento no puede guardar este producto (suele ser un dato inválido del producto, por ejemplo una URL duplicada o un atributo obligatorio vacío). Abrilo y guardalo desde el Admin de Magento para ver el error exacto.";

type MediaInput = { label: string | null; position: number; disabled: boolean; types: string[] };

function putMedia(sku: string, id: number, input: MediaInput, store?: string, file?: string) {
  return magentoFetch<boolean>(
    `/products/${enc(sku)}/media/${id}`,
    {
      method: "PUT",
      body: {
        entry: {
          id,
          media_type: "image",
          label: input.label ?? "",
          position: input.position,
          disabled: input.disabled,
          types: input.types,
          ...(file ? { file } : {}),
        },
      },
    },
    3,
    { store },
  );
}

/**
 * Actualiza rol, posición, alt y visibilidad. Primero sin `file` (en algunas
 * versiones de Magento enviarlo duplica la imagen). Si Magento responde «The
 * product can't be saved», que en otras versiones pasa justamente por faltar
 * `file`, se reintenta una vez con la ruta actual de la imagen. Si aparece una
 * copia, se deja la que tiene los valores nuevos y se borra la anterior.
 */
export async function updateMedia(sku: string, id: number, input: MediaInput, store?: string): Promise<void> {
  try {
    await putMedia(sku, id, input, store);
    return;
  } catch (err) {
    if (!(err instanceof MagentoError) || !CANT_SAVE.test(err.message)) throw err;
  }

  const before = await getMedia(sku, store);
  const current = before.find((e) => e.id === id);
  if (!current) throw new MagentoError("La imagen ya no existe en Magento. Recargá el producto.", 404);

  try {
    await putMedia(sku, id, input, store, current.file);
  } catch (err) {
    if (err instanceof MagentoError && CANT_SAVE.test(err.message)) {
      throw new MagentoError(PRODUCT_NOT_SAVABLE_MESSAGE, 422);
    }
    throw err;
  }

  const after = await getMedia(sku, store);
  const beforeIds = new Set(before.map((e) => e.id));
  const added = after.filter((e) => !beforeIds.has(e.id));
  if (added.length && after.some((e) => e.id === id)) {
    await deleteMedia(sku, id);
  }
}

export async function deleteMedia(sku: string, id: number): Promise<void> {
  await magentoFetch<boolean>(`/products/${enc(sku)}/media/${id}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// API asíncrona (bulk): las operaciones quedan en System > Action Logs > Bulk Actions.

export interface BulkMediaItem {
  sku: string;
  entry: {
    media_type: "image";
    label: string;
    position: number;
    disabled: boolean;
    types: string[];
    content: { base64_encoded_data: string; type: string; name: string };
  };
}

export interface BulkEnqueueResult {
  bulkUuid: string;
  /** Estado de aceptación por item, en el mismo orden enviado. */
  items: { accepted: boolean; message?: string }[];
}

export async function enqueueMediaBulk(items: BulkMediaItem[]): Promise<BulkEnqueueResult> {
  const res = await magentoFetch<{
    bulk_uuid: string;
    request_items?: { id: number; status: string; error_message?: string | null }[];
  }>("/products/bySku/media", { method: "POST", body: items }, 1, { prefix: "async/bulk/" });
  const byId = new Map((res.request_items ?? []).map((r) => [Number(r.id), r]));
  return {
    bulkUuid: res.bulk_uuid,
    items: items.map((_, i) => {
      const r = byId.get(i);
      const accepted = !r || r.status === "accepted";
      return accepted ? { accepted } : { accepted, message: r?.error_message || "Rechazado por Magento" };
    }),
  };
}

/** Estados de operación de Magento. */
export const BULK_STATUS = { complete: 1, failedRetriable: 2, failed: 3, open: 4, rejected: 5 } as const;

export type OperationState = "open" | "complete" | "failed";

export interface BulkStatusResult {
  /** Operaciones en el orden en que se enviaron. Nunca incluye el contenido de la imagen. */
  operations: { state: OperationState; message: string | null }[];
}

export async function getBulkStatus(uuid: string): Promise<BulkStatusResult> {
  const res = await magentoFetch<{
    operations_list?: { id: number; status: number; result_message?: string | null; serialized_data?: string }[];
  }>(`/bulk/${encodeURIComponent(uuid)}/detailed-status`);
  const ops = [...(res.operations_list ?? [])].sort((a, b) => a.id - b.id);
  return {
    operations: ops.map((o) => ({
      state: o.status === BULK_STATUS.complete ? "complete" : o.status === BULK_STATUS.open ? "open" : "failed",
      message: o.result_message ?? null,
    })),
  };
}

// ---------------------------------------------------------------------------
// Igualar las tiendas a lo general. La REST API no permite volver a
// «Use Default Value», así que se copian los valores generales en cada tienda.

/** Store views (sin admin) de todos los sitios. */
export async function getStoreViews(): Promise<{ code: string; name: string }[]> {
  return (await getWebsites()).flatMap((w) => w.stores.map((st) => ({ code: st.code, name: st.name })));
}

export async function getStoreDiffs(sku: string): Promise<StoreDiff[]> {
  const [general, stores] = await Promise.all([getMedia(sku), getStoreViews()]);
  const out: StoreDiff[] = [];
  for (const st of stores) {
    const media = await getMedia(sku, st.code);
    const diffs = diffEntries(general, media);
    if (diffs.length) out.push({ storeCode: st.code, storeName: st.name, diffs });
  }
  return out;
}

export interface SyncResult {
  storesSynced: string[];
  entriesUpdated: number;
  /** Tiendas que siguen distintas tras sincronizar (no debería pasar). */
  stillDifferent: string[];
}

export async function syncStores(sku: string): Promise<SyncResult> {
  const general = await getMedia(sku);
  const diffs = await getStoreDiffs(sku);
  const result: SyncResult = { storesSynced: [], entriesUpdated: 0, stillDifferent: [] };
  for (const d of diffs) {
    for (const entry of planStoreUpdates(general, d.diffs)) {
      await updateMedia(sku, entry.id, entry, d.storeCode);
      result.entriesUpdated++;
    }
    result.storesSynced.push(d.storeName);
    const after = await getMedia(sku, d.storeCode);
    if (diffEntries(general, after).length) result.stillDifferent.push(d.storeName);
  }
  return result;
}

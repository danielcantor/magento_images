// Cliente de la REST API de Magento 2. Solo se usa en el servidor:
// el token nunca llega al navegador.
import "server-only";
import { getAuthMode } from "./authMode";
import { getRequestToken } from "./requestToken";
import type { MediaEntry, ProductRow, ProductSearchResult } from "./types";

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
  "Tu usuario de Magento no tiene permiso para esto (Catalog > Products) o la sesión caducó en Magento. Vuelve a entrar.";

interface FetchOptions {
  /** false = petición sin token (login). Por defecto se usa el token de la petición. */
  auth?: boolean;
}

export async function magentoFetch<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
  retries = 3,
  opts: FetchOptions = {},
): Promise<T> {
  const cfg = getConfig();
  const url = `${cfg.baseUrl}/rest/${cfg.storeCode}/V1${path}`;
  const userMode = getAuthMode() === "magento";

  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  if (opts.auth !== false) {
    const token = await getRequestToken();
    if (!token) {
      throw userMode
        ? new MagentoError("Sesión caducada. Vuelve a entrar.", 401)
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
          ? "Magento rechazó el token (401). Revisa el token y la opción de Bearer tokens."
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
    return "Este usuario aún no configuró Google Authenticator. Entra una vez en el Admin de Magento para activarlo.";
  }
  if (withOtp && (m.includes("invalid code") || m.includes("code"))) {
    return "El código de Google Authenticator no es válido. Usa el código actual de la app.";
  }
  if (m.includes("2fa") || m.includes("two-factor") || m.includes("tfa")) {
    return "Tu Magento exige verificación en dos pasos: escribe el código de Google Authenticator.";
  }
  if (m.includes("does not match any route")) {
    return withOtp
      ? "Tu Magento no tiene la verificación en dos pasos por API. Deja vacío el código."
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

export async function searchProducts(opts: {
  q?: string;
  page?: number;
  pageSize?: number;
}): Promise<ProductSearchResult> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 25));
  const p = new URLSearchParams();
  p.set("searchCriteria[currentPage]", String(page));
  p.set("searchCriteria[pageSize]", String(pageSize));
  p.set("searchCriteria[sortOrders][0][field]", "entity_id");
  p.set("searchCriteria[sortOrders][0][direction]", "DESC");
  const q = opts.q?.trim();
  if (q) {
    // Dos filtros en el mismo grupo = OR (SKU o nombre).
    p.set("searchCriteria[filterGroups][0][filters][0][field]", "sku");
    p.set("searchCriteria[filterGroups][0][filters][0][value]", `%${q}%`);
    p.set("searchCriteria[filterGroups][0][filters][0][conditionType]", "like");
    p.set("searchCriteria[filterGroups][0][filters][1][field]", "name");
    p.set("searchCriteria[filterGroups][0][filters][1][value]", `%${q}%`);
    p.set("searchCriteria[filterGroups][0][filters][1][conditionType]", "like");
  }
  p.set(
    "fields",
    "items[id,sku,name,type_id,status,media_gallery_entries],total_count",
  );
  const data = await magentoFetch<{
    items: (Omit<ProductRow, "media"> & { media_gallery_entries?: MediaEntry[] })[] | null;
    total_count: number;
  }>(`/products?${p.toString()}`);
  return {
    total: data.total_count ?? 0,
    items: (data.items ?? []).map(({ media_gallery_entries, ...rest }) => ({
      ...rest,
      media: withUrls(media_gallery_entries),
    })),
  };
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

export async function getMedia(sku: string): Promise<MediaEntry[]> {
  const entries = await magentoFetch<MediaEntry[]>(`/products/${enc(sku)}/media`);
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

/**
 * Actualiza rol, posición, alt y visibilidad. Importante: NO se envía `file` ni
 * `content`; si se envían, Magento crea una entrada nueva en vez de editarla.
 * Magento quita automáticamente los roles enviados del resto de imágenes.
 */
export async function updateMedia(
  sku: string,
  id: number,
  input: { label: string | null; position: number; disabled: boolean; types: string[] },
): Promise<void> {
  await magentoFetch<boolean>(`/products/${enc(sku)}/media/${id}`, {
    method: "PUT",
    body: {
      entry: {
        id,
        media_type: "image",
        label: input.label ?? "",
        position: input.position,
        disabled: input.disabled,
        types: input.types,
      },
    },
  });
}

export async function deleteMedia(sku: string, id: number): Promise<void> {
  await magentoFetch<boolean>(`/products/${enc(sku)}/media/${id}`, { method: "DELETE" });
}

// Comprueba en Magento que el token de la sesión sigue vigente (Edge y Node).
// Magento puede invalidar el token antes que nuestra cookie: vence por su propia
// configuración, se cambia la contraseña o se revoca desde el Admin.
import type { MagentoSession } from "./session";

const CACHE_MS = 60 * 1000;
/** Recién entrado, un 401 es falta de permisos y no sesión vencida: no se lo manda al login otra vez. */
const FRESH_LOGIN_MS = 2 * 60 * 1000;
const TIMEOUT_MS = 4000;

const cache = new Map<string, { at: number; valid: boolean }>();

async function cacheKey(token: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return btoa(String.fromCharCode(...new Uint8Array(d)));
}

/**
 * false solo si Magento rechaza el token (401). Si Magento no responde o da otro error,
 * devuelve true: no se saca a nadie del dashboard por una caída de la tienda.
 */
export async function isMagentoSessionValid(session: MagentoSession, hours: number, now = Date.now()): Promise<boolean> {
  const base = (process.env.MAGENTO_BASE_URL ?? "").replace(/\/+$/, "");
  if (!base) return true;
  const issuedAt = session.exp * 1000 - hours * 3600 * 1000;
  if (now - issuedAt < FRESH_LOGIN_MS) return true;

  const key = await cacheKey(session.token);
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.valid;

  const store = encodeURIComponent(process.env.MAGENTO_STORE_CODE || "all");
  // La consulta más liviana que todo usuario del dashboard puede hacer: contar productos.
  const url = `${base}/rest/${store}/V1/products?searchCriteria%5BpageSize%5D=1&fields=total_count`;
  let valid = true;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${session.token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    valid = res.status !== 401;
  } catch {
    return true; // sin respuesta: no se guarda en caché para volver a probar en la próxima página
  }
  cache.set(key, { at: now, valid });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return valid;
}

/** Solo para tests. */
export function clearSessionCheckCache() {
  cache.clear();
}

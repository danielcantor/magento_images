// Cookie de sesión firmada con HMAC (Web Crypto: funciona en Edge y Node).
export const SESSION_COOKIE = "mid_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12 horas

const encoder = new TextEncoder();

function secret(): string {
  const s = process.env.SESSION_SECRET || process.env.DASHBOARD_PASSWORD;
  if (!s) throw new Error("Falta SESSION_SECRET");
  return s;
}

async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createSessionToken(now = Date.now()): Promise<string> {
  const exp = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
  return `${exp}.${await hmac(String(exp))}`;
}

export async function verifySessionToken(token: string | undefined, now = Date.now()): Promise<boolean> {
  if (!token) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || Number(exp) * 1000 < now) return false;
  return safeEqual(sig, await hmac(exp));
}

export async function checkPassword(input: string): Promise<boolean> {
  const expected = process.env.DASHBOARD_PASSWORD ?? "";
  if (!expected) return false;
  // Comparamos los HMAC para no filtrar la longitud.
  return safeEqual(await hmac(`pw:${input}`), await hmac(`pw:${expected}`));
}

// ---------------------------------------------------------------------------
// Sesión con usuario de Magento: el token de admin va cifrado (AES-GCM) en la cookie.

export const MAGENTO_SESSION_COOKIE = "mid_magento";

export interface MagentoSession {
  token: string;
  username: string;
  /** Segundos desde epoch. */
  exp: number;
}

export function magentoSessionHours(): number {
  const h = Number(process.env.MAGENTO_ADMIN_TOKEN_HOURS);
  return Number.isFinite(h) && h > 0 ? h : 4;
}

function strictSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET debe tener al menos 16 caracteres");
  return s;
}

async function aesKey(): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`magento-session:${strictSecret()}`));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function fromB64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export async function sealMagentoSession(session: MagentoSession): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(), encoder.encode(JSON.stringify(session)));
  return `${b64url(iv)}.${b64url(new Uint8Array(data))}`;
}

/** Devuelve la sesión si la cookie es auténtica y no ha caducado; si no, null. */
export async function openMagentoSession(value: string | undefined, now = Date.now()): Promise<MagentoSession | null> {
  if (!value) return null;
  try {
    const [iv, data] = value.split(".");
    if (!iv || !data) return null;
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64url(iv) as BufferSource }, await aesKey(), fromB64url(data) as BufferSource);
    const s = JSON.parse(new TextDecoder().decode(plain)) as MagentoSession;
    if (typeof s.token !== "string" || typeof s.username !== "string" || typeof s.exp !== "number") return null;
    return s.exp * 1000 > now ? s : null;
  } catch {
    return null;
  }
}

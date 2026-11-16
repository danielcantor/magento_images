import "server-only";
import { cookies } from "next/headers";
import { getAuthMode } from "./authMode";
import { MAGENTO_SESSION_COOKIE, openMagentoSession } from "./session";

/**
 * Token con el que se llama a Magento en esta petición:
 * en modo "magento" el del usuario conectado; si no, el de integración.
 */
export async function getRequestToken(): Promise<string | null> {
  if (getAuthMode() !== "magento") return process.env.MAGENTO_TOKEN || null;
  const jar = await cookies();
  const session = await openMagentoSession(jar.get(MAGENTO_SESSION_COOKIE)?.value);
  return session?.token ?? null;
}

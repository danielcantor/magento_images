import "server-only";
import { cookies } from "next/headers";
import { getAuthMode } from "./authMode";
import { MAGENTO_SESSION_COOKIE, openMagentoSession } from "./session";

/**
 * Usuario de la petición para el registro de acciones. Sale de la sesión del
 * servidor, nunca de lo que mande el navegador. Con login de Magento es su
 * usuario; con contraseña compartida todos comparten "dashboard".
 */
export async function getSessionUser(): Promise<string | null> {
  if (getAuthMode() === "magento") {
    const s = await openMagentoSession((await cookies()).get(MAGENTO_SESSION_COOKIE)?.value).catch(() => null);
    return s?.username ?? null;
  }
  return "dashboard";
}

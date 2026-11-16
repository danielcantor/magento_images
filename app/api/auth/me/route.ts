import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAuthMode } from "@/lib/authMode";
import { MAGENTO_SESSION_COOKIE, openMagentoSession } from "@/lib/session";

export const dynamic = "force-dynamic";

// Usuario conectado (solo en modo Magento). Nunca devuelve el token.
export async function GET() {
  if (getAuthMode() !== "magento") return NextResponse.json({ username: null });
  const s = await openMagentoSession((await cookies()).get(MAGENTO_SESSION_COOKIE)?.value);
  if (!s) return NextResponse.json({ error: "Sesión no válida" }, { status: 401 });
  return NextResponse.json({ username: s.username, expiresAt: s.exp * 1000 });
}

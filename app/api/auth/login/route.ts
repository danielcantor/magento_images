import { NextResponse } from "next/server";
import {
  checkPassword,
  createSessionToken,
  MAGENTO_SESSION_COOKIE,
  magentoSessionHours,
  sealMagentoSession,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from "@/lib/session";
import { getAuthMode } from "@/lib/authMode";
import { getAdminToken, MagentoError } from "@/lib/magento";

const slowDown = () => new Promise((r) => setTimeout(r, 600)); // frena intentos por fuerza bruta

const cookieOpts = (maxAge: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge,
});

export async function POST(req: Request) {
  const mode = getAuthMode();
  const body = (await req.json().catch(() => ({}))) as { username?: string; password?: string; otp?: string };

  if (mode === "magento") {
    const username = String(body.username ?? "").trim();
    const password = String(body.password ?? "");
    const otp = String(body.otp ?? "").replace(/\s+/g, "");
    if (!username || !password) {
      return NextResponse.json({ error: "Escribí usuario y contraseña" }, { status: 400 });
    }
    if (otp && !/^\d{6}$/.test(otp)) {
      return NextResponse.json({ error: "El código debe tener 6 dígitos" }, { status: 400 });
    }
    try {
      const token = await getAdminToken(username, password, otp || undefined);
      const maxAge = Math.round(magentoSessionHours() * 3600);
      const exp = Math.floor(Date.now() / 1000) + maxAge;
      const res = NextResponse.json({ ok: true, username });
      res.cookies.set(MAGENTO_SESSION_COOKIE, await sealMagentoSession({ token, username, exp }), cookieOpts(maxAge));
      return res;
    } catch (err) {
      await slowDown();
      if (err instanceof MagentoError) {
        return NextResponse.json({ error: err.message }, { status: err.status >= 500 ? 502 : 401 });
      }
      console.error(err);
      return NextResponse.json({ error: "Error interno" }, { status: 500 });
    }
  }

  if (mode !== "password") {
    return NextResponse.json({ error: "El acceso con contraseña no está activo" }, { status: 400 });
  }
  if (!body.password || !(await checkPassword(body.password))) {
    await slowDown();
    return NextResponse.json({ error: "Contraseña incorrecta" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(), cookieOpts(SESSION_TTL_SECONDS));
  return res;
}

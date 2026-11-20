import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getAuthMode } from "@/lib/authMode";
import { MAGENTO_SESSION_COOKIE, magentoSessionHours, openMagentoSession, SESSION_COOKIE, verifySessionToken } from "@/lib/session";
import { isMagentoSessionValid } from "@/lib/sessionCheck";

function deny(req: NextRequest, message: string, expired = false) {
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: message }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = expired ? "?expired=1" : "";
  return NextResponse.redirect(url);
}

export async function middleware(req: NextRequest) {
  const mode = getAuthMode();

  if (mode === "none") {
    // Sin acceso configurado: solo se permite en local.
    if (process.env.NODE_ENV === "production") {
      return deny(req, "Configura DASHBOARD_PASSWORD o Supabase para usar el dashboard.");
    }
    return NextResponse.next();
  }

  if (mode === "magento") {
    const cookie = req.cookies.get(MAGENTO_SESSION_COOKIE)?.value;
    const session = await openMagentoSession(cookie).catch(() => null);
    // Antes de mostrar una página se confirma en Magento que el token sigue vigente.
    // Las llamadas a la API no se comprueban aparte para no duplicar consultas a Magento.
    const valid =
      session && (req.nextUrl.pathname.startsWith("/api/") || (await isMagentoSessionValid(session, magentoSessionHours())));
    if (valid) return NextResponse.next();
    const res = deny(req, "Sesión caducada. Volvé a entrar.", Boolean(cookie));
    res.cookies.delete(MAGENTO_SESSION_COOKIE);
    return res;
  }

  if (mode === "password") {
    const cookie = req.cookies.get(SESSION_COOKIE)?.value;
    const ok = await verifySessionToken(cookie);
    return ok ? NextResponse.next() : deny(req, "Sesión no válida", Boolean(cookie));
  }

  // Supabase: refresca la sesión y comprueba el usuario.
  let res = NextResponse.next({ request: req });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (cookies) => {
          cookies.forEach(({ name, value }) => req.cookies.set(name, value));
          res = NextResponse.next({ request: req });
          cookies.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
        },
      },
    },
  );
  const { data } = await supabase.auth.getUser();
  return data.user ? res : deny(req, "Sesión no válida");
}

export const config = {
  // Todo excepto login, endpoints de login, el contador público de la tienda y archivos estáticos.
  matcher: ["/((?!login|api/auth|api/public/|stock-widget.js|brand/|icon.svg|_next/static|_next/image|favicon.ico).*)"],
};

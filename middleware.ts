import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getAuthMode } from "@/lib/authMode";
import { MAGENTO_SESSION_COOKIE, openMagentoSession, SESSION_COOKIE, verifySessionToken } from "@/lib/session";

function deny(req: NextRequest, message: string) {
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: message }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
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
    const session = await openMagentoSession(req.cookies.get(MAGENTO_SESSION_COOKIE)?.value).catch(() => null);
    if (session) return NextResponse.next();
    const res = deny(req, "Sesión caducada. Vuelve a entrar.");
    res.cookies.delete(MAGENTO_SESSION_COOKIE);
    return res;
  }

  if (mode === "password") {
    const ok = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
    return ok ? NextResponse.next() : deny(req, "Sesión no válida");
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
  // Todo excepto login, endpoints de login y archivos estáticos.
  matcher: ["/((?!login|api/auth|_next/static|_next/image|favicon.ico).*)"],
};

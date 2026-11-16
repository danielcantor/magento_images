"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { AuthMode } from "@/lib/authMode";
import { getSupabase } from "@/lib/supabaseBrowser";

export default function Nav({ mode, username }: { mode: AuthMode; username?: string | null }) {
  const path = usePathname();
  const links = [
    { href: "/products", label: "Productos" },
    { href: "/bulk", label: "Subida masiva" },
    { href: "/shared", label: "Imagen a varios SKU" },
    ...(mode === "supabase" ? [{ href: "/history", label: "Historial" }] : []),
  ];

  async function logout() {
    if (mode === "supabase") await getSupabase()?.auth.signOut();
    else await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <header className="topbar">
      <Link href="/products" className="brand" aria-label="SommierCenter · Imágenes">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/logo.svg" alt="SommierCenter" width={200} height={22} />
        <span className="tag">Imágenes</span>
      </Link>
      <nav className="nav">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className={path.startsWith(l.href) ? "active" : ""}>
            {l.label}
          </Link>
        ))}
      </nav>
      {username && (
        <span className="muted small user" title="Usuario de Magento conectado">
          {username}
        </span>
      )}
      {mode !== "none" && (
        <button className="link" onClick={logout}>
          Salir
        </button>
      )}
    </header>
  );
}

"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { AuthMode } from "@/lib/authMode";
import { getSupabase } from "@/lib/supabaseBrowser";

export default function Nav({ mode, username, auditEnabled = false }: { mode: AuthMode; username?: string | null; auditEnabled?: boolean }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const links = [
    { href: "/products", label: "Productos" },
    { href: "/bulk", label: "Subida masiva" },
    { href: "/shared", label: "Imagen a varios SKU" },
    { href: "/stock", label: "Stock" },
    ...(auditEnabled ? [{ href: "/history", label: "Historial" }] : []),
  ];
  const current = links.find((l) => path.startsWith(l.href));

  // En celular el menú se cierra al cambiar de página o con Escape.
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function logout() {
    if (mode === "supabase") await getSupabase()?.auth.signOut();
    else await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <header className={`topbar${open ? " menu-open" : ""}`}>
      <Link href="/products" className="brand" aria-label="SommierCenter · Imágenes">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/logo.svg" alt="SommierCenter" width={200} height={22} />
        <span className="tag">Imágenes</span>
      </Link>
      <button
        type="button"
        className="menu-toggle"
        aria-expanded={open}
        aria-controls="main-nav"
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">{open ? "✕" : "☰"}</span>
        <span>{open ? "Cerrar" : current?.label ?? "Menú"}</span>
      </button>
      <nav className="nav" id="main-nav" aria-label="Secciones">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className={path.startsWith(l.href) ? "active" : ""} aria-current={path.startsWith(l.href) ? "page" : undefined}>
            {l.label}
          </Link>
        ))}
      </nav>
      <div className="session">
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
      </div>
    </header>
  );
}

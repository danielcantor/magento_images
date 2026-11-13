"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { AuthMode } from "@/lib/authMode";
import { getSupabase } from "@/lib/supabaseBrowser";

export default function Nav({ mode }: { mode: AuthMode }) {
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
      <div className="brand">
        🖼️ <span>Imágenes Magento</span>
      </div>
      <nav className="nav">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className={path.startsWith(l.href) ? "active" : ""}>
            {l.label}
          </Link>
        ))}
      </nav>
      {mode !== "none" && (
        <button className="link" onClick={logout}>
          Salir
        </button>
      )}
    </header>
  );
}

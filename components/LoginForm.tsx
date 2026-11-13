"use client";
import { useState } from "react";
import type { AuthMode } from "@/lib/authMode";
import { getSupabase } from "@/lib/supabaseBrowser";

export default function LoginForm({ mode }: { mode: AuthMode }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (mode === "none") {
    return (
      <p className="muted">
        No hay acceso configurado. Define <code>DASHBOARD_PASSWORD</code> (y <code>SESSION_SECRET</code>) o las
        variables de Supabase. En local puedes entrar directamente: <a href="/products">ir al dashboard</a>.
      </p>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "supabase") {
        const { error } = await getSupabase()!.auth.signInWithPassword({ email, password });
        if (error) throw new Error(error.message === "Invalid login credentials" ? "Email o contraseña incorrectos" : error.message);
      } else {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Error al entrar");
      }
      window.location.href = "/products";
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {mode === "supabase" && (
        <input type="email" placeholder="Email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      )}
      <input
        type="password"
        placeholder="Contraseña"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        autoFocus={mode === "password"}
      />
      {error && <div className="alert">{error}</div>}
      <button className="primary" disabled={busy}>
        {busy ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}

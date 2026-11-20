"use client";
import { useState } from "react";
import type { AuthMode } from "@/lib/authMode";
import { getSupabase } from "@/lib/supabaseBrowser";

export default function LoginForm({ mode, otpRequired = true }: { mode: AuthMode; otpRequired?: boolean }) {
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (mode === "none") {
    return (
      <p className="muted">
        No hay acceso configurado. Definí <code>AUTH_MODE=magento</code>, <code>DASHBOARD_PASSWORD</code> (con{" "}
        <code>SESSION_SECRET</code>) o las variables de Supabase. En local podés entrar directamente:{" "}
        <a href="/">ir al dashboard</a>.
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
          body: JSON.stringify(mode === "magento" ? { username, password, otp } : { password }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Error al entrar");
      }
      window.location.href = "/";
    } catch (err) {
      setError((err as Error).message);
      if (mode === "magento") setOtp(""); // el código es de un solo uso
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {mode === "magento" && (
        <>
          <p className="muted small" style={{ margin: 0 }}>
            Entrá con tu usuario del Admin de Magento.
          </p>
          <input
            type="text"
            placeholder="Usuario de Magento"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoFocus
            aria-label="Usuario de Magento"
          />
        </>
      )}
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
        aria-label="Contraseña"
      />
      {mode === "magento" && otpRequired && (
        <input
          type="text"
          placeholder="Código de Google Authenticator"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
          required
          aria-label="Código de Google Authenticator (6 dígitos)"
        />
      )}
      {error && <div className="alert">{error}</div>}
      <button className="primary" disabled={busy}>
        {busy ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}

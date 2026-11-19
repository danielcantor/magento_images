"use client";
import { useEffect, useState } from "react";
import { api, type CouponCheck } from "@/lib/api";

export const DEFAULT_COUPON_TEXT = "Sumá un descuento extra con el cupón";

const BAD: Record<string, boolean> = { missing: true, inactive: true, expired: true };

/**
 * Verifica el cupón en Magento antes de guardar. Si no existe, está inactivo o venció,
 * pregunta si guardar igual. Devuelve false si el usuario cancela.
 */
export async function confirmCoupon(code: string | null | undefined): Promise<boolean> {
  if (!code) return true;
  let r: CouponCheck;
  try {
    r = await api.checkCoupon(code);
  } catch {
    return true; // sin verificación: no se bloquea el guardado
  }
  if (BAD[r.state]) return confirm(`${r.message ?? "El cupón no es válido."} Los clientes verían un cupón que no funciona. ¿Guardar igual?`);
  return true;
}

/** Campos «Cupón» y «Texto del cupón», con verificación en Magento al salir del campo. */
export default function CouponFields({
  coupon,
  couponText,
  onChange,
  disabled,
}: {
  coupon: string;
  couponText: string;
  onChange: (v: { coupon: string; couponText: string }) => void;
  disabled?: boolean;
}) {
  const [check, setCheck] = useState<CouponCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const code = coupon.trim();
  const formatOk = !code || /^[A-Za-z0-9_-]{1,40}$/.test(code);

  useEffect(() => setCheck(null), [code]);

  async function verify() {
    if (!code || !formatOk) return;
    setChecking(true);
    try {
      setCheck(await api.checkCoupon(code));
    } catch (e) {
      setCheck({ state: "unknown", message: (e as Error).message });
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="form-grid">
        <label>
          <span>Cupón de descuento (opcional)</span>
          <input
            type="text"
            value={coupon}
            placeholder="Ej.: LIQUIDACION10"
            onChange={(e) => onChange({ coupon: e.target.value.replace(/\s/g, ""), couponText })}
            onBlur={verify}
            disabled={disabled}
            maxLength={40}
            aria-invalid={!formatOk}
          />
        </label>
        <label>
          <span>Texto antes del cupón</span>
          <input
            type="text"
            value={couponText}
            placeholder={DEFAULT_COUPON_TEXT}
            onChange={(e) => onChange({ coupon, couponText: e.target.value })}
            disabled={disabled || !code}
            maxLength={80}
          />
        </label>
      </div>
      {!formatOk && <span className="small" style={{ color: "var(--err)" }}>Solo letras, números, guiones y guiones bajos.</span>}
      {code && formatOk && (
        <span className="small" aria-live="polite">
          {checking ? (
            <span className="muted">Verificando en Magento…</span>
          ) : check?.state === "ok" ? (
            <span className="badge ok">Cupón vigente · {check.rule}</span>
          ) : check && BAD[check.state] ? (
            <span className="badge err">{check.message}</span>
          ) : check?.state === "unknown" ? (
            <span className="badge warn">{check.message}</span>
          ) : (
            <span className="muted">Se muestra debajo de la barra con un botón «Copiar». Se verifica en Magento al salir del campo.</span>
          )}
        </span>
      )}
    </div>
  );
}

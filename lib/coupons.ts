// Verificación de cupones de Magento (reglas de precio del carrito). Solo servidor.
import "server-only";
import { magentoFetch, MagentoError } from "./magento";

export interface CouponCheckResult {
  state: "ok" | "missing" | "inactive" | "expired" | "unknown";
  rule?: string;
  message?: string;
}

interface RawCoupon {
  code: string;
  rule_id: number;
  expiration_date?: string | null;
  usage_limit?: number | null;
  times_used?: number | null;
}

interface RawRule {
  name?: string;
  is_active?: boolean;
  to_date?: string | null;
}

/** Fecha "YYYY-MM-DD" (o con hora) ya pasada respecto de `now`, contando el día entero. */
export function isPast(date: string | null | undefined, now = new Date()): boolean {
  if (!date) return false;
  const d = new Date(date.length <= 10 ? `${date}T23:59:59` : date.replace(" ", "T"));
  return !Number.isNaN(d.getTime()) && d.getTime() < now.getTime();
}

export async function checkCoupon(code: string, now = new Date()): Promise<CouponCheckResult> {
  try {
    const p = new URLSearchParams({
      "searchCriteria[filter_groups][0][filters][0][field]": "code",
      "searchCriteria[filter_groups][0][filters][0][value]": code,
      "searchCriteria[filter_groups][0][filters][0][condition_type]": "eq",
      "searchCriteria[pageSize]": "5",
    });
    const r = await magentoFetch<{ items?: RawCoupon[] }>(`/coupons/search?${p}`, {}, 1);
    const c = (r.items ?? []).find((i) => i.code.toLowerCase() === code.toLowerCase());
    if (!c) return { state: "missing", message: `El cupón ${code} no existe en Magento.` };
    const rule = await magentoFetch<RawRule>(`/salesRules/${c.rule_id}`, {}, 1);
    const name = rule.name ?? `Regla ${c.rule_id}`;
    if (rule.is_active === false) return { state: "inactive", rule: name, message: `La regla «${name}» está inactiva.` };
    if (isPast(rule.to_date, now) || isPast(c.expiration_date, now)) return { state: "expired", rule: name, message: `La regla «${name}» ya venció.` };
    if (c.usage_limit && (c.times_used ?? 0) >= c.usage_limit) return { state: "expired", rule: name, message: `El cupón alcanzó su límite de ${c.usage_limit} usos.` };
    return { state: "ok", rule: name };
  } catch (e) {
    const status = e instanceof MagentoError ? e.status : 0;
    return {
      state: "unknown",
      message:
        status === 401 || status === 403
          ? "No se pudo verificar: tu usuario de Magento necesita permiso en Marketing → Cart Price Rules."
          : `No se pudo verificar el cupón (${(e as Error).message}).`,
    };
  }
}

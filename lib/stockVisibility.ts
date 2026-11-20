// Si un contador se ve en la tienda y por qué (compartido entre servidor y navegador).

export type WidgetVisibility = "visible" | "agotado" | "umbral";

/** Igual que el endpoint público: se ve si quedan unidades y, con umbral, si quedan esa cantidad o menos. */
export function widgetVisibility(quedan: number, showAtOrBelow: number): WidgetVisibility {
  if (quedan <= 0) return "agotado";
  if (showAtOrBelow > 0 && quedan > showAtOrBelow) return "umbral";
  return "visible";
}

export interface WidgetStatus {
  sku: string;
  name: string | null;
  mode: "sources" | "orders";
  initial: number;
  showAtOrBelow: number;
  coupon: string | null;
  /** null si no se pudo consultar (ver `error`). */
  quedan: number | null;
  visibility: WidgetVisibility | null;
  error?: string;
}

export interface WidgetsStatusResponse {
  enabled: boolean;
  active: WidgetStatus[];
  paused: { sku: string; updatedAt: string }[];
  /** Prueba de MAGENTO_TOKEN, el token que usa la tienda (null = no hay contadores activos). */
  storeToken: { ok: boolean; message?: string } | null;
}

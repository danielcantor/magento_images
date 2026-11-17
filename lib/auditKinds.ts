// Tipos de acción registrados (compartido entre servidor y navegador).
export const AUDIT_KINDS = {
  "subida-masiva": "Subida masiva",
  "subida-reemplazar": "Subida masiva (reemplazar)",
  "varios-sku": "Imagen a varios SKU",
  "borrar-todas": "Borrar todas las imágenes",
  "borrar-sin-rol": "Borrar imágenes sin rol",
  "igualar-tiendas": "Igualar tiendas",
  "editor-guardar": "Editor: guardar cambios",
  "editor-reemplazar": "Editor: reemplazar imagen",
  "editor-borrar": "Editor: borrar imagen",
  "editor-añadir": "Editor: añadir imágenes",
  "editor-igualar": "Editor: igualar tiendas",
} as const;

export type AuditKind = keyof typeof AUDIT_KINDS;

export type AuditStatus = "en-curso" | "completo" | "con-errores" | "detenido" | "error";

export const AUDIT_STATUS_LABELS: Record<AuditStatus, string> = {
  "en-curso": "En curso",
  completo: "Completo",
  "con-errores": "Con errores",
  detenido: "Detenido",
  error: "Error",
};

export interface AuditLine {
  sku: string;
  action: string;
  fileName?: string;
  status: "ok" | "error";
  message?: string;
  bulk?: string;
}

export interface AuditRecord {
  id: string;
  user: string;
  env: string;
  kind: AuditKind;
  status: AuditStatus;
  startedAt: string;
  finishedAt?: string;
  /** Parámetros de la acción (modo, posiciones, cantidad de SKU…). */
  params: Record<string, string | number | boolean | null>;
  /** SKUs afectados (hasta 200, para mostrar en la lista). */
  skus: string[];
  total: number;
  ok: number;
  failed: number;
  lines: AuditLine[];
  /** true si había más líneas que el máximo guardado. */
  truncated?: boolean;
}

export type AuditSummary = Omit<AuditRecord, "lines">;

export const MAX_AUDIT_LINES = 2000;
export const MAX_AUDIT_SKUS = 200;

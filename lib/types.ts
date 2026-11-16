// Tipos compartidos entre servidor y cliente.

/** Rol de imagen (atributo media_image de Magento). */
export interface MediaRole {
  code: string;
  label: string;
}

/** Roles estándar de Magento; los reales se leen de la tienda (/api/roles). */

export const ROLES = ["image", "small_image", "thumbnail", "swatch_image"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  image: "Base",
  small_image: "Small",
  thumbnail: "Thumbnail",
  swatch_image: "Swatch",
};

export interface MediaEntry {
  id: number;
  media_type: string;
  label: string | null;
  position: number;
  disabled: boolean;
  types: string[];
  file: string;
  /** URL pública de la imagen (la añade nuestra API). */
  url?: string;
}

export const FALLBACK_ROLES: MediaRole[] = ROLES.map((code) => ({ code, label: ROLE_LABELS[code] }));

export interface ProductRow {
  id: number;
  sku: string;
  name: string;
  type_id: string;
  status: number;
  media: MediaEntry[];
  websiteIds: number[];
}

export interface StoreView {
  id: number;
  code: string;
  name: string;
}

export interface Website {
  id: number;
  code: string;
  name: string;
  stores: StoreView[];
}

export const PAGE_SIZES = [25, 50, 100, 200] as const;

export interface ProductSearchResult {
  items: ProductRow[];
  total: number;
}

// Tipos compartidos entre servidor y cliente.

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

export interface ProductRow {
  id: number;
  sku: string;
  name: string;
  type_id: string;
  status: number;
  media: MediaEntry[];
}

export interface ProductSearchResult {
  items: ProductRow[];
  total: number;
}

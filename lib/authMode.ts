// Qué sistema de acceso usa el dashboard. Funciona en Node y en Edge (middleware).
export type AuthMode = "magento" | "supabase" | "password" | "none";

export function getAuthMode(): AuthMode {
  if (process.env.AUTH_MODE === "magento") return "magento";
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return "supabase";
  if (process.env.DASHBOARD_PASSWORD) return "password";
  return "none";
}

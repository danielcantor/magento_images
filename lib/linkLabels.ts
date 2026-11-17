// Textos de productos vinculados (compartido entre servidor y navegador).

const LINK_TYPE_LABELS: Record<string, string> = { related: "relacionados", upsell: "up-sell", crosssell: "cross-sell" };

export const linkTypeLabel = (t: string) => LINK_TYPE_LABELS[t] ?? `tipo «${t}»`;

/** «relacionados: 3; up-sell: 1» */
export const formatLinkCounts = (byType: Record<string, number>) =>
  Object.entries(byType)
    .map(([t, n]) => `${linkTypeLabel(t)}: ${n}`)
    .join("; ");

/** «relacionados: A, B; cross-sell: C» (hasta 5 por tipo). */
export const formatMissingLinks = (missing: { type: string; sku: string }[]) => {
  const byType = new Map<string, string[]>();
  for (const m of missing) byType.set(m.type, [...(byType.get(m.type) ?? []), m.sku]);
  return [...byType]
    .map(([t, list]) => `${linkTypeLabel(t)}: ${list.slice(0, 5).join(", ")}${list.length > 5 ? ` y ${list.length - 5} más` : ""}`)
    .join("; ");
};

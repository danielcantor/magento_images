// Calcula dónde quedan las imágenes nuevas y cuáles existentes hay que correr.

export interface InsertPlan {
  /** Posición final (1..n) de cada imagen nueva, en el mismo orden que `targets`. */
  newPositions: number[];
  /** Imágenes existentes cuya posición cambia. */
  moves: { id: number; position: number }[];
}

export function planInsert(existing: { id: number; position: number }[], targets: number[]): InsertPlan {
  type Slot = { kind: "old"; id: number; position: number } | { kind: "new"; index: number };
  const list: Slot[] = [...existing]
    .sort((a, b) => a.position - b.position || a.id - b.id)
    .map((e) => ({ kind: "old", id: e.id, position: e.position }));

  // Se insertan de menor a mayor posición; empate: orden en que se añadieron.
  const order = targets.map((t, index) => ({ t: Math.max(1, Math.floor(t) || 1), index })).sort((a, b) => a.t - b.t || a.index - b.index);
  for (const { t, index } of order) {
    list.splice(Math.min(t - 1, list.length), 0, { kind: "new", index });
  }

  const newPositions: number[] = new Array(targets.length);
  const moves: InsertPlan["moves"] = [];
  list.forEach((slot, i) => {
    const pos = i + 1;
    if (slot.kind === "new") newPositions[slot.index] = pos;
    else if (slot.position !== pos) moves.push({ id: slot.id, position: pos });
  });
  return { newPositions, moves };
}

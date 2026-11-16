import { describe, expect, it } from "vitest";
import { diffEntries, planStoreUpdates } from "@/lib/storeSync";
import type { MediaEntry } from "@/lib/types";

const e = (id: number, position: number, types: string[] = [], label: string | null = "", disabled = false): MediaEntry => ({
  id, position, types, label, disabled, media_type: "image", file: `/${id}.jpg`,
});

describe("diffEntries", () => {
  const general = [e(1, 1, ["image", "small_image"], "Rojo"), e(2, 2, ["thumbnail"]), e(3, 3)];

  it("sin diferencias (ignora el orden de los roles y null vs vacío)", () => {
    const store = [e(1, 1, ["small_image", "image"], "Rojo"), e(2, 2, ["thumbnail"], null), e(3, 3)];
    expect(diffEntries(general, store)).toEqual([]);
  });

  it("detecta roles, alt, posición y oculta", () => {
    const store = [e(1, 1, ["small_image"], "Rojo ES"), e(2, 5, ["thumbnail", "image"]), e(3, 3, [], "", true)];
    expect(diffEntries(general, store)).toEqual([
      { id: 1, fields: ["roles", "alt"] },
      { id: 2, fields: ["roles", "posición"] },
      { id: 3, fields: ["oculta"] },
    ]);
  });

  it("ignora imágenes que la tienda no tiene", () => {
    expect(diffEntries(general, [e(1, 1, ["image", "small_image"], "Rojo")])).toEqual([]);
  });
});

describe("planStoreUpdates", () => {
  it("escribe solo lo que difiere, primero las que llevan roles, con valores generales", () => {
    const general = [e(1, 1), e(2, 2, ["image", "thumbnail"], "B"), e(3, 3, ["small_image"])];
    const plan = planStoreUpdates(general, [{ id: 1, fields: ["roles"] }, { id: 2, fields: ["roles"] }, { id: 3, fields: ["roles"] }]);
    expect(plan.map((p) => p.id)).toEqual([2, 3, 1]);
    expect(plan[0]).toMatchObject({ label: "B", types: ["image", "thumbnail"] });
    expect(planStoreUpdates(general, [{ id: 3, fields: ["alt"] }]).map((p) => p.id)).toEqual([3]);
  });
});

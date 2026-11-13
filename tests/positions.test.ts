import { describe, expect, it } from "vitest";
import { planInsert } from "@/lib/positions";

const gallery = [
  { id: 10, position: 1 },
  { id: 11, position: 2 },
  { id: 12, position: 3 },
];

describe("planInsert", () => {
  it("galería vacía", () => {
    expect(planInsert([], [2])).toEqual({ newPositions: [1], moves: [] });
    expect(planInsert([], [1, 2])).toEqual({ newPositions: [1, 2], moves: [] });
  });
  it("posición 1 corre todas", () => {
    expect(planInsert(gallery, [1])).toEqual({
      newPositions: [1],
      moves: [{ id: 10, position: 2 }, { id: 11, position: 3 }, { id: 12, position: 4 }],
    });
  });
  it("posición en medio solo mueve las siguientes", () => {
    expect(planInsert(gallery, [2])).toEqual({
      newPositions: [2],
      moves: [{ id: 11, position: 3 }, { id: 12, position: 4 }],
    });
  });
  it("posición mayor que el total va al final", () => {
    expect(planInsert(gallery, [9])).toEqual({ newPositions: [4], moves: [] });
  });
  it("dos imágenes en 1 y 3", () => {
    expect(planInsert(gallery, [3, 1])).toEqual({
      newPositions: [3, 1],
      moves: [{ id: 10, position: 2 }, { id: 11, position: 4 }, { id: 12, position: 5 }],
    });
  });
  it("normaliza posiciones con huecos de Magento", () => {
    const r = planInsert([{ id: 1, position: 0 }, { id: 2, position: 5 }], [2]);
    expect(r).toEqual({ newPositions: [2], moves: [{ id: 1, position: 1 }, { id: 2, position: 3 }] });
  });
});

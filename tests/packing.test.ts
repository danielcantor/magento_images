import { describe, expect, it } from "vitest";
import { packItems } from "@/lib/packing";

const MB = 1024 * 1024;
const item = (sku: string, file: string, size: number) => ({ sku, file, size });
const shape = (packs: { sku: string; file: string }[][]) => packs.map((p) => p.map((i) => `${i.sku}:${i.file}`));

describe("packItems", () => {
  it("no separa las imágenes de un SKU", () => {
    const items = [item("A", "a1", 1 * MB), item("A", "a2", 1 * MB), item("B", "b1", 1 * MB), item("B", "b2", 1 * MB)];
    expect(shape(packItems(items, { maxBytes: 3.5 * MB, maxItems: 50 }))).toEqual([["A:a1", "A:a2"], ["B:b1", "B:b2"]]);
  });

  it("un archivo compartido cuenta una vez por envío", () => {
    const items = ["A", "B", "C", "D", "E"].map((s) => item(s, "shared", 2 * MB));
    const packs = packItems(items, { maxBytes: 3.5 * MB, maxItems: 50 });
    expect(packs).toHaveLength(1);
  });

  it("respeta maxItems", () => {
    const items = ["A", "B", "C", "D", "E"].map((s) => item(s, "shared", 1));
    expect(packItems(items, { maxBytes: 10 * MB, maxItems: 2 }).map((p) => p.length)).toEqual([2, 2, 1]);
  });

  it("un SKU demasiado grande se reparte en orden", () => {
    const items = [item("A", "a1", 2 * MB), item("A", "a2", 2 * MB), item("A", "a3", 2 * MB)];
    expect(shape(packItems(items, { maxBytes: 3.5 * MB, maxItems: 50 }))).toEqual([["A:a1"], ["A:a2"], ["A:a3"]]);
  });

  it("agrupa SKU aunque vengan intercalados", () => {
    const items = [item("A", "a1", 1), item("B", "b1", 1), item("A", "a2", 1)];
    expect(shape(packItems(items, { maxBytes: MB, maxItems: 50 }))).toEqual([["A:a1", "A:a2", "B:b1"]]);
  });
});

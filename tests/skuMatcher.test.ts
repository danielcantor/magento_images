import { describe, expect, it } from "vitest";
import { candidateSkus, matchFiles, parseFileName, safeFileName } from "@/lib/skuMatcher";

describe("parseFileName", () => {
  it("SKU sin sufijo es posición 1", () => {
    expect(parseFileName("ABC123.jpg")).toMatchObject({ sku: "ABC123", position: 1, altSku: null });
  });
  it("sufijo numérico es la posición", () => {
    expect(parseFileName("ABC123_3.JPG")).toMatchObject({ sku: "ABC123", position: 3, altSku: "ABC123_3" });
  });
  it("separador configurable", () => {
    expect(parseFileName("ABC-123-2.png", "-")).toMatchObject({ sku: "ABC-123", position: 2 });
    expect(parseFileName("ABC_2.png", "-")).toMatchObject({ sku: "ABC_2", position: 1 });
  });
  it("rechaza extensiones no admitidas", () => {
    expect(parseFileName("ABC.pdf").error).toMatch(/Formato/);
    expect(parseFileName("ABC").error).toMatch(/Formato/);
  });
});

describe("matchFiles", () => {
  const items = ["abc_2.jpg", "ABC.jpg", "XYZ_1.png", "NOPE.jpg", "doc.txt", "SIZE_10_1.jpg", "SIZE_10.jpg"].map(
    (n) => ({ file: n, parsed: parseFileName(n) }),
  );

  it("agrupa por SKU de Magento y ordena por posición", () => {
    const r = matchFiles(items, ["ABC", "XYZ", "SIZE_10"]);
    const abc = r.groups.find((g) => g.sku === "ABC")!;
    expect(abc.files.map((f) => f.fileName)).toEqual(["ABC.jpg", "abc_2.jpg"]);
    expect(r.groups.find((g) => g.sku === "XYZ")!.files[0].position).toBe(1);
  });

  it("usa el nombre completo como SKU si el corto no existe", () => {
    const r = matchFiles(items, ["SIZE_10"]);
    const g = r.groups.find((g) => g.sku === "SIZE_10")!;
    expect(g.files.map((f) => [f.fileName, f.position])).toEqual([
      ["SIZE_10.jpg", 1],
      ["SIZE_10_1.jpg", 1],
    ]);
  });

  it("reporta SKU inexistentes y formatos inválidos", () => {
    const r = matchFiles(items, ["ABC"]);
    expect(r.rejected.map((x) => x.fileName)).toEqual(
      expect.arrayContaining(["NOPE.jpg", "doc.txt", "XYZ_1.png"]),
    );
  });

  it("candidateSkus incluye ambas interpretaciones", () => {
    expect(candidateSkus(items.map((i) => i.parsed))).toEqual(
      expect.arrayContaining(["ABC", "abc_2", "abc", "SIZE_10", "SIZE_10_1"]),
    );
  });
});

describe("safeFileName", () => {
  it("limpia caracteres raros", () => {
    expect(safeFileName("AB/C 12", 2, "jpg")).toBe("AB-C-12_2.jpg");
  });
});

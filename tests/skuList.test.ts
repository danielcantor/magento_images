import { describe, expect, it } from "vitest";
import { parseSkuCsv, parseSkuText } from "@/lib/skuList";

describe("parseSkuText", () => {
  it("separadores mixtos y duplicados", () => {
    expect(parseSkuText("A1, b2;C3\tA1\n\n a1  d4")).toEqual(["A1", "b2", "C3", "d4"]);
  });
});

describe("parseSkuCsv", () => {
  it("usa la columna sku de la cabecera", () => {
    expect(parseSkuCsv("﻿nombre,SKU,precio\nCamisa,\"C-1\",10\nPantalón,P-2,20\n")).toEqual(["C-1", "P-2"]);
  });
  it("separador ; y comillas con coma dentro", () => {
    expect(parseSkuCsv('sku;nombre\n"X,1";a\nY2;b')).toEqual(["X,1", "Y2"]);
  });
  it("sin cabecera usa la primera columna", () => {
    expect(parseSkuCsv("A,foo\nB,bar\nA,baz")).toEqual(["A", "B"]);
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  AUDIT_ID_RE,
  finishAudit,
  getAudit,
  isAuditEnabled,
  listAudit,
  newAuditId,
  setAuditStoreForTests,
  startAudit,
  userKey,
  type AuditStore,
} from "@/lib/audit";
import { MAX_AUDIT_LINES } from "@/lib/auditKinds";

function memoryStore(): AuditStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    async put(p, d) {
      data.set(p, d);
    },
    async get(p) {
      return data.get(p) ?? null;
    },
    async list(prefix, cursor, limit) {
      const all = [...data.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      return { paths: all.slice(start, start + limit), cursor: start + limit < all.length ? String(start + limit) : undefined };
    },
  };
}

let mem: ReturnType<typeof memoryStore>;
beforeEach(() => {
  delete process.env.AUDIT_LOCAL_DIR;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  mem = memoryStore();
  setAuditStoreForTests(mem);
});
afterEach(() => setAuditStoreForTests(null));

describe("ids y rutas", () => {
  it("el id ordena lo más nuevo primero", () => {
    const viejo = newAuditId(1_700_000_000_000);
    const nuevo = newAuditId(1_800_000_000_000);
    expect(AUDIT_ID_RE.test(viejo) && AUDIT_ID_RE.test(nuevo)).toBe(true);
    expect([viejo, nuevo].sort()[0]).toBe(nuevo);
  });
  it("userKey limpia el usuario", () => {
    expect(userKey("María.López@Sommier")).toBe("mar_a.l_pez_sommier");
    expect(userKey("../../etc")).toBe("etc");
    expect(userKey("")).toBe("anonimo");
  });
});

describe("registro", () => {
  it("crea en curso, cierra y lista lo más nuevo primero", async () => {
    const a = await startAudit("ana", { kind: "subida-masiva", skus: ["S1", "S2", "S1"], params: { modo: "añadir" } }, undefined, new Date("2026-11-01T10:00:00Z"));
    const b = await startAudit("ana", { kind: "igualar-tiendas", skus: ["S3"] }, undefined, new Date("2026-11-02T10:00:00Z"));
    expect(a.status).toBe("en-curso");
    expect(a.skus).toEqual(["S1", "S2"]);
    expect([...mem.data.keys()].every((k) => k.startsWith("audit/ana/"))).toBe(true);

    await finishAudit("ana", a.id, { status: "con-errores", ok: 1, failed: 1, lines: [{ sku: "S1", action: "subir", status: "ok" }, { sku: "S2", action: "subir", status: "error", message: "x" }] });
    const list = await listAudit("ana");
    expect(list.items.map((i) => i.id)).toEqual([b.id, a.id]);
    expect(list.items[1]).toMatchObject({ status: "con-errores", ok: 1, failed: 1 });
    expect("lines" in list.items[1]).toBe(false);
    expect((await getAudit("ana", a.id)).lines).toHaveLength(2);
  });

  it("no se puede cerrar dos veces", async () => {
    const a = await startAudit("ana", { kind: "borrar-todas", skus: ["S1"] });
    await finishAudit("ana", a.id, { status: "completo", ok: 1 });
    await expect(finishAudit("ana", a.id, { status: "completo" })).rejects.toMatchObject({ status: 409 });
  });

  it("cada usuario ve solo lo suyo", async () => {
    const a = await startAudit("ana", { kind: "subida-masiva", skus: ["S1"] });
    await startAudit("beto", { kind: "subida-masiva", skus: ["S9"] });
    expect((await listAudit("beto")).items.map((i) => i.user)).toEqual(["beto"]);
    await expect(getAudit("beto", a.id)).rejects.toMatchObject({ status: 404 });
    await expect(finishAudit("beto", a.id, { status: "completo" })).rejects.toMatchObject({ status: 404 });
  });

  it("filtra por tipo y recorta las líneas", async () => {
    await startAudit("ana", { kind: "subida-masiva" });
    const lines = Array.from({ length: MAX_AUDIT_LINES + 5 }, (_, i) => ({ sku: `S${i}`, action: "subir", status: "ok" as const }));
    const e = await startAudit("ana", { kind: "editor-guardar", skus: ["S1"] }, { status: "completo", ok: lines.length, lines });
    expect(e.lines).toHaveLength(MAX_AUDIT_LINES);
    expect(e.truncated).toBe(true);
    expect((await listAudit("ana", { kind: "editor-guardar" })).items.map((i) => i.kind)).toEqual(["editor-guardar"]);
  });

  it("rechaza tipos desconocidos e ids mal formados", async () => {
    await expect(startAudit("ana", { kind: "hackear" })).rejects.toMatchObject({ status: 400 });
    await expect(getAudit("ana", "../beto/x")).rejects.toMatchObject({ status: 404 });
  });
});

describe("almacenamiento local", () => {
  it("funciona con AUDIT_LOCAL_DIR y se desactiva sin configuración", async () => {
    setAuditStoreForTests(null);
    expect(isAuditEnabled()).toBe(false);
    const dir = mkdtempSync(path.join(tmpdir(), "audit-"));
    process.env.AUDIT_LOCAL_DIR = dir;
    try {
      expect(isAuditEnabled()).toBe(true);
      const a = await startAudit("ana", { kind: "varios-sku", skus: ["S1"] });
      expect((await listAudit("ana")).items[0].id).toBe(a.id);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

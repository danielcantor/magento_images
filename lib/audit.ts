// Registro de acciones (auditoría). Solo servidor.
// Un JSON por acción en Vercel Blob (privado) o, en desarrollo, en disco.
import "server-only";
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { get as blobGet, list as blobList, put as blobPut } from "@vercel/blob";
import {
  AUDIT_KINDS,
  MAX_AUDIT_LINES,
  MAX_AUDIT_SKUS,
  type AuditKind,
  type AuditLine,
  type AuditRecord,
  type AuditStatus,
  type AuditSummary,
} from "./auditKinds";

// ---------------------------------------------------------------------------
// Almacenamiento

export interface AuditStore {
  put(pathname: string, data: string): Promise<void>;
  get(pathname: string): Promise<string | null>;
  /** Paths bajo `prefix`, en orden alfabético (el más nuevo primero gracias al tiempo invertido). */
  list(prefix: string, cursor: string | undefined, limit: number): Promise<{ paths: string[]; cursor?: string }>;
}

const blobAccess = (): "private" | "public" => (process.env.AUDIT_BLOB_ACCESS === "public" ? "public" : "private");

const blobStore: AuditStore = {
  async put(pathname, data) {
    await blobPut(pathname, data, {
      access: blobAccess(),
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      cacheControlMaxAge: 60,
    });
  },
  async get(pathname) {
    const res = await blobGet(pathname, { access: blobAccess(), useCache: false });
    if (!res || !res.stream) return null;
    return await new Response(res.stream).text();
  },
  async list(prefix, cursor, limit) {
    const res = await blobList({ prefix, cursor, limit });
    return { paths: res.blobs.map((b) => b.pathname), cursor: res.hasMore ? res.cursor : undefined };
  },
};

function localStore(dir: string): AuditStore {
  const abs = (p: string) => path.join(dir, ...p.split("/"));
  return {
    async put(p, data) {
      await fs.mkdir(path.dirname(abs(p)), { recursive: true });
      await fs.writeFile(abs(p), data, "utf8");
    },
    async get(p) {
      try {
        return await fs.readFile(abs(p), "utf8");
      } catch {
        return null;
      }
    },
    async list(prefix, cursor, limit) {
      const folder = abs(prefix.replace(/\/$/, ""));
      let names: string[] = [];
      try {
        names = (await fs.readdir(folder)).filter((n) => n.endsWith(".json")).sort();
      } catch {
        /* sin registros */
      }
      const start = cursor ? Number(cursor) : 0;
      const slice = names.slice(start, start + limit);
      return { paths: slice.map((n) => prefix + n), cursor: start + limit < names.length ? String(start + limit) : undefined };
    },
  };
}

let override: AuditStore | null = null;
/** Solo para tests. */
export function setAuditStoreForTests(store: AuditStore | null) {
  override = store;
}

function store(): AuditStore | null {
  if (override) return override;
  if (process.env.AUDIT_LOCAL_DIR) return localStore(process.env.AUDIT_LOCAL_DIR);
  if (process.env.BLOB_READ_WRITE_TOKEN) return blobStore;
  return null;
}

export function isAuditEnabled(): boolean {
  return store() !== null;
}

// ---------------------------------------------------------------------------
// Rutas e ids

const MAX_TS = 9_999_999_999_999;

/** Carpeta del usuario: solo minúsculas, números, punto, guion y guion bajo. */
export function userKey(user: string): string {
  return (
    user
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "_")
      .replace(/^[._-]+|[._-]+$/g, "")
      .slice(0, 64) || "anonimo"
  );
}

/** id = <tiempo invertido de 13 dígitos>-<aleatorio>: ordenar por nombre = más nuevo primero. */
export function newAuditId(now = Date.now()): string {
  return `${String(MAX_TS - now).padStart(13, "0")}-${randomBytes(5).toString("hex")}`;
}

export const AUDIT_ID_RE = /^\d{13}-[0-9a-f]{10}$/;

const recordPath = (user: string, id: string) => `audit/${userKey(user)}/${id}.json`;

// ---------------------------------------------------------------------------
// Operaciones (siempre sobre el usuario de la sesión)

export class AuditError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

function requireStore(): AuditStore {
  const s = store();
  if (!s) throw new AuditError("El registro de acciones no está configurado.", 404);
  return s;
}

function clean(lines: AuditLine[] | undefined): { lines: AuditLine[]; truncated: boolean } {
  const all = (lines ?? []).map((l) => ({
    sku: String(l.sku ?? "").slice(0, 120),
    action: String(l.action ?? "").slice(0, 60),
    fileName: l.fileName ? String(l.fileName).slice(0, 200) : undefined,
    status: l.status === "ok" ? ("ok" as const) : ("error" as const),
    message: l.message ? String(l.message).slice(0, 600) : undefined,
    bulk: l.bulk ? String(l.bulk).slice(0, 60) : undefined,
  }));
  return { lines: all.slice(0, MAX_AUDIT_LINES), truncated: all.length > MAX_AUDIT_LINES };
}

export interface AuditStartInput {
  kind: string;
  params?: Record<string, unknown>;
  skus?: string[];
  total?: number;
}

export interface AuditFinishInput {
  status: AuditStatus;
  ok?: number;
  failed?: number;
  total?: number;
  lines?: AuditLine[];
}

function cleanParams(params: Record<string, unknown> | undefined): AuditRecord["params"] {
  const out: AuditRecord["params"] = {};
  for (const [k, v] of Object.entries(params ?? {}).slice(0, 30)) {
    if (v === null || typeof v === "number" || typeof v === "boolean") out[k.slice(0, 40)] = v;
    else out[k.slice(0, 40)] = String(v).slice(0, 300);
  }
  return out;
}

const FINAL: AuditStatus[] = ["completo", "con-errores", "detenido", "error"];

/** Crea un registro. Si `finish` viene, se guarda ya terminado (acciones del editor). */
export async function startAudit(user: string, input: AuditStartInput, finish?: AuditFinishInput, now = new Date()): Promise<AuditRecord> {
  const s = requireStore();
  if (!(input.kind in AUDIT_KINDS)) throw new AuditError("Tipo de acción desconocido.", 400);
  const skus = [...new Set((input.skus ?? []).map((x) => String(x).slice(0, 120)))];
  const record: AuditRecord = {
    id: newAuditId(now.getTime()),
    user,
    env: process.env.VERCEL_ENV || "local",
    kind: input.kind as AuditKind,
    status: "en-curso",
    startedAt: now.toISOString(),
    params: cleanParams(input.params),
    skus: skus.slice(0, MAX_AUDIT_SKUS),
    total: Math.max(0, Number(input.total) || skus.length),
    ok: 0,
    failed: 0,
    lines: [],
  };
  if (finish) applyFinish(record, finish, now);
  await s.put(recordPath(user, record.id), JSON.stringify(record));
  return record;
}

function applyFinish(record: AuditRecord, finish: AuditFinishInput, now: Date) {
  if (!FINAL.includes(finish.status)) throw new AuditError("Estado final no válido.", 400);
  const { lines, truncated } = clean(finish.lines);
  record.status = finish.status;
  record.finishedAt = now.toISOString();
  record.ok = Math.max(0, Number(finish.ok) || 0);
  record.failed = Math.max(0, Number(finish.failed) || 0);
  if (finish.total !== undefined) record.total = Math.max(0, Number(finish.total) || 0);
  record.lines = lines;
  if (truncated) record.truncated = true;
}

export async function getAudit(user: string, id: string): Promise<AuditRecord> {
  const s = requireStore();
  if (!AUDIT_ID_RE.test(id)) throw new AuditError("Registro no encontrado.", 404);
  const raw = await s.get(recordPath(user, id));
  if (!raw) throw new AuditError("Registro no encontrado.", 404);
  const rec = JSON.parse(raw) as AuditRecord;
  // Doble control: el registro debe ser de este usuario.
  if (userKey(rec.user) !== userKey(user)) throw new AuditError("Registro no encontrado.", 404);
  return rec;
}

export async function finishAudit(user: string, id: string, finish: AuditFinishInput, now = new Date()): Promise<AuditRecord> {
  const rec = await getAudit(user, id);
  if (rec.status !== "en-curso") throw new AuditError("El registro ya está cerrado.", 409);
  applyFinish(rec, finish, now);
  await requireStore().put(recordPath(user, id), JSON.stringify(rec));
  return rec;
}

/** Lista las acciones del usuario, la más nueva primero. */
export async function listAudit(
  user: string,
  opts: { cursor?: string; kind?: string; limit?: number } = {},
): Promise<{ items: AuditSummary[]; cursor?: string }> {
  const s = requireStore();
  const limit = Math.min(50, Math.max(1, opts.limit ?? 20));
  const prefix = `audit/${userKey(user)}/`;
  const items: AuditSummary[] = [];
  let cursor = opts.cursor;
  // Con filtro por tipo puede hacer falta leer varias páginas.
  for (let page = 0; page < 5 && items.length < limit; page++) {
    const res = await s.list(prefix, cursor, limit);
    const recs = await Promise.all(
      res.paths.map(async (p) => {
        const raw = await s.get(p).catch(() => null);
        if (!raw) return null;
        try {
          const { lines: _lines, ...summary } = JSON.parse(raw) as AuditRecord;
          return summary;
        } catch {
          return null;
        }
      }),
    );
    for (const r of recs) if (r && (!opts.kind || r.kind === opts.kind)) items.push(r);
    cursor = res.cursor;
    if (!cursor) break;
  }
  return { items, cursor };
}

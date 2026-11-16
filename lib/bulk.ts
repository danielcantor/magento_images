"use client";
// Trabajos masivos que corren en el navegador. Cada SKU se procesa en serie
// (para no pisar la galería del mismo producto) y varios SKU en paralelo.
import { api, ApiError, syncAllStores, withRetry } from "./api";
import { packItems } from "./packing";
import { DEFAULT_QUEUE, type QueueSettings, type UploadMode } from "./queueSettings";
import { prepareImage } from "./imagePrep";
import { planInsert } from "./positions";
import { runPool } from "./pool";
import type { SkuGroup } from "./skuMatcher";
import type { MediaEntry } from "./types";

export type LogStatus = "ok" | "error";

export interface LogLine {
  sku: string;
  action: string;
  fileName?: string;
  status: LogStatus;
  message?: string;
  /** bulk_uuid de Magento (modo bulk). */
  bulk?: string;
}

export interface Progress {
  done: number;
  total: number;
  ok: number;
  failed: number;
}

export interface JobCallbacks {
  onLog: (line: LogLine) => void;
  onProgress: (p: Progress) => void;
  /** Texto de la fase actual (p. ej. «Esperando a Magento…»); null al terminar. */
  onPhase?: (text: string | null) => void;
  signal?: AbortSignal;
  concurrency?: number;
}

/** Roles por defecto de la primera imagen si no llegan los de la tienda. */
export const MAIN_ROLES = ["image", "small_image", "thumbnail", "swatch_image"];

function tracker(total: number, cb: JobCallbacks) {
  const p: Progress = { done: 0, total, ok: 0, failed: 0 };
  cb.onProgress({ ...p });
  return (line: LogLine, countsAsStep = true) => {
    cb.onLog(line);
    if (!countsAsStep) return;
    p.done++;
    if (line.status === "ok") p.ok++;
    else p.failed++;
    cb.onProgress({ ...p });
  };
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Iguala las tiendas de un SKU a lo general y lo deja en el log (no cuenta como paso). */
async function syncSkuStores(sku: string, log: (line: LogLine) => void) {
  try {
    const r = await syncAllStores(sku);
    if (r.stillDifferent.length) {
      log({ sku, action: "tiendas", status: "error", message: `Siguen distintas: ${r.stillDifferent.join(", ")}` });
    } else {
      log({
        sku,
        action: "tiendas",
        status: "ok",
        message: r.storesSynced.length ? `Igualadas a lo general: ${r.storesSynced.join(", ")}` : "Ya coincidían con lo general",
      });
    }
  } catch (e) {
    log({ sku, action: "tiendas", status: "error", message: `No se pudieron igualar las tiendas: ${msg(e)}` });
  }
}

// ---------------------------------------------------------------------------
// Modo bulk: las subidas se encolan en Magento y quedan en
// System > Action Logs > Bulk Actions. Luego se sigue su estado.

export type { QueueSettings, UploadMode };

// Envíos chicos: Magento tarda en encolar y cada petición debe terminar bien antes del límite.
const PACK_LIMITS = { maxBytes: 2 * 1024 * 1024, maxItems: 10 };

interface QueueItem {
  sku: string;
  fileName: string;
  file: File;
  position: number;
  types: string[];
}

type Step = ReturnType<typeof tracker>;

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    });
  });
}

async function enqueueAndTrack(items: QueueItem[], step: Step, cb: JobCallbacks, q: QueueSettings): Promise<Set<string>> {
  const completed = new Set<string>();
  if (!items.length) return completed;
  const tracking: { uuid: string; items: QueueItem[]; done: Set<number> }[] = [];
  const packs = packItems(items.map((i) => ({ ...i, size: i.file.size })), PACK_LIMITS);

  let sent = 0;
  for (const pack of packs) {
    if (cb.signal?.aborted) break;
    cb.onPhase?.(`Enviando a la cola de Magento… (${sent}/${items.length})`);
    try {
      const res = await withRetry(() => api.enqueueMedia(pack), 2, { idempotent: false });
      for (const b of res.bulks) {
        const slice = pack.slice(b.from, b.from + b.items.length);
        const accepted: QueueItem[] = [];
        b.items.forEach((r, i) => {
          if (r.accepted) accepted.push(slice[i]);
          else step({ sku: slice[i].sku, action: "subir", fileName: slice[i].fileName, status: "error", message: r.message, bulk: b.bulkUuid });
        });
        if (accepted.length) {
          tracking.push({ uuid: b.bulkUuid, items: accepted, done: new Set() });
          step({ sku: "—", action: "en cola", status: "ok", message: `${accepted.length} imagen(es) en el bulk ${b.bulkUuid}`, bulk: b.bulkUuid }, false);
        }
      }
    } catch (e) {
      for (const it of pack) step({ sku: it.sku, action: "subir", fileName: it.fileName, status: "error", message: `No se pudo encolar: ${msg(e)}` });
    }
    sent += pack.length;
  }

  const deadline = Date.now() + q.timeoutMs;
  let pending = tracking.filter((t) => t.done.size < t.items.length);
  while (pending.length && !cb.signal?.aborted) {
    const remaining = pending.reduce((n, t) => n + t.items.length - t.done.size, 0);
    cb.onPhase?.(`Esperando a que Magento procese ${remaining} imagen(es)…`);
    for (const t of pending) {
      try {
        const st = await api.bulkStatus(t.uuid);
        st.operations.forEach((op, i) => {
          if (i >= t.items.length || t.done.has(i) || op.state === "open") return;
          t.done.add(i);
          const it = t.items[i];
          if (op.state === "complete") completed.add(it.sku);
          step({
            sku: it.sku,
            action: "subir",
            fileName: it.fileName,
            status: op.state === "complete" ? "ok" : "error",
            message: op.state === "complete" ? undefined : op.message || "Magento no pudo procesar la imagen",
            bulk: t.uuid,
          });
        });
      } catch (e) {
        if (e instanceof ApiError && e.status === 403) {
          // Sin permiso para ver Bulk Actions: no se puede seguir, pero la subida sigue en Magento.
          t.items.forEach((it, i) => {
            if (t.done.has(i)) return;
            t.done.add(i);
            step({ sku: it.sku, action: "subir", fileName: it.fileName, status: "error", bulk: t.uuid, message: "Encolada, pero tu usuario no puede ver su estado (falta el permiso Bulk Actions). Revísalo en el Admin." });
          });
        }
        // Otros errores: se vuelve a intentar en la siguiente vuelta.
      }
    }
    pending = pending.filter((t) => t.done.size < t.items.length);
    if (!pending.length) break;
    if (Date.now() > deadline) {
      for (const t of pending) {
        t.items.forEach((it, i) => {
          if (t.done.has(i)) return;
          step({ sku: it.sku, action: "subir", fileName: it.fileName, status: "error", bulk: t.uuid, message: "Magento aún no la procesó. Revisá que el cron y el consumidor async.operations.all estén activos; el estado está en System > Action Logs > Bulk Actions." });
        });
      }
      break;
    }
    await wait(q.pollMs, cb.signal);
  }
  if (cb.signal?.aborted && tracking.length) {
    step({ sku: "—", action: "detenido", status: "ok", message: "Se dejó de seguir el estado. Lo ya encolado se procesará igualmente en Magento (ver Bulk Actions)." }, false);
  }
  cb.onPhase?.(null);
  return completed;
}

/** Iguala las tiendas de varios SKU (fase final de los trabajos masivos). */
async function syncManyStores(skus: Iterable<string>, step: Step, cb: JobCallbacks) {
  const list = [...new Set(skus)];
  if (!list.length || cb.signal?.aborted) return;
  cb.onPhase?.(`Igualando tiendas de ${list.length} producto(s)…`);
  await runPool(list, cb.concurrency ?? 4, (sku) => syncSkuStores(sku, (l) => step(l, false)), cb.signal);
  cb.onPhase?.(null);
}

export async function runBulkUpload(
  groups: SkuGroup<File>[],
  opts: {
    mode: "append" | "replace";
    assignRoles: boolean;
    /** Roles que recibe la primera imagen de cada SKU (de /api/roles). */
    firstImageRoles?: string[];
    uploadMode?: UploadMode;
    queue?: QueueSettings;
    /** Igualar las tiendas a lo general al terminar cada SKU. */
    syncStores?: boolean;
  },
  cb: JobCallbacks,
): Promise<void> {
  const total = groups.reduce((n, g) => n + g.files.length, 0);
  const step = tracker(total, cb);
  const queued: QueueItem[] = [];
  const useQueue = opts.uploadMode === "bulk";
  const firstRoles = opts.firstImageRoles?.length ? opts.firstImageRoles : MAIN_ROLES;
  const touched: string[] = [];

  await runPool(
    groups,
    cb.concurrency ?? 4,
    async (group) => {
      const { sku } = group;
      let existing: MediaEntry[] = [];
      try {
        existing = await withRetry(() => api.getMedia(sku));
      } catch (e) {
        for (const f of group.files) step({ sku, action: "subir", fileName: f.fileName, status: "error", message: `No se pudo leer la galería: ${msg(e)}` });
        return;
      }

      let offset = 0;
      if (opts.mode === "replace") {
        for (const entry of existing) {
          if (cb.signal?.aborted) return;
          try {
            await withRetry(() => api.deleteMedia(sku, entry.id));
            step({ sku, action: "borrar anterior", fileName: entry.file, status: "ok" }, false);
          } catch (e) {
            step({ sku, action: "borrar anterior", fileName: entry.file, status: "error", message: msg(e) }, false);
          }
        }
      } else {
        offset = existing.reduce((m, e) => Math.max(m, e.position), 0);
      }

      // En modo añadir no se quita el rol base a una imagen existente, salvo que
      // el archivo sea explícitamente la posición 1 (SKU.jpg / SKU_1.jpg).
      const hasBase = opts.mode === "append" && existing.some((e) => e.types.includes("image"));
      const giveRoles = opts.assignRoles && (!hasBase || group.files[0]?.position === 1);

      for (let i = 0; i < group.files.length; i++) {
        if (cb.signal?.aborted) return;
        const f = group.files[i];
        try {
          const prepared = await prepareImage(f.file);
          if (useQueue) {
            queued.push({ sku, fileName: f.fileName, file: prepared, position: offset + i + 1, types: giveRoles && i === 0 ? firstRoles : [] });
            continue;
          }
          await withRetry(
            () => api.uploadMedia(sku, prepared, {
              position: offset + i + 1,
              types: giveRoles && i === 0 ? firstRoles : [],
            }),
            2,
            { idempotent: false },
          );
          step({ sku, action: "subir", fileName: f.fileName, status: "ok" });
          if (!touched.includes(sku)) touched.push(sku);
        } catch (e) {
          step({ sku, action: "subir", fileName: f.fileName, status: "error", message: msg(e) });
        }
      }
      if (opts.mode === "replace" && existing.length && !touched.includes(sku)) touched.push(sku);
    },
    cb.signal,
  );

  if (useQueue) {
    const done = await enqueueAndTrack(queued, step, cb, opts.queue ?? DEFAULT_QUEUE);
    done.forEach((sku) => !touched.includes(sku) && touched.push(sku));
  }
  if (opts.syncStores) await syncManyStores(touched, step, cb);
}

export async function runBulkDelete(
  skus: string[],
  opts: { onlyWithoutRoles: boolean; syncStores?: boolean },
  cb: JobCallbacks,
): Promise<void> {
  const step = tracker(skus.length, cb);
  await runPool(
    skus,
    cb.concurrency ?? 4,
    async (sku) => {
      try {
        const entries = await withRetry(() => api.getMedia(sku));
        const targets = opts.onlyWithoutRoles ? entries.filter((e) => e.types.length === 0) : entries;
        for (const e of targets) {
          if (cb.signal?.aborted) return;
          await withRetry(() => api.deleteMedia(sku, e.id));
        }
        step({ sku, action: "borrar", status: "ok", message: `${targets.length} imagen(es) borradas` });
        if (opts.syncStores && targets.length) await syncSkuStores(sku, cb.onLog);
      } catch (e) {
        step({ sku, action: "borrar", status: "error", message: msg(e) });
      }
    },
    cb.signal,
  );
}

export interface SharedImage {
  file: File;
  position: number;
  types: string[];
}

/**
 * Anexa las mismas imágenes a varios SKU, cada una en su posición.
 * Las imágenes existentes desde esa posición bajan un puesto (no se borra nada).
 */
export async function runSharedUpload(
  skus: string[],
  images: SharedImage[],
  cb: JobCallbacks,
  opts: { uploadMode?: UploadMode; queue?: QueueSettings; syncStores?: boolean } = {},
): Promise<void> {
  if (opts.uploadMode === "bulk") return runSharedUploadQueued(skus, images, cb, opts.queue ?? DEFAULT_QUEUE, Boolean(opts.syncStores));
  const step = tracker(skus.length, cb);

  // Se comprime una sola vez y se reutiliza en todos los SKU.
  let prepared: File[];
  try {
    prepared = await Promise.all(images.map((i) => prepareImage(i.file)));
  } catch (e) {
    for (const sku of skus) step({ sku, action: "anexar", status: "error", message: `No se pudo preparar la imagen: ${msg(e)}` });
    return;
  }

  await runPool(
    skus,
    cb.concurrency ?? 4,
    async (sku) => {
      let uploaded = 0;
      let moved = 0;
      try {
        const existing = await withRetry(() => api.getMedia(sku));
        const plan = planInsert(existing, images.map((i) => i.position));

        for (let i = 0; i < images.length; i++) {
          if (cb.signal?.aborted) return;
          await withRetry(
            () => api.uploadMedia(sku, prepared[i], { position: plan.newPositions[i], types: images[i].types }),
            2,
            { idempotent: false },
          );
          uploaded++;
        }

        if (plan.moves.length) {
          // Un solo guardado; los roles actuales (ya ajustados por Magento al subir) se conservan.
          await withRetry(() => api.saveGallery(sku, plan.moves.map((mv) => ({ id: mv.id, position: mv.position }))));
          moved = plan.moves.length;
        }
        step({ sku, action: "anexar", status: "ok", message: `${uploaded} imagen(es) anexadas, ${moved} movidas` });
        if (opts.syncStores) await syncSkuStores(sku, cb.onLog);
      } catch (e) {
        const partial = uploaded || moved ? ` (hecho: ${uploaded} anexadas, ${moved} movidas)` : "";
        step({ sku, action: "anexar", status: "error", message: msg(e) + partial });
      }
    },
    cb.signal,
  );
}

/**
 * Versión con cola: primero corre las imágenes existentes (inmediato) y luego
 * encola las nuevas en su posición. Progreso por imagen y SKU.
 */
async function runSharedUploadQueued(skus: string[], images: SharedImage[], cb: JobCallbacks, q: QueueSettings, sync: boolean) {
  const step = tracker(skus.length * images.length, cb);
  const failAll = (sku: string, message: string) =>
    images.forEach((img) => step({ sku, action: "anexar", fileName: img.file.name, status: "error", message }));

  let prepared: File[];
  try {
    prepared = await Promise.all(images.map((i) => prepareImage(i.file)));
  } catch (e) {
    for (const sku of skus) failAll(sku, `No se pudo preparar la imagen: ${msg(e)}`);
    return;
  }

  const queued: QueueItem[] = [];
  cb.onPhase?.("Preparando las galerías…");
  await runPool(
    skus,
    cb.concurrency ?? 4,
    async (sku) => {
      let existing: Awaited<ReturnType<typeof api.getMedia>>;
      try {
        existing = await withRetry(() => api.getMedia(sku));
      } catch (e) {
        failAll(sku, `No se pudo leer la galería: ${msg(e)}`);
        return;
      }
      const plan = planInsert(existing, images.map((i) => i.position));
      // Correr primero las existentes, en un solo guardado (todo o nada).
      if (plan.moves.length) {
        if (cb.signal?.aborted) return;
        try {
          await withRetry(() => api.saveGallery(sku, plan.moves.map((mv) => ({ id: mv.id, position: mv.position }))));
        } catch (e) {
          failAll(sku, `${msg(e)} (al correr las imágenes existentes; no se cambió nada)`);
          return;
        }
      }
      images.forEach((img, i) =>
        queued.push({ sku, fileName: img.file.name, file: prepared[i], position: plan.newPositions[i], types: img.types }),
      );
    },
    cb.signal,
  );
  const done = await enqueueAndTrack(queued, step, cb, q);
  if (sync) await syncManyStores(done, step, cb);
}

/** Reemplaza una imagen conservando roles, posición, alt y visibilidad. */
export async function replaceImage(sku: string, old: MediaEntry, file: File): Promise<void> {
  const prepared = await prepareImage(file);
  await api.uploadMedia(sku, prepared, {
    position: old.position,
    label: old.label,
    types: old.types,
    disabled: old.disabled,
  });
  await api.deleteMedia(sku, old.id);
}

export function logsToCsv(lines: LogLine[]): string {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [["sku", "accion", "archivo", "estado", "mensaje", "bulk_uuid"], ...lines.map((l) => [l.sku, l.action, l.fileName, l.status, l.message, l.bulk])];
  return rows.map((r) => r.map(esc).join(",")).join("\n");
}

export function downloadText(name: string, text: string, type = "text/csv") {
  const url = URL.createObjectURL(new Blob(["﻿" + text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** Iguala las tiendas a lo general en varios SKU (acción masiva de Productos). */
export async function runStoreSync(skus: string[], cb: JobCallbacks): Promise<void> {
  const step = tracker(skus.length, cb);
  await runPool(
    skus,
    cb.concurrency ?? 3,
    async (sku) => {
      try {
        const r = await syncAllStores(sku);
        step(
          r.stillDifferent.length
            ? { sku, action: "igualar tiendas", status: "error", message: `Siguen distintas: ${r.stillDifferent.join(", ")}` }
            : {
                sku,
                action: "igualar tiendas",
                status: "ok",
                message: r.storesSynced.length ? `${r.storesSynced.join(", ")} (${r.entriesUpdated} cambios)` : "Ya coincidían",
              },
        );
      } catch (e) {
        step({ sku, action: "igualar tiendas", status: "error", message: msg(e) });
      }
    },
    cb.signal,
  );
}

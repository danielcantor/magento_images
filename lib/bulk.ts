"use client";
// Trabajos masivos que corren en el navegador. Cada SKU se procesa en serie
// (para no pisar la galería del mismo producto) y varios SKU en paralelo.
import { api, withRetry } from "./api";
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
  signal?: AbortSignal;
  concurrency?: number;
}

export const MAIN_ROLES = ["image", "small_image", "thumbnail"];

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

export async function runBulkUpload(
  groups: SkuGroup<File>[],
  opts: { mode: "append" | "replace"; assignRoles: boolean },
  cb: JobCallbacks,
): Promise<void> {
  const total = groups.reduce((n, g) => n + g.files.length, 0);
  const step = tracker(total, cb);

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
          await withRetry(() =>
            api.uploadMedia(sku, prepared, {
              position: offset + i + 1,
              types: giveRoles && i === 0 ? MAIN_ROLES : [],
            }),
          );
          step({ sku, action: "subir", fileName: f.fileName, status: "ok" });
        } catch (e) {
          step({ sku, action: "subir", fileName: f.fileName, status: "error", message: msg(e) });
        }
      }
    },
    cb.signal,
  );
}

export async function runBulkDelete(
  skus: string[],
  opts: { onlyWithoutRoles: boolean },
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
export async function runSharedUpload(skus: string[], images: SharedImage[], cb: JobCallbacks): Promise<void> {
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
          await withRetry(() =>
            api.uploadMedia(sku, prepared[i], { position: plan.newPositions[i], types: images[i].types }),
          );
          uploaded++;
        }

        if (plan.moves.length) {
          // Releer: al subir con roles, Magento se los quitó a otras imágenes.
          const fresh = new Map((await withRetry(() => api.getMedia(sku))).map((e) => [e.id, e]));
          for (const mv of plan.moves) {
            const e = fresh.get(mv.id);
            if (!e) continue;
            await withRetry(() =>
              api.updateMedia(sku, { id: e.id, label: e.label, disabled: e.disabled, types: e.types, position: mv.position }),
            );
            moved++;
          }
        }
        step({ sku, action: "anexar", status: "ok", message: `${uploaded} imagen(es) anexadas, ${moved} movidas` });
      } catch (e) {
        const partial = uploaded || moved ? ` (hecho: ${uploaded} anexadas, ${moved} movidas)` : "";
        step({ sku, action: "anexar", status: "error", message: msg(e) + partial });
      }
    },
    cb.signal,
  );
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
  const rows = [["sku", "accion", "archivo", "estado", "mensaje"], ...lines.map((l) => [l.sku, l.action, l.fileName, l.status, l.message])];
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

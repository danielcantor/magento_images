"use client";
import { getSupabase } from "./supabaseBrowser";
import type { LogLine, Progress } from "./bulk";

/** Guarda el resumen de un lote en Supabase (si está configurado). Nunca lanza. */
export async function saveJobLog(kind: string, progress: Progress, lines: LogLine[]) {
  const sb = getSupabase();
  if (!sb) return;
  try {
    await sb.from("job_logs").insert({
      kind,
      total: progress.total,
      ok: progress.ok,
      failed: progress.failed,
      errors: lines.filter((l) => l.status === "error").slice(0, 500),
    });
  } catch (e) {
    console.warn("No se pudo guardar el historial", e);
  }
}

"use client";
import { useCallback, useRef, useState } from "react";
import { auditFinish, auditStart } from "@/lib/api";
import type { JobCallbacks, LogLine, Progress } from "@/lib/bulk";
import type { AuditKind, AuditStatus } from "@/lib/auditKinds";

export interface JobMeta {
  params?: Record<string, unknown>;
  skus?: string[];
}

/**
 * Estado de un trabajo masivo: progreso, log, cancelación, aviso al cerrar la
 * pestaña y registro de la acción (se abre al empezar y se cierra al terminar).
 */
export function useJob() {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [running, setRunning] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);

  const start = useCallback(async (kind: AuditKind, fn: (cb: JobCallbacks) => Promise<void>, meta: JobMeta = {}) => {
    const controller = new AbortController();
    ctrl.current = controller;
    const collected: LogLine[] = [];
    let last: Progress = { done: 0, total: 0, ok: 0, failed: 0 };
    setLines([]);
    setCancelled(false);
    setRunning(true);
    const beforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", beforeUnload);
    const auditId = await auditStart(kind, { params: meta.params, skus: meta.skus, total: meta.skus?.length });
    let crashed = false;
    let closed = false;
    // Si la pestaña se cierra o recarga a mitad de camino, el registro se cierra como «detenido»
    // con lo hecho hasta ahí (auditFinish usa keepalive para que el envío sobreviva al cierre).
    const pageHide = () => {
      if (closed) return;
      closed = true;
      const note: LogLine = { sku: "—", action: "detenido", status: "ok", message: "Se cerró o recargó la pestaña antes de terminar. Lo ya encolado se procesará igualmente en Magento." };
      void auditFinish(auditId, { status: "detenido", ok: last.ok, failed: last.failed, total: last.total, lines: [...collected, note] });
    };
    window.addEventListener("pagehide", pageHide);
    try {
      await fn({
        signal: controller.signal,
        onLog: (l) => {
          collected.push(l);
          setLines((prev) => [...prev, l]);
        },
        onProgress: (p) => {
          last = p;
          setProgress(p);
        },
        onPhase: setPhase,
      });
    } catch (e) {
      crashed = true;
      collected.push({ sku: "—", action: "error", status: "error", message: e instanceof Error ? e.message : String(e) });
      throw e;
    } finally {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("pagehide", pageHide);
      setRunning(false);
      setPhase(null);
      setCancelled(controller.signal.aborted);
      const status: AuditStatus = crashed
        ? "error"
        : controller.signal.aborted
          ? "detenido"
          : // Una línea con error que no cuenta como paso (p. ej. «tiendas») también es un error.
            last.failed > 0 || collected.some((l) => l.status === "error")
            ? "con-errores"
            : "completo";
      if (!closed) {
        closed = true;
        void auditFinish(auditId, { status, ok: last.ok, failed: last.failed, total: last.total, lines: collected });
      }
    }
  }, []);

  const cancel = useCallback(() => ctrl.current?.abort(), []);
  const reset = useCallback(() => {
    setProgress(null);
    setLines([]);
  }, []);

  return { progress, lines, running, cancelled, phase, start, cancel, reset };
}

"use client";
import { useCallback, useRef, useState } from "react";
import type { JobCallbacks, LogLine, Progress } from "@/lib/bulk";
import { saveJobLog } from "@/lib/history";

/** Estado de un trabajo masivo: progreso, log, cancelación y aviso al cerrar la pestaña. */
export function useJob() {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [running, setRunning] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);

  const start = useCallback(async (kind: string, fn: (cb: JobCallbacks) => Promise<void>) => {
    const controller = new AbortController();
    ctrl.current = controller;
    const collected: LogLine[] = [];
    let last: Progress = { done: 0, total: 0, ok: 0, failed: 0 };
    setLines([]);
    setCancelled(false);
    setRunning(true);
    const beforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", beforeUnload);
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
    } finally {
      window.removeEventListener("beforeunload", beforeUnload);
      setRunning(false);
      setPhase(null);
      setCancelled(controller.signal.aborted);
      void saveJobLog(kind, last, collected);
    }
  }, []);

  const cancel = useCallback(() => ctrl.current?.abort(), []);
  const reset = useCallback(() => {
    setProgress(null);
    setLines([]);
  }, []);

  return { progress, lines, running, cancelled, phase, start, cancel, reset };
}

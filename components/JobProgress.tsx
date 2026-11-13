"use client";
import { useState } from "react";
import { downloadText, logsToCsv, type LogLine, type Progress } from "@/lib/bulk";

interface Props {
  title: string;
  progress: Progress | null;
  lines: LogLine[];
  running: boolean;
  cancelled: boolean;
  onCancel: () => void;
}

export default function JobProgress({ title, progress, lines, running, cancelled, onCancel }: Props) {
  const [onlyErrors, setOnlyErrors] = useState(false);
  if (!progress) return null;
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 100;
  const shown = onlyErrors ? lines.filter((l) => l.status === "error") : lines;
  const pending = progress.total - progress.done;

  return (
    <div className="card stack">
      <div className="row">
        <h2 style={{ margin: 0 }}>{title}</h2>
        <span className="spacer" />
        {running ? (
          <button className="danger" onClick={onCancel}>
            Detener
          </button>
        ) : (
          <button onClick={() => downloadText(`resultado-${Date.now()}.csv`, logsToCsv(lines))} disabled={!lines.length}>
            Descargar CSV
          </button>
        )}
      </div>
      <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div style={{ width: `${pct}%` }} />
      </div>
      <div className="row small">
        <span>
          {progress.done} / {progress.total} ({pct}%)
        </span>
        <span className="badge ok">{progress.ok} correctas</span>
        <span className={`badge ${progress.failed ? "err" : ""}`}>{progress.failed} errores</span>
        {!running && cancelled && pending > 0 && <span className="badge warn">{pending} sin procesar (detenido)</span>}
        {running && <span className="muted">No cierres esta pestaña hasta que termine.</span>}
        <span className="spacer" />
        <label className="check">
          <input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} /> Solo errores
        </label>
      </div>
      {shown.length > 0 && (
        <div className="log">
          {shown.map((l, i) => (
            <div key={i}>
              <span className={`badge ${l.status === "ok" ? "ok" : "err"}`}>{l.status === "ok" ? "OK" : "ERROR"}</span>{" "}
              <b>{l.sku}</b> · {l.action}
              {l.fileName && <> · {l.fileName}</>}
              {l.message && <span className="muted"> — {l.message}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

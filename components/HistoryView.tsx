"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { AUDIT_KINDS, AUDIT_STATUS_LABELS, type AuditRecord, type AuditStatus, type AuditSummary } from "@/lib/auditKinds";
import { downloadText, logsToCsv } from "@/lib/bulk";

const statusClass: Record<AuditStatus, string> = {
  "en-curso": "",
  completo: "ok",
  "con-errores": "warn",
  detenido: "warn",
  error: "err",
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

function duration(a: AuditSummary) {
  if (!a.finishedAt) return "—";
  const s = Math.max(0, Math.round((Date.parse(a.finishedAt) - Date.parse(a.startedAt)) / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

function skusLabel(a: AuditSummary) {
  if (!a.skus.length) return "—";
  const shown = a.skus.slice(0, 3).join(", ");
  return a.skus.length > 3 ? `${shown} y ${a.skus.length - 3} más` : shown;
}

export default function HistoryView() {
  const [items, setItems] = useState<AuditSummary[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [kind, setKind] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<AuditRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState<string | null>(null);

  const load = useCallback(async (reset: boolean, c?: string) => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.auditList({ cursor: reset ? undefined : c, kind: kind || undefined });
      if (!r.enabled) setError("El registro de acciones no está configurado en este entorno.");
      setItems((prev) => (reset ? r.items : [...prev, ...r.items]));
      setCursor(r.cursor);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [kind]);

  useEffect(() => {
    void load(true);
  }, [load]);

  async function open(id: string) {
    setDetailLoading(id);
    try {
      setDetail(await api.auditGet(id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDetailLoading(null);
    }
  }

  return (
    <div className="stack">
      <h1 style={{ margin: 0 }}>Historial</h1>
      <div className="row filters">
        <p className="muted grow" style={{ margin: 0 }}>
          Tus acciones en el dashboard, la más reciente primero. Hacé clic en una fila para ver el detalle.
        </p>
        <label>
          Acción{" "}
          <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Filtrar por acción">
            <option value="">Todas</option>
            {Object.entries(AUDIT_KINDS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button onClick={() => void load(true)} disabled={loading}>
          Actualizar
        </button>
      </div>

      {error && <div className="alert">{error}</div>}

      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Acción</th>
                <th>Productos</th>
                <th>Resultado</th>
                <th>Duración</th>
              </tr>
            </thead>
            <tbody aria-busy={loading}>
              {loading && items.length === 0 &&
                Array.from({ length: 6 }, (_, i) => (
                  <tr key={i} className="skeleton-row" aria-hidden="true">
                    <td><span className="skeleton sk-line" style={{ width: 110 }} /></td>
                    <td><span className="skeleton sk-line" style={{ width: 150 }} /></td>
                    <td><span className="skeleton sk-line" style={{ width: `${40 + ((i * 13) % 40)}%` }} /></td>
                    <td><span className="skeleton sk-pill" style={{ width: 120 }} /></td>
                    <td><span className="skeleton sk-line" style={{ width: 50 }} /></td>
                  </tr>
                ))}
              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    Todavía no hay acciones registradas{kind ? " de este tipo" : ""}.
                  </td>
                </tr>
              )}
              {items.map((a) => (
                <tr
                  key={a.id}
                  className="clickable"
                  tabIndex={0}
                  onClick={() => void open(a.id)}
                  onKeyDown={(e) => e.key === "Enter" && void open(a.id)}
                  style={{ opacity: detailLoading === a.id ? 0.6 : 1 }}
                >
                  <td className="small" style={{ whiteSpace: "nowrap" }}>{fmtDate(a.startedAt)}</td>
                  <td>{AUDIT_KINDS[a.kind] ?? a.kind}</td>
                  <td className="small">{skusLabel(a)}</td>
                  <td>
                    <span className={`badge ${statusClass[a.status]}`}>{AUDIT_STATUS_LABELS[a.status]}</span>{" "}
                    {a.status !== "en-curso" && (
                      <span className="muted small">
                        {a.ok} ok{a.failed ? ` · ${a.failed} con error` : ""}
                      </span>
                    )}
                  </td>
                  <td className="small">{duration(a)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {cursor && (
        <div className="row">
          <span className="spacer" />
          <button onClick={() => void load(false, cursor)} disabled={loading}>
            {loading ? "Cargando…" : "Cargar más"}
          </button>
          <span className="spacer" />
        </div>
      )}

      {detail && <AuditDetail record={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function AuditDetail({ record: r, onClose }: { record: AuditRecord; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const params = Object.entries(r.params);
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Detalle de la acción">
        <header>
          <div style={{ minWidth: 0 }}>
            <div>{AUDIT_KINDS[r.kind] ?? r.kind}</div>
            <div className="muted small">
              {fmtDate(r.startedAt)} · {r.user} · {r.env}
            </div>
          </div>
          <span className="spacer" />
          <button onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </header>
        <div className="body stack">
          <div className="row">
            <span className={`badge ${statusClass[r.status]}`}>{AUDIT_STATUS_LABELS[r.status]}</span>
            <span className="badge ok">{r.ok} correctas</span>
            <span className={`badge ${r.failed ? "err" : ""}`}>{r.failed} con error</span>
            <span className="muted small">
              de {r.total} · duración {duration(r)}
            </span>
            <span className="spacer" />
            <button onClick={() => downloadText(`accion-${r.startedAt.slice(0, 10)}-${r.kind}.csv`, logsToCsv(r.lines))} disabled={!r.lines.length}>
              Descargar CSV
            </button>
          </div>
          {r.status === "en-curso" && (
            <div className="alert info small">
              Esta acción no se cerró: sigue en curso o la pestaña se cerró antes de terminar. Revisá los productos o Bulk Actions en Magento.
            </div>
          )}
          {params.length > 0 && (
            <div className="card">
              <h2>Parámetros</h2>
              <table>
                <tbody>
                  {params.map(([k, v]) => (
                    <tr key={k}>
                      <td className="muted small" style={{ width: 180 }}>{k}</td>
                      <td className="small">{v === true ? "sí" : v === false ? "no" : String(v ?? "—")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {r.skus.length > 0 && (
            <div className="card">
              <h2>Productos ({r.skus.length})</h2>
              <p className="small" style={{ margin: 0, wordBreak: "break-word" }}>{r.skus.join(", ")}</p>
            </div>
          )}
          <div className="card">
            <h2>Detalle ({r.lines.length}{r.truncated ? "+, recortado" : ""})</h2>
            {r.lines.length === 0 ? (
              <p className="muted small" style={{ margin: 0 }}>Sin líneas.</p>
            ) : (
              <div className="log">
                {r.lines.map((l, i) => (
                  <div key={i}>
                    <span className={`badge ${l.status === "ok" ? "ok" : "err"}`}>{l.status === "ok" ? "OK" : "ERROR"}</span> <b>{l.sku}</b> · {l.action}
                    {l.fileName && <> · {l.fileName}</>}
                    {l.bulk && <span className="muted"> · bulk {l.bulk.slice(0, 8)}</span>}
                    {l.message && <span className="muted"> — {l.message}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

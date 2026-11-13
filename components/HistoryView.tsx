"use client";
import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabaseBrowser";
import { downloadText, logsToCsv, type LogLine } from "@/lib/bulk";

interface Row {
  id: string;
  created_at: string;
  user_email: string | null;
  kind: string;
  total: number;
  ok: number;
  failed: number;
  errors: LogLine[];
}

export default function HistoryView() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return setError("Supabase no está configurado.");
    sb.from("job_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100)
      .then(({ data, error }) => (error ? setError(error.message) : setRows(data as Row[])));
  }, []);

  return (
    <div className="stack">
      <h1>Historial de lotes</h1>
      {error && <div className="alert">{error}</div>}
      {!rows && !error && <p className="muted">Cargando…</p>}
      {rows && (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Usuario</th>
                  <th>Tipo</th>
                  <th>Resultado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">
                      Todavía no hay lotes.
                    </td>
                  </tr>
                )}
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{new Date(r.created_at).toLocaleString("es")}</td>
                    <td>{r.user_email ?? "—"}</td>
                    <td>{r.kind}</td>
                    <td>
                      <span className="badge ok">{r.ok} ok</span>{" "}
                      <span className={`badge ${r.failed ? "err" : ""}`}>{r.failed} errores</span>{" "}
                      <span className="muted small">de {r.total}</span>
                    </td>
                    <td>
                      {r.errors?.length > 0 && (
                        <button className="link small" onClick={() => downloadText(`errores-${r.id}.csv`, logsToCsv(r.errors))}>
                          Errores (CSV)
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

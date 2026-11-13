"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SHARED_SKUS_KEY } from "@/lib/skuList";
import { api } from "@/lib/api";
import { runBulkDelete } from "@/lib/bulk";
import type { ProductRow } from "@/lib/types";
import MediaEditor from "./MediaEditor";
import JobProgress from "./JobProgress";
import { useJob } from "./useJob";

const PAGE_SIZE = 25;

export default function ProductsView() {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const job = useJob();
  const router = useRouter();

  function attachToSelected() {
    try {
      sessionStorage.setItem(SHARED_SKUS_KEY, JSON.stringify([...selected]));
    } catch {
      /* sessionStorage no disponible */
    }
    router.push("/shared");
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.searchProducts(query, page, PAGE_SIZE);
      setRows(r.items);
      setTotal(r.total);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [query, page]);

  useEffect(() => {
    void load();
  }, [load]);

  // Búsqueda con pequeña espera mientras se escribe.
  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      setQuery(q.trim());
    }, 350);
    return () => clearTimeout(t);
  }, [q]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.sku));

  const toggle = (sku: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(sku)) n.delete(sku);
      else n.add(sku);
      return n;
    });

  const togglePage = () =>
    setSelected((s) => {
      const n = new Set(s);
      rows.forEach((r) => (allOnPage ? n.delete(r.sku) : n.add(r.sku)));
      return n;
    });

  async function bulkDelete(onlyWithoutRoles: boolean) {
    const skus = [...selected];
    const what = onlyWithoutRoles ? "las imágenes SIN rol (ni base, ni small, ni thumbnail)" : "TODAS las imágenes";
    if (!confirm(`Vas a borrar ${what} de ${skus.length} producto(s). Esta acción no se puede deshacer. ¿Continuar?`)) return;
    await job.start(onlyWithoutRoles ? "borrar-sin-rol" : "borrar-todas", (cb) =>
      runBulkDelete(skus, { onlyWithoutRoles }, cb),
    );
    setSelected(new Set());
    void load();
  }

  return (
    <div className="stack">
      <div className="row">
        <h1 style={{ margin: 0 }}>Productos</h1>
        <span className="spacer" />
        <input
          type="search"
          placeholder="Buscar por SKU o nombre…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ width: "min(320px, 100%)" }}
          aria-label="Buscar productos"
        />
      </div>

      <JobProgress
        title="Borrado masivo"
        progress={job.progress}
        lines={job.lines}
        running={job.running}
        cancelled={job.cancelled}
        onCancel={job.cancel}
      />

      {error && <div className="alert">{error}</div>}

      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input type="checkbox" checked={allOnPage} onChange={togglePage} aria-label="Seleccionar página" />
                </th>
                <th style={{ width: 64 }}>Imagen</th>
                <th>SKU</th>
                <th>Nombre</th>
                <th>Imágenes</th>
                <th style={{ width: 90 }}></th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    Cargando…
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    No hay productos{query ? ` que coincidan con “${query}”` : ""}.
                  </td>
                </tr>
              )}
              {rows.map((r) => {
                const base = r.media.find((m) => m.types.includes("image")) ?? r.media[0];
                const noBase = r.media.length > 0 && !r.media.some((m) => m.types.includes("image"));
                return (
                  <tr key={r.sku} style={{ opacity: loading ? 0.6 : 1 }}>
                    <td>
                      <input type="checkbox" checked={selected.has(r.sku)} onChange={() => toggle(r.sku)} aria-label={`Seleccionar ${r.sku}`} />
                    </td>
                    <td>
                      {base ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img className="thumb" src={base.url} alt="" loading="lazy" />
                      ) : (
                        <div className="thumb empty">—</div>
                      )}
                    </td>
                    <td>
                      <code>{r.sku}</code>
                    </td>
                    <td>{r.name}</td>
                    <td>
                      <span className={`badge ${r.media.length ? "" : "warn"}`}>{r.media.length}</span>{" "}
                      {noBase && <span className="badge warn">sin base</span>}
                    </td>
                    <td>
                      <button onClick={() => setEditing(r)}>Editar</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="row">
        <span className="muted small">{total.toLocaleString("es")} productos</span>
        <span className="spacer" />
        <button onClick={() => setPage((p) => p - 1)} disabled={page <= 1 || loading}>
          ← Anterior
        </button>
        <span className="small">
          Página {page} de {pages}
        </span>
        <button onClick={() => setPage((p) => p + 1)} disabled={page >= pages || loading}>
          Siguiente →
        </button>
      </div>

      {selected.size > 0 && (
        <div className="bulkbar">
          <b>{selected.size} seleccionado(s)</b>
          <button onClick={() => setSelected(new Set())} disabled={job.running}>
            Quitar selección
          </button>
          <span className="spacer" />
          <button onClick={attachToSelected} disabled={job.running}>
            Anexar imagen…
          </button>
          <button onClick={() => bulkDelete(true)} disabled={job.running}>
            Borrar imágenes sin rol
          </button>
          <button onClick={() => bulkDelete(false)} disabled={job.running}>
            Borrar todas las imágenes
          </button>
        </div>
      )}

      {editing && (
        <MediaEditor sku={editing.sku} name={editing.name} onClose={() => setEditing(null)} onChanged={() => void load()} />
      )}
    </div>
  );
}

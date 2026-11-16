"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SHARED_SKUS_KEY } from "@/lib/skuList";
import { api } from "@/lib/api";
import { runBulkDelete, runStoreSync } from "@/lib/bulk";
import { PAGE_SIZES, type ProductRow, type Website } from "@/lib/types";
import MediaEditor from "./MediaEditor";
import { SkeletonRows } from "./Skeleton";
import JobProgress from "./JobProgress";
import { useJob } from "./useJob";

const SIZE_KEY = "products-page-size";

interface Filters {
  status: "" | "1" | "2";
  /** "" | "w:<websiteId>" | "s:<storeId>" */
  place: string;
  size: number;
}

function readInitialFilters(): Filters {
  const f: Filters = { status: "", place: "", size: 25 };
  try {
    const saved = Number(localStorage.getItem(SIZE_KEY));
    if ((PAGE_SIZES as readonly number[]).includes(saved)) f.size = saved;
  } catch {
    /* localStorage no disponible */
  }
  if (typeof window === "undefined") return f;
  const sp = new URLSearchParams(window.location.search);
  const st = sp.get("status");
  if (st === "1" || st === "2") f.status = st;
  if (sp.get("website")) f.place = `w:${sp.get("website")}`;
  if (sp.get("store")) f.place = `s:${sp.get("store")}`;
  const size = Number(sp.get("size"));
  if ((PAGE_SIZES as readonly number[]).includes(size)) f.size = size;
  return f;
}

export default function ProductsView({ syncStoresEnabled = false }: { syncStoresEnabled?: boolean }) {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<Filters | null>(null);
  const [websites, setWebsites] = useState<Website[]>([]);
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  /** Búsqueda/filtros/página de los datos que se muestran (para saber si es recarga de fondo). */
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const job = useJob();
  const router = useRouter();

  // Filtros iniciales desde la URL (solo en el navegador) y lista de sitios.
  useEffect(() => {
    setFilters(readInitialFilters());
    api.websites().then(setWebsites).catch(() => setWebsites([]));
  }, []);

  function updateFilters(change: Partial<Filters>) {
    setFilters((f) => {
      const next = { ...(f ?? readInitialFilters()), ...change };
      try {
        localStorage.setItem(SIZE_KEY, String(next.size));
      } catch {
        /* sin localStorage */
      }
      const sp = new URLSearchParams();
      if (next.status) sp.set("status", next.status);
      if (next.place.startsWith("w:")) sp.set("website", next.place.slice(2));
      if (next.place.startsWith("s:")) sp.set("store", next.place.slice(2));
      if (next.size !== 25) sp.set("size", String(next.size));
      window.history.replaceState(null, "", sp.size ? `?${sp}` : window.location.pathname);
      return next;
    });
    setPage(1);
  }

  function attachToSelected() {
    try {
      sessionStorage.setItem(SHARED_SKUS_KEY, JSON.stringify([...selected]));
    } catch {
      /* sessionStorage no disponible */
    }
    router.push("/shared");
  }

  const load = useCallback(async () => {
    if (!filters) return;
    const key = JSON.stringify([query, page, filters]);
    setLoading(true);
    setError(null);
    try {
      const r = await api.searchProducts({
        q: query,
        page,
        pageSize: filters.size,
        status: filters.status,
        website: filters.place.startsWith("w:") ? filters.place.slice(2) : undefined,
        store: filters.place.startsWith("s:") ? filters.place.slice(2) : undefined,
      });
      setRows(r.items);
      setTotal(r.total);
      setLoadedKey(key);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [query, page, filters]);

  useEffect(() => {
    void load();
  }, [load]);

  // Búsqueda con pequeña espera mientras se escribe.
  useEffect(() => {
    const t = setTimeout(() => {
      const v = q.trim();
      if (v !== query) {
        setQuery(v);
        setPage(1);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [q, query]);

  const pageSize = filters?.size ?? 25;
  // Skeleton al entrar o al cambiar búsqueda/filtros/página; en recargas de fondo solo se atenúa.
  const showSkeleton = !filters || (loading && loadedKey !== JSON.stringify([query, page, filters]));
  const refreshing = loading && !showSkeleton;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const websiteName = (id: number) => websites.find((w) => w.id === id)?.name ?? `#${id}`;
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
      runBulkDelete(skus, { onlyWithoutRoles, syncStores: syncStoresEnabled }, cb),
    );
    setSelected(new Set());
    void load();
  }

  async function bulkSyncStores() {
    const skus = [...selected];
    if (!confirm(`Se copiarán los roles, alt, posición y «ocultar» generales en todas las tiendas de ${skus.length} producto(s). ¿Continuar?`)) return;
    await job.start("igualar-tiendas", (cb) => runStoreSync(skus, cb));
    setSelected(new Set());
    void load();
  }

  return (
    <div className="stack">
      <h1 style={{ margin: 0 }}>Productos</h1>
      <div className="row filters">
        <input
          type="search"
          placeholder="Buscar por SKU o nombre…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Buscar productos"
          className="grow"
        />
        <label>
          Estado{" "}
          <select
            value={filters?.status ?? ""}
            onChange={(e) => updateFilters({ status: e.target.value as Filters["status"] })}
            aria-label="Filtrar por estado"
          >
            <option value="">Todos</option>
            <option value="1">Activos</option>
            <option value="2">Inactivos</option>
          </select>
        </label>
        <label>
          Sitio / tienda{" "}
          <select value={filters?.place ?? ""} onChange={(e) => updateFilters({ place: e.target.value })} aria-label="Filtrar por sitio o tienda">
            <option value="">Todos</option>
            {websites.map((w) => (
              <optgroup key={w.id} label={w.name}>
                <option value={`w:${w.id}`}>Todo «{w.name}»</option>
                {w.stores.map((st) => (
                  <option key={st.id} value={`s:${st.id}`}>
                    {st.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label>
          Por página{" "}
          <select value={pageSize} onChange={(e) => updateFilters({ size: Number(e.target.value) })} aria-label="Productos por página">
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>

      <JobProgress
        title="Acción masiva"
        progress={job.progress}
        lines={job.lines}
        running={job.running}
        cancelled={job.cancelled}
        onCancel={job.cancel}
        phase={job.phase}
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
                <th>Estado</th>
                <th>Sitios</th>
                <th>Imágenes</th>
              </tr>
            </thead>
            <tbody className={refreshing ? "is-refreshing" : undefined} aria-busy={loading}>
              {showSkeleton && <SkeletonRows count={Math.min(pageSize, 10)} />}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    No hay productos{query ? ` que coincidan con “${query}”` : ""}.
                  </td>
                </tr>
              )}
              {!showSkeleton && rows.map((r) => {
                const base = r.media.find((m) => m.types.includes("image")) ?? r.media[0];
                const noBase = r.media.length > 0 && !r.media.some((m) => m.types.includes("image"));
                return (
                  <tr
                    key={r.sku}
                    className="clickable"
                    onClick={() => setEditing(r)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && e.target === e.currentTarget) setEditing(r);
                    }}
                    tabIndex={0}
                    title="Abrir imágenes"
                  >
                    <td onClick={(e) => e.stopPropagation()}>
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
                      {r.status === 1 ? <span className="badge ok">Activo</span> : <span className="badge">Inactivo</span>}
                    </td>
                    <td className="small">{r.websiteIds.length ? r.websiteIds.map(websiteName).join(", ") : <span className="muted">—</span>}</td>
                    <td>
                      <span className={`badge ${r.media.length ? "" : "warn"}`}>{r.media.length}</span>{" "}
                      {noBase && <span className="badge warn">sin base</span>}
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
          <button className="accent" onClick={attachToSelected} disabled={job.running}>
            Anexar imagen…
          </button>
          {syncStoresEnabled && (
            <button onClick={bulkSyncStores} disabled={job.running} title="Copia los valores generales de las imágenes en cada store view">
              Igualar tiendas
            </button>
          )}
          <button onClick={() => bulkDelete(true)} disabled={job.running}>
            Borrar imágenes sin rol
          </button>
          <button onClick={() => bulkDelete(false)} disabled={job.running}>
            Borrar todas las imágenes
          </button>
        </div>
      )}

      {editing && (
        <MediaEditor
          sku={editing.sku}
          name={editing.name}
          expectedCount={editing.media.length}
          syncStoresEnabled={syncStoresEnabled}
          onClose={() => setEditing(null)}
          onChanged={() => void load()}
        />
      )}
    </div>
  );
}

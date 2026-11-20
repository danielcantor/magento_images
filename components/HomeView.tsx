"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { AUDIT_KINDS, AUDIT_STATUS_LABELS, type AuditStatus, type AuditSummary } from "@/lib/auditKinds";
import type { WidgetStatus, WidgetsStatusResponse } from "@/lib/stockVisibility";

const VIS: Record<NonNullable<WidgetStatus["visibility"]>, { label: string; cls: string }> = {
  visible: { label: "En la tienda", cls: "ok" },
  umbral: { label: "Oculto por umbral", cls: "" },
  agotado: { label: "Agotado", cls: "err" },
};

const STATUS_CLS: Record<AuditStatus, string> = { completo: "ok", "con-errores": "warn", detenido: "warn", error: "err", "en-curso": "" };

const IMAGE_TOOLS = [
  { href: "/products", title: "Productos", text: "Buscar por SKU o nombre y editar la galería: orden, roles, texto alternativo, reemplazar o borrar." },
  { href: "/products?img=nobase", title: "Sin imagen base", text: "Productos a los que les falta la imagen principal." },
  { href: "/bulk", title: "Subida masiva", text: "Cientos de archivos con nombre SKU.jpg, SKU_2.jpg… Añadir o reemplazar la galería." },
  { href: "/shared", title: "Imagen a varios SKU", text: "La misma imagen en una lista de productos, en la posición que elijas." },
];

const fmtDate = (iso: string) => new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Urgentes primero: agotados, luego los que se ven (menos unidades arriba), luego ocultos por umbral; errores al final. */
function rank(w: WidgetStatus): number {
  if (w.quedan === null) return 3;
  return w.visibility === "agotado" ? 0 : w.visibility === "visible" ? 1 : 2;
}

export default function HomeView({ username, auditEnabled }: { username: string | null; auditEnabled: boolean }) {
  const [status, setStatus] = useState<WidgetsStatusResponse | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [recent, setRecent] = useState<AuditSummary[] | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setStatusError(null);
    api
      .stockWidgetsStatus()
      .then((r) => {
        setStatus(r);
        setCheckedAt(new Date());
      })
      .catch((e) => setStatusError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  // El historial se lee solo al abrir la sección: listar Blob consume operaciones avanzadas
  // (cupo chico) y el inicio se abre muchas veces.
  const [recentError, setRecentError] = useState<string | null>(null);
  function loadRecent() {
    if (recent !== null) return;
    api
      .auditList()
      .then((r) => setRecent(r.items.slice(0, 5)))
      .catch((e) => {
        setRecentError((e as Error).message);
        setRecent([]);
      });
  }

  const active = [...(status?.active ?? [])].sort((a, b) => rank(a) - rank(b) || (a.quedan ?? 0) - (b.quedan ?? 0));
  const count = (v: WidgetStatus["visibility"]) => active.filter((w) => w.visibility === v).length;
  const failed = active.filter((w) => w.quedan === null).length;

  return (
    <div className="stack home">
      <div className="row">
        <h1 style={{ margin: 0 }}>Inicio</h1>
        <span className="spacer" />
        {username && <span className="muted">Hola, {username}</span>}
      </div>

      {/* ---------------- Contadores ---------------- */}
      <section className="card stack" aria-labelledby="h-contadores">
        <div className="row">
          <h2 id="h-contadores" style={{ margin: 0 }}>
            Contadores de stock
          </h2>
          <span className="spacer" />
          {checkedAt && !loading && <span className="muted small">Actualizado {checkedAt.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}</span>}
          <button onClick={load} disabled={loading}>
            {loading ? "Consultando…" : "Actualizar"}
          </button>
          <Link className="btn" href="/stock">
            Gestionar
          </Link>
        </div>

        {statusError && <div className="alert">{statusError}</div>}
        {status && !status.enabled && (
          <div className="alert info">Para guardar contadores hace falta MAGENTO_BASE_URL en este entorno.</div>
        )}

        <div className="kpis" aria-busy={loading}>
          <Kpi label="Activos" value={status ? active.length : null} />
          <Kpi label="En la tienda" value={status ? count("visible") : null} tone="ok" />
          <Kpi label="Agotados" value={status ? count("agotado") : null} tone={count("agotado") ? "err" : undefined} />
          <Kpi label="Ocultos por umbral" value={status ? count("umbral") : null} />
          <Kpi label="Apagados" value={status ? status.paused.length : null} muted />
        </div>

        {status?.storeToken && (
          <div className={status.storeToken.ok ? "token-line ok" : "alert"}>
            {status.storeToken.ok ? (
              <>
                <span className="dot" aria-hidden="true" />
                <span>
                  La tienda puede consultar los contadores: <code>MAGENTO_TOKEN</code> responde.
                </span>
              </>
            ) : (
              <>
                <b>La tienda no puede mostrar los contadores.</b> {status.storeToken.message} Revisá el token de la integración y sus permisos.
              </>
            )}
          </div>
        )}
        {failed > 0 && (
          <div className="alert">
            No se pudo consultar {failed === 1 ? "1 contador" : `${failed} contadores`} en Magento. Mirá el detalle abajo.
          </div>
        )}

        {loading && !status ? (
          <div className="muted">Consultando unidades en Magento…</div>
        ) : status?.enabled && !active.length ? (
          <div className="empty">
            No hay contadores activos{status.paused.length ? ` (${status.paused.length} apagado${status.paused.length === 1 ? "" : "s"})` : ""}.{" "}
            <Link href="/stock">Crear uno</Link>
          </div>
        ) : (
          active.length > 0 && (
            <ul className="counter-list">
              {active.map((w) => (
                <CounterRow key={w.sku} w={w} />
              ))}
            </ul>
          )
        )}

        {status && status.paused.length > 0 && active.length > 0 && (
          <details className="small">
            <summary className="muted">
              {status.paused.length} apagado{status.paused.length === 1 ? "" : "s"}
            </summary>
            <div className="row" style={{ marginTop: 8 }}>
              {status.paused.map((p) => (
                <Link key={p.sku} className="chip" href={`/stock?sku=${encodeURIComponent(p.sku)}`}>
                  {p.sku}
                </Link>
              ))}
            </div>
          </details>
        )}
      </section>

      {/* ---------------- Imágenes ---------------- */}
      <section aria-labelledby="h-imagenes" className="stack" style={{ gap: 12 }}>
        <h2 id="h-imagenes" style={{ margin: 0 }}>
          Imágenes de productos
        </h2>
        <div className="tools">
          {IMAGE_TOOLS.map((t) => (
            <Link key={t.href} href={t.href} className="tool card">
              <b>{t.title}</b>
              <span className="muted small">{t.text}</span>
              <span className="go" aria-hidden="true">
                →
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* ---------------- Historial ---------------- */}
      {auditEnabled && (
        <details className="card recent-card" onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && loadRecent()}>
          <summary>
            <h2 id="h-historial">Tus últimas acciones</h2>
          </summary>
          <div className="stack" style={{ marginTop: 12 }}>
            {recent === null ? (
              <div className="muted">Cargando…</div>
            ) : recentError ? (
              <div className="alert">{recentError}</div>
            ) : !recent.length ? (
              <div className="empty">Todavía no hay acciones registradas.</div>
            ) : (
              <ul className="recent">
                {recent.map((a) => (
                  <li key={a.id}>
                    <span className="muted small when">{fmtDate(a.startedAt)}</span>
                    <span className="what">{AUDIT_KINDS[a.kind] ?? a.kind}</span>
                    <span className="muted small">
                      {a.total} {a.total === 1 ? "elemento" : "elementos"}
                      {a.failed ? ` · ${a.failed} con error` : ""}
                    </span>
                    <span className={`badge ${STATUS_CLS[a.status]}`}>{AUDIT_STATUS_LABELS[a.status]}</span>
                  </li>
                ))}
              </ul>
            )}
            <div>
              <Link className="btn" href="/history">
                Ver historial completo
              </Link>
            </div>
          </div>
        </details>
      )}
    </div>
  );
}

function Kpi({ label, value, tone, muted }: { label: string; value: number | null; tone?: "ok" | "err"; muted?: boolean }) {
  return (
    <div className={`kpi${tone ? ` ${tone}` : ""}${muted ? " muted-kpi" : ""}`}>
      <span className="kpi-value">{value ?? "–"}</span>
      <span className="kpi-label">{label}</span>
    </div>
  );
}

function CounterRow({ w }: { w: WidgetStatus }) {
  const vis = w.visibility ? VIS[w.visibility] : null;
  const pct = w.quedan === null ? 0 : Math.max(0, Math.min(100, (w.quedan / Math.max(1, w.initial)) * 100));
  return (
    <li className={`counter${w.visibility === "agotado" ? " out" : ""}`}>
      <div className="counter-main">
        <div className="counter-title">
          <code>{w.sku}</code>
          {w.name && <span className="name">{w.name}</span>}
        </div>
        <div className="row small muted" style={{ gap: 6 }}>
          <span>{w.mode === "orders" ? "Por ventas" : "Por stock del ERP"}</span>
          {w.showAtOrBelow > 0 && <span>· se muestra con {w.showAtOrBelow} o menos</span>}
          {w.coupon && (
            <span>
              · cupón <b>{w.coupon}</b>
            </span>
          )}
        </div>
      </div>
      <div className="counter-meter">
        {w.quedan === null ? (
          <span className="small" style={{ color: "var(--err)" }}>
            {w.error ?? "Sin datos"}
          </span>
        ) : (
          <>
            <div className="small">
              <b className="qty">{w.quedan}</b> <span className="muted">de {w.initial}</span>
            </div>
            <div className="meter" role="img" aria-label={`Quedan ${w.quedan} de ${w.initial}`}>
              <span style={{ width: `${pct}%` }} />
            </div>
          </>
        )}
      </div>
      <div className="counter-state">{vis && <span className={`badge ${vis.cls}`}>{vis.label}</span>}</div>
      <Link className="btn counter-edit" href={`/stock?sku=${encodeURIComponent(w.sku)}`} aria-label={`Editar contador de ${w.sku}`}>
        Editar
      </Link>
    </li>
  );
}

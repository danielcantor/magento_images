"use client";
import { useEffect, useMemo, useState } from "react";
import { api, auditStart, type StockWidgetDto } from "@/lib/api";
import type { AuditLine } from "@/lib/auditKinds";
import { DEFAULT_SALE_STATUSES } from "@/lib/stockDiagnosis";
import CouponFields, { DEFAULT_COUPON_TEXT, confirmCoupon } from "./CouponFields";

const DEFAULT_TEXT = "¡Solo quedan {n} unidades!";

type Mode = "orders" | "sources";
type Row = { sku: string; name?: string; stock: number | null; initial: string; existing: boolean; result?: { ok: boolean; message?: string } };

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Crea (o reemplaza) contadores «Quedan X unidades» para varios productos a la vez.
 * Los ajustes son comunes; las unidades iniciales se eligen por producto.
 */
export default function BulkStockWidgets({ skus, names, onClose }: { skus: string[]; names: Record<string, string>; onClose: () => void }) {
  const [rows, setRows] = useState<Row[]>(skus.map((sku) => ({ sku, name: names[sku], stock: null, initial: "", existing: false })));
  const [sourceCodes, setSourceCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<Mode>("orders");
  const [since, setSince] = useState(() => new Date().toISOString());
  const [statusText, setStatusText] = useState(DEFAULT_SALE_STATUSES.join(", "));
  const [sources, setSources] = useState<string[]>([]);
  const [text, setText] = useState(DEFAULT_TEXT);
  const [showAtOrBelow, setShowAtOrBelow] = useState(0);
  const [enabled, setEnabled] = useState(true);
  const [coupon, setCoupon] = useState({ coupon: "", couponText: DEFAULT_COUPON_TEXT });
  const [replace, setReplace] = useState(false);
  const [all, setAll] = useState("");
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);

  // Stock actual por fuente de cada SKU y contadores que ya existen.
  useEffect(() => {
    let cancelled = false;
    Promise.all([api.stockSources(skus), api.stockWidgets()])
      .then(([src, w]) => {
        if (cancelled) return;
        const existing = new Set(w.widgets.map((x) => x.sku.toLowerCase()));
        const codes = new Set<string>();
        const withUnits = new Set<string>();
        Object.values(src.items).forEach((list) =>
          list.forEach((i) => {
            codes.add(i.sourceCode);
            if (i.inStock && i.quantity > 0) withUnits.add(i.sourceCode);
          }),
        );
        setSourceCodes([...codes].sort());
        setSources([...withUnits].sort());
        setRows((rs) =>
          rs.map((r) => {
            const stock = Math.max(0, Math.floor((src.items[r.sku] ?? []).filter((i) => i.inStock).reduce((a, i) => a + i.quantity, 0)));
            return { ...r, stock, initial: stock > 0 ? String(stock) : "", existing: existing.has(r.sku.toLowerCase()) };
          }),
        );
        if (!w.enabled) setError("Para guardar contadores hace falta Vercel Blob (BLOB_READ_WRITE_TOKEN) en este entorno.");
      })
      .catch((e) => !cancelled && setError((e as Error).message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [skus]);

  const statuses = useMemo(() => statusText.split(",").map((x) => x.trim()).filter(Boolean), [statusText]);
  const valid = (r: Row) => Number.isInteger(Number(r.initial)) && Number(r.initial) > 0;
  const targets = rows.filter((r) => valid(r) && (replace || !r.existing));
  const skippedExisting = rows.filter((r) => r.existing && !replace).length;
  const invalid = rows.filter((r) => !valid(r)).length;
  const textOk = text.includes("{n}");
  const canRun = !loading && !running && !done && targets.length > 0 && textOk && (mode === "sources" || statuses.length > 0) && !error;

  function setInitial(sku: string, v: string) {
    setRows((rs) => rs.map((r) => (r.sku === sku ? { ...r, initial: v.replace(/[^\d]/g, "") } : r)));
  }

  async function create() {
    if (!(await confirmCoupon(coupon.coupon))) return;
    if (replace && targets.some((r) => r.existing) && !confirm(`Se reemplazarán ${targets.filter((r) => r.existing).length} contador(es) existente(s). ¿Continuar?`)) return;
    setRunning(true);
    const lines: AuditLine[] = [];
    for (const r of targets) {
      const w: StockWidgetDto = {
        sku: r.sku,
        mode,
        since: mode === "orders" ? since : null,
        statuses: mode === "orders" ? statuses : [],
        initial: Number(r.initial),
        sources: mode === "sources" ? sources : [],
        text,
        showAtOrBelow,
        coupon: coupon.coupon || null,
        couponText: coupon.couponText,
        enabled,
      };
      try {
        await api.saveStockWidget(w);
        setRows((rs) => rs.map((x) => (x.sku === r.sku ? { ...x, existing: true, result: { ok: true } } : x)));
        lines.push({ sku: r.sku, action: r.existing ? "reemplazado" : "creado", status: "ok", message: `${r.initial} iniciales` });
      } catch (e) {
        const message = (e as Error).message;
        setRows((rs) => rs.map((x) => (x.sku === r.sku ? { ...x, result: { ok: false, message } } : x)));
        lines.push({ sku: r.sku, action: "crear contador", status: "error", message });
      }
    }
    const ok = lines.filter((l) => l.status === "ok").length;
    void auditStart(
      "contadores-crear",
      {
        skus: targets.map((r) => r.sku),
        params: { modo: mode === "orders" ? "ventas" : "stock del ERP", ...(coupon.coupon ? { cupon: coupon.coupon } : {}), ...(mode === "orders" ? { desde: since, estados: statuses.join(", ") } : { fuentes: sources.join(", ") || "todas" }) },
      },
      { status: ok === lines.length ? "completo" : ok ? "con-errores" : "error", ok, failed: lines.length - ok, total: lines.length, lines },
    );
    setRunning(false);
    setDone(true);
  }

  const close = () => {
    if (running) return;
    onClose();
  };

  return (
    <>
      <div className="drawer-backdrop" onClick={close} />
      <aside className="drawer" role="dialog" aria-label="Crear contadores de stock">
        <header>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div>Contadores de stock</div>
            <div className="small muted">{skus.length} producto(s) seleccionado(s)</div>
          </div>
          <button onClick={close} disabled={running} aria-label="Cerrar">
            ✕
          </button>
        </header>

        <div className="body stack">
          {error && <div className="alert">{error}</div>}

          <div className="card stack">
            <h2 style={{ margin: 0 }}>Cómo se calcula «quedan»</h2>
            <div className="row" style={{ gap: 18 }}>
              <label className="check">
                <input type="radio" name="bulk-mode" checked={mode === "orders"} onChange={() => setMode("orders")} disabled={running || done} />
                Según las ventas (iniciales − vendidas)
              </label>
              <label className="check">
                <input type="radio" name="bulk-mode" checked={mode === "sources"} onChange={() => setMode("sources")} disabled={running || done} />
                Según el stock del ERP (fuentes)
              </label>
            </div>
            {mode === "orders" ? (
              <div className="form-grid">
                <label>
                  <span>Contar ventas desde</span>
                  <input type="datetime-local" value={toLocalInput(since)} onChange={(e) => e.target.value && setSince(new Date(e.target.value).toISOString())} disabled={running || done} />
                </label>
                <label>
                  <span>Estados que cuentan como compra</span>
                  <input type="text" value={statusText} onChange={(e) => setStatusText(e.target.value)} disabled={running || done} />
                </label>
              </div>
            ) : (
              <div>
                <span className="small">Fuentes que se suman</span>
                <div className="row" style={{ marginTop: 6 }}>
                  {sourceCodes.length === 0 && <span className="muted small">{loading ? "Cargando fuentes…" : "Los productos no tienen fuentes asignadas."}</span>}
                  {sourceCodes.map((c) => (
                    <label key={c} className="check">
                      <input
                        type="checkbox"
                        checked={sources.includes(c)}
                        onChange={() => setSources((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]))}
                        disabled={running || done}
                      />
                      {c}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="form-grid">
              <label>
                <span>Texto (con {"{n}"} donde va la cantidad)</span>
                <input type="text" value={text} onChange={(e) => setText(e.target.value)} disabled={running || done} aria-invalid={!textOk} />
              </label>
              <label>
                <span>Mostrar con esta cantidad o menos (0 = siempre)</span>
                <input type="number" min={0} value={showAtOrBelow} onChange={(e) => setShowAtOrBelow(Math.max(0, Number(e.target.value) || 0))} disabled={running || done} />
              </label>
            </div>
            {!textOk && <span className="small" style={{ color: "var(--err)" }}>El texto tiene que incluir {"{n}"}.</span>}
            <CouponFields coupon={coupon.coupon} couponText={coupon.couponText} onChange={setCoupon} disabled={running || done} />
            <label className="check">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} disabled={running || done} />
              Activos al crearlos (se muestran en la tienda)
            </label>
          </div>

          <div className="card" style={{ padding: 0 }}>
            <div className="row" style={{ padding: "14px 16px", gap: 12 }}>
              <h2 style={{ margin: 0 }}>Unidades iniciales por producto</h2>
              <span className="spacer" />
              <input
                type="text"
                inputMode="numeric"
                placeholder="Igual para todos"
                value={all}
                onChange={(e) => setAll(e.target.value.replace(/[^\d]/g, ""))}
                style={{ width: 150 }}
                disabled={running || done}
                aria-label="Unidades iniciales para todos"
              />
              <button onClick={() => all && setRows((rs) => rs.map((r) => ({ ...r, initial: all })))} disabled={!all || running || done}>
                Aplicar a todos
              </button>
            </div>
            <div className="table-wrap">
              <table className="bulk-widgets-table">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Stock en fuentes</th>
                    <th>Iniciales</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.sku}>
                      <td>
                        <code>{r.sku}</code>
                        {r.name && <div className="small muted bw-name">{r.name}</div>}
                      </td>
                      <td>{r.stock === null ? <span className="muted">…</span> : r.stock}</td>
                      <td>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={r.initial}
                          onChange={(e) => setInitial(r.sku, e.target.value)}
                          style={{ width: 90 }}
                          disabled={running || done}
                          aria-label={`Unidades iniciales de ${r.sku}`}
                          aria-invalid={!valid(r)}
                        />
                      </td>
                      <td className="small">
                        {r.result ? (
                          r.result.ok ? <span className="badge ok">Guardado</span> : <span className="badge err" title={r.result.message}>Error: {r.result.message}</span>
                        ) : !valid(r) ? (
                          <span className="badge warn">Falta cantidad</span>
                        ) : r.existing ? (
                          replace ? <span className="badge warn">Se reemplaza</span> : <span className="badge">Ya tiene · se salta</span>
                        ) : (
                          <span className="badge">Nuevo</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            Las iniciales se precargan con el stock actual de las fuentes. Los productos sin stock quedan sin cantidad: escribila o no se crea su contador.
          </p>
        </div>

        <footer>
          <label className="check small">
            <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} disabled={running || done} />
            Reemplazar los que ya tienen contador
          </label>
          <span className="spacer" />
          {done ? (
            <button className="primary" onClick={onClose}>
              Listo
            </button>
          ) : (
            <button className="primary" onClick={create} disabled={!canRun}>
              {running ? "Creando…" : `Crear ${targets.length} contador${targets.length === 1 ? "" : "es"}`}
            </button>
          )}
          {!done && (skippedExisting > 0 || invalid > 0) && (
            <span className="small muted bw-skips">
              {[skippedExisting && `${skippedExisting} ya ${skippedExisting === 1 ? "tiene" : "tienen"} contador`, invalid && `${invalid} sin cantidad`].filter(Boolean).join(" · ")}
            </span>
          )}
        </footer>
      </aside>
    </>
  );
}

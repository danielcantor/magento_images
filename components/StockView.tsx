"use client";
import { useCallback, useEffect, useState } from "react";
import { api, type StockWidgetDto } from "@/lib/api";
import CouponFields, { DEFAULT_COUPON_TEXT, confirmCoupon } from "./CouponFields";
import { DEFAULT_SALE_STATUSES, type StockReport, type StockRow } from "@/lib/stockDiagnosis";

const DEFAULT_TEXT = "¡Solo quedan {n} unidades!";

const STATE: Record<StockRow["state"], { label: string; cls: string }> = {
  ok: { label: "OK", cls: "ok" },
  reservations: { label: "Con reservas", cls: "warn" },
  blocked: { label: "Bloqueado", cls: "err" },
  "no-sources": { label: "Sin unidades", cls: "err" },
  unassigned: { label: "No asignado", cls: "" },
};

/** ISO → valor de <input type="datetime-local"> en hora local. */
function toLocalInput(iso: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type SalesPreview = Awaited<ReturnType<typeof api.previewStockSales>>;

interface PublicResult {
  status: number;
  body: { quedan?: number; inicial?: number; texto?: string; visible?: boolean; error?: string };
}

export default function StockView() {
  const [sku, setSku] = useState("");
  const [report, setReport] = useState<StockReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [widgets, setWidgets] = useState<StockWidgetDto[]>([]);
  const [widgetsEnabled, setWidgetsEnabled] = useState(true);
  const [form, setForm] = useState<StockWidgetDto | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [pub, setPub] = useState<PublicResult | null>(null);
  const [origin, setOrigin] = useState("");
  const [allSources, setAllSources] = useState(false);
  const [sales, setSales] = useState<SalesPreview | null>(null);
  const [salesLoading, setSalesLoading] = useState(false);
  const [salesError, setSalesError] = useState<string | null>(null);

  useEffect(() => setOrigin(window.location.origin), []);

  const loadWidgets = useCallback(() => {
    api
      .stockWidgets()
      .then((r) => {
        setWidgetsEnabled(r.enabled);
        setWidgets(r.widgets);
      })
      .catch((e) => setError((e as Error).message));
  }, []);
  useEffect(loadWidgets, [loadWidgets]);

  async function testPublic(s: string) {
    setPub(null);
    try {
      const r = await fetch(`/api/public/stock/${encodeURIComponent(s)}?t=${Date.now()}`, { cache: "no-store" });
      setPub({ status: r.status, body: await r.json().catch(() => ({})) });
    } catch (e) {
      setPub({ status: 0, body: { error: (e as Error).message } });
    }
  }

  async function search(target = sku) {
    const s = target.trim();
    if (!s) return;
    setSku(s);
    setLoading(true);
    setError(null);
    setReport(null);
    setSaveMsg(null);
    setPub(null);
    setSales(null);
    setSalesError(null);
    try {
      const r = await api.stockReport(s);
      setReport(r);
      const existing = widgets.find((w) => w.sku.toLowerCase() === s.toLowerCase());
      const withUnits = r.sources.filter((x) => x.inStock && x.quantity > 0).map((x) => x.sourceCode);
      const units = r.sources.filter((x) => withUnits.includes(x.sourceCode)).reduce((a, x) => a + x.quantity, 0);
      setForm(
        existing ?? { sku: s, mode: "sources", since: null, statuses: DEFAULT_SALE_STATUSES, initial: Math.max(1, Math.floor(units)), sources: withUnits, text: DEFAULT_TEXT, showAtOrBelow: 0, enabled: true },
      );
      if (existing) void testPublic(existing.sku);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    if (!form) return;
    if (!(await confirmCoupon(form.coupon))) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const { widget } = await api.saveStockWidget(form);
      setForm(widget);
      setSaveMsg("Contador guardado.");
      loadWidgets();
      await testPublic(widget.sku);
    } catch (e) {
      setSaveMsg((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function previewSales() {
    if (!form) return;
    setSalesLoading(true);
    setSalesError(null);
    try {
      setSales(await api.previewStockSales(form));
    } catch (e) {
      setSales(null);
      setSalesError((e as Error).message);
    } finally {
      setSalesLoading(false);
    }
  }

  async function remove(s: string) {
    if (!confirm(`¿Quitar el contador de ${s}? Dejará de mostrarse en la tienda.`)) return;
    try {
      await api.deleteStockWidget(s);
      loadWidgets();
      if (form?.sku.toLowerCase() === s.toLowerCase()) setPub(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const globalSnippet = `<script src="${origin}/stock-widget.js" async></script>`;

  const snippet = form
    ? `<div data-stock-urgency data-sku="${form.sku.replace(/"/g, "&quot;")}"${form.coupon ? ' data-cupon="si"' : ""}></div>\n<script src="${origin}/stock-widget.js" async></script>`
    : "";

  const toggleSource = (code: string) =>
    form && setForm({ ...form, sources: form.sources.includes(code) ? form.sources.filter((c) => c !== code) : [...form.sources, code] });

  const sortedSources = report ? [...report.sources].sort((a, b) => b.quantity - a.quantity || a.sourceCode.localeCompare(b.sourceCode)) : [];
  const sourcesWithStock = sortedSources.filter((s) => s.inStock && s.quantity > 0);
  const hiddenSources = form ? sortedSources.filter((s) => !(s.inStock && s.quantity > 0) && !form.sources.includes(s.sourceCode)).length : 0;

  const selectedUnits = report && form ? report.sources.filter((x) => x.inStock && (form.sources.length === 0 || form.sources.includes(x.sourceCode))).reduce((a, x) => a + x.quantity, 0) : 0;

  return (
    <div className="stack">
      <h1>Contadores de stock</h1>

      <div className="card">
        <form
          className="row filters"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <input className="grow" type="search" placeholder="SKU, p. ej. KCOLNEA140PROMO" value={sku} onChange={(e) => setSku(e.target.value)} />
          <button className="primary" disabled={loading || !sku.trim()}>
            {loading ? "Consultando…" : "Revisar stock"}
          </button>
        </form>
        <p className="muted small" style={{ marginBottom: 0 }}>
          Muestra las unidades por fuente (lo que sincroniza el ERP), la cantidad vendible de cada stock y las unidades retenidas por reservas.
        </p>
      </div>

      {error && <div className="alert">{error}</div>}

      {report && (
        <>
          {report.messages.length > 0 ? (
            <div className="alert warn-box" style={{ display: "block" }}>
              <b>Diagnóstico</b>
              <ul style={{ margin: "8px 0 0" }}>
                {report.messages.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="alert info">Sin problemas: la cantidad vendible coincide con las fuentes.</div>
          )}

          {/* Plegada por defecto: un SKU puede tener decenas de fuentes. */}
          <details className="card collapsible">
            <summary>
              <h2>Fuentes</h2>
              <span className="muted small">
                {report.sources.length} fuente{report.sources.length === 1 ? "" : "s"} · {sourcesWithStock.length} con stock ·{" "}
                {Math.floor(report.sources.filter((x) => x.inStock).reduce((a, x) => a + x.quantity, 0))} unidades
              </span>
            </summary>
            {report.sources.length === 0 ? (
              <p className="muted">El SKU no tiene fuentes asignadas (o no existe).</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Nombre</th>
                      <th>Cantidad</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedSources.map((s) => (
                      <tr key={s.sourceCode}>
                        <td>
                          <code>{s.sourceCode}</code>
                        </td>
                        <td>
                          {s.name}
                          {s.enabled === false && <span className="badge" style={{ marginLeft: 6 }}>Fuente deshabilitada</span>}
                        </td>
                        <td>{s.quantity}</td>
                        <td>{s.inStock ? <span className="badge ok">In Stock</span> : <span className="badge err">Out of Stock</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </details>

          <div className="card">
            <h2>Stocks (lo que ve cada web)</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Stock</th>
                    <th>Webs</th>
                    <th>Fuentes</th>
                    <th>Unidades en fuentes</th>
                    <th>Vendible</th>
                    <th>Retenidas</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {report.stocks.map((r) => (
                    <tr key={r.stockId}>
                      <td>{r.name}</td>
                      <td>{r.channels.join(", ") || <span className="muted">—</span>}</td>
                      <td className="small">{r.sourceCodes.join(", ") || "—"}</td>
                      <td>{r.sourceQty}</td>
                      <td>
                        <b>{r.salable ?? "—"}</b>
                      </td>
                      <td>{r.reserved ?? "—"}</td>
                      <td>
                        <span className={`badge ${STATE[r.state].cls}`}>{STATE[r.state].label}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted small" style={{ marginBottom: 0 }}>
              «Retenidas» = unidades en fuentes − vendible. Incluye las reservas de pedidos que no se enviaron en Magento (y el umbral de agotado, si lo hay).
            </p>
          </div>

          {form && widgetsEnabled && (
            <div className="card stack">
              <h2>Contador «Quedan X unidades» en la tienda</h2>
              <p className="muted small">
                No le afectan las reservas. Solo indica cuántas quedan: para que se pueda comprar, el stock de la web tiene que estar bien.
              </p>
              <div className="row" style={{ gap: 18 }}>
                <label className="check">
                  <input type="radio" name="mode" checked={form.mode === "sources"} onChange={() => setForm({ ...form, mode: "sources" })} />
                  Según el stock del ERP (fuentes)
                </label>
                <label className="check">
                  <input
                    type="radio"
                    name="mode"
                    checked={form.mode === "orders"}
                    onChange={() => setForm({ ...form, mode: "orders", since: form.since ?? new Date().toISOString(), statuses: form.statuses.length ? form.statuses : DEFAULT_SALE_STATUSES })}
                  />
                  Según las ventas (iniciales − vendidas)
                </label>
              </div>
              {form.mode === "orders" && (
                <div className="stack">
                  <div className="row filters">
                    <label>
                      Contar ventas desde
                      <input
                        type="datetime-local"
                        value={toLocalInput(form.since)}
                        onChange={(e) => e.target.value && setForm({ ...form, since: new Date(e.target.value).toISOString() })}
                      />
                    </label>
                    <label>
                      Estados
                      <input
                        type="text"
                        key={`${form.sku}:${form.updatedAt ?? ""}`}
                        defaultValue={form.statuses.join(", ")}
                        onBlur={(e) => setForm({ ...form, statuses: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })}
                        style={{ width: 520, maxWidth: "100%" }}
                      />
                    </label>
                    <button type="button" onClick={previewSales} disabled={salesLoading}>
                      {salesLoading ? "Contando…" : "Ver ventas contadas"}
                    </button>
                  </div>
                  <p className="muted small" style={{ margin: 0 }}>
                    Quedan = unidades iniciales − unidades de este SKU en pedidos con esos estados creados desde esa fecha (sin canceladas ni reembolsadas).
                    Usa la fecha de inicio de la campaña: si es anterior, contará ventas viejas.
                  </p>
                  {salesError && <div className="alert">{salesError}</div>}
                  {sales && (
                    <div className="alert info">
                      Vendidas: <b>{sales.units}</b> en {sales.orders.length} pedido(s) → quedan <b>{sales.quedan}</b> de {form.initial}.
                      {sales.orders.length > 0 && (
                        <div className="table-wrap" style={{ marginTop: 8, maxHeight: 240, overflowY: "auto" }}>
                          <table>
                            <thead>
                              <tr>
                                <th>Pedido</th>
                                <th>Estado</th>
                                <th>Fecha (UTC)</th>
                                <th>Unidades</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sales.orders.map((o) => (
                                <tr key={o.incrementId}>
                                  <td>
                                    <code>{o.incrementId}</code>
                                  </td>
                                  <td>{o.status}</td>
                                  <td className="small">{o.createdAt}</td>
                                  <td>{o.units}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {Object.keys(sales.excluded).length > 0 && (
                        <p className="small" style={{ marginBottom: 0 }}>
                          <b>No se cuentan</b> (estado fuera de la lista):{" "}
                          {Object.entries(sales.excluded)
                            .map(([st, e]) => `${st}: ${e.units} u. en ${e.orders} pedido(s)`)
                            .join(" · ")}
                          . Si alguno es una compra, añade ese código a «Estados».
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
              {form.mode === "sources" && (
              <div>
                <b className="small">Fuentes que se suman</b>
                <div className="row" style={{ marginTop: 6 }}>
                  {sortedSources
                    .filter((s) => allSources || (s.inStock && s.quantity > 0) || form.sources.includes(s.sourceCode))
                    .map((s) => (
                      <label key={s.sourceCode} className="check">
                        <input type="checkbox" checked={form.sources.includes(s.sourceCode)} onChange={() => toggleSource(s.sourceCode)} />
                        {s.sourceCode} ({s.quantity})
                      </label>
                    ))}
                  {hiddenSources > 0 && (
                    <button type="button" className="link small" onClick={() => setAllSources((v) => !v)}>
                      {allSources ? "Ocultar las que no tienen stock" : `Ver ${hiddenSources} sin stock`}
                    </button>
                  )}
                </div>
                <p className="muted small">Ahora mostraría: <b>{Math.max(0, Math.floor(selectedUnits))}</b> {form.sources.length === 0 && "(sin elegir = todas)"}</p>
              </div>
              )}
              <div className="row filters">
                <label>
                  Unidades iniciales
                  <input type="number" min={1} value={form.initial} onChange={(e) => setForm({ ...form, initial: Number(e.target.value) })} style={{ width: 100 }} />
                </label>
                <label>
                  Mostrar con
                  <input type="number" min={0} value={form.showAtOrBelow} onChange={(e) => setForm({ ...form, showAtOrBelow: Number(e.target.value) })} style={{ width: 80 }} />
                  o menos (0 = siempre)
                </label>
                <label className="check">
                  <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
                  Activo
                </label>
              </div>
              <label className="row filters" style={{ display: "flex" }}>
                <span className="muted small">Texto</span>
                <input className="grow" type="text" value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} />
              </label>
              <CouponFields
                coupon={form.coupon ?? ""}
                couponText={form.couponText ?? DEFAULT_COUPON_TEXT}
                onChange={(v) => setForm({ ...form, coupon: v.coupon || null, couponText: v.couponText })}
                disabled={saving}
              />
              <div className="row">
                <button className="primary" onClick={save} disabled={saving}>
                  {saving ? "Guardando…" : "Guardar contador"}
                </button>
                {saveMsg && <span className="small">{saveMsg}</span>}
              </div>

              {pub && (
                <div className={pub.status === 200 ? "alert info" : "alert"}>
                  {pub.status === 200 ? (
                    <>
                      Endpoint público OK: quedan <b>{pub.body.quedan}</b> de {pub.body.inicial}.{" "}
                      {pub.body.visible ? "Se muestra en la tienda." : "Ahora no se muestra (sin unidades o por encima de «Mostrar con»)."}
                    </>
                  ) : (
                    <>
                      El endpoint público falló ({pub.status}): {pub.body.error ?? "error desconocido"}. Revisa que la integración de <code>MAGENTO_TOKEN</code> tenga
                      permiso de lectura en{" "}
                      {form.mode === "orders" ? <b>Sales → Operations → Orders</b> : <b>Stores → Inventory → Sources</b>}.
                    </>
                  )}
                </div>
              )}

              <div>
                <b className="small">Instalación global (una sola vez para toda la tienda, recomendado)</b>
                <p className="muted small" style={{ margin: "4px 0 0" }}>
                  Pégalo en <b>Content → Design → Configuration</b> → tu tienda → <b>Footer → Miscellaneous HTML</b> (o en una etiqueta de Google Tag Manager).
                  Cada ficha detecta su SKU y muestra el contador solo si está activo aquí. No hace falta tocar productos.
                </p>
                <textarea readOnly rows={1} value={globalSnippet} onFocus={(e) => e.currentTarget.select()} style={{ marginTop: 6 }} />
              </div>

              <div>
                <b className="small">O solo en esta ficha: código para pegar en el producto</b> <span className="muted small">(Page Builder → HTML Code, o Google Tag Manager)</span>
                <textarea readOnly rows={3} value={snippet} onFocus={(e) => e.currentTarget.select()} style={{ marginTop: 6 }} />
              </div>
            </div>
          )}
        </>
      )}

      {!widgetsEnabled && <div className="alert info">Para guardar contadores hace falta Vercel Blob (BLOB_STORE_ID o BLOB_READ_WRITE_TOKEN) en este entorno.</div>}

      {widgets.length > 0 && (
        <div className="card">
          <h2>Contadores publicados</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Cálculo</th>
                  <th>Iniciales</th>
                  <th>Estado</th>
                  <th>Última edición</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {widgets.map((w) => (
                  <tr key={w.sku}>
                    <td>
                      <code>{w.sku}</code>
                    </td>
                    <td className="small">
                      {w.mode === "orders" ? `Ventas (${w.statuses.join(", ")}) desde ${new Date(w.since ?? "").toLocaleString("es-AR")}` : `Fuentes: ${w.sources.join(", ") || "todas"}`}
                      {w.coupon && <> · cupón <code>{w.coupon}</code></>}
                    </td>
                    <td>{w.initial}</td>
                    <td>{w.enabled ? <span className="badge ok">Activo</span> : <span className="badge">Pausado</span>}</td>
                    <td className="small muted">
                      {w.updatedAt && new Date(w.updatedAt).toLocaleString("es-AR")} {w.updatedBy && `· ${w.updatedBy}`}
                    </td>
                    <td className="row">
                      <button className="link" onClick={() => void search(w.sku)}>
                        Abrir
                      </button>
                      <button className="link" onClick={() => void remove(w.sku)} style={{ color: "var(--err)" }}>
                        Quitar
                      </button>
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

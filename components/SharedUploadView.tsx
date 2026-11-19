"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import { api } from "@/lib/api";
import { runSharedUpload, type QueueSettings, type UploadMode } from "@/lib/bulk";
import QueueNotice from "./QueueNotice";
import SyncStoresOption from "./SyncStoresOption";
import { parseSkuCsv, parseSkuText, SHARED_SKUS_KEY } from "@/lib/skuList";
import { useRoles } from "./useRoles";
import JobProgress from "./JobProgress";
import UploadErrorHelp from "./UploadErrorHelp";
import { useJob } from "./useJob";



interface Img {
  key: number;
  file: File;
  url: string;
  position: number;
  types: string[];
}

let nextKey = 1;

export default function SharedUploadView({ uploadMode = "direct", queue, syncStoresEnabled = false }: { uploadMode?: UploadMode; queue?: QueueSettings; syncStoresEnabled?: boolean }) {
  const [skuText, setSkuText] = useState("");
  const [existing, setExisting] = useState<string[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<Img[]>([]);
  const csvInput = useRef<HTMLInputElement>(null);
  const job = useJob();
  const hasErrors = !job.running && (job.progress?.failed ?? 0) > 0;
  const [syncStores, setSyncStores] = useState(true);
  const { roles, labelOf } = useRoles();

  // SKU enviados desde la tabla de Productos.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(SHARED_SKUS_KEY);
      if (saved) {
        sessionStorage.removeItem(SHARED_SKUS_KEY);
        const list = JSON.parse(saved) as string[];
        if (Array.isArray(list) && list.length) setSkuText((t) => (t ? t + "\n" : "") + list.join("\n"));
      }
    } catch {
      /* sessionStorage no disponible */
    }
  }, []);

  const skus = useMemo(() => parseSkuText(skuText), [skuText]);

  // Valida contra Magento (con espera mientras se escribe).
  useEffect(() => {
    const pending = skus.filter((s) => !checked.has(s.toLowerCase()));
    if (!pending.length) return;
    let cancelled = false;
    const t = setTimeout(() => {
      setValidating(true);
      setError(null);
      api
        .validateSkus(pending)
        .then(({ existing: found }) => {
          if (cancelled) return;
          setExisting((prev) => [...new Set([...prev, ...found])]);
          setChecked((prev) => new Set([...prev, ...pending.map((s) => s.toLowerCase())]));
        })
        .catch((e) => !cancelled && setError((e as Error).message))
        .finally(() => !cancelled && setValidating(false));
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [skus, checked]);

  const byLower = useMemo(() => new Map(existing.map((s) => [s.toLowerCase(), s])), [existing]);
  const allChecked = skus.every((s) => checked.has(s.toLowerCase()));
  const valid = skus.map((s) => byLower.get(s.toLowerCase())).filter((s): s is string => !!s);
  const missing = allChecked ? skus.filter((s) => !byLower.has(s.toLowerCase())) : [];

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { "image/jpeg": [], "image/png": [], "image/gif": [], "image/webp": [] },
    multiple: true,
    disabled: job.running,
    onDrop: (files) =>
      setImages((prev) => [
        ...prev,
        ...files.map((file, i) => ({
          key: nextKey++,
          file,
          url: URL.createObjectURL(file),
          position: prev.length + i + 1,
          types: [],
        })),
      ]),
  });

  useEffect(() => () => images.forEach((i) => URL.revokeObjectURL(i.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = (key: number, change: Partial<Img>) => setImages((list) => list.map((i) => (i.key === key ? { ...i, ...change } : i)));

  const toggleRole = (key: number, role: string) =>
    setImages((list) => {
      const on = !list.find((i) => i.key === key)!.types.includes(role);
      return list.map((i) =>
        i.key === key
          ? { ...i, types: on ? [...i.types, role] : i.types.filter((t) => t !== role) }
          : on
            ? { ...i, types: i.types.filter((t) => t !== role) }
            : i,
      );
    });

  const removeImage = (key: number) =>
    setImages((list) => {
      const img = list.find((i) => i.key === key);
      if (img) URL.revokeObjectURL(img.url);
      return list.filter((i) => i.key !== key);
    });

  async function loadCsv(file: File) {
    const list = parseSkuCsv(await file.text());
    if (!list.length) return setError("El CSV no tiene SKU.");
    setSkuText((t) => (t.trim() ? t.trim() + "\n" : "") + list.join("\n"));
  }

  const canRun = !job.running && !validating && allChecked && valid.length > 0 && images.length > 0;

  async function start() {
    const desc = images.map((i) => `posición ${i.position}${i.types.length ? ` (${i.types.map(labelOf).join(", ")})` : ""}`).join("; ");
    // Caso visto en el historial: la imagen principal (Base) quedó en la posición 2 y la foto en la 1 con Hover.
    const baseElsewhere = images.find((i) => i.types.includes("image") && i.position !== 1);
    const warn = baseElsewhere
      ? `\n\nAtención: «${baseElsewhere.file.name}» lleva el rol ${labelOf("image")} pero va en la posición ${baseElsewhere.position}. Será la imagen principal del producto aunque no esté primera. Revisá que no estén invertidos los roles.`
      : "";
    if (!confirm(`Se anexarán ${images.length} imagen(es) a ${valid.length} producto(s): ${desc}. Las imágenes existentes desde esa posición bajarán un puesto.${warn}\n\n¿Continuar?`)) return;
    await job.start(
      "varios-sku",
      (cb) => runSharedUpload(valid, images.map(({ file, position, types }) => ({ file, position, types })), cb, { uploadMode, queue, syncStores: syncStoresEnabled && syncStores }),
      {
        skus: valid,
        params: {
          imágenes: images.map((i) => `${i.file.name} → posición ${i.position}${i.types.length ? ` (${i.types.map(labelOf).join(", ")})` : ""}`).join("; "),
          igualarTiendas: syncStoresEnabled && syncStores,
          cola: uploadMode === "bulk",
        },
      },
    );
  }

  return (
    <div className="stack">
      <h1>Imagen a varios SKU</h1>
      {uploadMode === "bulk" && <QueueNotice />}
      <p className="muted" style={{ marginTop: -8 }}>
        Subí una o varias imágenes a una lista de productos, cada una en la posición que elijas. Las imágenes que ya
        estaban desde esa posición bajan un puesto; no se borra nada.
      </p>

      <div className="card stack">
        <div className="row">
          <h2 style={{ margin: 0 }}>1. Productos</h2>
          <span className="spacer" />
          <input
            ref={csvInput}
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void loadCsv(f);
              e.target.value = "";
            }}
          />
          <button onClick={() => csvInput.current?.click()} disabled={job.running}>
            Cargar CSV
          </button>
          <button onClick={() => setSkuText("")} disabled={job.running || !skuText}>
            Vaciar
          </button>
        </div>
        <textarea
          value={skuText}
          onChange={(e) => setSkuText(e.target.value)}
          placeholder={"Pegá acá los SKU (uno por línea, o separados por comas o espacios)\nTEST-001\nTEST-002"}
          rows={6}
          disabled={job.running}
          aria-label="Lista de SKU"
        />
        <div className="row small">
          <span className="badge">{skus.length} SKU</span>
          {allChecked && skus.length > 0 && <span className="badge ok">{valid.length} válidos</span>}
          {missing.length > 0 && <span className="badge err">{missing.length} no existen</span>}
          {validating && <span className="muted">Comprobando en Magento…</span>}
          <span className="spacer" />
          {missing.length > 0 && (
            <button className="link small" onClick={() => setSkuText(valid.join("\n"))} disabled={job.running}>
              Quitar los que no existen
            </button>
          )}
        </div>
        {missing.length > 0 && (
          <div className="small muted">
            No existen: {missing.slice(0, 30).join(", ")}
            {missing.length > 30 && ` y ${missing.length - 30} más`}
          </div>
        )}
      </div>

      <div className="card stack">
        <h2 style={{ margin: 0 }}>2. Imágenes y posición</h2>
        <div {...getRootProps({ className: `dropzone${isDragActive ? " active" : ""}` })} style={{ padding: 20 }}>
          <input {...getInputProps()} />
          <b>Arrastrá acá la imagen o imágenes</b>
          <div className="muted">o hacé clic para elegirlas</div>
        </div>
        {images.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 64 }}>Imagen</th>
                  <th>Archivo</th>
                  <th style={{ width: 100 }}>Posición</th>
                  <th>Roles</th>
                  <th style={{ width: 60 }}></th>
                </tr>
              </thead>
              <tbody>
                {images.map((img) => (
                  <tr key={img.key}>
                    <td>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img className="thumb" src={img.url} alt="" />
                    </td>
                    <td className="small" style={{ wordBreak: "break-all" }}>
                      {img.file.name}
                    </td>
                    <td>
                      <input
                        type="number"
                        min={1}
                        value={img.position}
                        onChange={(e) => patch(img.key, { position: Math.max(1, Number(e.target.value) || 1) })}
                        disabled={job.running}
                        aria-label={`Posición de ${img.file.name}`}
                        style={{ width: 72 }}
                      />
                    </td>
                    <td>
                      <div className="roles">
                        {roles.map(({ code, label }) => (
                          <button
                            key={code}
                            type="button"
                            className={`role${img.types.includes(code) ? " on" : ""}`}
                            onClick={() => toggleRole(img.key, code)}
                            disabled={job.running}
                            aria-pressed={img.types.includes(code)}
                            title={code}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td>
                      <button className="link small" style={{ color: "var(--err)" }} onClick={() => removeImage(img.key)} disabled={job.running}>
                        Quitar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small" style={{ margin: 0 }}>
          Posición 1 = primera imagen de la galería. Si el producto tiene menos imágenes, la nueva queda al final. Un rol
          asignado acá se le quita a la imagen que lo tuviera en cada producto.
        </p>
      </div>

      {error && <div className="alert">{error}</div>}

      <div className="row">
        {syncStoresEnabled && <SyncStoresOption checked={syncStores} onChange={setSyncStores} disabled={job.running} />}
        <span className="spacer" />
        <button className="primary" onClick={start} disabled={!canRun}>
          Anexar {images.length || ""} {images.length === 1 ? "imagen" : "imágenes"} a {valid.length} producto{valid.length === 1 ? "" : "s"}
        </button>
      </div>

      <JobProgress
        title="Progreso"
        progress={job.progress}
        lines={job.lines}
        running={job.running}
        cancelled={job.cancelled}
        onCancel={job.cancel}
        phase={job.phase}
      />

      <UploadErrorHelp key={hasErrors ? "errores" : "ok"} open={hasErrors} bulk={uploadMode === "bulk"} />
    </div>
  );
}

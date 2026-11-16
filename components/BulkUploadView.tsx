"use client";
import { useEffect, useMemo, useState } from "react";
import { useDropzone } from "react-dropzone";
import { api } from "@/lib/api";
import { runBulkUpload, type QueueSettings, type UploadMode } from "@/lib/bulk";
import QueueNotice from "./QueueNotice";
import { candidateSkus, matchFiles, parseFileName, type Separator } from "@/lib/skuMatcher";
import JobProgress from "./JobProgress";
import { useJob } from "./useJob";

const MAX_FILE_MB = 25;

export default function BulkUploadView({ uploadMode = "direct", queue }: { uploadMode?: UploadMode; queue?: QueueSettings }) {
  const [files, setFiles] = useState<File[]>([]);
  const [separator, setSeparator] = useState<Separator>("_");
  const [mode, setMode] = useState<"append" | "replace">("append");
  const [assignRoles, setAssignRoles] = useState(true);
  const [existing, setExisting] = useState<string[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const job = useJob();

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    multiple: true,
    disabled: job.running,
    onDrop: (accepted) =>
      setFiles((prev) => {
        // Si se repite el nombre, gana el último.
        const map = new Map(prev.map((f) => [f.name, f]));
        accepted.forEach((f) => map.set(f.name, f));
        return [...map.values()];
      }),
  });

  const parsed = useMemo(() => files.map((file) => ({ file, parsed: parseFileName(file.name, separator) })), [files, separator]);

  // Valida contra Magento los SKU que aún no se han comprobado.
  useEffect(() => {
    const pending = candidateSkus(parsed.map((p) => p.parsed)).filter((s) => !checked.has(s.toLowerCase()));
    if (!pending.length) return;
    let cancelled = false;
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
    return () => {
      cancelled = true;
    };
  }, [parsed, checked]);

  const allChecked = candidateSkus(parsed.map((p) => p.parsed)).every((s) => checked.has(s.toLowerCase()));

  const match = useMemo(() => {
    const r = matchFiles(parsed, existing);
    // Archivos demasiado grandes incluso para comprimir.
    const tooBig = new Set(files.filter((f) => f.size > MAX_FILE_MB * 1024 * 1024).map((f) => f.name));
    if (tooBig.size) {
      r.groups = r.groups
        .map((g) => ({ ...g, files: g.files.filter((f) => !tooBig.has(f.fileName)) }))
        .filter((g) => g.files.length);
      tooBig.forEach((n) => r.rejected.push({ fileName: n, reason: `Archivo de más de ${MAX_FILE_MB} MB` }));
    }
    if (!allChecked) r.rejected = r.rejected.filter((x) => x.reason !== "SKU no existe en Magento");
    return r;
  }, [parsed, existing, files, allChecked]);

  const imageCount = match.groups.reduce((n, g) => n + g.files.length, 0);
  const canRun = !job.running && !validating && allChecked && imageCount > 0;

  async function start() {
    if (
      mode === "replace" &&
      !confirm(`Modo REEMPLAZAR: se borrarán todas las imágenes actuales de ${match.groups.length} producto(s) antes de subir las nuevas. ¿Continuar?`)
    )
      return;
    await job.start(mode === "replace" ? "subida-reemplazar" : "subida-añadir", (cb) =>
      runBulkUpload(match.groups, { mode, assignRoles, uploadMode, queue }, cb),
    );
  }

  function clear() {
    setFiles([]);
    job.reset();
  }

  return (
    <div className="stack">
      <h1>Subida masiva por SKU</h1>
      {uploadMode === "bulk" && <QueueNotice />}

      <div className="card stack">
        <p style={{ margin: 0 }}>
          Nombra cada archivo con el SKU del producto: <code>SKU.jpg</code> es la imagen 1, <code>SKU{separator}2.jpg</code> la 2, etc.
          Formatos: JPG, PNG, GIF y WebP (WebP se convierte a JPG). Las imágenes grandes se redimensionan a 2500 px.
        </p>
        <div className="row">
          <label>
            Separador de posición{" "}
            <select value={separator} onChange={(e) => setSeparator(e.target.value as Separator)} disabled={job.running}>
              <option value="_">Guion bajo ( SKU_2 )</option>
              <option value="-">Guion ( SKU-2 )</option>
              <option value=".">Punto ( SKU.2 )</option>
            </select>
          </label>
          <label>
            Modo{" "}
            <select value={mode} onChange={(e) => setMode(e.target.value as "append" | "replace")} disabled={job.running}>
              <option value="append">Añadir a la galería existente</option>
              <option value="replace">Reemplazar toda la galería</option>
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={assignRoles} onChange={(e) => setAssignRoles(e.target.checked)} disabled={job.running} />
            La primera imagen de cada SKU será base, small y thumbnail
          </label>
          {mode === "append" && assignRoles && (
            <span className="muted small">
              Si el producto ya tiene imagen base, solo se cambia cuando subes la posición 1 (<code>SKU.jpg</code> o <code>SKU{separator}1.jpg</code>).
            </span>
          )}
        </div>
      </div>

      <div {...getRootProps({ className: `dropzone${isDragActive ? " active" : ""}` })}>
        <input {...getInputProps()} />
        <b>Arrastra aquí las imágenes</b>
        <div className="muted">o haz clic para elegirlas (puedes seleccionar cientos a la vez)</div>
      </div>

      {error && <div className="alert">{error}</div>}

      {files.length > 0 && (
        <div className="card stack">
          <div className="row">
            <h2 style={{ margin: 0 }}>Vista previa</h2>
            <span className="badge">{files.length} archivos</span>
            <span className="badge ok">
              {imageCount} imágenes → {match.groups.length} productos
            </span>
            {match.rejected.length > 0 && <span className="badge err">{match.rejected.length} rechazadas</span>}
            {validating && <span className="muted small">Comprobando SKU en Magento…</span>}
            <span className="spacer" />
            <button onClick={clear} disabled={job.running}>
              Limpiar
            </button>
            <button className="primary" onClick={start} disabled={!canRun}>
              {mode === "replace" ? "Reemplazar" : "Subir"} {imageCount} imágenes
            </button>
          </div>

          {match.rejected.length > 0 && (
            <details open={match.rejected.length <= 20}>
              <summary>Archivos que no se subirán ({match.rejected.length})</summary>
              <div className="table-wrap">
                <table>
                  <tbody>
                    {match.rejected.map((r) => (
                      <tr key={r.fileName}>
                        <td>{r.fileName}</td>
                        <td>
                          <span className="badge err">{r.reason}</span>
                          {r.sku && <span className="muted small"> (buscado: {r.sku})</span>}
                        </td>
                        <td>
                          <button className="link small" onClick={() => setFiles((fs) => fs.filter((f) => f.name !== r.fileName))}>
                            Quitar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Imágenes (en orden)</th>
                </tr>
              </thead>
              <tbody>
                {match.groups.slice(0, 200).map((g) => (
                  <tr key={g.sku}>
                    <td>
                      <code>{g.sku}</code>
                    </td>
                    <td className="small">
                      {g.files.map((f, i) => (
                        <span key={f.fileName}>
                          {i > 0 && " · "}
                          {f.fileName}
                          {i === 0 && assignRoles && (
                            <span className="badge ok" style={{ marginLeft: 4 }}>
                              {mode === "replace" || f.position === 1 ? "base" : "base si no tiene"}
                            </span>
                          )}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {match.groups.length > 200 && <p className="muted small">…y {match.groups.length - 200} productos más.</p>}
          </div>
        </div>
      )}

      <JobProgress
        title="Progreso de la subida"
        progress={job.progress}
        lines={job.lines}
        running={job.running}
        cancelled={job.cancelled}
        onCancel={job.cancel}
        phase={job.phase}
      />
    </div>
  );
}

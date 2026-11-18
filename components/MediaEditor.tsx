"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { api, auditStart, syncAllStores, type AuditFinish } from "@/lib/api";
import type { AuditKind, AuditLine } from "@/lib/auditKinds";
import { describeRepair, replaceImage } from "@/lib/bulk";
import { prepareImage } from "@/lib/imagePrep";
import type { MediaEntry, MediaRole } from "@/lib/types";
import { useRoles } from "./useRoles";
import { SkeletonMediaCards } from "./Skeleton";

interface Props {
  sku: string;
  name?: string;
  /** Igualar las tiendas a lo general después de cada cambio. */
  syncStoresEnabled?: boolean;
  /** Cantidad de imágenes conocida (de la lista), para dibujar el skeleton. */
  expectedCount?: number;
  onClose: () => void;
  onChanged?: () => void;
}

const key = (e: MediaEntry, position: number) =>
  JSON.stringify([e.label ?? "", e.disabled, [...e.types].sort(), position]);

export default function MediaEditor({ sku, name, syncStoresEnabled = false, expectedCount = 3, onClose, onChanged }: Props) {
  const [original, setOriginal] = useState<MediaEntry[]>([]);
  const [items, setItems] = useState<MediaEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const addInput = useRef<HTMLInputElement>(null);
  const { roles, firstImageRoles } = useRoles();
  type StoreDiffs = Awaited<ReturnType<typeof api.storeDiffs>>;
  const [storeDiffs, setStoreDiffs] = useState<StoreDiffs | null>(null);
  const [storeNote, setStoreNote] = useState<string | null>(null);

  const checkStores = useCallback(async () => {
    if (!syncStoresEnabled) return;
    try {
      setStoreDiffs(await api.storeDiffs(sku));
    } catch (e) {
      setStoreNote(`No se pudieron revisar las tiendas: ${(e as Error).message}`);
    }
  }, [sku, syncStoresEnabled]);

  /** Iguala las tiendas y actualiza el aviso. */
  const syncStoresNow = useCallback(async () => {
    const r = await syncAllStores(sku);
    setStoreNote(
      r.stillDifferent.length
        ? `Siguen distintas: ${r.stillDifferent.join(", ")}`
        : r.storesSynced.length
          ? `Tiendas igualadas a lo general: ${r.storesSynced.join(", ")}.`
          : null,
    );
    setStoreDiffs([]);
    return r;
  }, [sku]);

  useEffect(() => {
    void checkStores();
  }, [checkStores]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const entries = await api.getMedia(sku);
      setOriginal(entries);
      setItems(entries);
      setLoadedOnce(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [sku]);

  useEffect(() => {
    void load();
  }, [load]);

  // Posición final = orden en pantalla (1, 2, 3…).
  const dirtyIds = useMemo(() => {
    const orig = new Map(original.map((e) => [e.id, key(e, e.position)]));
    return new Set(items.filter((e, i) => orig.get(e.id) !== key(e, i + 1)).map((e) => e.id));
  }, [items, original]);
  const dirty = dirtyIds.size > 0;

  const close = useCallback(() => {
    if (dirty && !confirm("Hay cambios sin guardar. ¿Cerrar igualmente?")) return;
    onClose();
  }, [dirty, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, busy]);

  const patch = (id: number, change: Partial<MediaEntry>) =>
    setItems((list) => list.map((e) => (e.id === id ? { ...e, ...change } : e)));

  const toggleRole = (id: number, role: string) =>
    setItems((list) => {
      const target = list.find((e) => e.id === id)!;
      const turningOn = !target.types.includes(role);
      return list.map((e) => {
        if (e.id === id) return { ...e, types: turningOn ? [...e.types, role] : e.types.filter((t) => t !== role) };
        // Un rol solo puede estar en una imagen.
        return turningOn && e.types.includes(role) ? { ...e, types: e.types.filter((t) => t !== role) } : e;
      });
    });

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    // En pantallas táctiles se arrastra manteniendo pulsado: deslizar sigue haciendo scroll.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /** Mueve una imagen un puesto (botones ← →, alternativa al arrastre). */
  function move(id: number, delta: -1 | 1) {
    setItems((list) => {
      const from = list.findIndex((e) => e.id === id);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= list.length) return list;
      return arrayMove(list, from, to);
    });
  }

  function onDragEnd(ev: DragEndEvent) {
    const { active, over } = ev;
    if (!over || active.id === over.id) return;
    setItems((list) => {
      const from = list.findIndex((e) => e.id === active.id);
      const to = list.findIndex((e) => e.id === over.id);
      return arrayMove(list, from, to);
    });
  }

  /**
   * Ejecuta una acción del editor, iguala tiendas si corresponde y deja un
   * registro ya cerrado con el resultado (si el registro está activo).
   */
  async function run(label: string, fn: () => Promise<void>, audit: { kind: AuditKind; detail: string; params?: Record<string, unknown> }) {
    setBusy(label);
    setError(null);
    const lines: AuditLine[] = [];
    let status: AuditFinish["status"] = "completo";
    try {
      await fn();
      lines.push({ sku, action: audit.detail, status: "ok" });
      if (syncStoresEnabled) {
        setBusy("Igualando tiendas…");
        try {
          const r = await syncStoresNow();
          lines.push({
            sku,
            action: "tiendas",
            status: r.stillDifferent.length ? "error" : "ok",
            message: r.stillDifferent.length
              ? `Siguen distintas: ${r.stillDifferent.join(", ")}`
              : r.storesSynced.length
                ? `Igualadas: ${r.storesSynced.join(", ")}`
                : "Ya coincidían",
          });
        } catch (e) {
          lines.push({ sku, action: "tiendas", status: "error", message: (e as Error).message });
          setStoreNote(`El cambio se guardó, pero no se pudieron igualar las tiendas: ${(e as Error).message}`);
        }
      }
      if (lines.some((l) => l.status === "error")) status = "con-errores";
      await load();
      onChanged?.();
    } catch (e) {
      status = "error";
      lines.push({ sku, action: audit.detail, status: "error", message: (e as Error).message });
      // Recargar primero: load() limpia el error y lo borraría antes de que se vea.
      await load();
      setError((e as Error).message);
    } finally {
      setBusy(null);
      const ok = lines.filter((l) => l.status === "ok").length;
      void auditStart(
        audit.kind,
        { skus: [sku], params: { producto: name ?? sku, ...audit.params } },
        { status, ok, failed: lines.length - ok, total: lines.length, lines },
      );
    }
  }


  /** Guarda el producto con sus vínculos válidos y deja constancia en el Historial. */
  async function repairLinks() {
    if (
      !confirm(
        "Se guardará el producto con sus productos vinculados válidos, como al guardar desde el Admin. " +
          "Se quitan los vínculos a SKU que ya no existen; el resto del producto no cambia. ¿Continuar?",
      )
    )
      return;
    setBusy("Reparando vínculos…");
    let line: AuditLine;
    try {
      const r = await api.repairLinks(sku);
      line = { sku, action: "reparar vínculos", status: "ok", message: describeRepair(r) };
      setError(null);
      setStoreNote(`${describeRepair(r)}. Ya podés volver a intentar el cambio.`);
    } catch (e) {
      line = { sku, action: "reparar vínculos", status: "error", message: (e as Error).message };
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
    void auditStart(
      "reparar-vinculos",
      { skus: [sku], params: { producto: name ?? sku } },
      { status: line.status === "ok" ? "completo" : "error", ok: line.status === "ok" ? 1 : 0, failed: line.status === "ok" ? 0 : 1, total: 1, lines: [line] },
    );
  }

  /** Resumen legible de lo que cambia al guardar (para el registro). */
  const describeChanges = () => {
    const orig = new Map(original.map((e) => [e.id, e]));
    return items
      .map((e, i) => ({ e, i, o: orig.get(e.id) }))
      .filter(({ e }) => dirtyIds.has(e.id))
      .map(({ e, i, o }) => {
        const parts: string[] = [];
        if (o && o.position !== i + 1) parts.push(`posición ${o.position}→${i + 1}`);
        if (o && [...o.types].sort().join() !== [...e.types].sort().join()) parts.push(`roles: ${e.types.join("+") || "ninguno"}`);
        if (o && (o.label ?? "") !== (e.label ?? "")) parts.push(`alt: «${e.label ?? ""}»`);
        if (o && o.disabled !== e.disabled) parts.push(e.disabled ? "oculta" : "visible");
        return `${e.file.split("/").pop()}: ${parts.join(", ")}`;
      })
      .join("; ");
  };

  const save = () =>
    run("Guardando…", async () => {
      // Primero las que ganan roles, luego el resto, para que Magento no los reasigne mal.
      const changed = items
        .map((e, i) => ({ id: e.id, label: e.label, disabled: e.disabled, types: e.types, position: i + 1 }))
        .filter((e) => dirtyIds.has(e.id));
      // Un solo guardado del producto con todos los cambios.
      await api.saveGallery(sku, changed);
    }, {
      kind: "editor-guardar",
      detail: `guardar ${dirtyIds.size} imagen(es)`,
      params: { cambios: describeChanges() },
    });

  const remove = (e: MediaEntry) => {
    if (!confirm(`¿Borrar esta imagen de ${sku}?`)) return;
    void run("Borrando…", () => api.deleteMedia(sku, e.id).then(() => undefined), {
      kind: "editor-borrar",
      detail: "borrar imagen",
      params: { imagen: e.file, posición: e.position, roles: e.types.join(", ") || "ninguno" },
    });
  };

  const replace = (e: MediaEntry, file: File) =>
    run("Reemplazando…", () => replaceImage(sku, e, file), {
      kind: "editor-reemplazar",
      detail: "reemplazar imagen",
      params: { anterior: e.file, nueva: file.name, posición: e.position, roles: e.types.join(", ") || "ninguno" },
    });

  const addFiles = (files: FileList) =>
    run("Subiendo…", async () => {
      let pos = items.reduce((m, e) => Math.max(m, e.position), 0);
      for (const f of Array.from(files)) {
        const prepared = await prepareImage(f);
        await api.uploadMedia(sku, prepared, { position: ++pos, types: items.length === 0 && pos === 1 ? firstImageRoles : [] });
      }
    }, {
      kind: "editor-añadir",
      detail: `añadir ${files.length} imagen(es)`,
      params: { archivos: Array.from(files).map((f) => f.name).join(", ") },
    });

  const lockedReason = dirty ? "Guardá o descartá los cambios primero" : undefined;

  return (
    <>
      <div className="drawer-backdrop" onClick={() => !busy && close()} />
      <aside className="drawer" role="dialog" aria-label={`Imágenes de ${sku}`}>
        <header>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700 }}>{sku}</div>
            {name && <div className="muted small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>}
          </div>
          <span className="spacer" />
          <button onClick={close} disabled={!!busy} aria-label="Cerrar">
            ✕
          </button>
        </header>
        <div className="body stack">
          {error && (
            <div className="alert">
              {error}
              {/vinculados/i.test(error) && (
                <div style={{ marginTop: 8 }}>
                  <button onClick={repairLinks} disabled={!!busy}>
                    Reparar vínculos
                  </button>
                </div>
              )}
            </div>
          )}
          {storeDiffs && storeDiffs.length > 0 && (
            <div className="alert warn-box">
              <div>
                <b>Algunas tiendas tienen valores propios de imágenes</b> y no muestran lo general:
                <ul className="small" style={{ margin: "6px 0" }}>
                  {storeDiffs.map((d) => (
                    <li key={d.storeCode}>
                      {d.storeName}: {[...new Set(d.diffs.flatMap((x) => x.fields))].join(", ")} ({d.diffs.length} imagen(es))
                    </li>
                  ))}
                </ul>
              </div>
              <button className="primary" disabled={!!busy || dirty} title={dirty ? "Guardá o descartá los cambios primero" : undefined} onClick={() => void run("Igualando tiendas…", async () => {}, { kind: "editor-igualar", detail: "igualar tiendas" })}>
                Igualar todas las tiendas a lo general
              </button>
            </div>
          )}
          {storeNote && <div className="alert info small">{storeNote}</div>}
          {loading && !loadedOnce ? (
            <div role="status" aria-label="Cargando imágenes">
              <span className="skeleton sk-line" style={{ width: "min(560px, 80%)", marginBottom: 16 }} />
              <SkeletonMediaCards count={Math.min(Math.max(expectedCount, 1), 8)} />
            </div>
          ) : items.length === 0 && !loading ? (
            <div className="alert info">Este producto no tiene imágenes.</div>
          ) : (
            <>
              <p className="muted small" style={{ margin: 0 }}>
                Arrastrá las imágenes (en el celular, mantené pulsado) o usá ← → para cambiar el orden. Tocá un rol para asignarlo (cada rol solo puede estar en una imagen).
              </p>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={items.map((e) => e.id)} strategy={rectSortingStrategy}>
                  <div className={`gallery${loading ? " is-refreshing" : ""}`} aria-busy={loading}>
                    {items.map((e, i) => (
                      <MediaCard
                        key={e.id}
                        entry={e}
                        index={i}
                        count={items.length}
                        onMove={(d) => move(e.id, d)}
                        roles={roles}
                        dirty={dirtyIds.has(e.id)}
                        disabled={!!busy}
                        lockedReason={lockedReason}
                        onLabel={(label) => patch(e.id, { label })}
                        onHidden={(disabled) => patch(e.id, { disabled })}
                        onRole={(r) => toggleRole(e.id, r)}
                        onDelete={() => remove(e)}
                        onReplace={(f) => replace(e, f)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </>
          )}
        </div>
        <footer>
          <input
            ref={addInput}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) void addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button onClick={() => addInput.current?.click()} disabled={!!busy || dirty || loading} title={lockedReason}>
            + Añadir imágenes
          </button>
          <span className="spacer" />
          {busy && <span className="muted">{busy}</span>}
          <button onClick={() => setItems(original)} disabled={!dirty || !!busy}>
            Descartar
          </button>
          <button className="primary" onClick={save} disabled={!dirty || !!busy}>
            Guardar cambios{dirty ? ` (${dirtyIds.size})` : ""}
          </button>
        </footer>
      </aside>
    </>
  );
}

function MediaCard(props: {
  entry: MediaEntry;
  index: number;
  count: number;
  onMove: (delta: -1 | 1) => void;
  roles: MediaRole[];
  dirty: boolean;
  disabled: boolean;
  lockedReason?: string;
  onLabel: (v: string) => void;
  onHidden: (v: boolean) => void;
  onRole: (r: string) => void;
  onDelete: () => void;
  onReplace: (f: File) => void;
}) {
  const { entry: e, index, dirty, disabled, lockedReason } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: e.id, disabled });
  const fileInput = useRef<HTMLInputElement>(null);

  return (
    <div
      ref={setNodeRef}
      className={`media-card${dirty ? " dirty" : ""}${e.disabled ? " hidden-img" : ""}`}
      style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 5 : undefined, opacity: isDragging ? 0.8 : 1 }}
    >
      <div className="media-img" {...attributes} {...listeners} aria-label={`Imagen ${index + 1}, arrastra para mover`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={e.url} alt={e.label ?? ""} loading="lazy" />
        <span className="pos">{index + 1}</span>
      </div>
      <div className="move-row">
        <button type="button" onClick={() => props.onMove(-1)} disabled={disabled || index === 0} aria-label={`Mover la imagen ${index + 1} a la izquierda`} title="Mover antes">
          ←
        </button>
        <span className="small muted">Posición {index + 1} de {props.count}</span>
        <button type="button" onClick={() => props.onMove(1)} disabled={disabled || index === props.count - 1} aria-label={`Mover la imagen ${index + 1} a la derecha`} title="Mover después">
          →
        </button>
      </div>
      <div className="media-body">
        <div className="roles">
          {props.roles.map(({ code, label }) => (
            <button
              key={code}
              type="button"
              className={`role${e.types.includes(code) ? " on" : ""}`}
              onClick={() => props.onRole(code)}
              disabled={disabled}
              aria-pressed={e.types.includes(code)}
              title={code}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Texto alternativo (alt)"
          value={e.label ?? ""}
          maxLength={255}
          onChange={(ev) => props.onLabel(ev.target.value)}
          disabled={disabled}
        />
        <div className="row">
          <label className="check small">
            <input type="checkbox" checked={e.disabled} onChange={(ev) => props.onHidden(ev.target.checked)} disabled={disabled} />
            Ocultar
          </label>
          <span className="spacer" />
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            hidden
            onChange={(ev) => {
              const f = ev.target.files?.[0];
              if (f) props.onReplace(f);
              ev.target.value = "";
            }}
          />
          <button className="link small" onClick={() => fileInput.current?.click()} disabled={disabled || !!lockedReason} title={lockedReason}>
            Reemplazar
          </button>
          <button className="link small" style={{ color: "var(--err)" }} onClick={props.onDelete} disabled={disabled || !!lockedReason} title={lockedReason}>
            Borrar
          </button>
        </div>
      </div>
    </div>
  );
}

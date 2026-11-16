"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
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
import { api } from "@/lib/api";
import { replaceImage } from "@/lib/bulk";
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
    const r = await api.syncStores(sku);
    setStoreNote(
      r.stillDifferent.length
        ? `Siguen distintas: ${r.stillDifferent.join(", ")}`
        : r.storesSynced.length
          ? `Tiendas igualadas a lo general: ${r.storesSynced.join(", ")}.`
          : null,
    );
    setStoreDiffs([]);
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
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(ev: DragEndEvent) {
    const { active, over } = ev;
    if (!over || active.id === over.id) return;
    setItems((list) => {
      const from = list.findIndex((e) => e.id === active.id);
      const to = list.findIndex((e) => e.id === over.id);
      return arrayMove(list, from, to);
    });
  }

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
      if (syncStoresEnabled) {
        setBusy("Igualando tiendas…");
        try {
          await syncStoresNow();
        } catch (e) {
          setStoreNote(`El cambio se guardó, pero no se pudieron igualar las tiendas: ${(e as Error).message}`);
        }
      }
      await load();
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
      await load();
    } finally {
      setBusy(null);
    }
  }

  const save = () =>
    run("Guardando…", async () => {
      // Primero las que ganan roles, luego el resto, para que Magento no los reasigne mal.
      const changed = items
        .map((e, i) => ({ id: e.id, label: e.label, disabled: e.disabled, types: e.types, position: i + 1 }))
        .filter((e) => dirtyIds.has(e.id));
      // Un solo guardado del producto con todos los cambios.
      await api.saveGallery(sku, changed);
    });

  const remove = (e: MediaEntry) => {
    if (!confirm(`¿Borrar esta imagen de ${sku}?`)) return;
    void run("Borrando…", () => api.deleteMedia(sku, e.id).then(() => undefined));
  };

  const replace = (e: MediaEntry, file: File) => run("Reemplazando…", () => replaceImage(sku, e, file));

  const addFiles = (files: FileList) =>
    run("Subiendo…", async () => {
      let pos = items.reduce((m, e) => Math.max(m, e.position), 0);
      for (const f of Array.from(files)) {
        const prepared = await prepareImage(f);
        await api.uploadMedia(sku, prepared, { position: ++pos, types: items.length === 0 && pos === 1 ? firstImageRoles : [] });
      }
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
          {error && <div className="alert">{error}</div>}
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
              <button className="primary" disabled={!!busy || dirty} title={dirty ? "Guardá o descartá los cambios primero" : undefined} onClick={() => void run("Igualando tiendas…", async () => {})}>
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
                Arrastrá las imágenes para cambiar el orden. Tocá un rol para asignarlo (cada rol solo puede estar en una imagen).
              </p>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={items.map((e) => e.id)} strategy={rectSortingStrategy}>
                  <div className={`gallery${loading ? " is-refreshing" : ""}`} aria-busy={loading}>
                    {items.map((e, i) => (
                      <MediaCard
                        key={e.id}
                        entry={e}
                        index={i}
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

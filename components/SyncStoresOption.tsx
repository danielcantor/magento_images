"use client";

/** Casilla «Igualar todas las tiendas a lo general». */
export default function SyncStoresOption({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="check" title="Copia en cada store view los roles, alt, posición y «ocultar» generales, para que ninguna tienda conserve valores antiguos.">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
      Igualar todas las tiendas a lo general
    </label>
  );
}

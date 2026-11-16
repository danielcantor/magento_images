// Placeholders de carga con la forma del contenido real.

/** Filas de la tabla de Productos (7 columnas). */
export function SkeletonRows({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <tr key={i} className="skeleton-row" aria-hidden="true">
          <td><span className="skeleton sk-box" /></td>
          <td><span className="skeleton sk-thumb" /></td>
          <td><span className="skeleton sk-line" style={{ width: 72 }} /></td>
          <td><span className="skeleton sk-line" style={{ width: `${55 + ((i * 17) % 35)}%` }} /></td>
          <td><span className="skeleton sk-pill" /></td>
          <td><span className="skeleton sk-line" style={{ width: 90 }} /></td>
          <td><span className="skeleton sk-pill" style={{ width: 28 }} /></td>
        </tr>
      ))}
    </>
  );
}

/** Tarjetas de imagen del editor. */
export function SkeletonMediaCards({ count }: { count: number }) {
  return (
    <div className="gallery" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="media-card">
          <div className="skeleton sk-image" />
          <div className="media-body">
            <div className="roles">
              {[46, 44, 70, 52, 60].map((w, j) => (
                <span key={j} className="skeleton sk-chip" style={{ width: w }} />
              ))}
            </div>
            <span className="skeleton sk-input" />
            <div className="row">
              <span className="skeleton sk-line" style={{ width: 70 }} />
              <span className="spacer" />
              <span className="skeleton sk-line" style={{ width: 64 }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

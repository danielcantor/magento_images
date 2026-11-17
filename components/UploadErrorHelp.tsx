// Explicación de los mensajes de error de la subida a varios SKU.

interface Row {
  /** Texto que aparece en el mensaje (para que la persona lo reconozca). */
  says: string;
  means: string;
  todo: string;
}

const ROWS: Row[] = [
  {
    says: "«…tiene productos vinculados que ya no existen…» o «…no puede volver a grabar los productos vinculados…»",
    means:
      "Magento no deja guardar el producto por sus productos relacionados, up-sell o cross-sell (por ejemplo, uno apunta a un SKU borrado). La imagen está bien.",
    todo: "En Productos, seleccioná el SKU y usá «Reparar vínculos» (o guardalo desde el Admin). Después volvé a anexar la imagen a ese SKU.",
  },
  {
    says: "«Magento no puede guardar este producto: …»",
    means: "Magento rechazó el producto por un dato propio. El motivo es el texto que sigue a los dos puntos.",
    todo: "Abrí el producto en el Admin y guardalo: te va a marcar qué corregir. Después reintentá.",
  },
  {
    says: "«Magento no puede guardar este producto. Abrilo y guardalo desde el Admin…»",
    means: "Igual que el anterior, pero Magento no dio el motivo.",
    todo: "Guardalo desde el Admin; si no da error, probá «Reparar vínculos» y reintentá.",
  },
  {
    says: "«…(al correr las imágenes existentes; no se cambió nada)»",
    means: "Falló al hacer lugar para la imagen nueva. No se subió ni se movió nada en ese producto.",
    todo: "Resolvé el motivo que figura antes del paréntesis y reintentá ese SKU.",
  },
  {
    says: "«…(hecho: N anexadas, M movidas)»",
    means: "Se cortó a mitad de camino: parte del trabajo sí quedó hecho en Magento.",
    todo: "Abrí el producto en Productos y revisá las imágenes antes de reintentar, para no duplicarlas.",
  },
  {
    says: "«No se pudo confirmar… Puede que se haya aplicado igual» o «Magento tardó demasiado en responder»",
    means: "Magento tardó o cortó la conexión justo mientras guardaba. No se sabe si la imagen quedó.",
    todo: "Abrí el producto y fijate si la imagen ya está. Reintentá solo si no está.",
  },
  {
    says: "«No se pudo completar: Magento no respondió a tiempo» o «se cortó la conexión con Magento»",
    means: "Magento estaba lento o no respondió. No se aplicó nada.",
    todo: "Esperá unos minutos y reintentá.",
  },
  {
    says: "«No se pudo preparar la imagen»",
    means: "El archivo está dañado o tiene un formato que el navegador no puede leer.",
    todo: "Abrilo y volvé a exportarlo como JPG o PNG.",
  },
  {
    says: "«No se pudo leer la galería»",
    means: "No se pudieron leer las imágenes actuales del producto (SKU borrado, Magento caído o sin conexión).",
    todo: "Comprobá que el SKU exista y reintentá.",
  },
  {
    says: "«Una imagen ya no existe en Magento»",
    means: "Alguien cambió las imágenes de ese producto mientras corría la subida.",
    todo: "Revisá el producto y reintentá.",
  },
  {
    says: "«Tu usuario de Magento no tiene permiso…» o «Sesión caducada»",
    means: "Tu sesión venció o tu usuario no tiene el permiso Catalog > Products.",
    todo: "Volvé a entrar. Si sigue, pedí el permiso a quien administra Magento.",
  },
  {
    says: "Línea «tiendas»: «Siguen distintas…» o «No se pudieron igualar las tiendas»",
    means: "La imagen se anexó bien, pero alguna tienda sigue mostrando sus valores anteriores.",
    todo: "En Productos, seleccioná el SKU y usá «Igualar tiendas».",
  },
];

const BULK_ROWS: Row[] = [
  {
    says: "«No se pudo encolar»",
    means: "Magento no aceptó el paquete en su cola.",
    todo: "Reintentá; si se repite, avisá a quien mantiene Magento.",
  },
  {
    says: "«Magento aún no la procesó…» o «Encolada, pero tu usuario no puede ver su estado»",
    means: "La imagen quedó en la cola de Magento pero no se pudo confirmar el resultado.",
    todo: "Revisá el producto más tarde o en el Admin, Bulk Actions.",
  },
];

export default function UploadErrorHelp({ open = false, bulk = false }: { open?: boolean; bulk?: boolean }) {
  const rows = bulk ? [...ROWS, ...BULK_ROWS] : ROWS;
  return (
    <details className="card" open={open}>
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>¿Qué significan los errores de la subida?</summary>
      <p className="muted small">
        Cada error es de un SKU y no frena a los demás. Con «Solo errores» ves solo los que fallaron, y con «Descargar CSV» te llevás la lista; también
        queda en Historial. Corregí el motivo y volvé a anexar la imagen solo a esos SKU.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Si el mensaje dice…</th>
              <th>Qué pasó</th>
              <th>Qué hacer</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.says}>
                <td className="small">{r.says}</td>
                <td className="small">{r.means}</td>
                <td className="small">{r.todo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

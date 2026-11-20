# Dashboard de la tienda (Magento 2)

Web para **subir, ordenar, editar y borrar imágenes de productos de Magento 2 de forma masiva**, usando la REST API de la tienda. Se despliega en **Vercel**; **Supabase** es opcional (login por usuario y historial de lotes).

## Qué hace

- **Inicio**: estado de los contadores de stock activos (unidades que quedan, si se ven en la tienda, agotados, ocultos por umbral y apagados), aviso si `MAGENTO_TOKEN` no responde, accesos a las herramientas de imágenes y tus últimas acciones.
- **Productos**: busca por SKU o nombre y filtra por estado (activo/inactivo) y por sitio web o store view. Eliges cuántos ver por página (25, 50, 100 o 200) y la URL guarda los filtros. La tabla muestra miniatura, estado, sitios, número de imágenes y un aviso si falta la imagen base. Haz clic en una fila para abrir sus imágenes.
- **Editor por producto**: arrastra para reordenar, asigna roles (los de tu tienda: se leen de Magento, incluidos los de módulos como Hover o Abandoned Cart Image), edita el texto alternativo, oculta, reemplaza (conserva rol y posición), borra y añade imágenes.
- **Subida masiva por SKU**: arrastra cientos de archivos con nombres `SKU.jpg`, `SKU_2.jpg`, `SKU_3.jpg`…
  - Vista previa que comprueba en Magento que cada SKU existe antes de subir.
  - Modo **añadir** (no toca lo que hay) o **reemplazar galería** (borra las actuales).
  - La imagen 1 puede recibir todos los roles de la tienda menos los de tipo Hover. Para elegir otros, define `FIRST_IMAGE_ROLES` (códigos separados por comas, p. ej. `image,small_image,thumbnail`). En modo añadir, la base existente solo se cambia si subes la posición 1.
  - Redimensiona a 2500 px y comprime en el navegador; convierte WebP a JPG.
  - Progreso en vivo, botón de detener y CSV con el resultado.
- **Imagen a varios SKU**: sube la misma imagen (o varias) a una lista de productos, cada una en la posición que elijas.
  - Los SKU se pegan, se cargan desde un CSV (columna `sku` o la primera) o se mandan desde la tabla de Productos con **Anexar imagen…**.
  - **Insertar y correr**: si eliges la posición 2, la nueva imagen queda segunda y las que estaban desde la 2 bajan un puesto. No se borra nada. Si el producto tiene menos imágenes, queda al final.
  - Puedes darle roles (Base, Small, Thumbnail, Swatch); en cada producto se le quitan a la imagen que los tuviera.
  - La imagen se comprime una sola vez y se reutiliza para todos los SKU.
- **Borrado masivo**: selecciona productos y borra todas sus imágenes o solo las que no tienen rol.

## 1. Preparar Magento

1. **System → Extensions → Integrations → Add New Integration**.
   - En *API*, da acceso a **Catalog → Inventory → Products**.
   - Guarda, pulsa **Activate** y copia el **Access Token**.
2. En Magento 2.4.4 o superior: **Stores → Configuration → Services → OAuth → Consumer Settings →
   Allow OAuth Access Tokens to be used as standalone Bearer tokens = Yes**.
3. Si la tienda tiene firewall, Cloudflare o WAF, permite las peticiones a `/rest/` desde Vercel.
4. Revisa que PHP acepte peticiones de unos 6 MB (`post_max_size`, `client_max_body_size` en nginx).

## 2. Desplegar en Vercel

1. Sube este proyecto a un repositorio de GitHub.
2. En [vercel.com/new](https://vercel.com/new) importa el repositorio (Vercel detecta Next.js solo).
3. En **Environment Variables** añade:

| Variable | Valor |
|---|---|
| `MAGENTO_BASE_URL` | `https://tutienda.com` (sin barra final) |
| `MAGENTO_TOKEN` | el Access Token de la integración |
| `MAGENTO_STORE_CODE` | `all` (recomendado) |
| `MAGENTO_MEDIA_URL` | opcional, si sirves las imágenes desde un CDN |
| `DASHBOARD_PASSWORD` | contraseña para entrar al dashboard |
| `SESSION_SECRET` | texto aleatorio largo (por ejemplo `openssl rand -hex 32`) |

4. **Deploy**. Entra con la contraseña.

> En producción, si no hay `DASHBOARD_PASSWORD` ni Supabase configurados, el dashboard queda bloqueado. Así la API de escritura nunca queda expuesta.

## Login con usuarios del Admin de Magento (recomendado)

Cada persona entra con **su usuario, contraseña y código de Google Authenticator del Admin de Magento**.

- El dashboard pide a Magento un token de admin para esa persona y lo guarda cifrado (AES-GCM) en una cookie `httpOnly`. El navegador nunca lo ve en claro.
- Se respetan los **roles y permisos** de cada usuario, y Magento registra quién hizo cada cambio.
- `MAGENTO_TOKEN` deja de usarse.

En Vercel:

| Variable | Valor |
|---|---|
| `AUTH_MODE` | `magento` |
| `MAGENTO_BASE_URL` | `https://tutienda.com` |
| `SESSION_SECRET` | texto aleatorio de 16+ caracteres (`openssl rand -hex 32`), obligatorio |
| `MAGENTO_ADMIN_TOKEN_HOURS` | opcional, por defecto `4` |
| `MAGENTO_ADMIN_2FA` | opcional: `off` si tu Magento no usa 2FA en el Admin |

Requisitos en Magento:

- **Rol con permiso**: el usuario necesita un rol con acceso a **Catalog → Inventory → Products** (*System → Permissions → User Roles*). Si no lo tiene, el dashboard muestra «Tu usuario de Magento no tiene permiso…».
- **Google Authenticator**: cada usuario debe tenerlo configurado. La primera vez se activa entrando al Admin de Magento.
- **Duración de la sesión**: la sesión dura lo mismo que el token de admin de Magento. Si cambias *Stores → Configuration → Services → OAuth → Access Token Expiration → Admin Token Lifetime*, pon el mismo número de horas en `MAGENTO_ADMIN_TOKEN_HOURS`.
- **Bloqueo por intentos**: Magento bloquea temporalmente la cuenta tras varios intentos fallidos, igual que en el Admin.

`AUTH_MODE=magento` tiene prioridad sobre `DASHBOARD_PASSWORD` y Supabase.

## Historial en el Admin de Magento (Bulk Actions)

Con `MAGENTO_UPLOAD_MODE=bulk`, las subidas de **Subida masiva** e **Imagen a varios SKU** se envían a la API asíncrona de Magento (`/async/bulk/V1/products/bySku/media`). Cada envío aparece en **System → Action Logs → Bulk Actions**, a nombre del usuario que lo hizo. Para que se vea el nombre real de cada persona, combínalo con `AUTH_MODE=magento`.

- **Procesamiento**: Magento procesa las subidas con su cron. El dashboard muestra «Esperando a que Magento procese…» y el resultado de cada imagen cuando termina. El CSV incluye el `bulk_uuid`.
- **Agrupación**: un lote grande puede verse como varias entradas en Bulk Actions. Cada envío lleva como máximo ~3,5 MB, por el límite de Vercel.
- **Lo que sigue siendo inmediato y no aparece en Bulk Actions**:
  - Borrar la galería anterior (modo reemplazar).
  - Correr las imágenes existentes en «Imagen a varios SKU».
  - Todo el editor de un producto.
- **Si pulsas Detener**: lo ya encolado se procesa igualmente en Magento.

Requisitos en Magento:

- **Cron y consumidor**: el cron debe estar activo y procesar el consumidor `async.operations.all`. Lo hace por defecto con `consumers_runner`; también puedes lanzarlo con `bin/magento queue:consumers:start async.operations.all`. Si no corre, el dashboard avisa tras 15 minutos y las imágenes quedan en cola.
- **Permiso Bulk Actions**: el rol del usuario necesita también **System → Action Logs → Bulk Actions** para que el dashboard pueda leer el estado.
- **Tamaño de envío**: PHP debe aceptar envíos de hasta `MAGENTO_BULK_MAX_MB` (16 MB por defecto, en `post_max_size`).

## Imágenes iguales en todas las tiendas (store views)

En Magento, una store view puede tener **valores propios** de imágenes: roles, alt, posición y «ocultar». El dashboard guarda a nivel general, así que una tienda con valores propios seguiría mostrando lo anterior.

Con `MAGENTO_SYNC_STORES=1`:

- **Editor**: al abrir un producto, avisa si alguna tienda tiene valores distintos de los generales y ofrece «Igualar todas las tiendas a lo general». Después de cada cambio (guardar, subir, reemplazar, borrar), iguala las tiendas automáticamente.
- **Subida masiva, «Imagen a varios SKU» y borrado masivo**: tienen la casilla «Igualar todas las tiendas a lo general», marcada por defecto. Se aplica al terminar cada producto; en modo cola, cuando Magento termina.
- **Productos**: la acción masiva «Igualar tiendas» arregla los productos seleccionados.

Cómo funciona: la REST API de Magento **no permite volver a «Use Default Value»** en una tienda. Por eso el dashboard **copia los valores generales en cada tienda que difiere**, y solo en las imágenes que difieren.

Hay dos consecuencias:

- **Las tiendas no heredan cambios hechos en el Admin.** Quedan con valores propios iguales a lo general. Si después cambias una imagen a nivel general **desde el Admin**, las tiendas no lo heredan. Los cambios hechos desde el dashboard, en cambio, siempre las vuelven a igualar.
- **Riesgo según la versión de Magento.** Al guardar en una tienda, Magento guarda el producto en esa tienda. En 2.4 normalmente solo escribe lo que cambia, pero en algunas versiones puede marcar otros atributos (nombre, URL) como propios de la tienda. **Pruébalo primero en staging con un producto** y revisa en el Admin que el nombre y la URL de la tienda sigan con «Use Default Value».

## Productos vinculados rotos

Al guardar un producto por la API, Magento vuelve a grabar todos sus productos vinculados (relacionados, up-sell, cross-sell). Si uno falla, rechaza todo el guardado con «The linked products data is invalid» o «The product can't be saved», aunque la imagen esté bien.

- **Revisar vínculos** (Productos → seleccionar → acción masiva): solo lee e indica qué productos tienen vínculos a SKU que ya no existen.
- **Reparar vínculos** (acción masiva, o el botón que aparece en el error del editor): vuelve a guardar el producto con los vínculos válidos, como hace el Admin. Quita solo los que apuntan a SKU inexistentes y queda en el Historial.

## Historial de acciones

Cada acción queda registrada: Subida masiva, Imagen a varios SKU, borrados masivos, Igualar tiendas y cada guardado, reemplazo, borrado o añadido en el editor. Cada registro guarda el usuario de Magento, la fecha, la duración, los parámetros, los productos y el resultado de cada imagen. El registro se abre al empezar, así que si alguien cierra la pestaña la acción queda como «En curso».

- **Dónde se ve**: en **Historial**. Cada usuario ve solo sus propias acciones. Se puede filtrar por tipo, abrir el detalle y descargarlo en CSV.
- **Dónde se guarda**: en un almacenamiento privado de **Vercel Blob**, conectado al proyecto. Usa `BLOB_STORE_ID` (autenticación OIDC, la que crea Vercel al conectar un store nuevo) o, si no está, `BLOB_READ_WRITE_TOKEN`. Así cada entorno puede tener su propio store (p. ej. uno de staging solo para Preview). Si no existe ninguna, el registro se desactiva y el resto funciona igual.
- **Desarrollo local**: con `AUDIT_LOCAL_DIR=./audit-data` se guarda en disco.

## 3. (Opcional) Login por usuario con Supabase

Úsalo si varias personas van a usar el dashboard y quieres saber quién hizo cada lote.

1. Crea un proyecto en [supabase.com](https://supabase.com).
2. En **SQL Editor** ejecuta `supabase/migrations/001_job_logs.sql`.
3. En **Authentication → Users** crea los usuarios (email + contraseña). Desactiva el registro público en **Authentication → Providers → Email** si solo quieres usuarios invitados.
4. En Vercel añade `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` (en **Project Settings → API**) y vuelve a desplegar.

Con Supabase configurado, el login pasa a ser por email. `DASHBOARD_PASSWORD` deja de usarse.

## Desarrollo local

```bash
cp .env.example .env.local   # y rellena los valores
npm install
npm run dev                  # http://localhost:3000
npm test                     # tests unitarios
npm run build                # build de producción
```

## Notas técnicas

- El token de Magento solo existe en el servidor (rutas `app/api/*`). El navegador nunca lo ve.
- Vercel limita cada petición a 4,5 MB, por eso la cola masiva corre en el navegador: una imagen por petición, 4 productos en paralelo, y las imágenes de un mismo SKU en serie para no pisar su galería. **No cierres la pestaña durante un lote.** Si lo detienes, el resumen indica lo que quedó pendiente.
- Al editar una imagen (`PUT`) no se envía `file` ni `content`. Si se envían, Magento crea una imagen duplicada en vez de editarla.
- Se usa el store `all`, así que roles y textos alternativos se guardan como valores globales.
- Si después de un lote grande no ves las imágenes en la tienda, limpia la caché (`bin/magento cache:flush`) y, si hace falta, `bin/magento catalog:images:resize`.

## Estructura

```
lib/magento.ts         cliente REST de Magento (servidor)
lib/skuMatcher.ts      nombre de archivo → SKU + posición
lib/bulk.ts            lotes en el navegador (subir, borrar, reemplazar)
lib/session.ts         sesión firmada para el login por contraseña
middleware.ts          protege páginas y API
app/api/...            proxy hacia Magento
components/...         Productos, Editor, Subida masiva, Historial
supabase/migrations/   tabla job_logs (opcional)
```

# Dashboard de imágenes para Magento 2

Web para **subir, ordenar, editar y borrar imágenes de productos de Magento 2 de forma masiva**, usando la REST API de la tienda. Se despliega en **Vercel**; **Supabase** es opcional (login por usuario y historial de lotes).

## Qué hace

- **Productos**: busca por SKU o nombre, muestra miniatura y número de imágenes, y avisa de productos sin imagen base.
- **Editor por producto**: arrastra para reordenar, asigna roles (Base, Small, Thumbnail, Swatch), edita el texto alternativo, oculta, reemplaza (conserva rol y posición), borra y añade imágenes.
- **Subida masiva por SKU**: arrastra cientos de archivos con nombres `SKU.jpg`, `SKU_2.jpg`, `SKU_3.jpg`…
  - Vista previa que comprueba en Magento que cada SKU existe antes de subir.
  - Modo **añadir** (no toca lo que hay) o **reemplazar galería** (borra las actuales).
  - La imagen 1 puede quedar como base/small/thumbnail. En modo añadir, la base existente solo se cambia si subes la posición 1.
  - Redimensiona a 2500 px y comprime en el navegador; convierte WebP a JPG.
  - Progreso en vivo, botón de detener y CSV con el resultado.
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

## 3. (Opcional) Login por usuario con Supabase

Úsalo si varias personas van a usar el dashboard y quieres saber quién hizo cada lote.

1. Crea un proyecto en [supabase.com](https://supabase.com).
2. En **SQL Editor** ejecuta `supabase/migrations/001_job_logs.sql`.
3. En **Authentication → Users** crea los usuarios (email + contraseña). Desactiva el registro público en **Authentication → Providers → Email** si solo quieres usuarios invitados.
4. En Vercel añade `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` (en **Project Settings → API**) y vuelve a desplegar.

Con Supabase configurado, el login pasa a ser por email y aparece la pestaña **Historial**. `DASHBOARD_PASSWORD` deja de usarse.

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

# Asistencia Fiesta de Fin de Año

App para que cada invitado obtenga su QR con su DNI, el personal de puerta lo escanee y RRHH controle la asistencia.

- `server/` — API Node + Express (login propio con JWT, Supabase como base de datos y storage de fotos).
- `client/` — React + Vite.
- `api/index.js` + `vercel.json` — deploy en Vercel (estático + API como una función serverless).
- `docs/ARQUITECTURA.md` — contrato de la API y decisiones de diseño.

## Puesta en marcha

1. **Supabase**: crear un proyecto y
   1. ejecutar una vez `server/db/schema.sql` en *SQL Editor*. Crea el schema **`appfiesta`** (tablas, vista, funciones, permisos solo para `service_role`) y el bucket `fotos`;
   2. en *Project Settings → Data API → Exposed schemas* **agregar `appfiesta`** (sin quitar los que ya están) y guardar. Sin este paso la API responde `PGRST106` y nada funciona.
2. **Backend**
   ```bash
   cd server
   npm install
   cp .env.example .env   # completar SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY y JWT_SECRET
   npm run seed:admin -- admin "Admin RRHH"   # crea el primer usuario de RRHH
   npm run dev            # http://localhost:4000
   ```
3. **Frontend**
   ```bash
   cd client
   npm install
   npm run dev            # http://localhost:5173
   ```

## Modo local (sin Postgres ni Supabase)

Para probar en una PC sin nada instalado: `server/.env` con `DB_MODE=local` (es el default si no hay `SUPABASE_URL` real).
La base es Postgres embebido (PGlite, WASM) en `server/.data/pgdata` y las fotos se guardan en `server/.data/fotos` (servidas en `/fotos`; Vite las proxea).
En el primer arranque se aplica `db/schema.sql` y se crean los usuarios `rrhh` y `scanner` con passwords aleatorias escritas en **`server/.data/CREDENCIALES-LOCAL.txt`**.

```bash
npm run dev --prefix server          # http://localhost:4000
npm run reset:local --prefix server  # borra server/.data (base, fotos y credenciales) para empezar de cero
```

Las tablas se crean en el schema `appfiesta`, igual que en Supabase. Si `server/.data` fue creada por una versión anterior (tablas en `public`), el server avisa al arrancar: correr `npm run reset:local --prefix server`.

PGlite admite un solo proceso: no correr `seed:admin` (ni un segundo server) contra la base local mientras el server está levantado.

### Actualizar una base de Supabase ya creada

Si `schema.sql` se corrió con una versión anterior, ejecutar en el *SQL Editor*, en orden, los archivos de `server/db/migraciones/` que falten (son idempotentes):
`001_estado_por_token.sql` y **`002_confirmacion_ingreso.sql`** (obligatoria para el escáner con confirmación: tabla `rechazos` y funciones `verificar_qr` / `registrar_rechazo`). El modo local las aplica solo al arrancar.

## Pantallas

| Ruta | Quién | Qué hace |
|---|---|---|
| `/` | Invitado (link público) | Ingresa DNI → ve y descarga su QR, o aviso de que no está en la lista |
| `/login` | RRHH / Escáner | Ingreso con usuario y contraseña |
| `/scanner` | Escáner (y RRHH) | Cámara → foto y datos → **VERIFICÁ LA IDENTIDAD**: *Confirmar ingreso* (**PUEDE PASAR**) o *No es la persona* (**INGRESO RECHAZADO**, queda auditado). También **QR YA USADO** (hora y quién) / **NO PASA** |
| `/admin` | RRHH | Asistencia en vivo + export Excel, empleados, importar Excel, fotos masivas, usuarios |

## Importación de Excel

Columnas: `nombre`, `documento` (o `DNI`), `empresa`, `sector`. Mayúsculas, tildes y espacios no importan.
Cada reimportación **inserta** los documentos nuevos, **actualiza** los que cambiaron y **nunca borra** a quien no esté en el archivo.
Ejemplo para probar: `server/scripts/ejemplo-empleados.xlsx`.

## Fotos

Desde *Fotos masivas* se suben muchas imágenes juntas. Cada archivo se vincula al empleado por su nombre de archivo:

- **documento**: `30123456.jpg`, `30.123.456.png` o CUIT `20-30123456-7.jpg`;
- **apellido y nombre** exactamente como en el Excel: `ABIUS JOAQUIN.jpg`. No importan mayúsculas, acentos, guiones bajos, espacios de más, el orden de las palabras ni sufijos de copia como ` (1)`; **no** se adivinan nombres mal escritos.

Formatos: JPG, PNG o WebP (HEIC de iPhone **no**: convertir a JPG). Si dos empleados se llaman igual, la foto queda como *nombre repetido* y hay que nombrarla con el documento.
Al terminar se ve qué archivo se asignó a quién, cuáles no se vincularon (y por qué) y el listado **Quedaron sin foto** (también visible antes de subir), descargable como CSV para Excel. También se puede subir de a una desde *Empleados*.
Máximo **4 MB por foto** y 4 MB para el Excel de importación (Vercel no acepta requests de más de 4.5 MB); la carga masiva se envía en lotes chicos automáticamente.

## Después de las pruebas (borrar datos de prueba)

Antes del evento real, para dejar la base vacía (empleados, asistencias, rechazos, **usuarios** y fotos) sin tocar la estructura:

```bash
npm run reset:datos --prefix server                       # usa DB_MODE de server/.env (Supabase o local)
npm run reset:datos --prefix server -- --local            # fuerza la base local (PGlite)
npm run reset:datos --prefix server -- --si-estoy-seguro  # sin pregunta (no interactivo)
npm run seed:admin --prefix server -- admin "Admin RRHH"  # después: volver a crear el usuario RRHH
```

El script muestra el **proyecto de Supabase** (ref de la URL) y cuántos registros/fotos va a borrar, y pide escribir exactamente `BORRAR TODO`. Borra todas las fotos del bucket `fotos` con la Storage API (el bucket queda) y luego las filas de `rechazos`, `asistencias`, `empleados` y `usuarios`.
En modo local el server tiene que estar **frenado** (PGlite admite un solo proceso; el script se niega si responde el puerto del server). En local, al volver a arrancar el server se recrean `rrhh`/`scanner` con passwords nuevas en `CREDENCIALES-LOCAL.txt`; para borrar todo, incluida la base, también sirve `npm run reset:local --prefix server`.

Alternativa solo SQL: `server/db/reset-datos.sql` (`TRUNCATE ... CASCADE` de las tablas de `appfiesta`) en el *SQL Editor*. **No borra las fotos** (Supabase no permite borrar `storage.objects` por SQL): borrarlas desde *Storage → fotos* o con el script.

## Producción en Vercel

Un único proyecto de Vercel importado desde la **raíz** del repo (Root Directory vacío). `vercel.json` ya define install, build (`client/dist`), la función `api/index.js` (Express) y los rewrites (`/api/*`, `/health`, `/ready` → función; el resto → SPA).

1. Hacer los dos pasos de Supabase de arriba (schema + *Exposed schemas*) y crear el primer usuario RRHH desde una PC con `server/.env` apuntando a Supabase: `npm run seed:admin --prefix server -- admin "Admin RRHH"`.
2. En Vercel → *Project Settings → Environment Variables* (Production):
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET` (≥ 32 bytes aleatorios), `DB_MODE=supabase`, y opcionales `CORS_ORIGIN=https://<tu-app>.vercel.app`, `PUBLIC_BASE_URL`, `LOG_LEVEL`, `DB_SCHEMA` (default `appfiesta`).
3. Deploy. Verificar `https://<tu-app>.vercel.app/ready` → `{"status":"ok"}`.

Notas: la función nunca arranca en modo local (falla con un error claro si `DB_MODE` no es `supabase`). El rate limit es en memoria por instancia serverless (aproximado, aceptable). Si Supabase usa un dominio propio, ajustar `img-src` de la CSP en `vercel.json`.

## Producción en un servidor propio

`cd client && npm run build`, luego en `server/` con `NODE_ENV=production npm start`: el backend sirve también el frontend en el mismo puerto.
**La cámara del escáner sólo funciona con HTTPS** (o en `localhost`), así que el deploy debe tener certificado.

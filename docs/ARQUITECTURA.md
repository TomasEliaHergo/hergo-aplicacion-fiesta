# Arquitectura - Asistencia Fiesta de Fin de Año

App chica, monolito: **un** backend Express + **un** frontend React. Sin microservicios.

```
[Empleado (público)] ─┐
[Scanner (celular)]  ─┼─HTTPS─> client/ (React+Vite, SPA) ──/api──> server/ (Express, Node 22)
[RRHH (PC)]          ─┘                                               │  SERVICE_ROLE key
                                                                      ├─> Supabase Postgres
                                                                      └─> Supabase Storage (bucket "fotos")
[Navegador] ──GET imagen──> URL pública del bucket "fotos" (única excepción al "solo backend")
```

- El frontend **nunca** usa la key de Supabase. Toda escritura/lectura de datos pasa por `/api`.
- RLS activo sin policies: aunque se filtre la anon key, no da acceso a nada.
- Esquema: `server/db/schema.sql` (correr una vez en el SQL Editor). Todo lo de la app (tablas `usuarios`/`empleados`/`asistencias`, vista `v_empleados`, funciones, triggers e índices) vive en el schema propio **`appfiesta`**, no en `public`. Solo `service_role` tiene `usage` + privilegios sobre él; `anon`/`authenticated` no tienen ninguno (y RLS sigue activo sin policies). Las funciones fijan `search_path = appfiesta, extensions, public` y además califican todos los nombres. El bucket `fotos` sigue en `storage.buckets`.
- El backend usa `createClient(..., { db: { schema: DB_SCHEMA } })` (`DB_SCHEMA`, default `appfiesta`, definido una sola vez en `server/src/config.js`). Para que PostgREST lo sirva hay que agregar `appfiesta` en *Dashboard → Project Settings → Data API → Exposed schemas*; si no, toda consulta falla con `PGRST106`.

## Decisiones

| Tema | Decisión | Motivo |
|---|---|---|
| Fotos | Bucket **público**, path no adivinable `empleados/{empleadoId}/{random}.webp` | El scanner necesita cargar la foto al instante y sin URLs que vencen; el path aleatorio evita enumeración. |
| Procesamiento de fotos | `sharp`: recorte/resize a 600px, WebP calidad 80 | Fotos livianas en celulares con mala señal. Al reemplazar, se borra el archivo anterior (path nuevo = sin problemas de caché). |
| Escaneo | RPC `registrar_asistencia(token, usuario)` | `insert ... on conflict do nothing` + lectura, atómico y en 1 round-trip. |
| Listado con `asistio` | Vista `v_empleados` (left join asistencias) | supabase-js no filtra cómodo por ausencia de join. |
| Resumen | RPC `resumen_asistencias()` con `group by rollup` | Totales general, por empresa y por empresa+sector en una consulta. |
| Columna "foto URL" en import | **Se ignora** | Evita SSRF/descargas arbitrarias; las fotos se suben por `/fotos` (bulk). |
| Usuarios | No se borran, se desactivan (`activo=false`) | `asistencias.escaneado_por` los referencia (auditoría). |
| Documento | Solo dígitos, 5-12 caracteres (DNI/CUIT). Normalizado en backend y en trigger | Evita duplicados por "12.345.678" vs "12345678". |
| QR | Codifica solo `qr_token` (43 chars url-safe), inmutable (trigger lo bloquea) | Un QR impreso/capturado sigue sirviendo aunque cambien los datos. |

## Autenticación (propia, no Supabase Auth)

- **Login**: `POST /api/auth/login` → bcrypt (`bcryptjs`, cost 12) contra `usuarios.password_hash`. Mismo error para usuario inexistente, inactivo o password incorrecta (`CREDENCIALES_INVALIDAS`).
- **JWT** HS256 firmado con `JWT_SECRET` (>= 32 bytes aleatorios), expira en **10h**. Claims: `{ sub: usuarioId, rol, nombre }`.
- **Transporte**: header `Authorization: Bearer <jwt>`. El cliente lo guarda en `sessionStorage` (sin cookies => sin CSRF; CSP estricta para mitigar XSS).
- **`requireAuth(roles)`**: valida firma/expiración, luego consulta `usuarios` por `sub` (cache en memoria 60s) para verificar `activo` y que el `rol` siga igual. Así desactivar un usuario corta su acceso en <= 1 min. Fallo → `401 NO_AUTENTICADO`; rol no permitido → `403 SIN_PERMISO`.
- **Seed**: `npm run seed:admin -- --username admin --nombre "Admin RRHH"`; password desde `SEED_ADMIN_PASSWORD` (o prompt). Falla si el username ya existe.
- **Reglas**: RRHH no puede desactivarse ni cambiarse el rol a sí mismo; no se puede desactivar al último RRHH activo (`409 ULTIMO_RRHH`). Password mínimo 8 caracteres.
- **Rate limit** (`express-rate-limit`, `app.set('trust proxy', 1)`): login 10/min por IP; `/api/public/qr` 20/min por IP; global 300/min por IP.

## Convenciones de la API

- JSON en UTF-8, base `/api`. Fechas ISO-8601 UTC (el cliente muestra en `America/Argentina/Buenos_Aires`).
- Error estándar: `{ "error": "CODIGO", "mensaje": "Texto en español", "detalles"?: [...] }`.
- Validación de entrada con `zod` en cada ruta; error → `400 VALIDACION` con `detalles: [{campo, motivo}]`.
- Paginación: `?page=1&pageSize=50` (máx 200) → `{ items, total, page, pageSize }`.
- `foto_url` siempre se devuelve calculada (`getPublicUrl(foto_path)`) o `null`.

Códigos comunes: `400 VALIDACION`, `401 NO_AUTENTICADO`, `403 SIN_PERMISO`, `404 NO_ENCONTRADO`, `409 DUPLICADO`, `413 ARCHIVO_MUY_GRANDE`, `415 TIPO_NO_SOPORTADO`, `429 DEMASIADAS_SOLICITUDES`, `500 ERROR_INTERNO`.

Objeto `Empleado`:
```json
{ "id": "uuid", "documento": "30123456", "nombre": "Ana Pérez", "empresa": "Hergo", "sector": "Ventas",
  "foto_url": "https://<proj>.supabase.co/storage/v1/object/public/fotos/empleados/<id>/<rnd>.webp",
  "asistio": true, "escaneado_at": "2026-12-19T23:41:00Z", "escaneado_por_nombre": "Puerta 1",
  "created_at": "...", "updated_at": "..." }
```
Objeto `Usuario`: `{ "id", "username", "nombre", "rol": "rrhh|scanner", "activo", "created_at" }` (nunca `password_hash`).

## Endpoints

### Infra
| Método | Path | Auth | Respuesta |
|---|---|---|---|
| GET | `/health` | - | `200 {status:"ok"}` (liveness) |
| GET | `/ready` | - | `200 {status:"ok"}` si responde Postgres; si no `503` |

### Auth
| Método | Path | Auth | Body | Respuesta / errores |
|---|---|---|---|---|
| POST | `/api/auth/login` | - | `{username, password}` | `200 {token, expiraEn, usuario:Usuario}` · `401 CREDENCIALES_INVALIDAS` · `429` |
| GET | `/api/auth/me` | cualquiera | - | `200 Usuario` · `401` |

### Público
| Método | Path | Auth | Body | Respuesta / errores |
|---|---|---|---|---|
| POST | `/api/public/qr` | - (rate limit IP) | `{documento}` (se normaliza) | `200 {nombre, empresa, qr_token}` · `404 {error:"NO_ENCONTRADO"}` · `400 VALIDACION` · `429` |

El cliente genera el QR (lib `qrcode`) a partir de `qr_token` y ofrece "Descargar imagen".

### Scanner
| Método | Path | Auth | Body | Respuesta |
|---|---|---|---|---|
| POST | `/api/scan` | scanner, rrhh | `{token}` | `200` siempre que el request sea válido (ver abajo) · `400 VALIDACION` |

```json
{ "estado": "OK | YA_INGRESO | INVALIDO",
  "empleado": { "nombre": "Ana Pérez", "documento": "30123456", "empresa": "Hergo", "sector": "Ventas", "foto_url": "..." },
  "escaneado_at": "2026-12-19T23:41:00Z" }
```
`INVALIDO` → `empleado: null, escaneado_at: null`. `YA_INGRESO` devuelve la hora del **primer** ingreso. Se responde 200 en los tres casos para que la UI muestre pantalla verde/amarilla/roja sin manejar errores.

### Empleados (RRHH)
| Método | Path | Body / query | Respuesta / errores |
|---|---|---|---|
| GET | `/api/empleados` | `?q=&empresa=&sector=&asistio=true\|false&page=&pageSize=&orden=nombre\|escaneado_at` | `200 {items: Empleado[], total, page, pageSize}`. `q` busca en nombre (ilike, trigram) o documento (prefijo). |
| GET | `/api/empleados/filtros` | - | `200 {empresas: string[], sectores: string[]}` (para combos) |
| GET | `/api/empleados/:id` | - | `200 Empleado` · `404` |
| POST | `/api/empleados` | `{documento, nombre, empresa?, sector?}` | `201 Empleado` · `409 DUPLICADO` (documento) |
| PUT | `/api/empleados/:id` | `{documento?, nombre?, empresa?, sector?}` | `200 Empleado` · `404` · `409 DUPLICADO` |
| DELETE | `/api/empleados/:id` | - | `204` (borra también asistencia y foto) · `404` |
| GET | `/api/empleados/:id/qr` | - | `200 {qr_token}` (RRHH puede reimprimir un QR) |
| POST | `/api/empleados/:id/foto` | multipart `foto` (jpg/png/webp, máx 4 MB) | `200 Empleado` · `404` · `413` · `415` |
| DELETE | `/api/empleados/:id/foto` | - | `204` |
| POST | `/api/empleados/fotos` | multipart `fotos[]` (máx 300 archivos/request, 4 MB c/u; el cliente manda lotes de ≤ 3.5 MB acumulados y ≤ 20 archivos). Nombre de archivo = documento (`30.123.456.jpg` se normaliza) | `200 {subidas, errores:[{archivo, motivo}]}` motivos: `DOCUMENTO_NO_EXISTE`, `TIPO_NO_SOPORTADO`, `ARCHIVO_MUY_GRANDE`, `IMAGEN_INVALIDA` |
| POST | `/api/empleados/import` | multipart `archivo` (.xlsx/.xls/.csv, máx 4 MB) | `200 {insertados, actualizados, sinCambios, errores:[{fila, motivo}]}` · `400 COLUMNAS_FALTANTES {detalles:[...]}` · `415` |

**Import (detalle)** - lib `xlsx` (SheetJS) para los tres formatos; primera hoja.
1. Encabezados: `trim` + minúsculas + sin acentos (`normalize('NFD')`) + sin espacios/guiones bajos. Sinónimos: `dni|nrodocumento → documento`, `nombreyapellido|apellidoynombre → nombre`. Faltan `nombre` o `documento` → `400 COLUMNAS_FALTANTES`. Columna de foto: se ignora.
2. Por fila (`fila` = número de fila en Excel, el encabezado es la 1): normalizar documento (solo dígitos; números de Excel → string sin decimales), `trim`/colapsar espacios en textos. Motivos de error: `DOCUMENTO_VACIO`, `DOCUMENTO_INVALIDO`, `NOMBRE_VACIO`, `DOCUMENTO_DUPLICADO_EN_ARCHIVO (también en fila N)` - en duplicados **ninguna** de las filas se aplica.
3. Traer existentes con `documento in (...)` en lotes de 500; comparar `nombre, empresa, sector` → insertar nuevos / actualizar cambiados / contar sin cambios. Upserts en lotes de 500.
4. **Nunca** se borra ni se toca `qr_token`/`foto_path` de empleados existentes ni de los ausentes del archivo.

### Asistencias (RRHH)
| Método | Path | Body / query | Respuesta / errores |
|---|---|---|---|
| GET | `/api/asistencias/resumen` | - | `200` (ver abajo) |
| GET | `/api/asistencias/export` | `?empresa=&sector=` | `200` archivo `asistencia-YYYY-MM-DD-HHmm.xlsx` con hojas `Presentes` y `Ausentes` (documento, nombre, empresa, sector, hora ingreso AR, escaneado por) |
| DELETE | `/api/asistencias/:empleadoId` | - | `204` · `404 NO_ENCONTRADO` (no tenía ingreso). Se loguea quién deshizo. |

```json
{ "total": 820, "presentes": 512, "ausentes": 308, "porcentaje": 62.4,
  "porEmpresa": [ { "empresa": "Hergo", "total": 500, "presentes": 320,
                    "sectores": [ { "sector": "Ventas", "total": 80, "presentes": 61 } ] } ],
  "actualizadoAt": "2026-12-19T23:50:00Z" }
```
El panel RRHH hace polling cada 15s (suficiente; sin WebSocket).

### Usuarios (RRHH)
| Método | Path | Body | Respuesta / errores |
|---|---|---|---|
| GET | `/api/usuarios` | `?rol=&activo=` | `200 Usuario[]` |
| POST | `/api/usuarios` | `{username, nombre, rol, password}` | `201 Usuario` · `409 DUPLICADO` |
| PUT | `/api/usuarios/:id` | `{nombre?, rol?, activo?}` | `200 Usuario` · `404` · `409 ULTIMO_RRHH` · `409 OPERACION_SOBRE_SI_MISMO` |
| POST | `/api/usuarios/:id/password` | `{password}` | `204` · `404` |

No hay DELETE (desactivar con `activo:false`).

## Estructura de carpetas

```
aplicacion-asistencia-fiesta/
├─ package.json                 # mínimo, solo para Vercel: "type":"module", engines node 22.x (sin dependencias)
├─ vercel.json                  # build del cliente + función /api + rewrites + headers del estático
├─ api/index.js                 # entrada serverless de Vercel: createApp() de server/ (solo DB_MODE=supabase)
├─ .gitignore
├─ docs/ARQUITECTURA.md
├─ server/
│  ├─ package.json              # "type":"module"; scripts: dev, start, seed:admin
│  ├─ .env.example              # SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, JWT_SECRET, PORT, CORS_ORIGIN, SEED_ADMIN_PASSWORD
│  ├─ db/schema.sql
│  ├─ scripts/seed-admin.js
│  └─ src/
│     ├─ index.js               # arranque, lee env y valida (zod)
│     ├─ app.js                 # express, helmet, cors, pino-http, rate limits, rutas, error handler
│     ├─ config.js
│     ├─ lib/                   # supabase.js, jwt.js, passwords.js, documento.js, storage.js, excel.js, errors.js
│     ├─ middleware/            # requireAuth.js, validate.js, upload.js (multer memoryStorage), errorHandler.js
│     ├─ routes/                # auth.js, public.js, scan.js, empleados.js, asistencias.js, usuarios.js
│     └─ services/              # empleados.service.js, import.service.js, fotos.service.js, asistencias.service.js, usuarios.service.js
└─ client/
   ├─ package.json
   ├─ vite.config.js            # proxy /api -> http://localhost:3000 en dev
   └─ src/
      ├─ main.jsx, App.jsx      # rutas react-router
      ├─ api/client.js          # fetch wrapper: agrega Bearer, maneja 401 -> /login
      ├─ auth/                  # AuthContext.jsx, RequireRole.jsx
      ├─ pages/
      │  ├─ public/MiQR.jsx     # "/" ingresar DNI -> QR
      │  ├─ Login.jsx           # "/login"
      │  ├─ scanner/Scanner.jsx # "/scanner" cámara (html5-qrcode), resultado a pantalla completa
      │  └─ rrhh/               # Dashboard, Empleados, EmpleadoForm, Importar, Fotos, Usuarios
      └─ components/
```

## Seguridad y operación (resumen)

- `SUPABASE_SERVICE_ROLE_KEY` y `JWT_SECRET` solo en variables de entorno del server; nunca en `client/` ni en git (`.env` en `.gitignore`).
- `helmet`, CORS restringido a `CORS_ORIGIN`, `express.json({limit:'100kb'})`, multer con límites de tamaño/cantidad y validación de MIME + decodificación real con `sharp`.
- Riesgo aceptado: quien conozca un DNI ajeno puede obtener su QR (decisión de producto). Mitigado con rate limit; el QR solo sirve una vez.
- Logs JSON con `pino` + `requestId` (header `X-Request-Id`); sin passwords ni tokens en logs. Se loguean scans, imports, undo de asistencias y cambios de usuarios con el `usuarioId`.
- Carga esperada: ~1000 empleados, picos de ~5 scans/s en la entrada. Una instancia sobra; el servidor es stateless (JWT), así que escala horizontal si hiciera falta (el cache de usuarios de 60s es por instancia, aceptable).
- En Vercel (serverless) el rate limit de `express-rate-limit` es **en memoria por instancia**: con varias instancias calientes el límite efectivo es N × el configurado, y se reinicia en cada cold start. Aceptado para esta app (el objetivo es frenar abuso grosero, no un límite exacto); si hiciera falta uno global, usar un store compartido (Redis/Upstash).

## Cambios de implementación (backend)

Aclaraciones y desvíos menores respecto del contrato, tal como quedaron implementados en `server/`:

| Tema | Implementación |
|---|---|
| Puerto | El server escucha en `PORT` (default **4000**, no 3000). El proxy de Vite debe apuntar a `http://localhost:4000`. |
| `expiraEn` (login) | String ISO-8601 UTC con el instante de expiración del JWT (ej. `"2026-12-20T09:41:00.000Z"`). |
| Fotos bulk | Se acepta el campo multipart `fotos` **o** `fotos[]` (ambos). Un archivo > 4 MB no aborta el request: se reporta como `ARCHIVO_MUY_GRANDE` en `errores`. Motivo extra posible: `ERROR_AL_GUARDAR` (falla de Storage/DB). Si el nombre de archivo no contiene un documento válido → `DOCUMENTO_NO_EXISTE`. |
| Foto individual | Imagen corrupta / no decodificable → `400 IMAGEN_INVALIDA`. Resize: rotación EXIF + encaja en 600x600 **sin recortar** (`fit: inside`, sin agrandar), WebP q80. |
| Import: `COLUMNAS_FALTANTES` | `detalles: [{campo:"documento", motivo:"Falta la columna \"documento\""}]` (misma forma que `VALIDACION`). |
| Import: archivo ilegible | `415 TIPO_NO_SOPORTADO`. Extensión distinta de .xlsx/.xls/.csv → `415`. CSV se lee como UTF-8 (BOM opcional) sin conversión de tipos. |
| Import: columnas opcionales | Si el archivo **no trae** la columna `empresa` o `sector`, esa columna no se compara ni se modifica en empleados existentes (altas nuevas quedan con `''`). Si la columna existe y la celda está vacía, se guarda `''`. |
| Import: encabezados | Además de espacios y `_`, se quitan `.` y `-` (`"Nro. Documento"` → `nrodocumento`). Sinónimos extra: documento ← `doc, nrodoc, nrodni, numerodocumento, cuit, cuil`; nombre ← `nombrecompleto, apellidoynombres, nombresyapellidos, empleado`; empresa ← `compania, razonsocial`; sector ← `area, departamento`. Columnas de foto (`foto, fotourl, imagen`) se ignoran. |
| Import: errores | Motivo extra posible: `ERROR_AL_GUARDAR` (falló el lote de upsert en la DB; esas filas no se cuentan). `errores` ordenado por `fila`. |
| `OPERACION_SOBRE_SI_MISMO` | Solo si el request efectivamente cambia el propio `rol` o pone `activo:false`. Mandar los mismos valores actuales no falla. |
| Búsqueda `q` | Si `q` (sin puntos/espacios/guiones) son solo dígitos: `documento` por prefijo **o** `nombre` ilike. Si no: `nombre` ilike `%q%`. Query params vacíos (`empresa=`) se ignoran. |
| `429` | Cuerpo `{error:"DEMASIADAS_SOLICITUDES", mensaje}` + headers `RateLimit`/`RateLimit-Policy` (draft-7). |
| `/ready` 503 | Cuerpo `{status:"error", error:"NO_DISPONIBLE", mensaje}`. Timeout de 3s contra Postgres. |
| Export | "Hora ingreso" como texto `dd/mm/aaaa hh:mm:ss` en hora Argentina; hoja `Presentes` ordenada por hora de ingreso. Nombre de archivo con fecha/hora AR. |
| Seed | `npm run seed:admin -- <username> "<Nombre>"` **o** `-- --username x --nombre "Y"`. |
| Producción | Fuera de Vercel, con `NODE_ENV=production` y `client/dist/index.html` presente, Express sirve el build con fallback SPA (assets con cache inmutable, `index.html` con `no-cache`). CSP permite imágenes del origen de `SUPABASE_URL`. |
| Errores zod | Mensajes en español (`z.config(z.locales.es())`). |
| Modo local | `DB_MODE=local` (default si falta `SUPABASE_URL` real): `getSupabase()` devuelve un cliente compatible con la parte de supabase-js que se usa (`src/lib/local-client.js`) sobre PGlite en `server/.data/pgdata`. Igual que en Supabase, todo va al schema `DB_SCHEMA` (`appfiesta`): el cliente local califica tablas y RPC (`"appfiesta"."registrar_asistencia"(...)`) y la conexión fija `search_path`. Una `.data` creada por la versión anterior (tablas en `public`) se detecta y se pide `npm run reset:local`. PGlite se carga solo por `import()` dinámico (nunca en Vercel). `schema.sql` se aplica sin cambios, creando stubs del schema `extensions`, los roles `anon/authenticated/service_role` y `storage.buckets` (`src/lib/local-db.js`). Storage = archivos en `server/.data/fotos`; `foto_url` es relativa (`/fotos/...`), la sirve Express y Vite la proxea. Usuarios `rrhh`/`scanner` auto-creados con credenciales en `server/.data/CREDENCIALES-LOCAL.txt`. Solo para desarrollo. |
| `registrar_asistencia` | Usa `on conflict on constraint asistencias_empleado_uk`: con `on conflict (empleado_id)` la columna OUT homónima del `returns table` daba error `42702` (ambigua) en cada escaneo válido. |
| Límites de subida | 4 MB por foto (individual y por archivo en bulk) y 4 MB para el Excel de import, porque Vercel rechaza requests de más de 4.5 MB. La carga masiva de fotos del cliente arma lotes por tamaño acumulado (< 3.5 MB y ≤ 20 archivos por request; una foto de 3.5-4 MB viaja sola). |

## Deploy en Vercel

Un solo proyecto de Vercel desde la raíz del repo:

- **Estático**: `vercel.json` corre `npm install --prefix server && npm install --prefix client` y `npm run build --prefix client`; publica `client/dist` en el CDN. `vercel.json` agrega los headers de seguridad del estático (CSP equivalente a la de helmet, con `img-src https://*.supabase.co`), y cache inmutable para `/assets/*`.
- **API**: `api/index.js` es **una** función serverless que exporta la app Express (`createApp({ serveClient: false })`). Rewrites: `/api/(.*)`, `/health` y `/ready` → `/api`; Express recibe el path original en `req.url`, así que las rutas montadas en `/api` funcionan igual que en local. El resto (`/(.*)`) cae en `/index.html` (fallback SPA; primero se sirve lo que exista en `client/dist`).
- La función **exige** `DB_MODE=supabase` (si `DB_MODE` viene con otro valor, falla al iniciar con un error claro; si no viene, se fuerza `supabase`) y valida `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y `JWT_SECRET`. `NODE_ENV` default `production`.
- Las dependencias se resuelven desde `server/node_modules` (el file tracer sigue los imports de `server/src`); la raíz no tiene dependencias. PGlite queda fuera del bundle: se importa con un specifier no analizable y además `excludeFiles` excluye `server/node_modules/@electric-sql/**`, `server/.data/**` y `client/**`.
- `maxDuration: 30` s. Frontend y API comparten dominio: CORS no interviene (mismo origen) y `trust proxy` ya está en 1. Rate limit por instancia (ver arriba).

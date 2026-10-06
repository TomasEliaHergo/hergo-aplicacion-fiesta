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

- **Login**: `POST /api/auth/login` → bcrypt (`bcryptjs`, **cost 10**; antes 12) contra `usuarios.password_hash`. Los hashes viejos de costo 12 siguen verificando (el costo va dentro del hash) y se rehashean a costo 10 en el primer login correcto (best effort). El hash señuelo para usuarios inexistentes está precalculado (antes se generaba con `hashSync` al importar el módulo: ~0,2-0,9 s de cold start). Mismo error para usuario inexistente, inactivo o password incorrecta (`CREDENCIALES_INVALIDAS`).
- **JWT** HS256 firmado con `JWT_SECRET` (>= 32 bytes aleatorios), expira en **10h**. Claims: `{ sub: usuarioId, rol, nombre, iat, exp }`. Implementado con `node:crypto` en `src/lib/jwt.js` (sin `jsonwebtoken`, que sumaba carga al cold start); solo acepta `alg: HS256` y es compatible con los tokens ya emitidos.
- **Transporte**: header `Authorization: Bearer <jwt>`. El cliente lo guarda en `sessionStorage` (sin cookies => sin CSRF; CSP estricta para mitigar XSS).
- **`requireAuth(roles)`**: valida firma/expiración y decide de dónde sale el usuario, **sin round trip a la DB en la mayoría de los requests**: (1) cache por instancia de < 5 min → se usa; (2) si no, token emitido hace < 5 min (`iat`) → se confía en los claims `rol`/`nombre` (el login ya exigió `activo`); (3) si no → consulta `usuarios` por `sub` y cachea 5 min. Verifica `activo` y que el `rol` siga igual al del token. Fallo → `401 NO_AUTENTICADO`; rol no permitido → `403 SIN_PERMISO`.
  - **Trade-off aceptado**: un usuario desactivado (o con rol cambiado) puede seguir operando **hasta 5 min** en las instancias serverless que no procesaron el cambio. En la instancia que atendió el `PUT /api/usuarios/:id` aplica de inmediato. Antes era <= 1 min, a costa de un round trip serie a Supabase (~150 ms) en casi todo request en Vercel, donde el cache en memoria casi nunca pega.
- **Seed**: `npm run seed:admin -- --username admin --nombre "Admin RRHH"`; password desde `SEED_ADMIN_PASSWORD` (o prompt). Falla si el username ya existe.
- **Reglas**: RRHH no puede desactivarse ni cambiarse el rol a sí mismo; no se puede desactivar al último RRHH activo (`409 ULTIMO_RRHH`). Password mínimo 8 caracteres.
- **Rate limit** (`express-rate-limit`, `app.set('trust proxy', 1)`): login 10/min por IP; `/api/public/qr` 20/min por IP; `/api/public/estado/:token` 60/min por IP; global 300/min por IP.

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
| POST | `/api/public/qr` | - (rate limit IP 20/min) | `{documento}` (se normaliza) | `200 {nombre, empresa, qr_token, ingreso: boolean, escaneado_at: string\|null}` · `404 {error:"NO_ENCONTRADO"}` · `400 VALIDACION` · `429` |
| GET | `/api/public/estado/:token` | - (rate limit IP 60/min) | - | `200 {nombre, ingreso: boolean, escaneado_at: string\|null}` · `404 {error:"NO_ENCONTRADO", mensaje}` (token inexistente **o** con formato inválido: se valida `^[A-Za-z0-9_-]{43}$` antes de ir a la DB) · `429` |

Ambos responden `Cache-Control: no-store`. `escaneado_at` = hora del (primer) ingreso en ISO-8601, `null` si no ingresó. `estado` es para la pantalla de bienvenida (el cliente hace polling cada 5 s) y es 1 round trip (RPC `estado_por_token`, ver Migraciones); `qr` hace 2 consultas **en paralelo** (tabla + vista por documento), 1 round trip de latencia.

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
| GET | `/api/empleados` | `?q=&empresa=&sector=&asistio=true\|false&foto=con\|sin&page=&pageSize=&orden=nombre\|escaneado_at` | `200 {items: Empleado[], total, page, pageSize}`. `q` busca en nombre (ilike, trigram) o documento (prefijo). `foto=sin` → `foto_path is null`, `foto=con` → `not foto_path is null` (lo usa *Fotos masivas* para "Quedaron sin foto", paginando de a 200). |
| GET | `/api/empleados/filtros` | - | `200 {empresas: string[], sectores: string[]}` (para combos). `Cache-Control: private, max-age=10`. |
| GET | `/api/empleados/:id` | - | `200 Empleado` · `404` |
| POST | `/api/empleados` | `{documento, nombre, empresa?, sector?}` | `201 Empleado` · `409 DUPLICADO` (documento) |
| PUT | `/api/empleados/:id` | `{documento?, nombre?, empresa?, sector?}` | `200 Empleado` · `404` · `409 DUPLICADO` |
| DELETE | `/api/empleados/:id` | - | `204` (borra también asistencia y foto) · `404` |
| GET | `/api/empleados/:id/qr` | - | `200 {qr_token}` (RRHH puede reimprimir un QR) |
| POST | `/api/empleados/:id/foto` | multipart `foto` (jpg/png/webp, máx 4 MB) | `200 Empleado` · `404` · `413` · `415` |
| DELETE | `/api/empleados/:id/foto` | - | `204` |
| POST | `/api/empleados/fotos` | multipart `fotos[]` (máx 300 archivos/request, 4 MB c/u; el cliente manda lotes de ≤ 3.5 MB acumulados y ≤ 20 archivos). Nombre de archivo = documento (`30.123.456.jpg`) **o** apellido y nombre como en `empleados.nombre` (`ABIUS JOAQUIN.jpg`); ver "Vinculación de fotos por nombre de archivo" | `200 {subidas, asignadas:[{archivo, documento, nombre, via:'documento'\|'nombre'}], errores:[{archivo, motivo}]}` motivos: `DOCUMENTO_NO_EXISTE`, `SIN_COINCIDENCIA`, `AMBIGUO (documentos a, b)`, `DUPLICADO_EN_LOTE`, `TIPO_NO_SOPORTADO`, `ARCHIVO_MUY_GRANDE`, `IMAGEN_INVALIDA`, `ERROR_AL_GUARDAR` |
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
| GET | `/api/asistencias/panel` | - | `200 { resumen, filtros }` = `resumen` (forma de abajo) + `filtros` (forma de `/api/empleados/filtros`) en **un** request (consultas en paralelo) para el primer pintado del dashboard. `Cache-Control: private, max-age=10`. Los endpoints viejos siguen. |
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
│  ├─ db/schema.sql            # instalación nueva (incluye todas las migraciones)
│  ├─ db/migraciones/          # NNN_*.sql idempotentes para bases ya creadas (correr a mano en Supabase; el modo local las aplica solo)
│  ├─ scripts/seed-admin.js
│  └─ src/
│     ├─ index.js               # arranque, lee env y valida (zod)
│     ├─ app.js                 # express, helmet, cors, pino-http, rate limits, rutas, error handler
│     ├─ config.js
│     ├─ lib/                   # supabase.js, jwt.js (HS256 con node:crypto), passwords.js, documento.js, storage.js, excel.js, errors.js
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
- Carga esperada: ~1000 empleados, picos de ~5 scans/s en la entrada. Una instancia sobra; el servidor es stateless (JWT), así que escala horizontal si hiciera falta (el cache de usuarios de 5 min es por instancia; ver trade-off en Autenticación).
- En Vercel (serverless) el rate limit de `express-rate-limit` es **en memoria por instancia**: con varias instancias calientes el límite efectivo es N × el configurado, y se reinicia en cada cold start. Aceptado para esta app (el objetivo es frenar abuso grosero, no un límite exacto); si hiciera falta uno global, usar un store compartido (Redis/Upstash).

## Cambios de implementación (backend)

Aclaraciones y desvíos menores respecto del contrato, tal como quedaron implementados en `server/`:

| Tema | Implementación |
|---|---|
| Puerto | El server escucha en `PORT` (default **4000**, no 3000). El proxy de Vite debe apuntar a `http://localhost:4000`. |
| `expiraEn` (login) | String ISO-8601 UTC con el instante de expiración del JWT (ej. `"2026-12-20T09:41:00.000Z"`). |
| Fotos bulk | Se acepta el campo multipart `fotos` **o** `fotos[]` (ambos). Un archivo > 4 MB no aborta el request: se reporta como `ARCHIVO_MUY_GRANDE` en `errores`. Motivo extra posible: `ERROR_AL_GUARDAR` (falla de Storage/DB). Si el nombre de archivo es un documento (5-12 dígitos) que no existe → `DOCUMENTO_NO_EXISTE`; si es un nombre sin coincidencia → `SIN_COINCIDENCIA`. |
| Foto individual | Imagen corrupta / no decodificable → `400 IMAGEN_INVALIDA`. Resize: rotación EXIF + encaja en 600x600 **sin recortar** (`fit: inside`, sin agrandar), WebP q80. |
| Fotos bulk: vinculación por nombre de archivo | Lógica pura en `server/src/lib/foto-match.js` (tests en `server/test/foto-match.test.js`). 1) Se quita la extensión y las marcas de copia (` (1)`, ` - copia`, ` copy`, `Copia de `). Si lo que queda, sin `. - _` ni espacios, son 5-12 dígitos → match por **documento** (DNI o CUIT). 2) Si no, se normaliza (minúsculas, sin acentos, `ñ→n`, `_ - . ,` → espacio, espacios colapsados) y se compara con `empleados.nombre` normalizado: **a)** igualdad exacta; **b)** si no, mismas palabras en cualquier orden (`joaquin abius` = `abius joaquin`). **Sin coincidencia aproximada** (nada de Levenshtein): un typo o una palabra de más/menos es `SIN_COINCIDENCIA`. Más de un empleado en (a) o (b) → `AMBIGUO (documentos …)` y no se sube. Dos archivos del mismo request que caen en el mismo empleado → el segundo es `DUPLICADO_EN_LOTE`. El índice (Maps por documento, nombre y bolsa de palabras) se arma una vez por request con todos los empleados (`id, documento, nombre, foto_path`, paginado de a 1000). Entre lotes distintos del cliente el servidor no ve repetidos: el cliente lo detecta en `asignadas` y reporta la foto pisada como `DUPLICADO_EN_LOTE (quedó …)`. |
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

## Migraciones de base de datos

`db/schema.sql` es para una base **nueva** (se corre una vez) y ya incluye todo. Los cambios posteriores van **además** en `db/migraciones/NNN_descripcion.sql`, idempotentes (`create or replace`, `if not exists`), con permisos solo para `service_role`:

| Archivo | Qué agrega | Cómo aplicarlo |
|---|---|---|
| `db/migraciones/001_estado_por_token.sql` | Función `appfiesta.estado_por_token(p_token text) returns table (nombre, escaneado_at)` para `GET /api/public/estado/:token` | **Supabase** (base ya creada): pegar el archivo completo en el SQL Editor y ejecutar (termina con `notify pgrst, 'reload schema'`). Mientras no se corra, el endpoint funciona igual pero con 2 consultas en serie y un warning en el log. **Local**: automático. |

El modo local aplica todos los `db/migraciones/*.sql` (orden alfabético) en **cada** arranque, después de crear el esquema si hacía falta; por eso deben ser idempotentes.

## Rendimiento (Vercel + Supabase)

Cada round trip a Supabase cuesta ~120-200 ms desde Argentina (más si la función corre lejos de la base, ver región abajo), así que se minimizan los round trips **en serie** por request.

**Cold start.** `api/index.js` solo carga lo necesario para los endpoints JSON. Se cargan con `import()` perezoso la primera vez que se usan: `sharp` (fotos), `xlsx`/SheetJS (import/export) y `multer` (uploads). Se quitó `jsonwebtoken` y el `bcrypt.hashSync` que corría al importar. Medido en una PC Windows (`await import('./api/index.js')` con env falsa, mediana de 12 procesos): **~1410 ms → ~710 ms**.

**Round trips en serie por request (Supabase), antes → ahora.** "auth" = `requireAuth`: ahora es 0 si el token tiene < 5 min o hay cache de < 5 min en la instancia, y 1 si no.

| Endpoint | Antes | Ahora |
|---|---|---|
| `POST /api/auth/login` | 1 (+ bcrypt costo 12) | 1 (+ bcrypt costo 10; +1 una sola vez por usuario para rehashear hashes viejos) |
| `GET /api/auth/me` | 1 auth + 1 | 0-1 auth + 1 |
| `POST /api/public/qr` | 1 | 1 (2 consultas en paralelo) |
| `GET /api/public/estado/:token` | - | 1 (0 si el formato es inválido) |
| `POST /api/scan` | 1 auth + 1 RPC | 0-1 auth + 1 RPC |
| `GET /api/empleados` (con `total`) | 1 auth + 1 | 0-1 auth + 1 |
| `GET /api/empleados/filtros` | 1 auth + 1 | 0-1 auth + 1 (+ cache del navegador 10 s) |
| `GET /api/asistencias/resumen` | 1 auth + 1 | 0-1 auth + 1 |
| Dashboard inicial (resumen + filtros) | 2 requests: 2 auth + 2 | **`/panel`**: 1 request, 0-1 auth + 1 (2 consultas en paralelo) |
| `POST /api/empleados` | 1 auth + 2 | 0-1 auth + 1 (insert ... returning) |
| `PUT /api/empleados/:id` | 1 auth + 2 | 0-1 auth + 1 (update y lectura de asistencia en paralelo) |
| `DELETE /api/empleados/:id` | 1 auth + 2 (+ Storage) | 0-1 auth + 1 (delete ... returning foto_path) (+ Storage) |
| `POST /api/empleados/:id/foto` | 1 auth + 1 + sharp + Storage + 1 + Storage + 1 | igual, pero la lectura corre en paralelo con sharp |
| `PUT /api/usuarios/:id` (desactivar / cambiar rol) | 1 auth + 3 | 0-1 auth + 2 (lectura y conteo de RRHH en paralelo) |
| Import | lotes de lectura y de upsert en serie | lotes de lectura en paralelo; inserts y updates en paralelo |

**Región de la función (importante).** Si la función de Vercel corre en una región distinta a la de la base, **cada** round trip suma la distancia entre ambas (p. ej. Washington ↔ São Paulo ≈ +120 ms por consulta). La región de la función debe coincidir con la de Supabase:

1. Ver la región de la base: Supabase Dashboard → Project Settings → General → **Region** (p. ej. `sa-east-1` São Paulo, `us-east-1` N. Virginia).
2. Elegir la región de Vercel equivalente: `sa-east-1` → `gru1` (São Paulo); `us-east-1` → `iad1` (Washington D.C.); `us-east-2` → `cle1`; `us-west-1` → `sfo1`; `eu-central-1` → `fra1`; `eu-west-1` → `dub1`.
3. Configurarla de **una** de estas formas y redeployar:
   - Vercel Dashboard → Project → Settings → **Functions** → *Function Region*; o
   - agregar en la raíz de `vercel.json` `"regions": ["gru1"]` (con el código que corresponda).

`vercel.json` **no** fija la región a propósito: depende de dónde se creó el proyecto de Supabase y no se puede adivinar.

**Cache HTTP.** `/api/empleados/filtros` y `/api/asistencias/panel` → `Cache-Control: private, max-age=10` (solo el navegador, nunca un CDN compartido). Todo lo demás de `/api` → `no-store`, en particular los endpoints públicos.

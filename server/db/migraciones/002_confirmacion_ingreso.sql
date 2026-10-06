-- =====================================================================
-- Migración 002: confirmación de identidad en la puerta + auditoría de rechazos
--
-- Para una base YA creada con una versión anterior de db/schema.sql:
-- copiar y ejecutar este archivo completo en el SQL Editor de Supabase.
-- Es idempotente (se puede correr más de una vez). schema.sql ya la incluye
-- para instalaciones nuevas. El modo local (PGlite) la aplica solo al arrancar.
--
-- Usada por:
--   POST /api/scan/verificar  -> appfiesta.verificar_qr(p_token)       (solo lectura, 1 round trip)
--   POST /api/scan/rechazar   -> appfiesta.registrar_rechazo(...)       (inserta en appfiesta.rechazos)
--   GET  /api/asistencias/resumen|panel -> count de appfiesta.rechazos
-- Sin esta migración esos endpoints responden 500 (POST /api/scan y
-- /api/scan/confirmar siguen funcionando: usan registrar_asistencia).
-- =====================================================================

-- ---------------------------------------------------------------------
-- rechazos: "No es la persona" marcado por el personal de la puerta.
-- No registra asistencia; solo auditoría.
-- ---------------------------------------------------------------------
create table if not exists appfiesta.rechazos (
  id             uuid primary key default gen_random_uuid(),
  empleado_id    uuid not null references appfiesta.empleados (id) on delete cascade,
  rechazado_por  uuid not null references appfiesta.usuarios (id) on delete restrict,
  motivo         text null,
  created_at     timestamptz not null default now(),
  constraint rechazos_motivo_largo check (motivo is null or length(motivo) <= 200)
);
create index if not exists rechazos_empleado_idx      on appfiesta.rechazos (empleado_id);
create index if not exists rechazos_rechazado_por_idx on appfiesta.rechazos (rechazado_por);
create index if not exists rechazos_created_at_idx    on appfiesta.rechazos (created_at desc);

alter table appfiesta.rechazos enable row level security;
revoke all on table appfiesta.rechazos from public, anon, authenticated;
grant all on table appfiesta.rechazos to service_role;

-- ---------------------------------------------------------------------
-- verificar_qr: estado del QR SIN registrar nada. 0 filas = token inexistente.
-- ---------------------------------------------------------------------
create or replace function appfiesta.verificar_qr(p_token text)
returns table (
  estado                text,
  empleado_id           uuid,
  nombre                text,
  documento             text,
  empresa               text,
  sector                text,
  foto_path             text,
  escaneado_at          timestamptz,
  escaneado_por_nombre  text
)
language sql
stable
set search_path = appfiesta, extensions, public
as $$
  select case when a.id is null then 'PENDIENTE' else 'YA_INGRESO' end,
         e.id, e.nombre, e.documento, e.empresa, e.sector, e.foto_path,
         a.escaneado_at, u.nombre
  from appfiesta.empleados e
  left join appfiesta.asistencias a on a.empleado_id = e.id
  left join appfiesta.usuarios   u on u.id = a.escaneado_por
  where e.qr_token = p_token;
$$;

-- ---------------------------------------------------------------------
-- registrar_rechazo: inserta el rechazo resolviendo el token en la misma
-- sentencia. Devuelve el empleado_id, o null si el token no existe.
-- ---------------------------------------------------------------------
create or replace function appfiesta.registrar_rechazo(p_token text, p_usuario uuid, p_motivo text)
returns uuid
language sql
volatile
set search_path = appfiesta, extensions, public
as $$
  insert into appfiesta.rechazos (empleado_id, rechazado_por, motivo)
  select e.id, p_usuario, nullif(left(btrim(p_motivo), 200), '')
  from appfiesta.empleados e
  where e.qr_token = p_token
  returning empleado_id;
$$;

-- Solo el backend (service_role). EXECUTE a PUBLIC es el default global de Postgres: se revoca.
revoke all on function appfiesta.verificar_qr(text) from public, anon, authenticated;
grant execute on function appfiesta.verificar_qr(text) to service_role;
revoke all on function appfiesta.registrar_rechazo(text, uuid, text) from public, anon, authenticated;
grant execute on function appfiesta.registrar_rechazo(text, uuid, text) to service_role;

-- Que PostgREST vea la tabla y las funciones nuevas.
notify pgrst, 'reload schema';

-- =====================================================================
-- Asistencia Fiesta de Fin de Año - Esquema Postgres (Supabase)
-- Ejecutar UNA vez en el SQL Editor de Supabase.
--
-- Todo lo de la app vive en el schema propio "appfiesta" (no en public).
-- El backend usa la SERVICE_ROLE key (bypassa RLS) con db.schema='appfiesta'.
-- RLS activo y SIN policies + sin grants => anon / authenticated no pueden
-- leer ni escribir nada.
--
-- IMPORTANTE (paso manual, además de correr este script):
--   Supabase Dashboard -> Project Settings -> Data API -> "Exposed schemas"
--   -> agregar  appfiesta  (dejando los que ya están) y guardar.
--   Si no se agrega, PostgREST responde PGRST106
--   ("The schema must be one of the following: ...") y el backend no anda.
--
-- Si se cambia DB_SCHEMA en el .env, reemplazar "appfiesta" en todo este
-- archivo por ese nombre (el modo local lo hace automáticamente).
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm  with schema extensions;

create schema if not exists appfiesta;

-- ---------------------------------------------------------------------
-- Helpers
-- (todas las funciones fijan search_path y además califican los nombres:
--  no dependen del search_path de quien las llama)
-- ---------------------------------------------------------------------

-- Token url-safe de 32 bytes aleatorios (43 caracteres, sin padding).
create or replace function appfiesta.generar_qr_token()
returns text
language sql
volatile
set search_path = appfiesta, extensions, public
as $$
  select translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
$$;

create or replace function appfiesta.set_updated_at()
returns trigger
language plpgsql
set search_path = appfiesta, extensions, public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Normaliza documento (solo dígitos) como red de seguridad; el backend
-- también normaliza antes de buscar/insertar.
create or replace function appfiesta.normalizar_documento()
returns trigger
language plpgsql
set search_path = appfiesta, extensions, public
as $$
begin
  new.documento := regexp_replace(coalesce(new.documento, ''), '\D', '', 'g');
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- usuarios (auth propia, NO Supabase Auth)
-- ---------------------------------------------------------------------
create table appfiesta.usuarios (
  id             uuid primary key default gen_random_uuid(),
  username       text not null,
  password_hash  text not null,
  nombre         text not null,
  rol            text not null check (rol in ('rrhh', 'scanner')),
  activo         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint usuarios_username_formato
    check (username = lower(username) and username ~ '^[a-z0-9._-]{3,40}$')
);
create unique index usuarios_username_uk on appfiesta.usuarios (username);

create trigger usuarios_updated_at
  before update on appfiesta.usuarios
  for each row execute function appfiesta.set_updated_at();

-- ---------------------------------------------------------------------
-- empleados
-- ---------------------------------------------------------------------
create table appfiesta.empleados (
  id          uuid primary key default gen_random_uuid(),
  documento   text not null,
  nombre      text not null check (length(trim(nombre)) > 0),
  empresa     text not null default '',
  sector      text not null default '',
  foto_path   text,                                   -- path dentro del bucket 'fotos'
  qr_token    text not null default appfiesta.generar_qr_token(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint empleados_documento_formato check (documento ~ '^[0-9]{5,12}$')
);
create unique index empleados_documento_uk on appfiesta.empleados (documento);
create unique index empleados_qr_token_uk  on appfiesta.empleados (qr_token);
create index empleados_empresa_idx on appfiesta.empleados (empresa);
create index empleados_sector_idx  on appfiesta.empleados (sector);
create index empleados_nombre_trgm on appfiesta.empleados
  using gin (lower(nombre) extensions.gin_trgm_ops);

create trigger empleados_normalizar_documento
  before insert or update of documento on appfiesta.empleados
  for each row execute function appfiesta.normalizar_documento();

create trigger empleados_updated_at
  before update on appfiesta.empleados
  for each row execute function appfiesta.set_updated_at();

-- qr_token es inmutable: nunca cambia después del insert.
create or replace function appfiesta.bloquear_cambio_qr_token()
returns trigger
language plpgsql
set search_path = appfiesta, extensions, public
as $$
begin
  if new.qr_token is distinct from old.qr_token then
    raise exception 'qr_token es inmutable';
  end if;
  return new;
end;
$$;

create trigger empleados_qr_token_inmutable
  before update of qr_token on appfiesta.empleados
  for each row execute function appfiesta.bloquear_cambio_qr_token();

-- ---------------------------------------------------------------------
-- asistencias (un ingreso por empleado)
-- ---------------------------------------------------------------------
create table appfiesta.asistencias (
  id             uuid primary key default gen_random_uuid(),
  empleado_id    uuid not null references appfiesta.empleados (id) on delete cascade,
  escaneado_por  uuid not null references appfiesta.usuarios (id) on delete restrict,
  escaneado_at   timestamptz not null default now(),
  constraint asistencias_empleado_uk unique (empleado_id)
);
create index asistencias_escaneado_at_idx on appfiesta.asistencias (escaneado_at desc);
create index asistencias_escaneado_por_idx on appfiesta.asistencias (escaneado_por);

-- ---------------------------------------------------------------------
-- Vista para listado/filtros (asistio) y export
-- security_invoker => respeta RLS del que consulta (anon sigue sin ver nada)
-- ---------------------------------------------------------------------
create view appfiesta.v_empleados
with (security_invoker = true) as
select e.id, e.documento, e.nombre, e.empresa, e.sector, e.foto_path,
       e.created_at, e.updated_at,
       (a.id is not null)  as asistio,
       a.escaneado_at,
       u.nombre            as escaneado_por_nombre
from appfiesta.empleados e
left join appfiesta.asistencias a on a.empleado_id = e.id
left join appfiesta.usuarios   u on u.id = a.escaneado_por;

-- ---------------------------------------------------------------------
-- RPC de escaneo: insert ... on conflict do nothing, luego leer.
-- Atómico, una sola ida y vuelta desde el backend.
-- ---------------------------------------------------------------------
create or replace function appfiesta.registrar_asistencia(p_token text, p_usuario uuid)
returns table (
  estado        text,
  empleado_id   uuid,
  nombre        text,
  documento     text,
  empresa       text,
  sector        text,
  foto_path     text,
  escaneado_at  timestamptz
)
language plpgsql
set search_path = appfiesta, extensions, public
as $$
declare
  v_emp       appfiesta.empleados%rowtype;
  v_insertado boolean;
  v_at        timestamptz;
begin
  select * into v_emp from appfiesta.empleados e where e.qr_token = p_token;
  if not found then
    return query select 'INVALIDO'::text, null::uuid, null::text, null::text,
                        null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  insert into appfiesta.asistencias (empleado_id, escaneado_por)
  values (v_emp.id, p_usuario)
  -- "on constraint" y no "(empleado_id)": la columna OUT empleado_id del
  -- returns table haría ambigua la referencia (error 42702 en plpgsql).
  on conflict on constraint asistencias_empleado_uk do nothing;
  v_insertado := found;

  select a.escaneado_at into v_at from appfiesta.asistencias a where a.empleado_id = v_emp.id;

  return query select case when v_insertado then 'OK' else 'YA_INGRESO' end,
                      v_emp.id, v_emp.nombre, v_emp.documento, v_emp.empresa,
                      v_emp.sector, v_emp.foto_path, v_at;
end;
$$;

-- ---------------------------------------------------------------------
-- RPC de resumen: totales generales y por empresa/sector
-- ---------------------------------------------------------------------
create or replace function appfiesta.resumen_asistencias()
returns table (empresa text, sector text, total bigint, presentes bigint)
language sql
stable
set search_path = appfiesta, extensions, public
as $$
  select e.empresa, e.sector, count(*)::bigint, count(a.id)::bigint
  from appfiesta.empleados e
  left join appfiesta.asistencias a on a.empleado_id = e.id
  group by rollup (e.empresa, e.sector)
  order by e.empresa nulls first, e.sector nulls first;
$$;

-- ---------------------------------------------------------------------
-- RLS: activado en todas las tablas, SIN policies.
-- ---------------------------------------------------------------------
alter table appfiesta.usuarios    enable row level security;
alter table appfiesta.empleados   enable row level security;
alter table appfiesta.asistencias enable row level security;

-- ---------------------------------------------------------------------
-- Permisos: SOLO service_role (el backend). PostgREST necesita USAGE sobre
-- el schema + privilegios sobre los objetos para poder exponerlos.
-- ---------------------------------------------------------------------
revoke all on schema appfiesta from public, anon, authenticated;
revoke all on all tables    in schema appfiesta from public, anon, authenticated;
revoke all on all sequences in schema appfiesta from public, anon, authenticated;
revoke all on all functions in schema appfiesta from public, anon, authenticated;

grant usage on schema appfiesta to service_role;
grant all on all tables    in schema appfiesta to service_role;
grant all on all sequences in schema appfiesta to service_role;
grant all on all functions in schema appfiesta to service_role;

-- Objetos que se creen a futuro en el schema (por el rol que corre este script).
alter default privileges in schema appfiesta grant all on tables    to service_role;
alter default privileges in schema appfiesta grant all on sequences to service_role;
alter default privileges in schema appfiesta grant all on functions to service_role;
-- (EXECUTE a PUBLIC en funciones nuevas es un default GLOBAL de Postgres que no
--  se puede revocar por schema: si se agregan funciones, revocarlo a mano.)

-- ---------------------------------------------------------------------
-- Storage: bucket público 'fotos' (lectura pública por URL; escritura solo
-- service_role, ya que no se crean policies en storage.objects).
-- Queda en el schema storage de Supabase (no se mueve).
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos', 'fotos', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Que PostgREST relea el catálogo (nuevo schema / tablas / funciones).
notify pgrst, 'reload schema';

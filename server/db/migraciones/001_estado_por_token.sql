-- =====================================================================
-- Migración 001: estado de ingreso por qr_token (pantalla de bienvenida)
--
-- Para una base YA creada con una versión anterior de db/schema.sql:
-- copiar y ejecutar este archivo completo en el SQL Editor de Supabase.
-- Es idempotente (se puede correr más de una vez). schema.sql ya la incluye
-- para instalaciones nuevas. El modo local (PGlite) la aplica solo al arrancar.
--
-- Usada por GET /api/public/estado/:token (1 round trip). Si no se corre, el
-- backend sigue funcionando con 2 consultas en serie y lo avisa en el log.
-- =====================================================================

create or replace function appfiesta.estado_por_token(p_token text)
returns table (nombre text, escaneado_at timestamptz)
language sql
stable
set search_path = appfiesta, extensions, public
as $$
  select e.nombre, a.escaneado_at
  from appfiesta.empleados e
  left join appfiesta.asistencias a on a.empleado_id = e.id
  where e.qr_token = p_token;
$$;

-- Solo el backend (service_role). EXECUTE a PUBLIC es el default global de Postgres: se revoca.
revoke all on function appfiesta.estado_por_token(text) from public, anon, authenticated;
grant execute on function appfiesta.estado_por_token(text) to service_role;

-- Que PostgREST vea la función nueva.
notify pgrst, 'reload schema';

-- =====================================================================
-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!  PELIGRO  !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
--
--  BORRA TODOS LOS DATOS de la app (schema appfiesta):
--    rechazos, asistencias, empleados y USUARIOS (incluido RRHH).
--  No se puede deshacer. Pensado para limpiar después de las pruebas,
--  ANTES del evento real. Revisar que el SQL Editor esté abierto en el
--  proyecto de Supabase correcto antes de ejecutar.
--
--  NO borra las fotos: Supabase no permite borrar storage.objects con SQL.
--  Las fotos del bucket "fotos" se borran desde el Dashboard
--  (Storage -> fotos -> seleccionar la carpeta "empleados" -> Delete) o con:
--      npm run reset:datos --prefix server
--  (el script borra fotos Y datos; con él no hace falta este archivo).
--
--  Tampoco toca la estructura (tablas, vista, funciones, permisos, bucket).
--
--  Después: crear de nuevo el usuario RRHH:
--      npm run seed:admin --prefix server -- admin "Admin RRHH"
--
--  Si DB_SCHEMA no es "appfiesta", reemplazar el nombre abajo.
-- =====================================================================

begin;

truncate table
  appfiesta.rechazos,
  appfiesta.asistencias,
  appfiesta.empleados,
  appfiesta.usuarios
  cascade;

commit;

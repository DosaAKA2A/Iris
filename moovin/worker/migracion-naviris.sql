-- MOOVIN — vinculo con Naviris (2026-08-30).
--
-- Para la base que ya esta en marcha. Es aditivo: añade una columna que
-- empieza a NULL en todas las cuentas y un indice unico que, en SQLite, deja
-- pasar todos los NULL que hagan falta. Nadie pierde acceso al aplicarlo.
--
--   npx wrangler d1 execute moovin --remote --file=migracion-naviris.sql

ALTER TABLE usuarios ADD COLUMN naviris_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_usuarios_naviris ON usuarios(naviris_id);

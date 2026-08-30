-- MOOVIN — de donde salio cada sesion (2026-08-30).
--
-- Aditiva: las sesiones que ya existen quedan como "correo", que es de donde
-- salieron todas menos las de Naviris, que aun no habia.
--
--   npx wrangler d1 execute moovin --remote --file=migracion-origen-sesion.sql

ALTER TABLE sesiones ADD COLUMN origen TEXT NOT NULL DEFAULT 'correo';

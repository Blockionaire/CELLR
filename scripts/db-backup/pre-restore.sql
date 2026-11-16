-- Run FIRST when restoring a CELLR logical dump into a new (empty) Supabase project, before roles.sql and schema.sql.
-- docs/BACKUP-RECOVERY.md §6.6.
--
-- Why: a new Supabase project grants anon, authenticated and service_role ALL on every new table, sequence and function
-- in `public` (default privileges). CELLR's migration 0001 revokes that ("deny by default"), and every later grant is
-- explicit. pg_dump writes ALTER DEFAULT PRIVILEGES at the END of schema.sql, so without this file every restored
-- object is created with the platform's defaults first: anon could then execute service-role-only admin functions and
-- would hold every table privilege (RLS would still filter rows, but security-definer functions do not use RLS).
-- Found in the restore rehearsal of 2026-11-16; this file is the same four statements as migration 0001.
alter default privileges in schema public revoke all on tables    from anon, authenticated, service_role;
alter default privileges in schema public revoke all on sequences from anon, authenticated, service_role;
alter default privileges in schema public revoke all on functions from anon, authenticated, service_role;
alter default privileges revoke execute on functions from public;

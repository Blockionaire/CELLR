-- =====================================================================
-- GATED, NOT A MIGRATION YET: the old one-bottle-per-cell index goes
-- =====================================================================
-- !! DESTRUCTIVE: THIS FILE DROPS AN INDEX, AND THE OWNER HAS NOT AUTHORISED THAT.
-- !! It is deliberately NOT in supabase/migrations, so `supabase db push` cannot run it, on purpose or by accident,
-- !! and it has NO version number: it gets one on the day it is released (see README.md in this folder).
--
-- What goes:   bottles_slot_unique          unique (location_id, loc_row, loc_col)             [0004]
-- What stays:  bottles_slot_index_unique    unique (location_id, loc_row, loc_col, loc_index)  [0043]
--              both `where status = 'in_cellar' and location_id is not null`.
--
-- Why it will have to go: it allows one bottle per CELL, so while it exists no cell can ever hold two. Until then
-- it is a second lock on the door: with it in place, more than one bottle per cell is impossible even if the
-- switch (private.cellar_settings) were turned on. Migrations 0043-0045 are complete and safe without this file.
--
-- Why it will be able to go: with every bottle at index 1 the new index refuses exactly what the old one refused.
-- No data is touched; no bottle is moved, changed or deleted; the app's "that spot was just taken" still comes from
-- a unique violation (23505), which it recognises by its code, not by the index's name.
--
-- Nothing is removed before its replacement is proven to be there: the block below stops (and leaves the old index
-- in place) unless the new index exists on these columns, with this predicate, and is unique, valid and ready.
--
-- This exact file is run by the test suite, inside a transaction that is rolled back, wherever a test needs two
-- bottles in one cell (supabase/tests/99_smart_cellar_structure.test.sql, 99_smart_cellar_rpcs.test.sql), and by
-- scripts/db-smart-cellar-upgrade.sh and scripts/db-placement-concurrency.sh on their own throwaway databases.
-- So what is released later is what has been tested all along.
--
-- Putting the old index BACK is possible only while no cell holds two bottles:
--   create unique index bottles_slot_unique on public.bottles (location_id, loc_row, loc_col)
--     where status = 'in_cellar' and location_id is not null;

do $$
declare def text;
begin
  select pg_get_indexdef(i.indexrelid) into def
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'bottles_slot_index_unique'
     and i.indrelid = 'public.bottles'::regclass
     and i.indisunique and i.indisvalid and i.indisready and i.indislive;
  if def is null then
    raise exception 'bottles_slot_index_unique is missing or not a valid unique index: the old index stays';
  end if;
  if def !~ '\(location_id, loc_row, loc_col, loc_index\)'
     or def !~* 'where .*status = ''in_cellar''.*location_id is not null' then
    raise exception 'bottles_slot_index_unique is not the index 0043 defines (%): the old index stays', def;
  end if;
  -- the new index really covers what the old one covers: no two bottles in the cellar share a whole spot
  if exists (select 1 from public.bottles b
              where b.status = 'in_cellar' and b.location_id is not null
              group by b.location_id, b.loc_row, b.loc_col, b.loc_index having count(*) > 1) then
    raise exception 'two bottles share a spot: the old index stays';
  end if;
end $$;

drop index public.bottles_slot_unique;

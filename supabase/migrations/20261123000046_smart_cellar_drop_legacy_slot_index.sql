-- =====================================================================
-- 0046 Smart Cellar 3D, sprint 1B (4 of 4): the old one-bottle-per-cell index goes
-- =====================================================================
-- !! DESTRUCTIVE: THIS FILE DROPS AN INDEX. It is the only destructive statement of sprint 1B, it is alone in its
-- !! own file so it can be reviewed and timed on its own, and docs/MIGRATIONS.md rule 2 asks for an explicit
-- !! decision of the owner before it reaches production.
--
-- What goes:   bottles_slot_unique          unique (location_id, loc_row, loc_col)             [0004]
-- What stays:  bottles_slot_index_unique    unique (location_id, loc_row, loc_col, loc_index)  [0043]
--              both `where status = 'in_cellar' and location_id is not null`.
--
-- Why it has to go: it allows one bottle per CELL, so while it exists no cell can ever hold two. Why it can go
-- now: with every bottle at index 1 (which is every bottle there is: more than one per cell is switched off,
-- private.cellar_settings) the new index refuses exactly what the old one refused. No data is touched; no bottle
-- is moved, changed or deleted; the app's "that spot was just taken" still comes from a unique violation (23505),
-- which it recognises by its code, not by the index's name.
--
-- Nothing is removed before its replacement is proven to be there: the block below stops this migration (and
-- leaves the old index in place) unless the new index exists on these columns, with this predicate, and is unique,
-- valid and ready. If it stops, the database is exactly as 0045 left it and works as before.
--
-- Rolling back the APP after this ran needs nothing: an older app writes no index, so its bottles are at index 1,
-- where the new index gives the same answer. Putting the old index BACK is possible only while no cell holds two
-- bottles:
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

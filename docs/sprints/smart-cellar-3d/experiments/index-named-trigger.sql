-- =====================================================================
-- Smart Cellar 3D, sprint 1B: can a trigger know whether an UPDATE named a column?
-- =====================================================================
-- The specification of sprint 1A (SPRINT-1B-DATABASE-REQUIREMENTS.md, §3 as first written) proposed:
--   * a column trigger `before update of loc_index` that leaves a note in a transaction setting
--     (set_config('cellr.index_named', <row id>, true)), and
--   * the bounds trigger reading that note, clearing it, and putting a bottle at index 1 when it was moved to
--     another cell WITHOUT the index being named.
-- This file is that design on a small table, run against PostgreSQL 16 before anything was built.
--
--   psql "<a throwaway database>" -X -q -f docs/sprints/smart-cellar-3d/experiments/index-named-trigger.sql
--
-- RESULT (PostgreSQL 16.x, 2026-11-14). In the ordinary cases it does what it says:
--   1  a move without the index: reset to 1                                   as designed
--   2  a move naming the index (the same value): kept                         as designed
--   3  `set idx = idx`: counts as named                                       as designed
--   4  one statement, several rows, index not named: all reset                as designed
--   5  one statement, several rows, index named: all kept                     as designed
--   6  two statements in one transaction, named then not named: second reset  as designed
--   7  a statement that fails after the note was left, inside a savepoint: the note is rolled back with it
-- And it goes wrong, EACH TIME WITHOUT ANY ERROR, when something outside the two triggers changes:
--   8  another BEFORE trigger, sorted between the two, skips the row (returns null): the note stays behind, and
--      the NEXT statement in that transaction that moves the row without an index KEEPS the old index.
--   9  one of the two triggers is renamed so that the order flips: a move that NAMES index 2 is put at index 1.
--   10 the note is a setting any SQL session can write: with it set by hand, a move without an index keeps the 2.
--   11 one of the two triggers is disabled (maintenance, a restore, session_replication_role): named moves are
--      reset to 1.
--   12 a writer that sends the whole row back (PUT, an upsert, a table editor) NAMES the index without knowing
--      what it is: the stale index it read earlier is written as if it were meant.
--
-- CONCLUSION. Whether the rule holds depends on things the rule cannot see: the names of two triggers, every other
-- trigger on the table, a session setting, and how each client builds its UPDATE. When one of them is off, a bottle
-- is put on a spot nobody asked for and nothing says so. That is exactly what must never happen, so this design
-- was NOT built. Migration 0043 uses only the values of the row and refuses the one case it cannot decide
-- ('slot_index_ambiguous'): see private.check_bottle_location there.
-- =====================================================================
\set ON_ERROR_STOP 0
drop schema if exists exp cascade; create schema exp;
create table exp.b (id int primary key, cell int, idx smallint not null default 1, note text);
-- T1: column trigger marks "idx was named"
create function exp.mark() returns trigger language plpgsql as $$
begin perform set_config('cellr.index_named', new.id::text, true); return new; end $$;
create trigger b_index_named before update of idx on exp.b for each row execute function exp.mark();
-- T2: applies R2
create function exp.loc() returns trigger language plpgsql as $$
declare named boolean;
begin
  named := coalesce(current_setting('cellr.index_named', true), '') = new.id::text;
  perform set_config('cellr.index_named', '', true);
  if new.cell is distinct from old.cell and not named then new.idx := 1; end if;
  return new;
end $$;
create trigger b_location before update on exp.b for each row execute function exp.loc();

\echo == 1. unnamed move of idx 2 -> expect idx 1
insert into exp.b values (1, 10, 2), (2, 20, 2), (3, 30, 1);
update exp.b set cell = 11 where id = 1; select id, cell, idx from exp.b where id = 1;
\echo == 2. named move keeps 2 (same value written)
update exp.b set cell = 21, idx = 2 where id = 2; select id, cell, idx from exp.b where id = 2;
\echo == 3. named by self-assignment idx = idx
update exp.b set idx = 2 where id = 1; update exp.b set cell = 12, idx = idx where id = 1; select id, cell, idx from exp.b where id = 1;
\echo == 4. multi-row: one statement moves two rows, unnamed -> both 1
update exp.b set idx = 2; update exp.b set cell = cell + 100; select id, cell, idx from exp.b order by id;
\echo == 5. multi-row named -> all keep
update exp.b set idx = 2; update exp.b set cell = cell + 100, idx = idx; select id, cell, idx from exp.b order by id;
\echo == 6. two statements in one tx on one row: named then unnamed -> second must reset
begin; update exp.b set cell = 1, idx = 2 where id = 1; update exp.b set cell = 2 where id = 1; select id, cell, idx from exp.b where id = 1; commit;
\echo == 7. savepoint rollback between: named statement fails after T1? simulate T1 fired then error in later trigger
create function exp.boom() returns trigger language plpgsql as $$ begin if new.note = 'boom' then raise exception 'boom'; end if; return new; end $$;
create trigger b_zz_boom before update on exp.b for each row execute function exp.boom();
update exp.b set idx = 2 where id = 1;
begin; savepoint s; update exp.b set cell = 5, idx = 2, note = 'boom' where id = 1; rollback to s;
select current_setting('cellr.index_named', true) as marker_after_rollback;
update exp.b set cell = 6 where id = 1; select id, cell, idx from exp.b where id = 1; commit;
\echo == 8. FRAGILE A: a BEFORE trigger sorted between the two that skips the row (returns null) leaves the marker set
create function exp.skip() returns trigger language plpgsql as $$ begin if new.note = 'skip' then return null; end if; return new; end $$;
create trigger b_k_skip before update on exp.b for each row execute function exp.skip();
update exp.b set idx = 2, note = null where id = 1;
begin; update exp.b set cell = 7, idx = 2, note = 'skip' where id = 1;
select current_setting('cellr.index_named', true) as marker_left_behind;
update exp.b set cell = 8 where id = 1; select id, cell, idx as idx_should_be_1 from exp.b where id = 1; commit;
drop trigger b_k_skip on exp.b;
\echo == 9. FRAGILE B: trigger order depends on names: a rename flips it
update exp.b set idx = 2 where id = 1;
alter trigger b_index_named on exp.b rename to b_named_index;
update exp.b set cell = 9, idx = 2 where id = 1; select id, cell, idx as named_but_now from exp.b where id = 1;
update exp.b set cell = 10 where id = 1; select id, cell, idx as unnamed_but_now from exp.b where id = 1;
alter trigger b_named_index on exp.b rename to b_index_named;
\echo == 10. FRAGILE C: the marker is a session setting anyone with SQL can set
update exp.b set idx = 2 where id = 1;
begin; select set_config('cellr.index_named', '1', true); update exp.b set cell = 11 where id = 1; select id, cell, idx as unnamed_but_kept from exp.b where id = 1; commit;
\echo == 11. FRAGILE D: one of the two triggers disabled (maintenance, replication role)
update exp.b set idx = 2 where id = 1;
alter table exp.b disable trigger b_index_named;
update exp.b set cell = 12, idx = 2 where id = 1; select id, cell, idx as named_but_reset from exp.b where id = 1;
alter table exp.b enable trigger b_index_named;
\echo == 12. a writer that sends the whole row back (PUT / upsert / table editor) names idx without knowing it
update exp.b set idx = 2 where id = 1;
insert into exp.b (id, cell, idx, note) values (1, 99, 2, null) on conflict (id) do update set cell = excluded.cell, idx = excluded.idx, note = excluded.note;
select id, cell, idx as upsert_named from exp.b where id = 1;
drop schema exp cascade;

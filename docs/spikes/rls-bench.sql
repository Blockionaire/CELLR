-- =====================================================================
-- Spike 2 — RLS policy shape vs. scale  (docs/00-architecture-plan.md §4.3)
-- Run AFTER rls-model.sql (reuses its auth shim and `private` schema).
-- 50k households, ~70k users, 600k bottles; one user reads their own 12 bottles.
-- Compare the EXPLAIN output of the two policy shapes.
-- =====================================================================
\set ON_ERROR_STOP on
reset role;
drop table if exists b_bottles, b_members cascade;
create table b_members(household_id uuid not null, user_id uuid not null, primary key(household_id,user_id));
create index on b_members(user_id);
create table b_bottles(id uuid primary key default gen_random_uuid(), household_id uuid not null,
                       status text not null default 'in_cellar', added_at timestamptz not null default now(), wine text);
create index on b_bottles(household_id, status, added_at desc);
insert into b_members select md5(i::text)::uuid, md5('u'||i::text)::uuid from generate_series(1,50000) i;
insert into b_members select md5((1+(i%50000))::text)::uuid, md5('u2-'||i::text)::uuid from generate_series(1,20000) i;
insert into b_bottles(household_id, wine, added_at)
  select md5((1+(i%50000))::text)::uuid, 'w'||i, now() - (i||' seconds')::interval from generate_series(1,600000) i;
analyze b_members; analyze b_bottles;

create function private.is_member_b(hid uuid) returns boolean language sql stable security definer set search_path='' as
  $$ select exists(select 1 from public.b_members m where m.household_id=hid and m.user_id=auth.uid()) $$;
create function private.my_household_ids_b() returns uuid[] language sql stable security definer set search_path='' as
  $$ select coalesce(array_agg(household_id), '{}') from public.b_members where user_id=auth.uid() $$;
grant execute on function private.is_member_b(uuid), private.my_household_ids_b() to authenticated;
grant select on b_bottles, b_members to authenticated;
alter table b_bottles enable row level security;

select set_config('request.jwt.claim.sub', md5('u1')::uuid::text, false) as acting_user \gset

\echo '=== A: per-row function  using (is_member_b(household_id))  — expect ~seconds, Seq Scan'
create policy p on b_bottles for select to authenticated using (private.is_member_b(household_id));
set role authenticated;
explain (analyze, timing off, summary on) select * from b_bottles where status='in_cellar' order by added_at desc limit 50;
reset role; drop policy p on b_bottles;

\echo '=== D: array InitPlan  using (household_id = any (((select my_household_ids_b()))::uuid[]))  — expect <1 ms, Index Cond'
create policy p on b_bottles for select to authenticated
  using (household_id = any (((select private.my_household_ids_b()))::uuid[]));
set role authenticated;
explain (analyze, timing off, summary on) select * from b_bottles where status='in_cellar' order by added_at desc limit 50;
select 'rows visible via policy D: ' || count(*) as check from b_bottles;
reset role;
select 'ground truth:              ' || count(*) as check from b_bottles
 where household_id in (select household_id from b_members where user_id = md5('u1')::uuid);

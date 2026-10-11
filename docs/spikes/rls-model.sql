-- =====================================================================
-- Spike 1 — household / RLS permission model  (docs/00-architecture-plan.md §5)
-- Runs on plain Postgres 16 with a minimal Supabase shim (auth.uid(), anon/authenticated roles),
-- because Docker (supabase start) is not available in every environment.
-- Expected: 31 PASS, 0 FAIL, then a negative control showing the naive policy hits 42P17.
-- This is evidence for the plan, not the production migration — Phase 0 rebuilds it under supabase/migrations
-- and turns these scenarios into the mandatory CI permission suite.
-- =====================================================================
-- Throwaway spike: does the proposed household/RLS model actually hold on real Postgres 16?
\set ON_ERROR_STOP on
drop schema if exists public cascade; create schema public;
drop schema if exists auth cascade;   create schema auth;
drop schema if exists private cascade; create schema private;
drop schema if exists test cascade;   create schema test;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;

-- ---- Supabase shim --------------------------------------------------------
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth, public, private, test to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
-- Supabase default: broad table grants, RLS is the actual gate. Replicate it so the test is honest.
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;

-- ---- Schema (excerpt of the proposed model) -------------------------------
create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  created_by uuid not null default auth.uid() references auth.users
);
create table public.household_members (
  household_id uuid not null references public.households on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null check (role in ('owner','member')),
  primary key (household_id, user_id)
);
create table public.household_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  code_hash text not null unique,
  expires_at timestamptz not null,
  created_by uuid not null default auth.uid()
);
create table public.wines (
  id uuid primary key default gen_random_uuid(),
  status text not null check (status in ('canonical','provisional')),
  owner_household_id uuid references public.households,
  name text not null,
  check ((status='canonical') = (owner_household_id is null))
);
create table public.bottles (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households,
  wine_id uuid not null references public.wines,
  status text not null default 'in_cellar'
);
create table public.user_taste_profiles (
  user_id uuid primary key references auth.users,
  body smallint
);

-- ---- Helpers: SECURITY DEFINER, locked search_path, in a non-exposed schema -
create function private.is_household_member(hid uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.household_members m
                 where m.household_id = hid and m.user_id = auth.uid()) $$;
create function private.shares_household(other uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.household_members a
                 join public.household_members b on a.household_id = b.household_id
                 where a.user_id = auth.uid() and b.user_id = other) $$;
grant execute on all functions in schema private to authenticated;
revoke execute on all functions in schema private from anon, public;

-- ---- RLS -------------------------------------------------------------------
alter table public.households          enable row level security;
alter table public.household_members   enable row level security;
alter table public.household_invites   enable row level security;
alter table public.wines               enable row level security;
alter table public.bottles             enable row level security;
alter table public.user_taste_profiles enable row level security;

create policy hh_select on public.households for select to authenticated
  using (private.is_household_member(id));
create policy hm_select on public.household_members for select to authenticated
  using (private.is_household_member(household_id));     -- via helper: no self-recursion
create policy inv_select on public.household_invites for select to authenticated
  using (private.is_household_member(household_id));
-- no INSERT/UPDATE policies on households/members/invites: only the RPCs below can write

create policy wines_select on public.wines for select to authenticated
  using (status = 'canonical' or private.is_household_member(owner_household_id));
create policy wines_insert on public.wines for insert to authenticated
  with check (status = 'provisional' and private.is_household_member(owner_household_id));
create policy wines_update on public.wines for update to authenticated
  using (status = 'provisional' and private.is_household_member(owner_household_id))
  with check (status = 'provisional' and private.is_household_member(owner_household_id));

create policy bottles_all on public.bottles for all to authenticated
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id)
              and exists (select 1 from public.wines w where w.id = wine_id));  -- wine must be visible to caller

create policy taste_select on public.user_taste_profiles for select to authenticated
  using (user_id = auth.uid() or private.shares_household(user_id));
create policy taste_write on public.user_taste_profiles for insert to authenticated
  with check (user_id = auth.uid());
create policy taste_upd on public.user_taste_profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ownership fields are immutable
create function private.forbid_household_change() returns trigger language plpgsql as $$
begin
  if new.household_id is distinct from old.household_id then
    raise exception 'household_id is immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger bottles_household_immutable before update on public.bottles
  for each row execute function private.forbid_household_change();

-- ---- RPCs (the only way to create/join) -----------------------------------
create function public.create_household(p_name text) returns uuid
  language plpgsql security definer set search_path = '' as $$
declare hid uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  insert into public.households(name, created_by) values (p_name, auth.uid()) returning id into hid;
  insert into public.household_members(household_id, user_id, role) values (hid, auth.uid(), 'owner');
  return hid;
end $$;
create function public.create_invite(p_household uuid) returns text
  language plpgsql security definer set search_path = '' as $$
declare code text := substr(replace(gen_random_uuid()::text,'-',''),1,12);
begin
  if not exists (select 1 from public.household_members
                 where household_id = p_household and user_id = auth.uid() and role = 'owner')
  then raise exception 'only owners can invite' using errcode = '42501'; end if;
  insert into public.household_invites(household_id, code_hash, expires_at)
  values (p_household, encode(sha256(convert_to(code,'utf8')),'hex'), now() + interval '7 days');
  return code;
end $$;
create function public.join_household(p_code text) returns uuid
  language plpgsql security definer set search_path = '' as $$
declare inv public.household_invites;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into inv from public.household_invites
   where code_hash = encode(sha256(convert_to(p_code,'utf8')),'hex') and expires_at > now();
  if not found then raise exception 'invalid or expired invite' using errcode = 'P0002'; end if;
  insert into public.household_members(household_id, user_id, role)
  values (inv.household_id, auth.uid(), 'member') on conflict do nothing;
  return inv.household_id;
end $$;
revoke execute on function public.create_household, public.create_invite, public.join_household from public, anon;
grant  execute on function public.create_household, public.create_invite, public.join_household to authenticated;

-- ---- Mini test framework ---------------------------------------------------
create table test.results (name text, ok boolean);
create function test.as_user(u uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', coalesce(u::text,''), false); execute 'set role authenticated'; end $$;
create function test.as_anon() returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub','',false); execute 'set role anon'; end $$;
create function test.su() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claim.sub','',false); end $$;
grant all on test.results to public;
create function test.rec(n text, o boolean) returns void language plpgsql security definer as $$
begin
  insert into test.results values (n, coalesce(o,false));
  raise notice '% %', case when o then 'PASS' else 'FAIL' end, n;
end $$;
-- runs q as the *current* role; true iff it raises (RLS 42501 / check / P000x)
create function test.denied(q text) returns boolean language plpgsql as $$
begin execute q; return false;
exception when insufficient_privilege or raise_exception or check_violation or no_data_found then return true; end $$;
create function test.affected(q text) returns bigint language plpgsql as $$
declare n bigint; begin execute q; get diagnostics n = row_count; return n; end $$;
create function test.count_of(q text) returns bigint language plpgsql as $$
declare n bigint; begin execute 'select count(*) from ('||q||') s' into n; return n; end $$;

-- ---- Scenarios -------------------------------------------------------------
do $$
declare
  alice uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  bob   uuid := 'bbbbbbbb-0000-0000-0000-000000000002';
  carol uuid := 'cccccccc-0000-0000-0000-000000000003';
  h1 uuid; h2 uuid; w_canon uuid; w_prov_a uuid; b1 uuid; code text; n bigint;
begin
  insert into auth.users values (alice),(bob),(carol);
  insert into public.wines(status,name) values ('canonical','Marqués de Riscal Reserva') returning id into w_canon;

  perform test.as_user(alice); h1 := public.create_household('Alice & friends');
  perform test.as_user(bob);   h2 := public.create_household('Bob');

  -- 1 isolation
  perform test.as_user(alice);
  insert into public.bottles(household_id, wine_id) values (h1, w_canon) returning id into b1;
  perform test.rec('alice can add a bottle to her own household', true);
  perform test.rec('alice CANNOT add a bottle to bob''s household (guessed id)',
    test.denied(format('insert into public.bottles(household_id,wine_id) values (%L,%L)', h2, w_canon)));
  perform test.as_user(bob);
  perform test.rec('bob sees none of alice''s bottles', test.count_of('select 1 from public.bottles') = 0);
  perform test.rec('bob cannot read alice''s household by id', test.count_of(format('select 1 from public.households where id=%L',h1)) = 0);
  perform test.rec('bob cannot read alice''s member list', test.count_of(format('select 1 from public.household_members where household_id=%L',h1)) = 0);
  perform test.rec('bob cannot delete alice''s bottle (0 rows affected)', test.affected(format('delete from public.bottles where id=%L', b1)) = 0);

  -- 2 no recursion + membership self-service blocked
  perform test.as_user(alice);
  perform test.rec('member list readable without policy recursion', test.count_of('select 1 from public.household_members') = 1);
  perform test.rec('alice cannot insert herself into bob''s household',
    test.denied(format('insert into public.household_members values (%L,%L,%L)', h2, alice, 'owner')));

  -- 3 ownership immutability
  perform test.rec('household_id of a bottle is immutable',
    test.denied(format('update public.bottles set household_id=%L where id=%L', h2, b1)));

  -- 4 anon sees nothing / can't call RPCs
  perform test.as_anon();
  perform test.rec('anon sees no bottles', test.count_of('select 1 from public.bottles') = 0);
  perform test.rec('anon cannot create a household', test.denied(format('select public.create_household(%L)', 'x')));

  -- 5 canonical vs provisional wines
  perform test.as_user(alice);
  insert into public.wines(status, owner_household_id, name) values ('provisional', h1, 'Mystery Rioja') returning id into w_prov_a;
  perform test.rec('alice can create a provisional wine in her household', true);
  perform test.rec('alice cannot create a canonical wine', test.denied(format('insert into public.wines(status,name) values (%L,%L)','canonical','fake')));
  perform test.rec('alice cannot promote provisional -> canonical', test.denied(format('update public.wines set status=%L, owner_household_id=null where id=%L','canonical',w_prov_a)));
  perform test.rec('alice cannot edit a canonical wine (0 rows)', test.affected(format('update public.wines set name=%L where id=%L','hacked',w_canon)) = 0);
  perform test.as_user(bob);
  perform test.rec('bob cannot see alice''s provisional wine', test.count_of(format('select 1 from public.wines where id=%L',w_prov_a)) = 0);
  perform test.rec('bob sees canonical wines', test.count_of(format('select 1 from public.wines where id=%L',w_canon)) = 1);
  perform test.rec('bob cannot attach a bottle to alice''s provisional wine id (guessed)',
    test.denied(format('insert into public.bottles(household_id,wine_id) values (%L,%L)', h2, w_prov_a)));

  -- 6 individual taste vs household sharing
  perform test.as_user(bob);   insert into public.user_taste_profiles values (bob, 4);
  perform test.as_user(alice); insert into public.user_taste_profiles values (alice, 2);
  perform test.rec('before sharing a household, alice cannot read bob''s taste profile',
    test.count_of(format('select 1 from public.user_taste_profiles where user_id=%L', bob)) = 0);
  perform test.rec('alice cannot write bob''s taste profile', test.denied(format('insert into public.user_taste_profiles values (%L,5)', carol)));

  -- 7 invite flow
  perform test.rec('non-owner cannot create an invite', (select test.denied(format('select public.create_invite(%L)', h2))));
  code := public.create_invite(h1);
  perform test.as_user(bob);
  perform test.rec('wrong invite code is rejected', test.denied(format('select public.join_household(%L)', 'deadbeef0000')));
  perform public.join_household(code);
  perform test.rec('bob joined alice''s household via invite', test.count_of(format('select 1 from public.household_members where household_id=%L and user_id=%L', h1, bob)) = 1);
  perform test.rec('bob now sees the shared bottle', test.count_of('select 1 from public.bottles') = 1);
  perform test.rec('bob (member, not owner) still cannot invite', test.denied(format('select public.create_invite(%L)', h1)));
  perform test.rec('member cannot promote himself to owner (0 rows)', test.affected(format('update public.household_members set role=%L where household_id=%L and user_id=%L','owner',h1,bob)) = 0);
  perform test.rec('member cannot remove the owner (0 rows)', test.affected(format('delete from public.household_members where household_id=%L and user_id=%L', h1, alice)) = 0);
  perform test.rec('member cannot rename the household (0 rows)', test.affected(format('update public.households set name=%L where id=%L','pwned',h1)) = 0);
  perform test.rec('after sharing a household, bob can read alice''s taste profile',
    test.count_of(format('select 1 from public.user_taste_profiles where user_id=%L', alice)) = 1);
  perform test.as_user(carol);
  perform test.rec('carol (outsider) still sees nothing', test.count_of('select 1 from public.bottles') = 0 and
                   test.count_of('select 1 from public.user_taste_profiles') = 0);
  perform test.su();
  update public.household_invites set expires_at = now() - interval '1 hour';
  perform test.as_user(carol);
  perform test.rec('expired invite is rejected', test.denied(format('select public.join_household(%L)', code)));
end $$;

select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from test.results;

-- ---- Negative control: the naive policy really does recurse ----------------
reset role;
create table public.naive_members (household_id uuid, user_id uuid);
alter table public.naive_members enable row level security;
create policy naive on public.naive_members for select to authenticated
  using (household_id in (select household_id from public.naive_members where user_id = auth.uid()));
set role authenticated;
do $$ begin
  begin perform count(*) from public.naive_members; raise notice 'NAIVE POLICY: no error (unexpected)';
  exception when others then raise notice 'NAIVE POLICY: % -> %', sqlstate, sqlerrm; end;
end $$;

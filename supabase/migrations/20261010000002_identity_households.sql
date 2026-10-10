-- =====================================================================
-- 0002 identity & households: profiles, households, members, invites, rate limiting, RLS, RPCs
-- =====================================================================
-- Verified in docs/spikes/rls-model.sql (permissions) and rls-bench.sql (policy shape vs scale).
--  * Membership is NEVER client-writable: households/members/invites change only via the RPCs below.
--  * Policies on household-scoped tables use the array-InitPlan form
--      household_id = any (((select private.my_household_ids()))::uuid[])
--    which is index-friendly (0.2–0.8 ms at 600k rows vs ~3 s for a per-row function call).
--  * Helper functions are SECURITY DEFINER with an empty search_path, so they can read membership
--    without recursing through the policies they are used in.

-- ---- Tables ------------------------------------------------------------------------------------
create table public.households (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(btrim(name)) between 1 and 80),
  currency   text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  created_by uuid references auth.users on delete set null,   -- provenance only; never blocks account deletion
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households on delete cascade,
  user_id      uuid not null references auth.users on delete cascade,
  role         public.household_role not null,
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index household_members_user_idx on public.household_members (user_id);

create table public.profiles (
  id                  uuid primary key references auth.users on delete cascade,
  display_name        text check (display_name is null or char_length(btrim(display_name)) between 1 and 40),
  avatar_path         text check (avatar_path is null or avatar_path like id::text || '/%'),
  locale              text not null default 'en' check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  active_household_id uuid references public.households on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Only a SHA-256 of the invite code is stored; the plaintext is returned once, at creation.
create table public.household_invites (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  code_hash    text not null unique,
  expires_at   timestamptz not null,
  max_uses     int  not null default 5 check (max_uses between 1 and 50),
  uses         int  not null default 0 check (uses >= 0),
  created_by   uuid not null references auth.users on delete cascade,
  created_at   timestamptz not null default now()
);
create index household_invites_household_idx on public.household_invites (household_id);

-- Internal sliding-window rate limiting (no Redis at this scale). Not reachable from the Data API.
create table private.rate_events (
  id      bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  bucket  text not null,
  at      timestamptz not null default now()
);
create index rate_events_lookup_idx on private.rate_events (user_id, bucket, at desc);
alter table private.rate_events enable row level security;  -- no policies: only definer functions touch it

-- ---- Policy helpers ----------------------------------------------------------------------------
create function private.my_household_ids() returns uuid[]
  language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(m.household_id), '{}'::uuid[])
  from public.household_members m where m.user_id = auth.uid()
$$;

create function private.is_household_member(hid uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.household_members m where m.household_id = hid and m.user_id = auth.uid())
$$;

create function private.is_household_owner(hid uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.household_members m
                 where m.household_id = hid and m.user_id = auth.uid() and m.role = 'owner')
$$;

create function private.shares_household(other uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.household_members a
                 join public.household_members b on a.household_id = b.household_id
                 where a.user_id = auth.uid() and b.user_id = other)
$$;

-- Sliding window: returns false (and records nothing) when the limit is already reached.
-- The advisory lock makes concurrent calls for the same user+bucket serial, so the limit holds.
create function private.consume_rate_limit(p_user uuid, p_bucket text, p_limit int, p_window interval)
  returns boolean language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text || ':' || p_bucket, 0));
  delete from private.rate_events where user_id = p_user and bucket = p_bucket and at < now() - p_window;
  select count(*) into n from private.rate_events where user_id = p_user and bucket = p_bucket;
  if n >= p_limit then return false; end if;
  insert into private.rate_events (user_id, bucket) values (p_user, p_bucket);
  return true;
end $$;

-- ---- Triggers ----------------------------------------------------------------------------------
create trigger households_updated before update on public.households
  for each row execute function private.set_updated_at();
create trigger profiles_updated before update on public.profiles
  for each row execute function private.set_updated_at();

-- A profile row appears with every new auth user. display_name stays NULL until onboarding asks.
create function private.handle_new_user() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), ''));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- The last owner cannot walk away while other people remain (they would be locked out of
-- owner-only actions). Skipped when the household itself is being deleted (cascade).
create function private.guard_member_delete() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.households h where h.id = old.household_id) then
    return old;
  end if;
  if old.role = 'owner'
     and not exists (select 1 from public.household_members m
                     where m.household_id = old.household_id and m.user_id <> old.user_id and m.role = 'owner')
     and exists (select 1 from public.household_members m
                 where m.household_id = old.household_id and m.user_id <> old.user_id)
  then
    raise exception 'last_owner' using errcode = 'P0001';
  end if;
  return old;
end $$;
create trigger household_members_guard before delete on public.household_members
  for each row execute function private.guard_member_delete();

-- When the final member leaves, the (now unreachable) household and everything in it is removed.
create function private.cleanup_empty_household() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.household_members m where m.household_id = old.household_id) then
    delete from public.households where id = old.household_id;
  end if;
  return old;
end $$;
create trigger household_members_cleanup after delete on public.household_members
  for each row execute function private.cleanup_empty_household();

-- ---- Row level security ------------------------------------------------------------------------
alter table public.households        enable row level security;
alter table public.household_members enable row level security;
alter table public.profiles          enable row level security;
alter table public.household_invites enable row level security;

create policy households_select on public.households for select to authenticated
  using (id = any (((select private.my_household_ids()))::uuid[]));
create policy households_update on public.households for update to authenticated
  using (private.is_household_owner(id)) with check (private.is_household_owner(id));
create policy households_delete on public.households for delete to authenticated
  using (private.is_household_owner(id));

create policy members_select on public.household_members for select to authenticated
  using (household_id = any (((select private.my_household_ids()))::uuid[]));
-- leave a household yourself, or (owner) remove someone else
create policy members_delete on public.household_members for delete to authenticated
  using (user_id = auth.uid() or private.is_household_owner(household_id));

create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or private.shares_household(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid()
              and (active_household_id is null
                   or active_household_id = any (((select private.my_household_ids()))::uuid[])));

create policy invites_select on public.household_invites for select to authenticated
  using (private.is_household_owner(household_id));
create policy invites_delete on public.household_invites for delete to authenticated
  using (private.is_household_owner(household_id));

-- ---- Grants (column-level: ids, owners and timestamps are simply not updatable by clients) ----
grant select, delete                         on public.household_members to authenticated;
grant select, delete                         on public.household_invites to authenticated;
grant select, delete, update (name, currency) on public.households       to authenticated;
grant select, update (display_name, avatar_path, locale, active_household_id) on public.profiles to authenticated;

-- ---- RPCs: the only way to create or join a household -----------------------------------------
create function public.create_household(p_name text, p_currency text default 'EUR') returns uuid
  language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); hid uuid;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if not private.consume_rate_limit(uid, 'create_household', 5, interval '1 hour') then
    raise exception 'rate_limited' using errcode = '54000';
  end if;
  insert into public.households (name, currency, created_by) values (btrim(p_name), p_currency, uid)
    returning id into hid;
  insert into public.household_members (household_id, user_id, role) values (hid, uid, 'owner');
  update public.profiles set active_household_id = coalesce(active_household_id, hid) where id = uid;
  return hid;
end $$;

-- Returns the plaintext code ONCE; only its hash is stored.
create function public.create_invite(p_household uuid, p_ttl_hours int default 168, p_max_uses int default 5)
  returns text language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); code text;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if not exists (select 1 from public.household_members
                 where household_id = p_household and user_id = uid and role = 'owner') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_ttl_hours not between 1 and 720 or p_max_uses not between 1 and 50 then
    raise exception 'invalid_arguments' using errcode = '22023';
  end if;
  if not private.consume_rate_limit(uid, 'create_invite', 20, interval '1 hour') then
    raise exception 'rate_limited' using errcode = '54000';
  end if;
  code := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);          -- 48 bits
  insert into public.household_invites (household_id, code_hash, expires_at, max_uses, created_by)
  values (p_household, encode(sha256(convert_to(code, 'utf8')), 'hex'),
          now() + make_interval(hours => p_ttl_hours), p_max_uses, uid);
  return code;
end $$;

-- Returns the household id, or NULL for an unknown / expired / used-up code (one indistinguishable
-- answer for all three, so the endpoint is not an oracle). It returns instead of raising on purpose:
-- raising would roll back the rate-limit event and failed guesses would never count.
create function public.join_household(p_code text) returns uuid
  language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); inv public.household_invites; added int;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if not private.consume_rate_limit(uid, 'join_household', 10, interval '1 hour') then
    raise exception 'rate_limited' using errcode = '54000';
  end if;
  select * into inv from public.household_invites
   where code_hash = encode(sha256(convert_to(lower(regexp_replace(coalesce(p_code, ''), '[^0-9a-fA-F]', '', 'g')), 'utf8')), 'hex')
     and expires_at > now() and uses < max_uses
   for update;
  if not found then return null; end if;

  insert into public.household_members (household_id, user_id, role)
  values (inv.household_id, uid, 'member') on conflict do nothing;
  get diagnostics added = row_count;
  if added > 0 then update public.household_invites set uses = uses + 1 where id = inv.id; end if;
  update public.profiles set active_household_id = coalesce(active_household_id, inv.household_id) where id = uid;
  return inv.household_id;
end $$;

-- Rate limiting for application endpoints (AI, uploads). Buckets are namespaced so a client can
-- never touch the internal ones above, and can only ever affect its own quota.
create function public.consume_rate_limit(p_bucket text, p_limit int, p_window_seconds int) returns boolean
  language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if p_bucket !~ '^[a-z0-9_:.-]{1,64}$' or p_limit not between 1 and 10000 or p_window_seconds not between 1 and 86400 then
    raise exception 'invalid_arguments' using errcode = '22023';
  end if;
  return private.consume_rate_limit(auth.uid(), 'app:' || p_bucket, p_limit, make_interval(secs => p_window_seconds));
end $$;

-- ---- Function privileges -----------------------------------------------------------------------
revoke execute on function public.create_household(text, text), public.create_invite(uuid, int, int),
  public.join_household(text), public.consume_rate_limit(text, int, int) from public, anon;
grant execute on function public.create_household(text, text), public.create_invite(uuid, int, int),
  public.join_household(text), public.consume_rate_limit(text, int, int) to authenticated;

grant execute on function private.my_household_ids(), private.is_household_member(uuid),
  private.is_household_owner(uuid), private.shares_household(uuid) to authenticated;
-- consume_rate_limit(uuid, …), handle_new_user, guard/cleanup triggers: internal only (no grant).

grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
grant all on private.rate_events to service_role;

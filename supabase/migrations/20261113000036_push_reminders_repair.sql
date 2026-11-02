-- Repair: the objects of 20261018000013_push_reminders.sql, for a database that never ran it.
--
-- Production skipped 0013. Everything else kept working because the app treats reminders as optional, but
-- 20261107000030_wine_master.sql's private.vintage_in_use() reads public.drink_notices: on such a database every wine
-- with a vintage fails to open in the Wine Master Database (42P01, relation "public.drink_notices" does not exist),
-- and correcting or removing a vintage fails the same way. 0030 itself is correct and is NOT re-run.
--
-- This creates exactly what 0013 creates, only where it is missing: the two tables, the index, row level security,
-- the five policies and the same grants. One difference, on purpose: 0013 ends with "grant all on all tables / all
-- sequences in schema public to service_role", which run today would also reach tables and sequences created after
-- 0013; here the service role gets those rights on the two new tables only, so a repaired database ends up exactly
-- like one built in order. No existing table, row, wine, artwork or permission is changed.
--
-- Reminders stay off until the app has its push keys (VAPID_*): the tables alone send nothing. Safe to run again, and
-- a no-op on a database that ran 0013.

create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  -- where the browser's push service takes the message (always https)
  endpoint   text not null check (endpoint like 'https://%' and char_length(endpoint) <= 1000),
  p256dh     text not null check (char_length(p256dh) between 20 and 200),
  auth       text not null check (char_length(auth) between 8 and 100),
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

create table if not exists public.drink_notices (
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  vintage_id uuid not null references public.wine_vintages on delete cascade,
  -- 'peak': it has reached its best years; 'ending': the last stretch of its window, drink it soon
  kind       text not null check (kind in ('peak', 'ending')),
  sent_at    timestamptz not null default now(),
  primary key (user_id, vintage_id, kind)
);

-- ---- Row level security -------------------------------------------------------------------------
alter table public.push_subscriptions enable row level security;
alter table public.drink_notices      enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'push_subscriptions'
                    and policyname = 'push_subscriptions_select') then
    create policy push_subscriptions_select on public.push_subscriptions for select to authenticated
      using (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'push_subscriptions'
                    and policyname = 'push_subscriptions_insert') then
    create policy push_subscriptions_insert on public.push_subscriptions for insert to authenticated
      with check (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'push_subscriptions'
                    and policyname = 'push_subscriptions_delete') then
    create policy push_subscriptions_delete on public.push_subscriptions for delete to authenticated
      using (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'drink_notices'
                    and policyname = 'drink_notices_select') then
    create policy drink_notices_select on public.drink_notices for select to authenticated
      using (user_id = (select auth.uid()));
  end if;
  -- switching reminders on marks what is already true as "known", so nobody gets a pile of old news
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'drink_notices'
                    and policyname = 'drink_notices_insert') then
    create policy drink_notices_insert on public.drink_notices for insert to authenticated
      with check (user_id = (select auth.uid()) and exists (select 1 from public.wine_vintages v where v.id = vintage_id));
  end if;
end $$;

grant select, delete on public.push_subscriptions to authenticated;
grant insert (endpoint, p256dh, auth) on public.push_subscriptions to authenticated;
grant select on public.drink_notices to authenticated;
grant insert (vintage_id, kind) on public.drink_notices to authenticated;

-- what 0013's schema-wide grant gave the service role on these two tables (and nothing beyond them)
grant all on public.push_subscriptions, public.drink_notices to service_role;

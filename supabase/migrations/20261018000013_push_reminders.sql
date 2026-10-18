-- =====================================================================
-- 0013 push reminders: "this wine is at its best now"
-- =====================================================================
-- push_subscriptions: the phones and browsers a person allowed to receive notifications on (Web Push).
-- drink_notices: which reminder about which vintage a person has already had, so each one comes only once.
-- Both are a person's own, not the household's: notifications are personal.

create table public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  -- where the browser's push service takes the message (always https)
  endpoint   text not null check (endpoint like 'https://%' and char_length(endpoint) <= 1000),
  p256dh     text not null check (char_length(p256dh) between 20 and 200),
  auth       text not null check (char_length(auth) between 8 and 100),
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

create table public.drink_notices (
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

create policy push_subscriptions_select on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));
create policy push_subscriptions_insert on public.push_subscriptions for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy push_subscriptions_delete on public.push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));

create policy drink_notices_select on public.drink_notices for select to authenticated
  using (user_id = (select auth.uid()));
-- switching reminders on marks what is already true as "known", so nobody gets a pile of old news
create policy drink_notices_insert on public.drink_notices for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (select 1 from public.wine_vintages v where v.id = vintage_id));

grant select, delete on public.push_subscriptions to authenticated;
grant insert (endpoint, p256dh, auth) on public.push_subscriptions to authenticated;
grant select on public.drink_notices to authenticated;
grant insert (vintage_id, kind) on public.drink_notices to authenticated;

grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;

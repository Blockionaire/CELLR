-- =====================================================================
-- 0006 platform: first-party analytics and AI usage accounting
-- =====================================================================

-- Product analytics: first-party, insert-only for clients, no IP / user-agent, no third parties.
-- Event names are an allow-list in the application layer (domain/analytics); the DB bounds the shape.
create table public.analytics_events (
  id           bigint generated always as identity primary key,
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  household_id uuid references public.households on delete set null,
  name         text not null check (name ~ '^[a-z0-9_]{1,64}$'),
  props        jsonb not null default '{}' check (pg_column_size(props) < 4096),
  at           timestamptz not null default now()
);
create index analytics_events_name_idx on public.analytics_events (name, at desc);
create index analytics_events_user_idx on public.analytics_events (user_id, at desc);

-- Every AI call is accounted for (cost, latency, outcome) — written by the server with the service
-- role, readable by the user it belongs to. Per-user rate limits use public.consume_rate_limit().
create table public.ai_usage (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users on delete cascade,
  household_id uuid references public.households on delete set null,
  task         text not null check (task ~ '^[a-z0-9_]{1,40}$'),
  model        text not null,
  tokens_in    int not null default 0 check (tokens_in >= 0),
  tokens_out   int not null default 0 check (tokens_out >= 0),
  cost_micro   bigint not null default 0 check (cost_micro >= 0),   -- millionths of a currency unit
  latency_ms   int check (latency_ms >= 0),
  status       text not null check (status in ('ok', 'error', 'timeout', 'invalid_output', 'rate_limited')),
  at           timestamptz not null default now()
);
create index ai_usage_user_idx on public.ai_usage (user_id, at desc);

alter table public.analytics_events enable row level security;
alter table public.ai_usage         enable row level security;

create policy analytics_insert on public.analytics_events for insert to authenticated
  with check (user_id = auth.uid()
              and (household_id is null or household_id = any (((select private.my_household_ids()))::uuid[])));
-- (no select policy: clients cannot read events back, not even their own)

create policy ai_usage_select on public.ai_usage for select to authenticated using (user_id = auth.uid());
-- (no insert policy: only the service role records usage)

grant insert (household_id, name, props) on public.analytics_events to authenticated;
grant select on public.ai_usage to authenticated;

grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;

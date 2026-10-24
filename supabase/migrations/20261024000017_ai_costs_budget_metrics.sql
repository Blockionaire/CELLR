-- AI cost accounting, a platform-wide AI budget, and platform metrics. Everything here is for the server
-- (service role) only: nothing new is granted to signed-in people or visitors.

-- ---- 1. What each AI call cost ---------------------------------------------------------------------------
-- Estimates in micro-USD (1 USD = 1 000 000), from the usage the provider reported and the versioned price
-- list in the app (apps/web/src/server/ai/pricing.ts). NULL means unknown (no usage reported, or a model
-- without a price), never "free". `cost_micro` (from the first migration) was never filled in; existing rows
-- keep it at 0 and their new cost stays NULL: unknown, not rewritten as zero.
alter table public.ai_usage
  add column tokens_cached_in    int not null default 0 check (tokens_cached_in >= 0),
  add column web_search_calls    int not null default 0 check (web_search_calls >= 0),
  add column cost_usd_micro      bigint check (cost_usd_micro >= 0),
  -- When the cost is unknown: the conservative amount the budget reserved for the call, so budgets still
  -- count it. Never shown as a cost.
  add column cost_hold_usd_micro bigint check (cost_hold_usd_micro >= 0),
  add column pricing_version     text check (pricing_version ~ '^[a-z0-9._-]{1,40}$');

comment on column public.ai_usage.cost_micro is
  'Legacy, never populated (0 on every row). Use cost_usd_micro; NULL there means the cost is unknown.';

-- A call the platform budget did not allow (no provider call was made).
alter table public.ai_usage drop constraint ai_usage_status_check;
alter table public.ai_usage add constraint ai_usage_status_check
  check (status in ('ok', 'error', 'timeout', 'invalid_output', 'rate_limited', 'budget_exhausted'));

-- Aggregation by day, household and task (by user already exists).
create index ai_usage_at_idx        on public.ai_usage (at desc);
create index ai_usage_household_idx on public.ai_usage (household_id, at desc) where household_id is not null;
create index ai_usage_task_idx      on public.ai_usage (task, at desc);

-- ---- 2. Platform-wide AI budget ----------------------------------------------------------------------------
-- A call in flight holds its estimated cost until its usage is recorded (then the hold is removed). Holds that
-- were never released (a crash) stop counting after 15 minutes.
create table public.ai_budget_holds (
  id                 uuid primary key default gen_random_uuid(),
  task               text not null check (task ~ '^[a-z0-9_]{1,40}$'),
  estimate_usd_micro bigint not null check (estimate_usd_micro > 0),
  at                 timestamptz not null default now()
);
create index ai_budget_holds_at_idx on public.ai_budget_holds (at);
alter table public.ai_budget_holds enable row level security;
-- No policies and no grants for signed-in people or visitors.
revoke all on public.ai_budget_holds from public, anon, authenticated;

-- Reserve room for one AI call, or refuse it (NULL). Concurrent callers are serialised by an advisory lock, so
-- two calls cannot both take the last room. Spent = recorded costs (or, when unknown, their hold) since the
-- start of the UTC day / month, plus every live hold. A NULL limit is no limit. Service role only.
create function public.ai_budget_hold(p_task text, p_estimate bigint, p_daily bigint, p_monthly bigint)
  returns uuid language plpgsql security definer set search_path = '' as $$
declare
  day_start   timestamptz := date_trunc('day', now(), 'UTC');
  month_start timestamptz := date_trunc('month', now(), 'UTC');
  spent_day   bigint;
  spent_month bigint;
  held        bigint;
  hold_id     uuid;
begin
  if p_estimate is null or p_estimate <= 0 or p_task !~ '^[a-z0-9_]{1,40}$'
     or p_daily <= 0 or p_monthly <= 0 then
    raise exception 'invalid_arguments' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('cellr.ai_budget'));
  delete from public.ai_budget_holds where at < now() - interval '15 minutes';
  select coalesce(sum(coalesce(u.cost_usd_micro, u.cost_hold_usd_micro, 0)) filter (where u.at >= day_start), 0),
         coalesce(sum(coalesce(u.cost_usd_micro, u.cost_hold_usd_micro, 0)), 0)
    into spent_day, spent_month
    from public.ai_usage u
   where u.at >= least(day_start, month_start);
  select coalesce(sum(h.estimate_usd_micro), 0) into held from public.ai_budget_holds h;
  if (p_daily is not null and spent_day + held + p_estimate > p_daily)
     or (p_monthly is not null and spent_month + held + p_estimate > p_monthly) then
    return null;
  end if;
  insert into public.ai_budget_holds (task, estimate_usd_micro) values (p_task, p_estimate)
    returning id into hold_id;
  return hold_id;
end $$;

revoke all on function public.ai_budget_hold(text, bigint, bigint, bigint) from public, anon, authenticated;
grant execute on function public.ai_budget_hold(text, bigint, bigint, bigint) to service_role;

-- ---- 3. Platform metrics -----------------------------------------------------------------------------------
-- Counted from what people actually did in the database (accounts, households, bottles, tastings, AI calls),
-- plus the optional first-party events. Missing events (do-not-track) never make someone look inactive: the
-- database activity counts on its own. Definitions: docs/METRICS.md. Service role only.
create function public.platform_metrics(p_now timestamptz default now())
  returns jsonb language sql stable security definer set search_path = '' as $$
  with activity as (
    select user_id, at from public.analytics_events
    union all select user_id, at from public.ai_usage where status <> 'budget_exhausted'
    union all select added_by, created_at from public.bottles where added_by is not null
    union all select opened_by, opened_at from public.bottles where opened_by is not null and opened_at is not null
    union all select user_id, greatest(created_at, updated_at) from public.tastings
    union all select user_id, joined_at from public.household_members
    union all select id, last_sign_in_at from auth.users where last_sign_in_at is not null
  ),
  users as (select id as user_id, created_at from public.profiles),
  onboarded as (
    select p.id as user_id from public.profiles p
     where p.display_name is not null
       and exists (select 1 from public.household_members m where m.user_id = p.id)
  ),
  first_bottle as (
    select added_by as user_id, min(created_at) as at from public.bottles where added_by is not null group by added_by
  ),
  cohort as (
    select u.user_id, u.created_at from users u
     where u.created_at >= p_now - interval '14 days' and u.created_at < p_now - interval '7 days'
  ),
  scans as (
    select count(*) filter (where status = 'ok') as ok,
           count(*) filter (where status in ('error', 'timeout', 'invalid_output')) as failed
      from public.ai_usage
     where task = 'label_extraction' and at >= p_now - interval '30 days'
  ),
  adoption as (
    select 'scan' as feature, user_id from public.ai_usage
     where task = 'label_extraction' and status <> 'budget_exhausted' and at >= p_now - interval '30 days'
    union select 'sommelier', user_id from public.ai_usage
     where task = 'sommelier_chat' and status <> 'budget_exhausted' and at >= p_now - interval '30 days'
    union select 'wine_insight', user_id from public.ai_usage
     where task = 'wine_insight' and status <> 'budget_exhausted' and at >= p_now - interval '30 days'
    union select 'valuation', user_id from public.ai_usage
     where task = 'wine_valuation' and status <> 'budget_exhausted' and at >= p_now - interval '30 days'
    union select 'bottle_added', added_by from public.bottles
     where added_by is not null and created_at >= p_now - interval '30 days'
    union select 'bottle_opened', opened_by from public.bottles
     where opened_by is not null and opened_at >= p_now - interval '30 days'
    union select 'rating', user_id from public.tastings where created_at >= p_now - interval '30 days'
    -- Client events (optional, may be missing for people with do-not-track):
    union select 'tonight', user_id from public.analytics_events
     where name = 'tonight_recommendation_generated' and at >= p_now - interval '30 days'
    union select '3d_cellar', user_id from public.analytics_events
     where name = '3d_cellar_opened' and at >= p_now - interval '30 days'
  )
  select jsonb_build_object(
    'at', p_now,
    'registered', (select count(*) from users where created_at <= p_now),
    'new_7d', (select count(*) from users where created_at > p_now - interval '7 days' and created_at <= p_now),
    'new_30d', (select count(*) from users where created_at > p_now - interval '30 days' and created_at <= p_now),
    'dau', (select count(distinct user_id) from activity where at > p_now - interval '1 day' and at <= p_now),
    'wau', (select count(distinct user_id) from activity where at > p_now - interval '7 days' and at <= p_now),
    'mau', (select count(distinct user_id) from activity where at > p_now - interval '30 days' and at <= p_now),
    'onboarded', (select count(*) from onboarded),
    'activated', (select count(*) from onboarded o join first_bottle f using (user_id) where f.at <= p_now),
    'retention_7d', jsonb_build_object(
      'cohort', (select count(*) from cohort),
      'retained', (select count(*) from cohort c
                    where exists (select 1 from activity a
                                   where a.user_id = c.user_id
                                     and a.at >= c.created_at + interval '7 days'
                                     and a.at <  c.created_at + interval '14 days'
                                     and a.at <= p_now))),
    'scans_30d', (select jsonb_build_object('ok', ok, 'failed', failed) from scans),
    'adoption_30d', coalesce((select jsonb_object_agg(feature, n)
                                from (select feature, count(distinct user_id) as n from adoption group by feature) f),
                             '{}'::jsonb)
  );
$$;

revoke all on function public.platform_metrics(timestamptz) from public, anon, authenticated;
grant execute on function public.platform_metrics(timestamptz) to service_role;

grant all on public.ai_budget_holds to service_role;

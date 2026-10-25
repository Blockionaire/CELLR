-- Read-only aggregations for the internal admin dashboard (/admin). Service role only: nothing here is granted to
-- signed-in people or visitors, and nothing writes. The app calls these only after its own admin check
-- (CELLR_ADMIN_USER_IDS); the database adds the second wall by refusing everyone but the service role.
-- Definitions follow docs/METRICS.md and public.platform_metrics().

-- ---- 1. User directory: one bounded page, aggregated in one pass (no per-row queries) -------------------------
create function public.admin_user_directory(p_limit int, p_offset int)
  returns table (
    user_id        uuid,
    display_name   text,
    created_at     timestamptz,
    last_active_at timestamptz,
    onboarded      boolean,
    activated      boolean,
    households     int,
    bottles_added  int,
    total          bigint
  )
  language plpgsql stable security definer set search_path = '' as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 or p_offset is null or p_offset < 0 or p_offset > 1000000 then
    raise exception 'invalid_arguments' using errcode = '22023';
  end if;
  return query
  with page as (
    select p.id, p.display_name, p.created_at, count(*) over () as total
      from public.profiles p
     order by p.created_at desc, p.id
     limit p_limit offset p_offset
  ),
  members as (
    select m.user_id, count(*)::int as n, max(m.joined_at) as last_at
      from public.household_members m where m.user_id in (select id from page) group by m.user_id
  ),
  added as (
    select b.added_by as user_id, count(*)::int as n, max(b.created_at) as last_at
      from public.bottles b where b.added_by in (select id from page) group by b.added_by
  ),
  opened as (
    select b.opened_by as user_id, max(b.opened_at) as last_at
      from public.bottles b where b.opened_by in (select id from page) group by b.opened_by
  ),
  events as (
    select e.user_id, max(e.at) as last_at
      from public.analytics_events e where e.user_id in (select id from page) group by e.user_id
  ),
  ai as (
    select u.user_id, max(u.at) as last_at
      from public.ai_usage u
     where u.user_id in (select id from page) and u.status <> 'budget_exhausted' group by u.user_id
  ),
  tasted as (
    select t.user_id, max(greatest(t.created_at, t.updated_at)) as last_at
      from public.tastings t where t.user_id in (select id from page) group by t.user_id
  )
  select pg.id,
         pg.display_name,
         pg.created_at,
         nullif(greatest(coalesce(a.last_at, '-infinity'), coalesce(o.last_at, '-infinity'),
                         coalesce(e.last_at, '-infinity'), coalesce(ai.last_at, '-infinity'),
                         coalesce(t.last_at, '-infinity'), coalesce(m.last_at, '-infinity'),
                         coalesce(au.last_sign_in_at, '-infinity')), '-infinity'),
         pg.display_name is not null and coalesce(m.n, 0) > 0,
         pg.display_name is not null and coalesce(m.n, 0) > 0 and coalesce(a.n, 0) > 0,
         coalesce(m.n, 0),
         coalesce(a.n, 0),
         pg.total
    from page pg
    left join members m on m.user_id = pg.id
    left join added a on a.user_id = pg.id
    left join opened o on o.user_id = pg.id
    left join events e on e.user_id = pg.id
    left join ai on ai.user_id = pg.id
    left join tasted t on t.user_id = pg.id
    left join auth.users au on au.id = pg.id
   order by pg.created_at desc, pg.id;
end $$;

-- ---- 2. One user: counts only (no notes, no conversations, no tokens) -------------------------------------------
create function public.admin_user_summary(p_user uuid, p_now timestamptz default now())
  returns jsonb language sql stable security definer set search_path = '' as $$
  select case when not exists (select 1 from public.profiles where id = p_user) then null else jsonb_build_object(
    'user_id', p_user,
    'display_name', (select display_name from public.profiles where id = p_user),
    'created_at', (select created_at from public.profiles where id = p_user),
    'last_sign_in_at', (select last_sign_in_at from auth.users where id = p_user),
    'households', (select count(*) from public.household_members where user_id = p_user),
    'bottles_added', (select count(*) from public.bottles where added_by = p_user),
    'bottles_opened', (select count(*) from public.bottles where opened_by = p_user),
    'ratings', (select count(*) from public.tastings where user_id = p_user),
    'ai_30d', coalesce((
      select jsonb_agg(jsonb_build_object(
               'task', task, 'calls', calls, 'ok', ok, 'known_cost_usd_micro', known, 'unknown_cost_calls', unknown)
             order by calls desc)
        from (select task, count(*) as calls, count(*) filter (where status = 'ok') as ok,
                     coalesce(sum(cost_usd_micro), 0) as known,
                     count(*) filter (where cost_usd_micro is null) as unknown
                from public.ai_usage
               where user_id = p_user and at > p_now - interval '30 days' and at <= p_now
               group by task) t), '[]'::jsonb),
    'events_30d', coalesce((
      select jsonb_object_agg(name, n)
        from (select name, count(*) as n from public.analytics_events
               where user_id = p_user and at > p_now - interval '30 days' and at <= p_now
               group by name) e), '{}'::jsonb)
  ) end;
$$;

-- ---- 3. AI calls and estimated costs in a window (at most 100 days) ---------------------------------------------
-- Known cost = sum of cost_usd_micro (an estimate from the price list). cost_usd_micro NULL is UNKNOWN, never 0:
-- those calls are counted apart, with the amount the budget held for them. The legacy cost_micro is never read.
create function public.admin_ai_costs(p_from timestamptz, p_to timestamptz)
  returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  result jsonb;
begin
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '100 days' then
    raise exception 'invalid_arguments' using errcode = '22023';
  end if;
  with u as (
    select * from public.ai_usage where at >= p_from and at < p_to
  ),
  agg as (
    select count(*) as calls,
           count(*) filter (where status = 'ok') as ok,
           count(*) filter (where status in ('error', 'invalid_output')) as failed,
           count(*) filter (where status = 'timeout') as timeout,
           count(*) filter (where status = 'rate_limited') as rate_limited,
           count(*) filter (where status = 'budget_exhausted') as blocked,
           coalesce(sum(cost_usd_micro), 0) as known_cost,
           count(*) filter (where cost_usd_micro is null and status <> 'budget_exhausted') as unknown_calls,
           coalesce(sum(cost_hold_usd_micro) filter (where cost_usd_micro is null), 0) as unknown_held,
           coalesce(sum(tokens_in), 0) as tokens_in,
           coalesce(sum(tokens_cached_in), 0) as tokens_cached_in,
           coalesce(sum(tokens_out), 0) as tokens_out,
           coalesce(sum(web_search_calls), 0) as web_searches,
           round(avg(latency_ms) filter (where status = 'ok'))::int as avg_latency_ms
      from u
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'totals', (select to_jsonb(agg) from agg),
    'by_day', coalesce((
      select jsonb_agg(jsonb_build_object('day', day, 'calls', calls, 'known_cost', known, 'unknown_calls', unknown)
             order by day)
        from (select (at at time zone 'UTC')::date as day, count(*) as calls,
                     coalesce(sum(cost_usd_micro), 0) as known,
                     count(*) filter (where cost_usd_micro is null and status <> 'budget_exhausted') as unknown
                from u group by 1) d), '[]'::jsonb),
    'by_task', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.known_cost desc, t.calls desc)
        from (select task as key, count(*) as calls, count(*) filter (where status = 'ok') as ok,
                     coalesce(sum(cost_usd_micro), 0) as known_cost,
                     count(*) filter (where cost_usd_micro is null and status <> 'budget_exhausted') as unknown_calls,
                     coalesce(sum(web_search_calls), 0) as web_searches,
                     coalesce(sum(tokens_in), 0) as tokens_in, coalesce(sum(tokens_out), 0) as tokens_out
                from u group by task) t), '[]'::jsonb),
    'by_model', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.known_cost desc, t.calls desc)
        from (select model as key, count(*) as calls, count(*) filter (where status = 'ok') as ok,
                     coalesce(sum(cost_usd_micro), 0) as known_cost,
                     count(*) filter (where cost_usd_micro is null and status <> 'budget_exhausted') as unknown_calls,
                     coalesce(sum(web_search_calls), 0) as web_searches,
                     coalesce(sum(tokens_in), 0) as tokens_in, coalesce(sum(tokens_out), 0) as tokens_out
                from u group by model) t), '[]'::jsonb)
  ) into result;
  return result;
end $$;

-- ---- 4. The platform budget as ai_budget_hold() sees it ---------------------------------------------------------
-- Recorded = usage rows (their cost, or their hold when the cost is unknown). Outstanding holds = calls in flight or
-- never recorded; a hold is deleted once its usage is recorded, so the two are not counted twice (apart from the
-- instant between the two writes).
create function public.admin_budget_status(p_now timestamptz default now())
  returns jsonb language sql stable security definer set search_path = '' as $$
  with bounds as (
    select date_trunc('day', p_now, 'UTC') as day_start, date_trunc('month', p_now, 'UTC') as month_start
  )
  select jsonb_build_object(
    'recorded_day', (select coalesce(sum(coalesce(u.cost_usd_micro, u.cost_hold_usd_micro, 0)), 0)
                       from public.ai_usage u, bounds b where u.at >= b.day_start and u.at <= p_now),
    'recorded_month', (select coalesce(sum(coalesce(u.cost_usd_micro, u.cost_hold_usd_micro, 0)), 0)
                         from public.ai_usage u, bounds b where u.at >= b.month_start and u.at <= p_now),
    'holds_day', (select coalesce(sum(h.estimate_usd_micro), 0)
                    from public.ai_budget_holds h, bounds b where h.at >= b.day_start),
    'holds_month', (select coalesce(sum(h.estimate_usd_micro), 0)
                      from public.ai_budget_holds h, bounds b where h.at >= b.month_start),
    'holds_open', (select count(*) from public.ai_budget_holds h, bounds b where h.at >= b.month_start)
  );
$$;

-- ---- 5. Product activity per UTC day (7, 30 or 90 days) ---------------------------------------------------------
-- Active = the same activity as platform_metrics() (database actions plus optional first-party events). Client
-- events (Tonight, 3D cellar) are missing for people with Do Not Track / GPC; database counts are not.
create function public.admin_activity_series(p_days int, p_now timestamptz default now())
  returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  start_day date;
  result jsonb;
begin
  if p_days is null or p_days not in (7, 30, 90) then
    raise exception 'invalid_arguments' using errcode = '22023';
  end if;
  start_day := (p_now at time zone 'UTC')::date - (p_days - 1);
  with days as (
    select generate_series(start_day, (p_now at time zone 'UTC')::date, interval '1 day')::date as day
  ),
  since as (select (start_day::timestamp at time zone 'UTC') as t),
  activity as (
    select user_id, at from public.analytics_events, since where at >= since.t
    union all select user_id, at from public.ai_usage, since where status <> 'budget_exhausted' and at >= since.t
    union all select added_by, created_at from public.bottles, since where added_by is not null and created_at >= since.t
    union all select opened_by, opened_at from public.bottles, since where opened_by is not null and opened_at >= since.t
    union all select user_id, greatest(created_at, updated_at) from public.tastings, since
               where greatest(created_at, updated_at) >= since.t
    union all select user_id, joined_at from public.household_members, since where joined_at >= since.t
    union all select id, last_sign_in_at from auth.users, since where last_sign_in_at >= since.t
  ),
  active as (
    select (at at time zone 'UTC')::date as day, count(distinct user_id) as n from activity where at <= p_now group by 1
  ),
  signups as (
    select (created_at at time zone 'UTC')::date as day, count(*) as n
      from public.profiles, since where created_at >= since.t and created_at <= p_now group by 1
  ),
  ai as (
    select (at at time zone 'UTC')::date as day,
           count(*) filter (where task = 'label_extraction') as scans,
           count(*) filter (where task = 'label_extraction' and status = 'ok') as extraction_ok,
           count(*) filter (where task = 'label_extraction' and status in ('error', 'timeout', 'invalid_output')) as extraction_failed,
           count(*) filter (where task = 'sommelier_chat') as sommelier,
           count(*) filter (where task = 'wine_insight') as insights,
           count(*) filter (where task = 'wine_valuation') as valuations
      from public.ai_usage, since where at >= since.t and at <= p_now and status <> 'budget_exhausted' group by 1
  ),
  ev as (
    select (at at time zone 'UTC')::date as day,
           count(*) filter (where name = 'tonight_recommendation_generated') as tonight,
           count(*) filter (where name = '3d_cellar_opened') as cellar_3d
      from public.analytics_events, since
     where at >= since.t and at <= p_now and name in ('tonight_recommendation_generated', '3d_cellar_opened')
     group by 1
  ),
  bottles as (
    select (created_at at time zone 'UTC')::date as day, count(*) as added
      from public.bottles, since where created_at >= since.t and created_at <= p_now group by 1
  )
  select jsonb_agg(jsonb_build_object(
           'day', d.day,
           'signups', coalesce(s.n, 0), 'active', coalesce(a.n, 0),
           'scans', coalesce(ai.scans, 0), 'extraction_ok', coalesce(ai.extraction_ok, 0),
           'extraction_failed', coalesce(ai.extraction_failed, 0),
           'sommelier', coalesce(ai.sommelier, 0), 'insights', coalesce(ai.insights, 0),
           'valuations', coalesce(ai.valuations, 0), 'tonight', coalesce(ev.tonight, 0),
           'cellar_3d', coalesce(ev.cellar_3d, 0), 'bottles_added', coalesce(b.added, 0))
         order by d.day)
    into result
    from days d
    left join signups s on s.day = d.day
    left join active a on a.day = d.day
    left join ai on ai.day = d.day
    left join ev on ev.day = d.day
    left join bottles b on b.day = d.day;
  return coalesce(result, '[]'::jsonb);
end $$;

revoke all on function public.admin_user_directory(int, int) from public, anon, authenticated;
revoke all on function public.admin_user_summary(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.admin_ai_costs(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.admin_budget_status(timestamptz) from public, anon, authenticated;
revoke all on function public.admin_activity_series(int, timestamptz) from public, anon, authenticated;
grant execute on function public.admin_user_directory(int, int) to service_role;
grant execute on function public.admin_user_summary(uuid, timestamptz) to service_role;
grant execute on function public.admin_ai_costs(timestamptz, timestamptz) to service_role;
grant execute on function public.admin_budget_status(timestamptz) to service_role;
grant execute on function public.admin_activity_series(int, timestamptz) to service_role;

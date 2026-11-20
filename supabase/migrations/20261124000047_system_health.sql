-- =====================================================================
-- 0047 System health: measured health of CELLR's own parts (System Intelligence sprint 2, ADR-002)
-- =====================================================================
-- ADDITIVE: two new tables in `private` (not reachable through the API), eight new functions for the service role
-- only, and one pg_cron job. Nothing that exists changes, no existing row is read for anything but counting.
--
-- What it stores: per "round" (one run of the server-side probes, started by the heartbeat), one sample per probe:
-- a status, a machine reason code, a latency and a few numbers. Never an error message, a host name, a person or a
-- value from a request: the reason must be a short code and the detail may hold numbers, booleans and nulls only
-- (checked here, whatever the app sends).
--
-- Who can reach it: the service role, through the functions below. anon and authenticated can call none of them and
-- can read neither table (00_hygiene and 99_system_health tests). The admin dashboard reads it on the server after
-- the admin check.
--
-- Cost: one round every 10 minutes writes 18 small rows; the daily retention job keeps 14 days (~36k rows).
--
-- Rollback (only if this was applied and must go; drops the health history and nothing else):
--   select cron.unschedule('health-samples-purge');
--   drop function public.health_begin_round(text, int), public.health_record_round(bigint, text, jsonb),
--     public.health_latest(), public.health_history(int), public.health_ping(), public.health_cron_jobs(),
--     public.health_ai_window(timestamptz, timestamptz), public.health_purge(int);
--   drop table private.health_samples, private.health_rounds;
--   drop function private.health_detail_ok(jsonb);

-- ---- 1. Tables ------------------------------------------------------------------------------------------------

-- A detail is a flat object of at most 24 short keys with number, boolean or null values: no text can get in.
create function private.health_detail_ok(d jsonb) returns boolean
  language sql immutable set search_path = '' as $$
  -- CASE: the object checks run only on an object (SQL does not promise the order of AND)
  select case when d is null or jsonb_typeof(d) <> 'object' then false else
    pg_column_size(d) <= 2048
    and (select count(*) from jsonb_object_keys(d)) <= 24
    and not exists (
      select 1 from jsonb_each(d) e
       where e.key !~ '^[a-zA-Z0-9_]{1,40}$'
          or jsonb_typeof(e.value) not in ('number', 'boolean', 'null'))
  end
$$;
revoke all on function private.health_detail_ok(jsonb) from public, anon, authenticated;

create table private.health_rounds (
  id          bigint generated always as identity primary key,
  trigger     text not null check (trigger in ('heartbeat', 'manual')),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  outcome     text check (outcome in ('ok', 'partial', 'failed')),
  check ((finished_at is null) = (outcome is null)),
  check (finished_at is null or finished_at >= started_at)
);
create index health_rounds_started_idx on private.health_rounds (started_at desc);

create table private.health_samples (
  id          bigint generated always as identity primary key,
  round_id    bigint not null references private.health_rounds on delete cascade,
  probe       text not null check (probe ~ '^[a-z0-9_.-]{1,48}$'),
  status      text not null check (status in ('healthy', 'degraded', 'failed', 'unknown')),
  reason      text not null check (reason ~ '^[a-z0-9_]{1,64}$'),  -- a code: not even a host or address fits
  latency_ms  int check (latency_ms between 0 and 600000),
  detail      jsonb not null default '{}' check (private.health_detail_ok(detail)),
  measured_at timestamptz not null default now(),
  unique (round_id, probe)
);
create index health_samples_probe_idx on private.health_samples (probe, measured_at desc);
create index health_samples_round_idx on private.health_samples (round_id);

alter table private.health_rounds  enable row level security;
alter table private.health_samples enable row level security;
-- no policies and no grants: only the functions below (owned by the migration's role) touch these tables
revoke all on private.health_rounds, private.health_samples from public, anon, authenticated, service_role;

-- ---- 2. Writing a round ---------------------------------------------------------------------------------------

-- Starts a round, or answers null when one started less than p_min_gap_seconds ago — and never less than 60 seconds,
-- whatever the caller asks (also when two calls arrive at once): rounds cannot come faster than one a minute, so
-- their cost stays bounded. The insert itself is the round's proof that the database takes writes.
create function public.health_begin_round(p_trigger text, p_min_gap_seconds int default 60)
  returns bigint language plpgsql volatile security definer set search_path = '' as $$
declare
  new_id bigint;
begin
  if p_trigger is null or p_trigger not in ('heartbeat', 'manual')
     or p_min_gap_seconds is null or p_min_gap_seconds < 0 or p_min_gap_seconds > 3600 then
    raise exception 'invalid_arguments' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('cellr.health_round'));
  if exists (select 1 from private.health_rounds
              where started_at > now() - make_interval(secs => greatest(p_min_gap_seconds, 60))) then
    return null;
  end if;
  insert into private.health_rounds (trigger) values (p_trigger) returning id into new_id;
  return new_id;
end $$;

-- Records a round's samples and closes it. All or nothing: one sample the table refuses (a free-text reason, text
-- in a detail, an unknown status) refuses the whole call. A round is closed once, within 10 minutes of its start.
create function public.health_record_round(p_round bigint, p_outcome text, p_samples jsonb)
  returns integer language plpgsql volatile security definer set search_path = '' as $$
declare
  n integer;
begin
  if p_round is null or p_outcome is null or p_outcome not in ('ok', 'partial', 'failed')
     or p_samples is null or jsonb_typeof(p_samples) <> 'array'
     or jsonb_array_length(p_samples) > 64 then
    raise exception 'invalid_arguments' using errcode = '22023';
  end if;
  update private.health_rounds
     set finished_at = greatest(now(), started_at), outcome = p_outcome
   where id = p_round and finished_at is null and started_at > now() - interval '10 minutes';
  if not found then
    raise exception 'round_not_open' using errcode = '22023';
  end if;
  insert into private.health_samples (round_id, probe, status, reason, latency_ms, detail)
  select p_round, s.probe, s.status, s.reason, s."latencyMs", coalesce(s.detail, '{}'::jsonb)
    from jsonb_to_recordset(p_samples)
      as s(probe text, status text, reason text, "latencyMs" int, detail jsonb);
  get diagnostics n = row_count;
  return n;
end $$;

-- ---- 3. Reading -----------------------------------------------------------------------------------------------

-- The last five rounds, the newest finished round (also when five newer ones never finished), and the newest sample
-- of each probe (of the last 7 days: an older one is long stale).
create function public.health_latest() returns jsonb
  language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'rounds', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'trigger', r.trigger, 'startedAt', r.started_at,
                                          'finishedAt', r.finished_at, 'outcome', r.outcome)
                       order by r.started_at desc)
        from ((select * from private.health_rounds order by started_at desc limit 5)
              union
              (select * from private.health_rounds where finished_at is not null
                order by started_at desc limit 1)) r), '[]'::jsonb),
    'samples', coalesce((
      select jsonb_agg(jsonb_build_object('probe', s.probe, 'status', s.status, 'reason', s.reason,
                                          'latencyMs', s.latency_ms, 'detail', s.detail,
                                          'measuredAt', s.measured_at)
                       order by s.probe)
        from (select distinct on (probe) * from private.health_samples
               where measured_at > now() - interval '7 days'
               order by probe, measured_at desc) s), '[]'::jsonb))
$$;

-- Every sample of the last p_hours (1–168), oldest first, without details; at most 5000.
create function public.health_history(p_hours int) returns jsonb
  language plpgsql stable security definer set search_path = '' as $$
begin
  if p_hours is null or p_hours < 1 or p_hours > 168 then
    raise exception 'invalid_arguments' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('probe', s.probe, 'status', s.status, 'reason', s.reason,
                                        'latencyMs', s.latency_ms, 'measuredAt', s.measured_at)
                     order by s.measured_at, s.probe)
      from (select * from private.health_samples
             where measured_at > now() - make_interval(hours => p_hours)
             order by measured_at desc limit 5000) s), '[]'::jsonb);
end $$;

-- ---- 4. What the probes measure -------------------------------------------------------------------------------

-- The database answers a read through the API (the probe times the round trip).
create function public.health_ping() returns jsonb
  language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('inRecovery', pg_is_in_recovery())
$$;

-- pg_cron's jobs and their own run history: per job its schedule, whether it is active, the newest run's start and
-- status, and the failed runs of the last 24 hours. Never a job's command or its error text. Where pg_cron is not
-- installed (plain Postgres in tests) the answer says so instead of failing.
create function public.health_cron_jobs() returns jsonb
  language plpgsql stable security definer set search_path = '' as $$
declare
  jobs jsonb;
begin
  if to_regclass('cron.job') is null or to_regclass('cron.job_run_details') is null then
    return jsonb_build_object('available', false, 'jobs', '[]'::jsonb);
  end if;
  execute $q$
    select coalesce(jsonb_agg(jsonb_build_object(
             'name', j.jobname, 'schedule', j.schedule, 'active', j.active,
             'lastStart', l.start_time, 'lastStatus', l.status, 'failures24h', coalesce(f.n, 0))
           order by j.jobname), '[]'::jsonb)
      from cron.job j
      left join lateral (select d.start_time, d.status from cron.job_run_details d
                          where d.jobid = j.jobid order by d.start_time desc nulls last limit 1) l on true
      left join lateral (select count(*)::int as n from cron.job_run_details d
                          where d.jobid = j.jobid and d.status = 'failed'
                            and d.start_time > now() - interval '24 hours') f on true
     where j.jobname is not null
  $q$ into jobs;
  return jsonb_build_object('available', true, 'jobs', jobs);
exception when insufficient_privilege or undefined_table or undefined_column then
  return jsonb_build_object('available', false, 'jobs', '[]'::jsonb);
end $$;

-- AI calls per task in a window of at most a day: how many, how many failed, how many fell back to the plain
-- version, and the 95th percentile of their latency. Counts only: no user, household, model or cost.
create function public.health_ai_window(p_from timestamptz, p_to timestamptz) returns jsonb
  language plpgsql stable security definer set search_path = '' as $$
begin
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '1 day' then
    raise exception 'invalid_arguments' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('task', t.task, 'calls', t.calls, 'failed', t.failed,
                                        'fallback', t.fallback, 'p95Ms', t.p95) order by t.task)
      from (select u.task,
                   count(*)::int as calls,
                   count(*) filter (where u.status in ('error', 'timeout', 'invalid_output'))::int as failed,
                   count(*) filter (where u.status in ('rate_limited', 'budget_exhausted'))::int as fallback,
                   round(percentile_cont(0.95) within group (order by u.latency_ms))::int as p95
              from public.ai_usage u
             where u.at >= p_from and u.at < p_to
             group by u.task) t), '[]'::jsonb);
end $$;

-- ---- 5. Retention ---------------------------------------------------------------------------------------------

-- Deletes rounds (and their samples) older than p_keep_days (1–90); the number of rounds deleted.
create function public.health_purge(p_keep_days int default 14) returns integer
  language plpgsql volatile security definer set search_path = '' as $$
declare
  n integer;
begin
  if p_keep_days is null or p_keep_days < 1 or p_keep_days > 90 then
    raise exception 'invalid_arguments' using errcode = '22023';
  end if;
  delete from private.health_rounds where started_at < now() - make_interval(days => p_keep_days);
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.health_begin_round(text, int) from public, anon, authenticated;
revoke all on function public.health_record_round(bigint, text, jsonb) from public, anon, authenticated;
revoke all on function public.health_latest() from public, anon, authenticated;
revoke all on function public.health_history(int) from public, anon, authenticated;
revoke all on function public.health_ping() from public, anon, authenticated;
revoke all on function public.health_cron_jobs() from public, anon, authenticated;
revoke all on function public.health_ai_window(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.health_purge(int) from public, anon, authenticated;
grant execute on function public.health_begin_round(text, int) to service_role;
grant execute on function public.health_record_round(bigint, text, jsonb) to service_role;
grant execute on function public.health_latest() to service_role;
grant execute on function public.health_history(int) to service_role;
grant execute on function public.health_ping() to service_role;
grant execute on function public.health_cron_jobs() to service_role;
grant execute on function public.health_ai_window(timestamptz, timestamptz) to service_role;
grant execute on function public.health_purge(int) to service_role;

-- Every day at 04:23 UTC pg_cron keeps 14 days of health history. On Supabase pg_cron is available and this creates
-- the job; elsewhere (plain Postgres in tests and CI) it is skipped with a warning.
-- Verify after running: select jobname, schedule, active from cron.job where jobname = 'health-samples-purge';
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('health-samples-purge', '23 4 * * *', 'select public.health_purge(14)');
  else
    raise warning 'pg_cron is not available: health history is not trimmed. Schedule public.health_purge(14) daily (docs/sprints/system-health/OPERATIONS.md).';
  end if;
exception when others then
  raise warning 'could not schedule the health purge (%): schedule public.health_purge(14) daily by hand (docs/sprints/system-health/OPERATIONS.md).', sqlerrm;
end $$;

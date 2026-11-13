-- Wine Intelligence WI-01: a safer provider import lifecycle. Additive: one index, one trigger, two replaced and two
-- new service-role functions. No existing column or table changes shape. Design:
-- docs/sprints/wine-intelligence-mega/ADR-002-provider-rights.md.
--
-- The problem (found reviewing Sprint 004A's foundation): catalog_import_run_finish(run, p_withdraw_missing = true)
-- withdrew every record of the provider that this run had not seen. A run that crashed half-way and was finished
-- later — after a newer, complete run — would have withdrawn everything the newer run imported; and an older run
-- could keep importing old batches over newer data.
--
-- The rule now, enforced by the database: A PROVIDER HAS AT MOST ONE OPEN IMPORT RUN.
-- 1. Starting a run closes any run of that provider that is still open, as "abandoned" (superseded), under a lock
--    on the provider. A unique index guarantees the rule even against a bug in a function.
-- 2. A record can only be written under an OPEN run (trigger): a closed run can no longer import anything.
-- 3. So the open run is always the provider's newest, and "withdraw what I did not see" is always its to decide.
--    Finishing locks the run, so batches of the same run still in flight are seen before anything is withdrawn.
-- 4. catalog_import_run_abandon(): closes a run that failed, with the reason, withdrawing nothing.
-- 5. admin_catalog_provider_disable(): the off switch. One audited call takes a provider out of search (and, when
--    asked, blocks it: no further import). It only ever narrows; switching anything back on stays a deliberate
--    admin_catalog_provider_rights() call with evidence. Household wines and the catalogue are not touched.

-- ---- 0. One open run per provider ----------------------------------------------------------------------------------
-- Runs left open before this migration (only ever in pilot databases): all but the newest of each provider are closed.
update public.catalog_import_runs r
   set finished_at = now(),
       counts = r.counts || jsonb_build_object('abandoned', true, 'reason', 'closed by migration 20261115000038: one open run per provider')
 where r.finished_at is null
   and exists (select 1 from public.catalog_import_runs n
                where n.provider_id = r.provider_id and n.finished_at is null
                  and (n.started_at, n.id) > (r.started_at, r.id));
create unique index catalog_import_runs_one_open_idx on public.catalog_import_runs (provider_id)
  where finished_at is null;

-- ---- 1. Starting a run closes what was left open ----------------------------------------------------------------
-- Same signature, checks and grants as before (20261114000037); new: the provider row is locked, and a run of this
-- provider that is still open is abandoned as superseded.
create or replace function public.catalog_import_run_start(p_provider text, p_version text, p_source_url text,
                                                           p_sha256 text, p_note text default null,
                                                           p_retrieved_at timestamptz default null,
                                                           p_pilot boolean default false)
  returns uuid
  language plpgsql security definer set search_path = '' as $$
declare rid uuid := gen_random_uuid(); pr public.catalog_providers;
begin
  select * into pr from public.catalog_providers where id = p_provider for update;
  if pr.id is null or not pr.may_store then
    raise exception 'provider % is unknown or its licence does not allow storing its records', p_provider
      using errcode = '42501';
  end if;
  if pr.rights_status = 'blocked' then
    raise exception 'provider %: importing is blocked until its licence terms are established', p_provider
      using errcode = '42501';
  end if;
  if coalesce(p_pilot, false) and private.catalog_environment() = 'production' then
    raise exception 'a pilot run is not allowed in a production database' using errcode = '42501';
  end if;
  if pr.rights_status <> 'verified' and not coalesce(p_pilot, false) then
    raise exception 'provider %: rights are not verified; only a pilot run is allowed', p_provider
      using errcode = '42501';
  end if;
  -- waits for batches of the old run that are still being written, then closes it: it can import nothing more
  update public.catalog_import_runs
     set finished_at = now(),
         counts = counts || jsonb_build_object('abandoned', true, 'reason', 'superseded by run ' || rid)
   where provider_id = p_provider and finished_at is null;
  insert into public.catalog_import_runs (id, provider_id, dataset_version, source_url, source_sha256, note,
                                          retrieved_at, pilot, license, rights_status)
  values (rid, p_provider, p_version, p_source_url, p_sha256, p_note, coalesce(p_retrieved_at, now()),
          coalesce(p_pilot, false), pr.license, pr.rights_status);
  return rid;
end $$;

-- ---- 2. A record is only ever written under an open run -----------------------------------------------------------
-- Fires for an import's insert and for its update of last_run_id; not for a withdrawal (which changes status only).
-- The shared lock makes closing a run wait for the batches still writing under it.
create function private.catalog_record_needs_open_run() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if new.last_run_id is null then return new; end if;
  perform 1 from public.catalog_import_runs r
    where r.id = new.last_run_id and r.provider_id = new.provider_id and r.finished_at is null
      for share;
  if not found then
    raise exception 'import run % is closed, or is not a run of provider %', new.last_run_id, new.provider_id
      using errcode = '22023';
  end if;
  return new;
end $$;
revoke all on function private.catalog_record_needs_open_run() from public, anon, authenticated;
create trigger catalog_external_records_open_run before insert or update of last_run_id
  on public.catalog_external_records for each row execute function private.catalog_record_needs_open_run();

-- ---- 3. Finishing a run --------------------------------------------------------------------------------------------
-- The run is locked first: every batch of it has been written by then, so "not seen by this run" is exact.
create or replace function public.catalog_import_run_finish(p_run_id uuid, p_withdraw_missing boolean, p_counts jsonb)
  returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare prov text; n int := 0;
begin
  select provider_id into prov
    from public.catalog_import_runs where id = p_run_id and finished_at is null for update;
  if prov is null then raise exception 'no open run %', p_run_id using errcode = '22023'; end if;
  if coalesce(p_withdraw_missing, false) then
    update public.catalog_external_records
       set status = 'withdrawn'
     where provider_id = prov and status = 'active' and last_run_id is distinct from p_run_id;
    get diagnostics n = row_count;
  end if;
  update public.catalog_import_runs
     set finished_at = now(),
         -- a caller's counts can never make a finished run look abandoned
         counts = (coalesce(p_counts, '{}') - 'abandoned' - 'reason') || jsonb_build_object('withdrawn', n)
   where id = p_run_id;
  return jsonb_build_object('run', p_run_id, 'withdrawn', n);
end $$;

-- ---- 4. Abandoning a run that failed half-way -------------------------------------------------------------------
-- Its records stay as they are (each is a complete, valid record); nothing is withdrawn; the run is marked so.
create function public.catalog_import_run_abandon(p_run_id uuid, p_reason text) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  update public.catalog_import_runs
     set finished_at = now(),
         counts = counts || jsonb_build_object('abandoned', true, 'reason', left(btrim(p_reason), 300))
   where id = p_run_id and finished_at is null;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'no open run %', p_run_id using errcode = '22023'; end if;
  return jsonb_build_object('run', p_run_id, 'abandoned', true);
end $$;

-- ---- 5. The off switch ------------------------------------------------------------------------------------------
-- p_block: also set rights to 'blocked' (no further import, pilot included). Evidence fields are kept as history;
-- the log keeps before and after, the reason and the actor, like every rights change.
create function public.admin_catalog_provider_disable(p_provider text, p_reason text, p_actor text,
                                                      p_block boolean default false) returns jsonb
  language plpgsql security definer set search_path = '' as $$
begin
  return public.admin_catalog_provider_rights(
    p_provider,
    case when coalesce(p_block, false)
         then jsonb_build_object('search_scope', 'off', 'rights_status', 'blocked')
         else jsonb_build_object('search_scope', 'off') end,
    p_reason, p_actor);
end $$;

revoke all on function public.catalog_import_run_abandon(uuid, text),
                       public.admin_catalog_provider_disable(text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.catalog_import_run_abandon(uuid, text),
                          public.admin_catalog_provider_disable(text, text, text, boolean)
  to service_role;

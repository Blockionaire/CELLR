-- Wine Intelligence WI-06: what the admin needs to run the external sources after launch. Additive: four functions,
-- all for the service role only (the admin dashboard calls them after checking the admin session). No table or
-- existing function changes. Design: docs/sprints/wine-intelligence-mega/progress/WI-06.md.
--
-- 1. admin_catalog_sources_overview(): per source its rights, scope, evidence, record and link counts, its last
--    complete import, runs left open or abandoned, and its latest rights changes. Read-only.
-- 2. admin_catalog_link_queue(): suggested (or decided) links, the source's record next to the catalogue wine;
--    optionally of one source only.
-- 3. admin_catalog_record_flag(): "needs investigation": the link stays a suggestion (so nothing changes for
--    people), the note is kept on it, and the audit log records who said so and why.
-- 4. admin_wine_intelligence_metrics(): counts of the new product events by a few coarse properties. No person and
--    no household is joined, and an event's properties are treated as untrusted text (see the function).
--
-- Deliberately absent: any way to switch a source ON from the dashboard. Clearing a source for people stays a
-- deliberate admin_catalog_provider_rights() call with evidence; the dashboard only narrows (the off switch of
-- 20261115000038) and decides links.

create function public.admin_catalog_sources_overview() returns jsonb
  language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', pr.id, 'name', pr.name, 'homepage', pr.homepage,
           'license', pr.license, 'licenseUrl', pr.license_url, 'attribution', pr.attribution,
           'rightsStatus', pr.rights_status, 'searchScope', pr.search_scope,
           'mayStore', pr.may_store, 'mayDisplay', pr.may_display, 'commercialUse', pr.commercial_use,
           'rightsEvidence', pr.rights_evidence, 'rightsVerifiedAt', pr.rights_verified_at,
           'rightsVerifiedBy', pr.rights_verified_by,
           'records', (select jsonb_build_object(
                         'active', count(*) filter (where e.status = 'active'),
                         'withdrawn', count(*) filter (where e.status = 'withdrawn'))
                         from public.catalog_external_records e where e.provider_id = pr.id),
           'links', (select jsonb_build_object(
                       'suggested', count(*) filter (where l.state = 'suggested'),
                       'verified', count(*) filter (where l.state = 'verified'),
                       'rejected', count(*) filter (where l.state = 'rejected'))
                       from public.catalog_record_links l
                       join public.catalog_external_records e on e.id = l.record_id
                      where e.provider_id = pr.id),
           -- the last import that ran to its end (an abandoned run is not one)
           'lastImport', (select jsonb_build_object('datasetVersion', r.dataset_version, 'finishedAt', r.finished_at,
                                                    'retrievedAt', r.retrieved_at, 'pilot', r.pilot,
                                                    'counts', r.counts - 'problems')
                            from public.catalog_import_runs r
                           where r.provider_id = pr.id and r.finished_at is not null
                             and not coalesce((r.counts->>'abandoned')::boolean, false)
                           order by r.finished_at desc limit 1),
           'openRuns', (select count(*) from public.catalog_import_runs r
                         where r.provider_id = pr.id and r.finished_at is null),
           'abandonedRuns', (select coalesce(jsonb_agg(a order by (a->>'at') desc), '[]'::jsonb)
                               from (select jsonb_build_object('at', r.finished_at, 'datasetVersion', r.dataset_version,
                                                               'reason', left(r.counts->>'reason', 300)) as a
                                       from public.catalog_import_runs r
                                      where r.provider_id = pr.id
                                        and coalesce((r.counts->>'abandoned')::boolean, false)
                                      order by r.finished_at desc limit 3) x),
           'log', (select coalesce(jsonb_agg(g order by (g->>'at') desc), '[]'::jsonb)
                     from (select jsonb_build_object(
                                    'at', lg.at, 'actor', lg.actor, 'reason', lg.reason,
                                    'from', jsonb_build_object('rightsStatus', lg.before->>'rights_status',
                                                               'searchScope', lg.before->>'search_scope'),
                                    'to', jsonb_build_object('rightsStatus', lg.after->>'rights_status',
                                                             'searchScope', lg.after->>'search_scope')) as g
                             from public.catalog_provider_rights_log lg
                            where lg.provider_id = pr.id
                            order by lg.at desc limit 5) y)
         ) order by pr.name), '[]'::jsonb)
    from public.catalog_providers pr
$$;

create function public.admin_catalog_link_queue(p_state text default 'suggested', p_limit int default 25,
                                                p_offset int default 0, p_provider text default null)
  returns jsonb
  language plpgsql stable security definer set search_path = '' as $$
declare lim int := least(greatest(coalesce(p_limit, 25), 1), 100); off int := greatest(coalesce(p_offset, 0), 0);
begin
  if p_state not in ('suggested', 'verified', 'rejected') then
    raise exception 'unknown state' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'total', (select count(*) from public.catalog_record_links l
                join public.catalog_external_records e on e.id = l.record_id
               where l.state = p_state and (p_provider is null or e.provider_id = p_provider)),
    'rows', (select coalesce(jsonb_agg(q.item order by q.ord), '[]'::jsonb) from (
      select row_number() over (order by l.created_at, l.record_id) as ord,
             jsonb_build_object(
               'recordId', e.id, 'externalId', e.external_id, 'recordStatus', e.status,
               'state', l.state, 'reason', l.reason, 'decidedAt', l.decided_at, 'createdAt', l.created_at,
               'provider', jsonb_build_object('id', pr.id, 'name', pr.name, 'rightsStatus', pr.rights_status,
                                              'searchScope', pr.search_scope),
               'record', jsonb_build_object('producer', e.producer, 'name', e.name, 'type', e.wine_type,
                                            'countryCode', e.country_code, 'region', e.region,
                                            'appellation', e.appellation, 'vintages', to_jsonb(e.vintages),
                                            'sourceUrl', e.source_url),
               'wine', jsonb_build_object('id', w.id, 'producer', p.name, 'name', w.name, 'type', w.wine_type,
                                          'countryCode', w.country_code, 'region', w.region,
                                          'appellation', w.appellation,
                                          'aliases', (select coalesce(jsonb_agg(a.alias order by a.alias), '[]'::jsonb)
                                                        from public.wine_aliases a where a.wine_id = w.id)),
               -- other records of the SAME source already tied to this wine: a possible duplicate in the source
               'sameSourceLinks', (select count(*) from public.catalog_record_links l2
                                     join public.catalog_external_records e2 on e2.id = l2.record_id
                                    where l2.wine_id = l.wine_id and e2.provider_id = e.provider_id
                                      and l2.record_id <> l.record_id and l2.state <> 'rejected')) as item
        from public.catalog_record_links l
        join public.catalog_external_records e on e.id = l.record_id
        join public.catalog_providers pr on pr.id = e.provider_id
        join public.wines w on w.id = l.wine_id
        join public.producers p on p.id = w.producer_id
       where l.state = p_state and (p_provider is null or e.provider_id = p_provider)
       order by l.created_at, l.record_id
       limit lim offset off) q));
end $$;

-- "Needs investigation": nothing changes for people (a suggestion is never shown), the note stays on the link.
create function public.admin_catalog_record_flag(p_record uuid, p_reason text, p_actor uuid) returns text
  language plpgsql security definer set search_path = '' as $$
declare v_wine uuid; v_before jsonb;
        -- 470 + the 21 characters of the prefix below stay inside the column's 500
        v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 470), '');
begin
  if v_reason is null then raise exception 'a reason is required' using errcode = '22023'; end if;
  select l.wine_id, to_jsonb(l) - 'record_id' into v_wine, v_before
    from public.catalog_record_links l where l.record_id = p_record for update;
  if v_wine is null then return 'not_found'; end if;
  if (v_before->>'state') <> 'suggested' then return 'already_decided'; end if;
  update public.catalog_record_links set reason = 'needs investigation: ' || v_reason where record_id = p_record;
  perform private.master_log('link', p_record, v_wine, 'external_record_needs_investigation', p_actor, v_before,
                             jsonb_build_object('wine_id', v_wine, 'state', 'suggested'), v_reason);
  return 'ok';
end $$;

-- Counts only, and robust against anything a signed-in person can write. An event row is written by its own user
-- (through the app, or straight into the table, which the grant of 20261010000006 allows), so its properties are
-- UNTRUSTED text: a value is counted under its own name only when it is one of the fixed words the app sends, and as
-- 'other' otherwise; a number is clamped before it is added. One hostile row can therefore add at most 1 to a count
-- and 50 to "requests": it cannot break the page or put its own text on it. No person and no household is joined.
create function private.wi_label(p_value jsonb, p_allowed text[], p_missing text) returns text
  language sql immutable set search_path = '' as $$
  select case when p_value is null or jsonb_typeof(p_value) = 'null' then p_missing
              when jsonb_typeof(p_value) = 'string' and (p_value #>> '{}') = any (p_allowed) then p_value #>> '{}'
              else 'other' end
$$;
revoke all on function private.wi_label(jsonb, text[], text) from public, anon, authenticated;

create function public.admin_wine_intelligence_metrics(p_days int default 30) returns jsonb
  language sql stable security definer set search_path = '' as $$
  with since as (select now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 365)) as t),
  ev as (
    select e.name, e.props from public.analytics_events e, since
     where e.at >= since.t and jsonb_typeof(e.props) = 'object'
       and e.name in ('wine_search_session', 'purchase_check_completed', 'wine_scan_completed')),
  search as (
    select private.wi_label(props->'surface', array['add', 'koopcheck', 'scan'], 'unknown') as surface,
           private.wi_label(props->'outcome', array['selected', 'left'], 'unknown') as outcome,
           private.wi_label(props->'source', array['owned', 'household', 'catalog', 'provider', 'local'], 'none') as source,
           private.wi_label(props->'rank', array['1', '2_3', '4_8', '9_plus', 'none'], 'none') as rank,
           private.wi_label(props->'slowest', array['under_250ms', 'under_700ms', 'under_1500ms', 'over_1500ms'], 'none') as slowest,
           -- a number between 0 and 50, whatever was sent
           case when jsonb_typeof(props->'requests') = 'number'
                then least(greatest((props->>'requests')::numeric, 0), 50) else 0 end as requests,
           props->'zero_results' = 'true'::jsonb as zero_results,
           props->'limited' = 'true'::jsonb as limited,
           props->'failed' = 'true'::jsonb as failed
      from ev where name = 'wine_search_session'),
  checks as (
    select private.wi_label(props->'knowledge', array['vintage_profile', 'stable_facts', 'catalog_only', 'none', 'off'], 'off') as knowledge,
           private.wi_label(props->'entry', array['photo', 'search', 'typed'], 'unknown') as entry
      from ev where name = 'purchase_check_completed'),
  scans as (
    select private.wi_label(props->'resolution', array['exact_candidate', 'ambiguous', 'not_found'], 'not_recorded') as resolution
      from ev where name = 'wine_scan_completed')
  select jsonb_build_object(
    'days', least(greatest(coalesce(p_days, 30), 1), 365),
    'search', (select jsonb_build_object(
        'sessions', count(*),
        'requests', coalesce(sum(requests), 0),
        'withSelection', count(*) filter (where outcome = 'selected'),
        'abandoned', count(*) filter (where outcome = 'left'),
        'zeroResult', count(*) filter (where zero_results),
        'limited', count(*) filter (where limited),
        'failed', count(*) filter (where failed),
        'bySurface', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb)
                        from (select surface as k, count(*) as n from search group by 1) s),
        'bySource', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb)
                       from (select source as k, count(*) as n from search where outcome = 'selected' group by 1) s),
        'byRank', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb)
                     from (select rank as k, count(*) as n from search where outcome = 'selected' group by 1) s),
        'bySlowest', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb)
                        from (select slowest as k, count(*) as n from search group by 1) s))
      from search),
    'purchaseCheck', (select jsonb_build_object(
        'completed', count(*),
        'byKnowledge', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb)
                          from (select knowledge as k, count(*) as n from checks group by 1) s),
        'byEntry', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb)
                      from (select entry as k, count(*) as n from checks group by 1) s))
      from checks),
    'scan', (select jsonb_build_object(
        'completed', count(*),
        'byResolution', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb)
                           from (select resolution as k, count(*) as n from scans group by 1) s))
      from scans))
$$;

revoke all on function public.admin_catalog_sources_overview(),
                       public.admin_catalog_link_queue(text, int, int, text),
                       public.admin_catalog_record_flag(uuid, text, uuid),
                       public.admin_wine_intelligence_metrics(int)
  from public, anon, authenticated;
grant execute on function public.admin_catalog_sources_overview(),
                          public.admin_catalog_link_queue(text, int, int, text),
                          public.admin_catalog_record_flag(uuid, text, uuid),
                          public.admin_wine_intelligence_metrics(int)
  to service_role;

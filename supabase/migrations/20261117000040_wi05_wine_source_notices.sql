-- Wine Intelligence WI-05: the external sources a wine page may credit. Additive: one read-only function.
-- Design: docs/sprints/wine-intelligence-mega/progress/WI-05.md; model: packages/domain/src/wine-sources.ts.
--
-- A wine page's "Bronnen & betrouwbaarheid" lists an external source only when ALL of this holds:
--   - the wine is a wine of the CELLR catalogue (canonical);
--   - a record of that source was linked to it and an admin VERIFIED the link (a suggestion is not shown);
--   - the record is active (not withdrawn);
--   - the source is cleared and shown to people right now: rights verified, may be displayed, commercial use
--     allowed, search scope 'public'. The same gate as catalog_search and catalog_record_provenance, read at the
--     moment of the call: switching a source off removes its credit from every wine page at once.
-- Nothing else about the source's record is returned: no raw fields, only what a credit needs.
-- The tables behind it stay closed to people (20261114000037); this function is the only way in.

create function public.wine_source_notices(p_household_id uuid, p_wine_id uuid) returns jsonb
  language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(n.notice order by n.provider_name, n.external_id), '[]'::jsonb)
    from (
      select pr.name as provider_name, e.external_id,
             jsonb_build_object(
               'providerId', pr.id, 'providerName', pr.name, 'homepage', pr.homepage,
               'license', pr.license, 'licenseUrl', pr.license_url,
               'attribution', pr.attribution, 'legalNotice', pr.legal_notice,
               'modified', coalesce(cardinality(e.modifications), 0) > 0,
               'modificationNotice', pr.modification_notice,
               'modifications', to_jsonb(e.modifications),
               'externalId', e.external_id, 'sourceUrl', e.source_url,
               'retrievedAt', lr.retrieved_at, 'datasetVersion', lr.dataset_version,
               'scope', pr.search_scope) as notice
        from public.catalog_record_links l
        join public.wines w on w.id = l.wine_id and w.status = 'canonical'
        join public.catalog_external_records e on e.id = l.record_id and e.status = 'active'
        join public.catalog_providers pr on pr.id = e.provider_id and pr.search_scope = 'public'
                                         and pr.rights_status = 'verified' and pr.may_display and pr.commercial_use
        left join public.catalog_import_runs lr on lr.id = e.last_run_id
       where l.wine_id = p_wine_id and l.state = 'verified'
         and p_household_id = any (private.my_household_ids())
       order by pr.name, e.external_id
       limit 10) n
$$;
revoke all on function public.wine_source_notices(uuid, uuid) from public, anon;
grant execute on function public.wine_source_notices(uuid, uuid) to authenticated, service_role;

-- The catalogue page of a provider record (Wine Catalogue & Community Ratings sprint, PR 3): a wine a person found in
-- search or by a scan, shown on its own page before it is in any cellar. Design: docs/sprints/ratings/DESIGN.md §5.
--
-- Only a record whose source is shown to people right now (public, verified, may display, commercial use) and that is
-- active: the same rule as people's search (catalog_search). Its identity as the source gives it, the listed vintages,
-- and the source's credit; never its raw details. Read-only; additive.

create function public.catalog_record_page(p_record_id uuid) returns jsonb
  language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
           'recordId', e.id, 'producer', e.producer, 'name', e.name, 'wineType', e.wine_type,
           'countryCode', e.country_code, 'region', e.region, 'appellation', e.appellation,
           'vintages', to_jsonb(e.vintages), 'nonVintage', e.non_vintage,
           'modified', cardinality(e.modifications) > 0,
           'provider', jsonb_build_object('id', pr.id, 'name', pr.name, 'license', pr.license,
                                          'licenseUrl', pr.license_url, 'attribution', pr.attribution,
                                          'homepage', pr.homepage))
    from public.catalog_external_records e
    join public.catalog_providers pr on pr.id = e.provider_id and pr.search_scope = 'public'
                                     and pr.rights_status = 'verified' and pr.may_display and pr.commercial_use
   where e.id = p_record_id and e.status = 'active' and auth.uid() is not null
     -- a record verified as a canonical wine is that wine: people see the catalogue wine, not the record
     and not exists (select 1 from public.catalog_record_links l where l.record_id = e.id and l.state = 'verified')
$$;
revoke all on function public.catalog_record_page(uuid) from public, anon;
grant execute on function public.catalog_record_page(uuid) to authenticated, service_role;

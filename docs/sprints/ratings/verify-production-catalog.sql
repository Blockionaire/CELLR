-- READ-ONLY checks of the X-Wines catalogue and ratings in PRODUCTION (ACTIVATION.md B6), for the SQL editor. The
-- catalogue tools never connect to production except through the reviewed import route, so this is the owner's own
-- check after the import, with the same rules as staging's ratings-verify.ts. Only SELECTs; nothing is changed.
-- Run once BEFORE the import (note the "before" row) and once AFTER; every row of the AFTER run must say ok = true.
--   wines, verified links: equal to the BEFORE run (the import writes no CELLR wine and decides no link)
with p as (select * from public.catalog_providers where id = 'xwines'),
     e as (select * from public.catalog_external_records where provider_id = 'xwines'),
     a as (select * from public.catalog_rating_aggregates where provider_id = 'xwines'),
     r as (select * from public.catalog_rating_runs where provider_id = 'xwines')
select * from (values
  ('before/after: CELLR wines (compare with the other run)', true, (select count(*) from public.wines)::text),
  ('before/after: verified links (compare with the other run)', true,
     (select count(*) from public.catalog_record_links where state = 'verified')::text),
  ('records: 100,646 active', (select count(*) from e where status = 'active') = 100646,
     (select count(*) from e where status = 'active')::text),
  ('records: no external id twice', (select count(*) - count(distinct external_id) from e) = 0,
     (select count(*) - count(distinct external_id) from e)::text),
  ('ratings: 1,008,593 units', (select count(*) from a) = 1008593, (select count(*) from a)::text),
  ('ratings: 20,857,044 ratings', (select coalesce(sum(rating_count), 0) from a) = 20857044,
     (select coalesce(sum(rating_count), 0) from a)::text),
  ('ratings: 2,382 NV units', (select count(*) from a where vintage_year is null) = 2382,
     (select count(*) from a where vintage_year is null)::text),
  ('ratings: every distribution adds up to its count and its sum',
     coalesce((select bool_and((select sum(x) from unnest(distribution) x) = rating_count
                          and (select sum(x * i) from unnest(distribution) with ordinality u(x, i)) = rating_sum_half) from a), false),
     ''),
  ('ratings: only on active records of X-Wines',
     (select count(*) from a left join e on e.id = a.record_id where e.id is null or e.status <> 'active') = 0, ''),
  ('ratings: years are real years (NV is its own vintage)',
     coalesce((select min(vintage_year) >= 1800 and max(vintage_year) <= extract(year from now()) from a), false),
     (select min(vintage_year) || '–' || max(vintage_year) from a)),
  ('runs: none open; the last complete run declared these totals',
     (select count(*) from r where finished_at is null) = 0
       and (select (counts->>'units')::int = 1008593 and (counts->>'ratings')::bigint = 20857044
              from r where finished_at is not null and not (counts ? 'abandoned') order by finished_at desc limit 1),
     (select count(*) from r)::text || ' runs'),
  ('privacy: no rater or user column on the rating tables',
     not exists (select 1 from information_schema.columns where table_schema in ('public', 'private')
                  and table_name like 'catalog_rating%' and column_name ~* '(rater|user|uid|email)'), ''),
  ('privacy: runs hold counts only',
     not exists (select 1 from r, lateral (select jsonb_object_keys(r.file_counts) k union select jsonb_object_keys(r.counts)) x
                  where k not in ('rows', 'invalid', 'unknown_wine', 'repeated_dropped', 'withdrawn_record_units',
                                  'units', 'ratings', 'removed', 'abandoned', 'reason')), ''),
  ('rights: verified with evidence, commercial, ratings may be shown',
     coalesce((select rights_status = 'verified' and commercial_use and may_store and may_display and may_display_ratings
                      and rights_evidence is not null from p), false),
     (select rights_status || ', scope ' || search_scope from p)),
  ('scope: still off until ACTIVATION.md C3', coalesce((select search_scope = 'off' from p), false),
     (select search_scope from p))
) as t(check_name, ok, detail);

-- Admin portal UX & workflow (Sprint U). Additive and read-only: five new admin reads, nothing existing is changed or
-- removed, no row is written. The list the Wine Master Database showed until now (admin_wine_master, Sprint R) stays
-- as it is and keeps serving the catalogue search of the link editor.
--
-- 1. private.bottle_photo_stage(submission): the bottle-photo → 2D-artwork workflow stage, DERIVED from the
--    submission's own review status and the artwork of the wine(s) it is about (never stored, so it cannot drift):
--      pending          the review status is pending
--      rejected         the review status is rejected
--      published        the contribution was used for a published picture (status used), or it is approved and its
--                       wine already shows a published picture
--      draft            approved, and a finished picture was uploaded for its wine but is not published yet
--      artwork_needed   approved, and its wine has no picture yet: the admin's next step is to make one
--    "Its wine" is the wine it was sent for and the catalogue wine it was reviewed for (the same two the admin's wine
--    page and the publish check already use).
-- 2. admin_bottle_photo_queue(...): the photos, filtered by review status (the old ?status= links) or by stage,
--    searched by the wine as it was sent, paged in a fixed order, with the counts per status and per stage.
-- 3. admin_wine_master_search(...): the master list with database-side filters for type, country, household and
--    vintage count, two more flags (draft = an unpublished picture; approved = approved photos), and sorting on name,
--    type, country, vintage count and pending photos, always ending in producer, wine, id so pages never overlap.
--    Built from the conditions that apply (values always bound, never spliced in), so every search gets its own plan;
--    counts per wine are only aggregated when a filter or the sort needs them.
-- 4. admin_wine_master_facets(): the countries present, for the country filter.
-- 5. admin_work_queue(): the overview's work queue, a handful of bounded counts.
-- Every function is for the service role only, like every admin read before it.

-- ---- 1. The workflow stage of a contribution ---------------------------------------------------------------------
create function private.bottle_photo_stage(s public.bottle_photo_submissions) returns text
  language sql stable security definer set search_path = '' as $$
  select case s.status
    when 'pending' then 'pending'
    when 'rejected' then 'rejected'
    when 'used' then 'published'
    else case
      when exists (select 1 from public.wine_bottle_art a
                    where a.wine_id in (s.source_wine_id, s.canonical_wine_id) and a.vintage_id is null
                      and a.published_at is null) then 'draft'
      when exists (select 1 from public.wine_bottle_art a
                    where a.wine_id in (s.source_wine_id, s.canonical_wine_id) and a.vintage_id is null
                      and a.published_at is not null) then 'published'
      else 'artwork_needed' end end
$$;
revoke all on function private.bottle_photo_stage(public.bottle_photo_submissions) from public, anon, authenticated;

-- ---- 2. The bottle-photo queue -------------------------------------------------------------------------------------
-- p_status: pending | approved | rejected | used | all (or null); p_stage: one of the stages above | all (or null).
-- Returns { total, counts: {status: n}, stages: {stage: n}, rows: [photo + stage] }; pending first, then newest.
create function public.admin_bottle_photo_queue(p_status text, p_stage text, p_query text, p_limit int, p_offset int)
  returns jsonb language sql stable security definer set search_path = '' as $$
  with base as (
    select s, private.bottle_photo_stage(s) as stage from public.bottle_photo_submissions s),
  args as (select nullif(btrim(coalesce(p_query, '')), '') as q),
  hits as (
    select b.s, b.stage from base b, args
     where (coalesce(p_status, 'all') = 'all' or (b.s).status = p_status)
       and (coalesce(p_stage, 'all') = 'all' or b.stage = p_stage)
       and (args.q is null or (b.s).producer_text ilike '%' || args.q || '%'
            or (b.s).wine_text ilike '%' || args.q || '%'))
  select jsonb_build_object(
    'total', (select count(*) from hits),
    'counts', (select coalesce(jsonb_object_agg(st, n), '{}'::jsonb)
                 from (select (b.s).status as st, count(*) as n from base b group by 1) c),
    'stages', (select coalesce(jsonb_object_agg(stage, n), '{}'::jsonb)
                 from (select b.stage, count(*) as n from base b group by 1) c),
    'rows', coalesce((select jsonb_agg(private.bottle_photo_json(h.s) || jsonb_build_object('stage', h.stage)
                                       order by ((h.s).status = 'pending') desc, (h.s).created_at desc, (h.s).id)
                        from (select * from hits x
                               order by ((x.s).status = 'pending') desc, (x.s).created_at desc, (x.s).id
                               limit least(greatest(coalesce(p_limit, 50), 1), 200)
                               offset greatest(coalesce(p_offset, 0), 0)) h), '[]'::jsonb))
$$;

-- ---- 3. The master list, filtered and sorted in the database ---------------------------------------------------
-- p_flags: art | no_art | draft | pending | approved | corrections | linked | unlinked. p_type: a wine type.
-- p_country: a country code (the wine's, else its producer's). p_household: a household's own wines.
-- p_vintages: none | one | many. p_sort: name | type | country | vintages | pending; p_desc: descending.
-- Returns { total, household (the filtered household's name), rows }. Unknown flags or values are ignored.
create function public.admin_wine_master_search(p_scope text, p_flags text[], p_query text, p_type text,
                                                p_country text, p_household uuid, p_vintages text, p_sort text,
                                                p_desc boolean, p_limit int, p_offset int)
  returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
-- Built from the parts that apply, so each search gets a plan of its own (a single statement full of "p is null or
-- ..." gets one generic plan that is slow at 100k+ wines). Only fixed SQL fragments are put together; every value the
-- admin typed or chose goes in as a bound parameter ($1..$8), never into the text.
declare
  q    text := nullif(btrim(coalesce(p_query, '')), '');
  nq   text := private.normalize_text(coalesce(p_query, ''));
  f    text[] := coalesce(p_flags, '{}');
  srt  text := case when p_sort in ('name', 'type', 'country', 'vintages', 'pending') then p_sort else 'name' end;
  d    boolean := coalesce(p_desc, false);
  cc   text := nullif(upper(btrim(coalesce(p_country, ''))), '');
  qid  uuid;
  cond text := 'true';
  joins text := '';
  k    text := 'null::text';
  ord  text;
  art  constant text := 'select 1 from public.wine_bottle_art a where a.wine_id = w.id and a.vintage_id is null';
  sub  constant text := 'select 1 from public.bottle_photo_submissions s where (s.source_wine_id = w.id or s.canonical_wine_id = w.id)';
  lnk  constant text := 'select 1 from public.wine_links l where l.source_wine_id = w.id and l.canonical_wine_id is not null';
  result jsonb;
begin
  if q ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then qid := q::uuid; end if;
  if p_scope = 'catalogue' then cond := cond || ' and w.status = ''canonical''';
  elsif p_scope = 'household' then cond := cond || ' and w.status = ''provisional''';
  end if;
  if p_type is not null then cond := cond || ' and w.wine_type::text = $3'; end if;
  if cc is not null then cond := cond || ' and coalesce(w.country_code, p.country_code) = $4'; end if;
  if p_household is not null then cond := cond || ' and w.owner_household_id = $5'; end if;
  if q is not null then
    cond := cond || ' and (w.id is not distinct from $6 or p.normalized_name like ''%'' || $2 || ''%'''
                 || ' or w.normalized_name like ''%'' || $2 || ''%'' or w.country_code = upper($1)'
                 || ' or w.region ilike ''%'' || $1 || ''%'' or exists (select 1 from public.wine_aliases x'
                 || ' where x.wine_id = w.id and x.normalized_alias like ''%'' || $2 || ''%''))';
  end if;
  if 'art' = any (f) then cond := cond || ' and exists (' || art || ' and a.published_at is not null)'; end if;
  if 'no_art' = any (f) then cond := cond || ' and not exists (' || art || ' and a.published_at is not null)'; end if;
  if 'draft' = any (f) then cond := cond || ' and exists (' || art || ' and a.published_at is null)'; end if;
  if 'pending' = any (f) then cond := cond || ' and exists (' || sub || ' and s.status = ''pending'')'; end if;
  if 'approved' = any (f) then cond := cond || ' and exists (' || sub || ' and s.status = ''approved'')'; end if;
  if 'corrections' = any (f) then
    cond := cond || ' and exists (select 1 from public.catalog_scan_signals c where c.kind = ''catalog'''
                 || ' and c.wine_id = w.id and c.status = ''open'')';
  end if;
  if 'linked' = any (f) then cond := cond || ' and exists (' || lnk || ')'; end if;
  if 'unlinked' = any (f) then
    cond := cond || ' and w.status = ''provisional'' and not exists (' || lnk || ')';
  end if;
  -- counts per wine, aggregated once, only when the sort or a filter needs them
  if srt = 'vintages' or p_vintages in ('none', 'one', 'many') then
    joins := joins || ' left join (select v.wine_id, count(*) as n from public.wine_vintages v group by v.wine_id) vc'
                   || ' on vc.wine_id = w.id';
    cond := cond || case p_vintages when 'none' then ' and vc.n is null' when 'one' then ' and vc.n = 1'
                                    when 'many' then ' and vc.n >= 2' else '' end;
  end if;
  if srt = 'pending' then
    -- a photo counts for the wine it was sent for and the catalogue wine it is about
    joins := joins || ' left join (select x.wid, count(distinct s.id) as n from public.bottle_photo_submissions s'
                   || ' cross join lateral (values (s.source_wine_id), (s.canonical_wine_id)) as x(wid)'
                   || ' where s.status = ''pending'' and x.wid is not null group by x.wid) pd on pd.wid = w.id';
  end if;
  k := case srt when 'vintages' then 'coalesce(vc.n, 0)' when 'pending' then 'coalesce(pd.n, 0)'
                when 'type' then 'w.wine_type::text' when 'country' then 'coalesce(w.country_code, p.country_code)'
                else 'null::text' end;
  -- always ending in producer, wine, id: a fixed order, so pages never overlap (%1$s = the table alias)
  ord := case when srt = 'name' and d then '%1$s.pn desc, %1$s.wn desc, %1$s.id'
              when srt = 'name' then '%1$s.pn, %1$s.wn, %1$s.id'
              else '%1$s.k ' || case when d then 'desc' else 'asc' end || ' nulls last, %1$s.pn, %1$s.wn, %1$s.id' end;
  execute format($q$
    with hits as (
      select w.id, p.normalized_name as pn, w.normalized_name as wn, %1$s as k
        from public.wines w join public.producers p on p.id = w.producer_id %2$s
       where %3$s),
    page as (select h.* from hits h order by %4$s limit $7 offset $8)
    select jsonb_build_object(
      'total', (select count(*) from hits),
      'household', (select hh.name from public.households hh where hh.id = $5),
      'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', w.id, 'producer', p.name, 'name', w.name, 'type', w.wine_type,
        'country', coalesce(w.country_code, p.country_code), 'region', w.region, 'status', w.status,
        'householdId', w.owner_household_id,
        'household', (select hh.name from public.households hh where hh.id = w.owner_household_id),
        'vintages', (select count(*) from public.wine_vintages v where v.wine_id = w.id),
        'published', exists (select 1 from public.wine_bottle_art a
                              where a.wine_id = w.id and a.vintage_id is null and a.published_at is not null),
        'draft', exists (select 1 from public.wine_bottle_art a
                          where a.wine_id = w.id and a.vintage_id is null and a.published_at is null),
        'pending', (select count(*) from public.bottle_photo_submissions s
                     where (s.source_wine_id = w.id or s.canonical_wine_id = w.id) and s.status = 'pending'),
        'approved', (select count(*) from public.bottle_photo_submissions s
                      where (s.source_wine_id = w.id or s.canonical_wine_id = w.id) and s.status = 'approved'),
        'openCorrections', (select count(*) from public.catalog_scan_signals c
                             where c.kind = 'catalog' and c.wine_id = w.id and c.status = 'open'),
        'linkedTo', l.canonical_wine_id,
        'linkedName', (select cp.name || ' — ' || c.name from public.wines c
                         join public.producers cp on cp.id = c.producer_id where c.id = l.canonical_wine_id),
        'linkedFrom', (select count(*) from public.wine_links x where x.canonical_wine_id = w.id))
        order by %5$s)
        from page pg join public.wines w on w.id = pg.id join public.producers p on p.id = w.producer_id
        left join public.wine_links l on l.source_wine_id = w.id), '[]'::jsonb))
  $q$, k, joins, cond, format(ord, 'h'), format(ord, 'pg'))
  into result
  using q, nq, p_type, cc, p_household, qid,
        least(greatest(coalesce(p_limit, 50), 1), 200), greatest(coalesce(p_offset, 0), 0);
  return result;
end $fn$;

-- ---- 4. The country filter's choices -----------------------------------------------------------------------------
create function public.admin_wine_master_facets()
  returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'countries', coalesce((select jsonb_agg(jsonb_build_object('code', c.code, 'n', c.n) order by c.code)
                             from (select coalesce(w.country_code, p.country_code) as code, count(*) as n
                                     from public.wines w join public.producers p on p.id = w.producer_id
                                    group by 1) c
                            where c.code is not null), '[]'::jsonb))
$$;

-- ---- 5. The overview's work queue ----------------------------------------------------------------------------------
create function public.admin_work_queue()
  returns jsonb language sql stable security definer set search_path = '' as $$
  with open_photos as (
    select private.bottle_photo_stage(s) as stage
      from public.bottle_photo_submissions s where s.status in ('pending', 'approved'))
  select jsonb_build_object(
    'photosPending', (select count(*) from open_photos where stage = 'pending'),
    'artworkNeeded', (select count(*) from open_photos where stage = 'artwork_needed'),
    'photosWithDraft', (select count(*) from open_photos where stage = 'draft'),
    'artDrafts', (select count(distinct a.wine_id) from public.wine_bottle_art a
                   where a.vintage_id is null and a.published_at is null),
    'corrections', (select count(distinct c.wine_id) from public.catalog_scan_signals c
                     where c.kind = 'catalog' and c.status = 'open'),
    'catalogueWithoutArt', (select count(*) from public.wines w
                             where w.status = 'canonical' and not exists (
                               select 1 from public.wine_bottle_art a
                                where a.wine_id = w.id and a.vintage_id is null and a.published_at is not null)))
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.admin_bottle_photo_queue(text, text, text, int, int)',
    'public.admin_wine_master_search(text, text[], text, text, text, uuid, text, text, boolean, int, int)',
    'public.admin_wine_master_facets()', 'public.admin_work_queue()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

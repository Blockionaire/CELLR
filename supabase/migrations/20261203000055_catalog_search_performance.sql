-- People's catalogue search, cheaper in CPU with the same answers (docs/sprints/ratings/PERF-OPTIMISATION.md).
--
-- Why: the staging load test of people's search (perf16) was CPU-bound on a 2-vCPU database: about 3,700 shared
-- buffers and tens of milliseconds of CPU per search, so 16 searches at once could not stay under the p95 of 250 ms.
-- This replaces private.catalog_search_impl (last defined in 20261119000042) with the same signature, attributes,
-- grants and result, and the same rules: the same candidates, the same scores, the same order. What changed is how
-- much work it takes to get there:
--
-- 1. NO SECOND LOOK AT THE SAME ROWS. The old version counted the trigram LIKE matches once ("is the page already
--    full?", to decide on typo tolerance) and then scanned the same rows again in the main query. Now the LIKE
--    candidates are read once, as a list of ids, and typo tolerance is decided from its length. Identical decision:
--    the count was "fewer than `limit` matches", the list holds up to 400 of them and the limit is at most 20.
-- 2. TYPO TOLERANCE ONLY WHEN IT IS NEEDED, AS BEFORE, BUT NOT EVEN PLANNED OTHERWISE. The word-similarity candidates
--    (the costly part) are a separate statement that runs only when the LIKE candidates do not fill the page.
-- 3. LESS PLANNING. The candidate scan whose shape depends on the words typed stays dynamic SQL (its patterns must be
--    constants for the trigram and prefix indexes). The word-similarity scan and the scoring are static SQL with a
--    cached generic plan (plan_cache_mode, below): measured, the generic plan keeps the trigram GIN index for the
--    word-similarity operator and the primary key for the scoring.
-- 4. THE DETAILS ARE FETCHED FOR THE PAGE, NOT FOR EVERY CANDIDATE. The old query joined up to 800 candidates to
--    wines, producers, aliases, provider records and providers and only then took the best `limit`. Now the best
--    `limit` are chosen first (the order uses the candidate's own columns only, and every join is to a primary key, so
--    nothing can be added or lost) and only those are joined.
-- 5. "EVERY WORD STARTS A WORD" without a regular expression: (' ' || text) like ('% ' || word || '%') is the same
--    test as text ~ ('(^| )' || word), because a word of the normalised query holds letters and digits only.
-- 6. One choice that was left to chance is now fixed: when two rows of the same wine (two aliases) tie on score,
--    the one with the lower index id is kept. Before, the sort order of the moment decided.
--
-- Unchanged on purpose: SECURITY DEFINER with search_path ''; not callable by any API role; public.catalog_search
-- (membership check, scope 'public' only) and public.catalog_search_pilot are not touched; the sources whose records
-- may be candidates are decided first and applied inside both candidate scans (20261119000042); a public provider's
-- rights are checked again where rows are scored; a record with a verified link is hidden behind its catalogue wine;
-- only canonical wines are `verified`, `fuzzy` is never an identity; the limit is 1..20, a query is cut at 8 words and
-- 80 characters; ties are broken by name.
--
-- The trigram index's pending list: an index with fast update keeps new entries in an unsorted list until a vacuum
-- (or the list reaching gin_pending_list_limit, 4 MB by default) merges them, and every search reads that whole list.
-- After an import of 100,000 records it held 142 pages locally, about 3 ms of every search. The limit for this index is
-- lowered to 512 kB (at most 64 pages): an import merges more often, in smaller batches (measured in the report).

create or replace function private.catalog_search_impl(p_household_id uuid, p_query text, p_type text, p_country text,
                                            p_region text, p_limit int, p_scopes text[])
  returns table (result_kind text, wine_id uuid, record_id uuid, producer text, name text, matched_alias text,
                 wine_type text, country_code text, region text, source text, verified boolean, match text,
                 score real, bottles int, provider_id text, provider_name text, attribution text, license text,
                 license_url text, provider_scope text, modified boolean, vintages smallint[])
  language plpgsql stable security definer set search_path = ''
  -- 0.6: measured on 100k provider records (Sprint 004A REPORT.md): 0.55 let "chateau margau" match 15,505 rows, 0.6
  -- matches 424, with the same typo recall on the benchmark's variants
  set pg_trgm.word_similarity_threshold = 0.6
  -- the static statements below are planned once per connection, not on every search; the one statement whose
  -- patterns must be constants for an index is dynamic SQL, which is always planned with its values
  set plan_cache_mode = force_generic_plan as $$
declare
  q       text;
  toks    text[];
  t       text;
  lim     int := least(greatest(coalesce(p_limit, 10), 1), 20);
  reg     text;
  filters text := '';
  cand    text;
  shown   text[];
  lk      bigint[];
  fz      bigint[] := '{}';
begin
  if p_household_id is null then return; end if;
  q := private.normalize_text(left(coalesce(p_query, ''), 200));
  toks := (string_to_array(nullif(q, ''), ' '))[1:8];
  if toks is null then return; end if;
  q := left(array_to_string(toks, ' '), 80);
  toks := string_to_array(q, ' ');
  if char_length(q) < 2 then return; end if;

  if p_type is not null then
    if p_type not in (select unnest(enum_range(null::public.wine_type))::text) then return; end if;
    filters := filters || format(' and e.wine_type = %L::public.wine_type', p_type);
  end if;
  if p_country is not null then
    if p_country !~ '^[A-Z]{2}$' then return; end if;
    filters := filters || format(' and e.country_code = %L', p_country);
  end if;
  reg := nullif(private.normalize_text(left(p_region, 120)), '');
  if reg is not null then filters := filters || format(' and e.region_text like %L', '%' || reg || '%'); end if;

  -- Which sources' records may be candidates at all (20261119000042): decided once, from the provider rows as they
  -- are now, and applied INSIDE both candidate scans, so a hidden source can never take a visible wine's place.
  select coalesce(array_agg(pr.id), '{}') into shown
    from public.catalog_providers pr
   where pr.search_scope = any (p_scopes)
     and (pr.search_scope <> 'public'
          or (pr.rights_status = 'verified' and pr.may_store and pr.may_display and pr.commercial_use));

  -- Candidates by the words typed, through an index: every 3+ letter word as a trigram LIKE (the GIN index ANDs
  -- them); a short query by btree prefix of the producer or the name. The 400 shortest, read once.
  cand := '';
  foreach t in array toks loop
    if char_length(t) >= 3 then cand := cand || format(' and e.search_text like %L', '%' || t || '%'); end if;
  end loop;
  if cand = '' then
    cand := format(' and (e.producer_text like %L or e.name_text like %L)', q || '%', q || '%');
  end if;
  execute format($q$
    select coalesce(array_agg(x.id), '{}') from (
      select e.id from private.catalog_search_entries e
       where (e.household_id is null or e.household_id = $1) %s %s
         and (e.kind <> 'record' or (e.provider_id = any ($2) and not exists (
                select 1 from public.catalog_record_links l where l.record_id = e.record_id and l.state = 'verified')))
       order by char_length(e.search_text), e.id limit 400) x
  $q$, cand, filters) into lk using p_household_id, shown;

  -- Typo tolerance (trigram word similarity) only when the words typed do not already give a full page (a person
  -- still typing a correct name gets prefix results, fast); and never for fewer than 4 letters. Exactly the old
  -- decision: fewer than `lim` LIKE candidates (the list above is cut at 400, `lim` is at most 20).
  if char_length(q) >= 4 and cardinality(lk) < lim then
    select coalesce(array_agg(x.id), '{}') into fz from (
      select e.id from private.catalog_search_entries e
       where q operator(extensions.<%) e.search_text
         and (e.household_id is null or e.household_id = p_household_id)
         and (p_type is null or e.wine_type = p_type::public.wine_type)
         and (p_country is null or e.country_code = p_country)
         and (reg is null or e.region_text like '%' || reg || '%')
         and (e.kind <> 'record' or (e.provider_id = any (shown) and not exists (
                select 1 from public.catalog_record_links l where l.record_id = e.record_id and l.state = 'verified')))
       order by extensions.word_similarity(q, e.search_text) desc, e.id limit 400) x;
  end if;

  return query
    with owned as (
      select v.wine_id as owned_wine, count(*)::int as n
        from public.bottles b join public.wine_vintages v on v.id = b.vintage_id
       where b.household_id = p_household_id and b.status = 'in_cellar'
       group by v.wine_id
    ),
    scored as (
      select c.*,
             case when c.name_text = q or c.search_text = q or c.producer_text = q then 3
                  when (select bool_and((' ' || c.search_text) like ('% ' || x.w || '%')) from unnest(toks) x (w)) then 2
                  else 1 end as cls,
             extensions.similarity(q, c.search_text) as sim
        from private.catalog_search_entries c
        left join public.catalog_providers pr on pr.id = c.provider_id
       where c.id = any (lk || fz)
         and (c.kind <> 'record'
              or (pr.search_scope = any (p_scopes)
                  -- a public provider's rights are checked again here, not only when its row was written
                  and (pr.search_scope <> 'public'
                       or (pr.rights_status = 'verified' and pr.may_store and pr.may_display and pr.commercial_use))
                  and not exists (select 1 from public.catalog_record_links l
                                   where l.record_id = c.record_id and l.state = 'verified')))
    ),
    ranked as (
      select s.*, coalesce(o.n, 0) as owned_n,
             (s.cls + 0.5 * s.sim
              + case when coalesce(o.n, 0) > 0 then 0.6
                     when s.kind <> 'record' and not s.canonical then 0.4
                     when s.canonical then 0.3 else 0 end)::real as total
        from scored s left join owned o on o.owned_wine = s.wine_id
    ),
    best as (
      select distinct on (coalesce(r.wine_id, r.record_id)) r.*
        from ranked r
       order by coalesce(r.wine_id, r.record_id), r.total desc, (r.kind = 'wine') desc, r.id
    ),
    -- the page first (ties broken by name, not by a random id, so a run can be repeated exactly), then its details
    page as (
      select bb.* from best bb
       order by bb.total desc, char_length(bb.search_text), bb.search_text, coalesce(bb.wine_id, bb.record_id)
       limit lim
    )
    select case when b.kind = 'record' then 'record' else 'wine' end,
           b.wine_id, b.record_id,
           coalesce(p.name, er.producer), coalesce(w.name, er.name),
           case when b.kind = 'alias' then a.alias end,
           coalesce(w.wine_type, er.wine_type)::text,
           coalesce(w.country_code, p.country_code, er.country_code),
           coalesce(w.region, er.region),
           case when b.kind = 'record' then 'provider'
                when b.owned_n > 0 then 'owned'
                when not b.canonical then 'household'
                else 'catalog' end,
           b.kind <> 'record' and b.canonical,
           case b.cls when 3 then case when b.kind = 'alias' then 'alias' else 'exact' end
                      when 2 then case when b.kind = 'alias' then 'alias' else 'prefix' end
                      else 'fuzzy' end,
           b.total, b.owned_n,
           pr.id, pr.name, pr.attribution, pr.license, pr.license_url, pr.search_scope,
           case when b.kind = 'record' then cardinality(er.modifications) > 0 end,
           case when b.kind = 'record' then er.vintages end
      from page b
      left join public.wines w on w.id = b.wine_id
      left join public.producers p on p.id = w.producer_id
      left join public.wine_aliases a on a.id = b.alias_id
      left join public.catalog_external_records er on er.id = b.record_id
      left join public.catalog_providers pr on pr.id = er.provider_id
     order by b.total desc, char_length(b.search_text), b.search_text, coalesce(b.wine_id, b.record_id);
end $$;
-- create or replace keeps the grants; stated again so this file says them: no API role calls the implementation
revoke all on function private.catalog_search_impl(uuid, text, text, text, text, int, text[])
  from public, anon, authenticated, service_role;

-- Bounded pending list for the trigram index (see the header).
alter index private.catalog_search_entries_trgm set (gin_pending_list_limit = 512);

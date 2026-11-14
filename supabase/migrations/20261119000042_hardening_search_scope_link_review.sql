-- Wine Intelligence, hardening after the independent review of WI-05 and WI-06
-- (docs/sprints/wine-intelligence-mega/progress/WI-08-hardening.md). Additive: one function replaced with the same
-- signature and grants, one new trigger. No table changes shape.
--
-- 1. SEARCH: A SOURCE THAT IS NOT SHOWN TO PEOPLE COULD EMPTY PEOPLE'S SEARCH (finding 3, P2). In the search of
--    20261114000037 the candidate scans took the 400 shortest matches of EVERYTHING in the index and only afterwards
--    dropped the records of sources that may not be shown. A source that was imported but is not shown (scope off:
--    the required state before its rights are cleared) or that was switched off, with 400 or more records matching a
--    common word, pushed the CELLR catalogue's and the household's own wines out of the answer. Reproduced: 600
--    records "Chateau N / Vin" of a hidden source, and a search for "chateau" returned nothing.
--    Now the sources whose records may be candidates are decided first and applied inside both candidate scans and
--    in the "is the page already full?" count. Nothing that may be shown changed.
--
-- 2. LINKS: AN APPROVED LINK SURVIVED A CHANGE OF THE RECORD'S IDENTITY (finding 4, P2). When a source reused or
--    corrected an id (another producer, name, colour or country), the import updated the record and kept the
--    approved link: the old catalogue wine went on crediting the source for a record that is no longer that wine,
--    and the new identity stayed hidden behind the "verified" link. Now such a change puts the link back to
--    'suggested' (so nothing is shown to people on its strength), with a note, and it is logged; the admin decides
--    again in /admin/sources.

create or replace function private.catalog_search_impl(p_household_id uuid, p_query text, p_type text, p_country text,
                                            p_region text, p_limit int, p_scopes text[])
  returns table (result_kind text, wine_id uuid, record_id uuid, producer text, name text, matched_alias text,
                 wine_type text, country_code text, region text, source text, verified boolean, match text,
                 score real, bottles int, provider_id text, provider_name text, attribution text, license text,
                 license_url text, provider_scope text, modified boolean, vintages smallint[])
  language plpgsql stable security definer set search_path = ''
  -- 0.6: measured on 100k provider records (REPORT.md): 0.55 let "chateau margau" match 15,505 rows, 0.6 matches
  -- 424, with the same typo recall on the benchmark's variants
  set pg_trgm.word_similarity_threshold = 0.6 as $$
declare
  q       text;
  toks    text[];
  t       text;
  lim     int := least(greatest(coalesce(p_limit, 10), 1), 20);
  typ     text;
  reg     text;
  filters text := '';
  cand    text;
  n_pre   int;
  fuzzy   boolean;
  shown   text[];
  seen    text;
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

  -- WHICH SOURCES' RECORDS MAY BE CANDIDATES AT ALL (new in 20261119000042). Decided once, here, from the provider
  -- rows as they are now, and applied INSIDE every candidate scan below and in the "is the page already full?"
  -- count. Before, the scans took the 400 shortest matches of everything, hidden sources included, and only then
  -- dropped what may not be shown: a source imported but not shown to people (scope off), or switched off, with 400
  -- or more records matching a common word, pushed every CELLR wine and every wine of the household out of the
  -- answer. A record already tied to a catalogue wine by a verified link is left out the same way (the catalogue
  -- wine stands for it). The check where rows are scored stays as it was: belt and braces.
  select coalesce(array_agg(pr.id), '{}') into shown
    from public.catalog_providers pr
   where pr.search_scope = any (p_scopes)
     and (pr.search_scope <> 'public'
          or (pr.rights_status = 'verified' and pr.may_store and pr.may_display and pr.commercial_use));
  seen := ' and (e.kind <> ''record'' or (e.provider_id = any ($7) and not exists (
             select 1 from public.catalog_record_links l where l.record_id = e.record_id and l.state = ''verified'')))';

  -- Candidates, each through an index: every 3+ letter word as a trigram LIKE (the GIN index ANDs them); a short
  -- query by btree prefix of the producer or the name; a typo by trigram word similarity.
  cand := '';
  foreach t in array toks loop
    if char_length(t) >= 3 then cand := cand || format(' and e.search_text like %L', '%' || t || '%'); end if;
  end loop;
  if cand = '' then
    cand := format(' and (e.producer_text like %L or e.name_text like %L)', q || '%', q || '%');
  end if;
  -- Typo tolerance only when the words typed do not already give a full page (a person still typing a correct
  -- name gets prefix results, fast); and never for fewer than 4 letters.
  fuzzy := char_length(q) >= 4;
  if fuzzy then
    execute format('select count(*) from (select 1 from private.catalog_search_entries e
                     where (e.household_id is null or e.household_id = $1) %s %s %s limit %s) x',
                   cand, filters, replace(seen, '$7', '$2'), lim)
      into n_pre using p_household_id, shown;
    fuzzy := n_pre < lim;
  end if;

  return query execute format($q$
    with owned as (
      select v.wine_id, count(*)::int as n
        from public.bottles b join public.wine_vintages v on v.id = b.vintage_id
       where b.household_id = $1 and b.status = 'in_cellar'
       group by v.wine_id
    ),
    cand as (
      (select e.* from private.catalog_search_entries e
        where (e.household_id is null or e.household_id = $1) %1$s %2$s %3$s
        order by char_length(e.search_text), e.id limit 400)
      union
      (select e.* from private.catalog_search_entries e
        where $5 and $2 operator(extensions.<%%) e.search_text
          and (e.household_id is null or e.household_id = $1) %2$s %3$s
        order by extensions.word_similarity($2, e.search_text) desc, e.id limit 400)
    ),
    scored as (
      select c.*,
             case when c.name_text = $2 or c.search_text = $2 or c.producer_text = $2 then 3
                  when (select bool_and(c.search_text ~ ('(^| )' || x)) from unnest($3::text[]) x) then 2
                  else 1 end as cls,
             extensions.similarity($2, c.search_text) as sim
        from cand c
        left join public.catalog_providers pr on pr.id = c.provider_id
       where c.kind <> 'record'
          or (pr.search_scope = any ($6)
              -- a public provider's rights are checked again here, not only when its row was written
              and (pr.search_scope <> 'public'
                   or (pr.rights_status = 'verified' and pr.may_store and pr.may_display and pr.commercial_use))
              and not exists (select 1 from public.catalog_record_links l
                               where l.record_id = c.record_id and l.state = 'verified'))
    ),
    ranked as (
      select s.*, coalesce(o.n, 0) as owned_n,
             (s.cls + 0.5 * s.sim
              + case when coalesce(o.n, 0) > 0 then 0.6
                     when s.kind <> 'record' and not s.canonical then 0.4
                     when s.canonical then 0.3 else 0 end)::real as total
        from scored s left join owned o on o.wine_id = s.wine_id
    ),
    best as (
      select distinct on (coalesce(r.wine_id, r.record_id)) r.*
        from ranked r
       order by coalesce(r.wine_id, r.record_id), r.total desc, (r.kind = 'wine') desc
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
      from best b
      left join public.wines w on w.id = b.wine_id
      left join public.producers p on p.id = w.producer_id
      left join public.wine_aliases a on a.id = b.alias_id
      left join public.catalog_external_records er on er.id = b.record_id
      left join public.catalog_providers pr on pr.id = er.provider_id
     -- ties broken by name, not by a random id, so a run can be repeated exactly
     order by b.total desc, char_length(b.search_text), b.search_text, coalesce(b.wine_id, b.record_id)
     limit $4
  $q$, cand, filters, seen) using p_household_id, q, toks, lim, fuzzy, p_scopes, shown;
end $$;;

-- ---- 2. An approved link is only as good as the identity it was approved for --------------------------------------
create function private.catalog_record_identity_changed() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare l public.catalog_record_links;
begin
  if new.normalized_producer is not distinct from old.normalized_producer
     and new.normalized_name is not distinct from old.normalized_name
     and new.wine_type is not distinct from old.wine_type
     and new.country_code is not distinct from old.country_code then
    return new;   -- the same identity (spelling, region, vintages, details may change freely)
  end if;
  select * into l from public.catalog_record_links
   where record_id = new.id and state = 'verified' for update;
  if not found then return new; end if;
  update public.catalog_record_links
     set state = 'suggested', decided_at = null, decided_by = null,
         reason = left('changed by the source since it was approved (was: ' || old.producer || ' / ' || old.name
                       || '): decide again', 500)
   where record_id = new.id;
  perform private.master_log('link', new.id, l.wine_id, 'external_record_identity_changed', null,
                             to_jsonb(l) - 'record_id',
                             jsonb_build_object('wine_id', l.wine_id, 'state', 'suggested',
                                                'producer', left(new.producer, 120), 'name', left(new.name, 160)),
                             'the source changed this record''s producer, name, type or country after its link was approved');
  return new;
end $$;
revoke all on function private.catalog_record_identity_changed() from public, anon, authenticated;
-- after the row's own triggers (the normalised names are filled in before the update)
create trigger catalog_external_records_identity after update of producer, name, wine_type, country_code
  on public.catalog_external_records for each row execute function private.catalog_record_identity_changed();

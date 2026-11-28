begin;
-- People's search after the performance work (migration 20261203000055, docs/sprints/ratings/PERF-OPTIMISATION.md).
-- 1. The new implementation returns EXACTLY what the one of 20261119000042 returned: every column, every row, in the
--    same order, for a fixed set of queries, filters, limits and scopes over a catalogue with aliases, household wines,
--    bottles, public, pilot and switched-off sources and a verified link. The old implementation is kept below,
--    verbatim, as the reference (in the test schema only; it exists for the length of this test).
-- 2. The rules it must keep, pinned one by one: scopes, household isolation, the verified link, typo tolerance next to
--    a few regular results, filters, limits, the query cut, determinism, the result columns and the grants.

-- ---- the reference: private.catalog_search_impl as 20261119000042 defined it, renamed ----------------------------
create function test.catalog_search_impl_0042(p_household_id uuid, p_query text, p_type text, p_country text,
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
end $$;
revoke all on function test.catalog_search_impl_0042(uuid, text, text, text, text, int, text[]) from public;

-- every column of every row, in order, of one implementation
create function test.p55_rows(fn text, h uuid, q text, typ text, ctry text, reg text, lim int, scopes text[])
  returns jsonb language plpgsql security definer as $$
declare j jsonb;
begin
  execute format('select coalesce(jsonb_agg(to_jsonb(r) order by r.ord), ''[]'') from
                    (select s.*, row_number() over () as ord from %s($1, $2, $3, $4, $5, $6, $7) s) r', fn)
    into j using h, q, typ, ctry, reg, lim, scopes;
  return j;
end $$;
-- people's search as "producer | name | source | match | verified" lines, best first
create function test.p55(h uuid, q text, typ text default null, ctry text default null, reg text default null,
                         lim int default 10) returns text[] language sql as $$
  select coalesce(array_agg(s.producer || ' | ' || s.name || ' | ' || s.source || ' | ' || s.match || ' | '
                            || s.verified::text order by s.ord), '{}')
    from (select r.*, row_number() over () as ord from public.catalog_search(h, q, typ, ctry, reg, lim) r) s
$$;
grant execute on function test.p55(uuid, text, text, text, text, int) to public;
create function test.p55_record(ext text) returns uuid language sql security definer as $$
  select id from public.catalog_external_records where external_id = ext
$$;
grant execute on function test.p55_record(text) to public;

do $$
declare h1 uuid; h2 uuid; cp uuid; cp2 uuid; cp3 uuid; cp4 uuid; cp5 uuid; cw uuid; cw2 uuid; cw3 uuid; cv uuid;
        hp uuid; v uuid; run uuid; n int; bad int; nonempty int; first_bad text; arr text[]; arr2 text[];
        r record; rights jsonb :=
  '{"license":"CC0-1.0","attribution":"Fixture","may_store":true,"may_display":true,"commercial_use":true,"rights_status":"verified","rights_evidence":"written by CELLR for tests","rights_verified_at":"2026-11-13","rights_verified_by":"test suite"}';
begin
  perform test.mk_users(2);
  perform test.as_user(1); h1 := public.create_household('Perf 1');
  perform test.as_user(2); h2 := public.create_household('Perf 2');
  perform test.su();
  -- a pilot database (what pilot.sh does as the database owner), so a pilot source can exist next to a public one
  insert into private.catalog_settings (environment, set_by) values ('pilot', 'test suite')
    on conflict (id) do update set environment = excluded.environment;

  -- ---- the catalogue -----------------------------------------------------------------------------------------------
  insert into public.producers (name, country_code, status, origin) values ('Château Léoville Poyferré', 'FR', 'canonical', 'verified')
    returning id into cp;
  insert into public.producers (name, country_code, status, origin) values ('Château Léoville Barton', 'FR', 'canonical', 'verified')
    returning id into cp2;
  insert into public.producers (name, country_code, status, origin) values ('Bodega Ventisquero', 'CL', 'canonical', 'verified')
    returning id into cp3;
  insert into public.producers (name, country_code, status, origin) values ('Bodega Ventisquiero', 'CL', 'canonical', 'verified')
    returning id into cp4;
  insert into public.producers (name, country_code, status, origin) values ('Domaine Alpha', 'FR', 'canonical', 'verified')
    returning id into cp5;
  insert into public.wines (producer_id, name, wine_type, country_code, region, status, origin)
    values (cp, 'Château Léoville Poyferré', 'red', 'FR', 'Saint-Julien', 'canonical', 'verified') returning id into cw;
  insert into public.wines (producer_id, name, wine_type, country_code, region, status, origin)
    values (cp, 'Pavillon de Léoville Poyferré', 'red', 'FR', 'Saint-Julien', 'canonical', 'verified') returning id into cw2;
  insert into public.wines (producer_id, name, wine_type, country_code, region, status, origin)
    values (cp2, 'Château Léoville Barton', 'red', 'FR', 'Saint-Julien', 'canonical', 'verified') returning id into cw3;
  insert into public.wine_aliases (wine_id, alias) values (cw2, 'Pavillon Poyferré'), (cw2, 'Pavillon Poyferre Rouge');
  insert into public.wines (producer_id, name, wine_type, country_code, status, origin)
    values (cp3, 'Ventisquero Reserva', 'red', 'CL', 'canonical', 'verified'),
           (cp4, 'Ventisquiero Reserva', 'red', 'CL', 'canonical', 'verified');
  insert into public.wines (producer_id, name, wine_type, country_code, region, status, origin)
    select cp5, 'Cuvée ' || i, (array['red', 'white'])[1 + i % 2]::public.wine_type, 'FR', 'Côte de Beaune', 'canonical', 'verified'
      from generate_series(1, 25) i;

  -- ---- the households: own wines, bottles, and another household's 450 look-alikes ---------------------------------
  perform test.as_user(1);
  insert into public.producers (name, country_code, status, owner_household_id, origin)
    values ('Domaine Zéphyrine', 'FR', 'provisional', h1, 'user_entered') returning id into hp;
  insert into public.wines (producer_id, name, wine_type, country_code, status, owner_household_id, origin)
    values (hp, 'Cuvée Secrète', 'white', 'FR', 'provisional', h1, 'user_entered');
  perform test.su();
  insert into public.wine_vintages (wine_id, year) values (cw3, 2016) returning id into v;
  insert into public.bottles (household_id, vintage_id) values (h1, v), (h1, v);
  perform test.as_user(2);
  insert into public.producers (name, country_code, status, owner_household_id, origin)
    values ('Domaine Zéphyrine', 'FR', 'provisional', h2, 'user_entered') returning id into hp;
  insert into public.wines (producer_id, name, wine_type, country_code, status, owner_household_id, origin)
    values (hp, 'Cuvée Cachée', 'red', 'FR', 'provisional', h2, 'user_entered');
  insert into public.producers (name, country_code, status, owner_household_id, origin)
    values ('Chateau Floodgate Huis', 'FR', 'provisional', h2, 'user_entered') returning id into hp;
  insert into public.wines (producer_id, name, wine_type, country_code, status, owner_household_id, origin)
    select hp, 'Nr ' || i, 'red', 'FR', 'provisional', h2, 'user_entered' from generate_series(1, 450) i;

  -- ---- three sources: public, pilot (450 short look-alikes), off ---------------------------------------------------
  perform test.as_service();
  perform public.catalog_provider_register('{"id":"p55pub","name":"Public test source"}');
  perform public.admin_catalog_provider_rights('p55pub', rights || '{"search_scope":"public"}', 'our own test data', 'test suite');
  run := public.catalog_import_run_start('p55pub', 'pub-1', null, null, null, '2026-11-01');
  perform public.catalog_external_import('p55pub', run, $b$[
    {"external_id":"Q1","producer":"Château Léoville Poyferré","name":"Château Léoville Poyferré","wine_type":"red","country_code":"FR","region":"Saint-Julien","vintages":[2015,2016]},
    {"external_id":"Q2","producer":"Bodega Zúñiga Perf","name":"Reserva Especial","wine_type":"red","country_code":"ES","vintages":[2019,2018],"modifications":["type mapped to CELLR types"]},
    {"external_id":"Q3","producer":"Chateau Floodgate","name":"Publique","wine_type":"red","country_code":"FR"},
    {"external_id":"Q4","producer":"Tie Wine","name":"B","wine_type":"white","country_code":"IT"},
    {"external_id":"Q5","producer":"Tie Wine","name":"A","wine_type":"white","country_code":"IT"},
    {"external_id":"Q6","producer":"Tie Wine","name":"C","wine_type":"white","country_code":"IT"},
    {"external_id":"Q7","producer":"Domaine Alpha","name":"Cuvée 7","wine_type":"red","country_code":"FR","region":"Côte de Beaune","vintages":[2020]},
    {"external_id":"Q8","producer":"Bodega Ventisquero","name":"Gran Reserva","wine_type":"red","country_code":"CL","vintages":[2017]}
  ]$b$, true);
  perform public.catalog_import_run_finish(run, false, '{}');
  perform public.catalog_provider_register('{"id":"p55pilot","name":"Pilot test source"}');
  perform public.admin_catalog_provider_rights('p55pilot',
    '{"license":"CC0-1.0","attribution":"Fixture","may_store":true,"may_display":true,"search_scope":"pilot"}', 'evaluate', 'test suite');
  run := public.catalog_import_run_start('p55pilot', 'pilot-1', null, null, null, '2026-11-01', true);
  perform public.catalog_external_import('p55pilot', run,
    (select jsonb_agg(jsonb_build_object('external_id', 'P' || i, 'producer', 'Chateau Floodgate ' || i, 'name', 'Vin',
                                         'wine_type', 'red', 'country_code', 'FR', 'vintages', jsonb_build_array(2000 + i % 20)))
       from generate_series(1, 450) i), true);
  perform public.catalog_import_run_finish(run, false, '{}');
  perform public.catalog_provider_register('{"id":"p55off","name":"Hidden test source"}');
  perform public.admin_catalog_provider_rights('p55off', rights, 'our own test data', 'test suite');
  run := public.catalog_import_run_start('p55off', 'off-1', null, null, null, '2026-11-01');
  perform public.catalog_external_import('p55off', run, $b$[
    {"external_id":"O1","producer":"Ventisquero Oculto","name":"Reserva","wine_type":"red","country_code":"CL"}
  ]$b$, true);
  perform public.catalog_import_run_finish(run, false, '{}');
  -- the import suggested Q1 as the catalogue's grand vin; an admin verifies it: from now on the wine stands for it
  perform test.rec('setup: the exact identity is verified by an admin',
    public.admin_catalog_record_decide(test.p55_record('Q1'), cw, 'verified', 'same wine', test.uid(1)) = 'ok');
  perform test.su();

  -- ---- 1. the same answers as 20261119000042, column for column ---------------------------------------------------
  select count(*), count(*) filter (where not same), count(*) filter (where found_any),
         min(label) filter (where not same)
    into n, bad, nonempty, first_bad
    from (select format('%s / %s / %s / %s / %s / %s', x.q, f.typ, f.ctry, f.reg, f.lim, f.scopes) as label,
                 test.p55_rows('test.catalog_search_impl_0042', h1, x.q, f.typ, f.ctry, f.reg, f.lim, f.scopes)
                   = test.p55_rows('private.catalog_search_impl', h1, x.q, f.typ, f.ctry, f.reg, f.lim, f.scopes) as same,
                 test.p55_rows('private.catalog_search_impl', h1, x.q, f.typ, f.ctry, f.reg, f.lim, f.scopes) <> '[]' as found_any
            from unnest(array[
              'leoville', 'leoville poyferre', 'chateau leoville poyferre', 'CHATEAU leoville POYFERRÉ', 'leovile poyfere',
              'pavillon poyferre', 'pavillon', 'pavillon poyferre rouge', 'poyf leov', 'ch', 'le', 'po', 'a b', 'chat',
              'ventisquero', 'ventisquero reserva', 'ventisquiero reserva', 'ventisqero', 'ventisquero gran reserva',
              'zephyrine', 'cuvee secrete', 'cuvee cachee', 'chateau', 'chateau floodgate', 'chateau floodgate 17',
              'floodgate', 'floodgte', 'floodgate huis', 'domaine alpha', 'domaine alpha cuvee', 'domaine alpha cuvee 1',
              'alpha cuvee 2', 'domaine alfa cuvee', 'cuvee', 'cuvee 7', 'zuniga', 'bodega zuniga perf', 'bodega zuniga prf',
              'reserva', 'reserva especial', 'tie wine', 'tie', 'oculto', 'ventisquero oculto', 'barton', 'leoville barton',
              'qqqzzzxx', '', 'x', ' -- ', 'domaine alpha cuvee 1 a b c d zzzz', repeat('leoville ', 20),
              'domaine alpha ' || repeat('x', 100)]) x (q)
           cross join (
             select null::text typ, null::text ctry, null::text reg, l.lim, s.scopes
               from unnest(array[1, 3, 10, 20, null, 0, 1000]) l (lim),
                    (values (array['public']), (array['pilot', 'public'])) s (scopes)
             union all
             select v.typ, v.ctry, v.reg, 10, array['public']
               from (values ('red', null, null), (null, 'FR', null), ('white', 'FR', 'cote de beaune'), (null, null, 'saint julien'),
                            ('red', 'CL', null), ('beer', null, null), (null, 'fra', null)) v (typ, ctry, reg)) f) c;
  perform test.rec(format('the same answers as 20261119000042: %s of %s searches identical (first difference: %s)',
                          n - bad, n, coalesce(first_bad, 'none')), bad = 0 and n = 53 * 21);
  perform test.rec(format('... and most of them found something (%s of %s)', nonempty, n), nonempty > n / 2);

  -- ---- 2. the rules, one by one (as a signed-in person, through public.catalog_search) -----------------------------
  perform test.as_user(1);
  arr := test.p55(h1, 'ventisquero reserva');
  perform test.rec('typo tolerance next to a few regular results: the regular one first, the near-miss offered as fuzzy',
    arr = array['Bodega Ventisquero | Ventisquero Reserva | catalog | exact | true',
                'Bodega Ventisquero | Gran Reserva | provider | prefix | false',
                'Bodega Ventisquiero | Ventisquiero Reserva | catalog | fuzzy | true']);
  perform test.rec('typo tolerance only when the page is not full: with a page of 1 the regular result alone',
    test.p55(h1, 'ventisquero reserva', null, null, null, 1) = array['Bodega Ventisquero | Ventisquero Reserva | catalog | exact | true']);
  perform test.rec('a typo alone is found as fuzzy, never verified as a provider record',
    test.p55(h1, 'bodega zuniga prf')
      = array['Bodega Zúñiga Perf | Reserva Especial | provider | fuzzy | false']);
  perform test.rec('fewer than 4 letters: no typo tolerance', cardinality(test.p55(h1, 'ven')) >= 1
    and not exists (select 1 from unnest(test.p55(h1, 'ven')) x where x like '% | fuzzy | %'));

  arr := test.p55(h1, 'chateau floodgate', null, null, null, 20);
  perform test.rec('scopes: 450 shorter pilot records do not push the public record out of people''s search',
    arr = array['Chateau Floodgate | Publique | provider | exact | false']);
  perform test.rec('scopes: and none of them is returned to people', not exists (select 1 from unnest(arr) x where x like '%| Vin |%'));
  perform test.rec('households: 450 look-alikes of another household are never returned, nor push anything out',
    not exists (select 1 from unnest(arr || test.p55(h1, 'floodgate huis', null, null, null, 20)) x where x like '%Huis%'));
  perform test.rec('households: never another household''s wine', cardinality(test.p55(h1, 'cuvee cachee')) = 0
    and test.p55(h1, 'zephyrine') = array['Domaine Zéphyrine | Cuvée Secrète | household | prefix | false']);
  perform test.rec('scopes: a source switched off is never returned', cardinality(test.p55(h1, 'oculto')) = 0
    and not exists (select 1 from unnest(test.p55(h1, 'ventisquero')) x where x like '%Oculto%'));
  perform test.rec('households: asking with another household''s id finds nothing', cardinality(test.p55(h2, 'leoville')) = 0);
  perform test.as_service();
  perform test.rec('pilot search: the pilot records are found there (service role, pilot database)',
    exists (select 1 from public.catalog_search_pilot(h1, 'chateau floodgate 17', null, null, null, 20) s
             where s.provider_id = 'p55pilot' and s.provider_scope = 'pilot' and s.name = 'Vin'));
  perform test.rec('pilot search: never a source that is off',
    not exists (select 1 from public.catalog_search_pilot(h1, 'ventisquero oculto', null, null, null, 20) s where s.provider_id = 'p55off'));
  perform test.as_user(1);

  arr := test.p55(h1, 'leoville poyferre', null, null, null, 20);
  perform test.rec('verified link: the record is hidden behind its catalogue wine, which is verified',
    arr[1] = 'Château Léoville Poyferré | Château Léoville Poyferré | catalog | prefix | true'
    and not exists (select 1 from unnest(arr) x where x like '% | provider | %'));
  perform test.rec('identity: only canonical wines are verified, provider records and fuzzy matches never',
    not exists (select 1 from public.catalog_search(h1, 'domaine alpha cuvee 7', null, null, null, 20) s
                 where s.verified and (s.result_kind = 'record' or s.source not in ('catalog', 'owned')))
    and exists (select 1 from public.catalog_search(h1, 'domaine alpha cuvee 7', null, null, null, 20) s
                 where s.result_kind = 'record' and not s.verified and s.vintages = '{2020}'::smallint[]));
  select * into r from public.catalog_search(h1, 'reserva especial') s where s.result_kind = 'record';
  perform test.rec('records: vintages, attribution, licence, scope and "modified" travel with the result',
    r.vintages = '{2018,2019}'::smallint[] and r.modified and r.provider_id = 'p55pub' and r.attribution = 'Fixture'
    and r.license = 'CC0-1.0' and r.provider_scope = 'public' and r.source = 'provider' and not r.verified);
  perform test.rec('owned: the household''s bottles rank first among equals and are counted',
    test.p55(h1, 'leoville')::text like '{"Château Léoville Barton | Château Léoville Barton | owned | prefix | true",%'
    and (select s.bottles from public.catalog_search(h1, 'leoville barton') s limit 1) = 2);
  perform test.rec('alias: found by its verified alias, the alias named',
    exists (select 1 from public.catalog_search(h1, 'pavillon poyferre rouge') s
             where s.wine_id = cw2 and s.match = 'alias' and s.matched_alias = 'Pavillon Poyferre Rouge'));

  perform test.rec('filters: type, country and region', (select bool_and(s.wine_type = 'white' and s.country_code = 'FR'
                     and s.region = 'Côte de Beaune') from public.catalog_search(h1, 'domaine alpha', 'white', 'FR', 'cote de beaune', 20) s)
    and cardinality(test.p55(h1, 'domaine alpha', 'white', 'FR', 'cote de beaune', 20)) = 13);
  perform test.rec('filters: an invalid type or country finds nothing, never an error',
    cardinality(test.p55(h1, 'leoville', 'beer')) = 0 and cardinality(test.p55(h1, 'leoville', null, 'fra')) = 0);
  perform test.rec('limits: at most 20, at least 1, 10 by default',
    cardinality(test.p55(h1, 'domaine alpha', null, null, null, 1000)) = 20
    and cardinality(test.p55(h1, 'domaine alpha', null, null, null, 0)) = 1
    and cardinality(test.p55(h1, 'domaine alpha', null, null, null, null)) = 10
    and (select count(*) from public.catalog_search(h1, 'domaine alpha')) = 10);
  perform test.rec('the query is cut at 8 words',
    test.p55(h1, 'domaine alpha cuvee 1 a b c d zzzz') = test.p55(h1, 'domaine alpha cuvee 1 a b c d'));
  perform test.rec('the query is cut at 80 characters',
    test.p55(h1, 'domaine alpha ' || repeat('x', 100)) = test.p55(h1, 'domaine alpha ' || repeat('x', 66))
    and cardinality(test.p55(h1, 'domaine alpha ' || repeat('x', 100))) = 10);
  perform test.rec('ties are broken by name: equal scores come in name order',
    test.p55(h1, 'tie wine') = array['Tie Wine | A | provider | exact | false', 'Tie Wine | B | provider | exact | false',
                                     'Tie Wine | C | provider | exact | false']);
  arr := test.p55(h1, 'domaine alpha cuvee', null, null, null, 20);
  arr2 := test.p55(h1, 'domaine alpha cuvee', null, null, null, 20);
  perform test.rec('deterministic: the same search twice gives the same answer in the same order', arr = arr2 and cardinality(arr) = 20);

  -- ---- 3. the contract: who may call it, what it returns, how it runs ---------------------------------------------
  perform test.as_anon();
  perform test.rec('anonymous callers may not search', test.denied(format('select * from public.catalog_search(%L, %L)', h1, 'leoville')));
  perform test.su();
  perform test.rec('grants: people and the service role may search, anonymous callers may not',
    has_function_privilege('authenticated', 'public.catalog_search(uuid, text, text, text, text, int)', 'execute')
    and has_function_privilege('service_role', 'public.catalog_search(uuid, text, text, text, text, int)', 'execute')
    and not has_function_privilege('anon', 'public.catalog_search(uuid, text, text, text, text, int)', 'execute'));
  perform test.rec('grants: no API role may call the implementation',
    not has_function_privilege('anon', 'private.catalog_search_impl(uuid, text, text, text, text, int, text[])', 'execute')
    and not has_function_privilege('authenticated', 'private.catalog_search_impl(uuid, text, text, text, text, int, text[])', 'execute')
    and not has_function_privilege('service_role', 'private.catalog_search_impl(uuid, text, text, text, text, int, text[])', 'execute'));
  perform test.rec('result: the same columns and types for people, the pilot search and the implementation',
    pg_get_function_result('public.catalog_search(uuid, text, text, text, text, int)'::regprocedure)
      = 'TABLE(result_kind text, wine_id uuid, record_id uuid, producer text, name text, matched_alias text, wine_type text, '
        || 'country_code text, region text, source text, verified boolean, match text, score real, bottles integer, '
        || 'provider_id text, provider_name text, attribution text, license text, license_url text, provider_scope text, '
        || 'modified boolean, vintages smallint[])'
    and pg_get_function_result('private.catalog_search_impl(uuid, text, text, text, text, int, text[])'::regprocedure)
      = pg_get_function_result('public.catalog_search(uuid, text, text, text, text, int)'::regprocedure)
    and pg_get_function_result('public.catalog_search_pilot(uuid, text, text, text, text, int)'::regprocedure)
      = pg_get_function_result('public.catalog_search(uuid, text, text, text, text, int)'::regprocedure));
  select p.prosecdef and p.provolatile = 's' and p.proconfig @> array['search_path=""', 'pg_trgm.word_similarity_threshold=0.6',
                                                                       'plan_cache_mode=force_generic_plan'] as ok
    into r from pg_proc p where p.oid = 'private.catalog_search_impl(uuid, text, text, text, text, int, text[])'::regprocedure;
  perform test.rec('the implementation: security definer, stable, empty search_path, threshold 0.6, cached plans', r.ok);
  perform test.rec('the trigram index keeps a bounded pending list (512 kB)',
    (select c.reloptions from pg_class c where c.oid = 'private.catalog_search_entries_trgm'::regclass)
      @> array['gin_pending_list_limit=512']);
end $$;
rollback;

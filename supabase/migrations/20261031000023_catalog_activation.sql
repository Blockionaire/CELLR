-- Canonical catalogue activation (Sprint I).
--
-- The canonical catalogue (producers / wines / wine_vintages / wine_aliases / wine_sources with status 'canonical'
-- and no owner) already exists and is read-only for people. This adds what it takes to actually use it:
--   1. catalog_import(): the owner fills and maintains it from a reviewed JSON list, in the Supabase SQL editor
--      (or with the service role). Dry run by default; idempotent; never overwrites an identity; every wine needs
--      at least one https source; conflicts and ambiguous entries are reported, not written.
--   2. catalog_vintage(): a signed-in person who confirmed a catalogue wine can add a bottle of a year the catalogue
--      does not list yet. It only ever adds a (wine, year) row to a canonical wine; nothing else becomes writable.
--   3. admin_catalog(): counts for /admin (service role only).
-- Nothing reads or copies household data into the catalogue: private wines are never promoted or relinked.
-- Additive only: until this runs the app behaves as before (a catalogue wine without that year cannot be added).

-- ---- 1. The import ------------------------------------------------------------------------------------------
-- One entry:
--   { "producer": "Château Margaux", "producer_country": "FR",
--     "name": "Pavillon Rouge du Château Margaux", "type": "red",
--     "country": "FR", "region": "Bordeaux", "appellation": "Margaux", "classification": null,
--     "vintages": [2018, 2019, null],              -- null = the non-vintage
--     "aliases": ["Pavillon Rouge"],                -- other names of THIS wine only
--     "sources": [{ "name": "Producer website", "url": "https://…", "license": "facts", "ref": null }] }
-- Returns { applied, summary: {created, updated, unchanged, conflict, invalid}, results: [{index, producer, wine,
-- status, messages}] }. With p_apply = false (the default) nothing is kept.
create function public.catalog_import(p_entries jsonb, p_apply boolean default false)
  returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  results    jsonb := '[]'::jsonb;
  seen       text[] := '{}';
  e          jsonb;
  i          int := 0;
  msgs       text[];
  st         text;
  prod_name  text; prod_country text; w_name text; w_type text; w_country text;
  w_region   text; w_app text; w_class text;
  key        text;
  v_prod     uuid; v_wine uuid; v_other uuid;
  existing   record;
  v          jsonb; a jsonb; s jsonb;
  max_year   int := extract(year from now())::int + 1;
  changed    boolean;
  n          int;
begin
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    raise exception 'entries must be a JSON array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_entries) > 500 then
    raise exception 'at most 500 entries per import' using errcode = '22023';
  end if;

  begin  -- everything below is undone at the end of a dry run
    for e in select value from jsonb_array_elements(p_entries) loop
      i := i + 1;
      msgs := '{}';
      st := null;
      prod_name    := btrim(e->>'producer');
      prod_country := upper(btrim(e->>'producer_country'));
      w_name       := btrim(e->>'name');
      w_type       := btrim(e->>'type');
      w_country    := upper(btrim(coalesce(e->>'country', e->>'producer_country')));
      w_region     := nullif(btrim(e->>'region'), '');
      w_app        := nullif(btrim(e->>'appellation'), '');
      w_class      := nullif(btrim(e->>'classification'), '');

      -- ---- validation: nothing is written for an invalid entry ----
      if jsonb_typeof(e) <> 'object' then msgs := array_append(msgs, ('not an object')::text); end if;
      -- the template's placeholders must all be filled in: an entry still saying TODO is never imported
      if e::text like '%"TODO:%' then msgs := array_append(msgs, ('fill in every TODO placeholder')::text); end if;
      if coalesce(char_length(prod_name), 0) not between 1 and 120 then msgs := array_append(msgs, ('producer: 1–120 characters')::text); end if;
      if prod_country is null or prod_country !~ '^[A-Z]{2}$' then msgs := array_append(msgs, ('producer_country: a 2-letter country code')::text); end if;
      if coalesce(char_length(w_name), 0) not between 1 and 160 then msgs := array_append(msgs, ('name: 1–160 characters')::text); end if;
      if w_type is null or w_type not in ('red', 'white', 'rose', 'sparkling', 'orange', 'dessert', 'fortified') then
        msgs := array_append(msgs, ('type: red, white, rose, sparkling, orange, dessert or fortified')::text); end if;
      if w_country is null or w_country !~ '^[A-Z]{2}$' then msgs := array_append(msgs, ('country: a 2-letter country code')::text); end if;
      if char_length(w_region) > 120 or char_length(w_app) > 160 or char_length(w_class) > 120 then
        msgs := array_append(msgs, ('region/appellation/classification too long')::text); end if;
      if jsonb_typeof(coalesce(e->'vintages', '[]')) <> 'array' then
        msgs := array_append(msgs, ('vintages: a list of years (null for non-vintage)')::text);
      else
        for v in select value from jsonb_array_elements(coalesce(e->'vintages', '[]')) loop
          if jsonb_typeof(v) <> 'null' and (jsonb_typeof(v) <> 'number' or (v::text)::numeric <> trunc((v::text)::numeric)
              or (v::text)::int not between 1800 and max_year) then
            msgs := array_append(msgs, (format('vintages: %s is not a year between 1800 and %s', v, max_year))::text);
          end if;
        end loop;
      end if;
      if jsonb_typeof(coalesce(e->'aliases', '[]')) <> 'array' then
        msgs := array_append(msgs, ('aliases: a list of names')::text);
      else
        for a in select value from jsonb_array_elements(coalesce(e->'aliases', '[]')) loop
          if jsonb_typeof(a) <> 'string' or char_length(btrim(a #>> '{}')) not between 1 and 160 then
            msgs := array_append(msgs, ('aliases: each 1–160 characters')::text); end if;
        end loop;
      end if;
      -- provenance: at least one trustworthy, public source per wine
      if jsonb_typeof(e->'sources') <> 'array' or jsonb_array_length(e->'sources') = 0 then
        msgs := array_append(msgs, ('sources: at least one source with a name and an https url')::text);
      else
        for s in select value from jsonb_array_elements(e->'sources') loop
          if coalesce(char_length(btrim(s->>'name')), 0) not between 1 and 120
             or coalesce(s->>'url', '') !~ '^https://[^[:space:]]{4,}$' or char_length(s->>'url') > 500
             or char_length(s->>'license') > 80 or char_length(s->>'ref') > 200 then
            msgs := array_append(msgs, 'sources: each needs a name (≤120) and an https url, license ≤80, ref ≤200'::text);
          end if;
        end loop;
      end if;
      if cardinality(msgs) > 0 then
        results := results || jsonb_build_object('index', i, 'producer', prod_name, 'wine', w_name,
                                                 'status', 'invalid', 'messages', to_jsonb(msgs));
        continue;
      end if;

      key := private.normalize_text(prod_name) || '|' || prod_country || '|' || private.normalize_text(w_name) || '|' || w_type;
      if key = any (seen) then
        results := results || jsonb_build_object('index', i, 'producer', prod_name, 'wine', w_name,
                                                 'status', 'conflict', 'messages', jsonb_build_array('the same wine appears twice in this file'));
        continue;
      end if;
      seen := seen || key;

      -- ---- one entry, all or nothing ----
      begin
        changed := false;
        -- The producer: the canonical one with this name and country. The same name in another country is a
        -- different producer to the catalogue, so it is not guessed at: that is for a person to decide.
        select p.id into v_prod from public.producers p
         where p.status = 'canonical' and p.normalized_name = private.normalize_text(prod_name)
           and p.country_code = prod_country;
        if v_prod is null then
          if exists (select 1 from public.producers p where p.status = 'canonical'
                      and p.normalized_name = private.normalize_text(prod_name)) then
            raise exception using errcode = 'P0C01',
              message = 'a canonical producer with this name exists in another country: check which one is meant';
          end if;
          insert into public.producers (name, country_code, status, owner_household_id, origin)
          values (prod_name, prod_country, 'canonical', null, 'verified') returning id into v_prod;
          changed := true;
        end if;

        -- The wine: never changed when it is there (only empty details are filled in); a different value is a conflict.
        select * into existing from public.wines w
         where w.status = 'canonical' and w.producer_id = v_prod
           and w.normalized_name = private.normalize_text(w_name) and w.wine_type = w_type::public.wine_type;
        if existing.id is null then
          -- its name must not already be another wine's alias at this producer
          select w.id into v_other from public.wine_aliases al join public.wines w on w.id = al.wine_id
           where w.status = 'canonical' and w.producer_id = v_prod and al.normalized_alias = private.normalize_text(w_name)
           limit 1;
          if v_other is not null then
            raise exception using errcode = 'P0C01',
              message = 'this name is already an alias of another catalogue wine of this producer';
          end if;
          insert into public.wines (producer_id, name, wine_type, country_code, region, appellation, classification,
                                    status, owner_household_id, origin)
          values (v_prod, w_name, w_type::public.wine_type, w_country, w_region, w_app, w_class, 'canonical', null, 'verified')
          returning id into v_wine;
          st := 'created';
        else
          v_wine := existing.id;
          if existing.country_code is distinct from w_country and existing.country_code is not null then
            msgs := array_append(msgs, (format('country differs (catalogue: %s)', existing.country_code))::text); end if;
          if w_region is not null and existing.region is not null and existing.region <> w_region then
            msgs := array_append(msgs, (format('region differs (catalogue: %s)', existing.region))::text); end if;
          if w_app is not null and existing.appellation is not null and existing.appellation <> w_app then
            msgs := array_append(msgs, (format('appellation differs (catalogue: %s)', existing.appellation))::text); end if;
          if w_class is not null and existing.classification is not null and existing.classification <> w_class then
            msgs := array_append(msgs, (format('classification differs (catalogue: %s)', existing.classification))::text); end if;
          if cardinality(msgs) > 0 then
            raise exception using errcode = 'P0C01', message = array_to_string(msgs, '; ');
          end if;
          update public.wines
             set country_code = coalesce(country_code, w_country), region = coalesce(region, w_region),
                 appellation = coalesce(appellation, w_app), classification = coalesce(classification, w_class)
           where id = v_wine
             and (country_code is null or (region is null and w_region is not null)
                  or (appellation is null and w_app is not null) or (classification is null and w_class is not null));
          get diagnostics n = row_count;
          changed := changed or n > 0;
        end if;

        -- Aliases: only names of THIS wine; one that names another wine of the producer is refused and reported.
        for a in select value from jsonb_array_elements(coalesce(e->'aliases', '[]')) loop
          select w.id into v_other from public.wines w
           where w.status = 'canonical' and w.producer_id = v_prod and w.id <> v_wine
             and (w.normalized_name = private.normalize_text(a #>> '{}')
                  or exists (select 1 from public.wine_aliases al where al.wine_id = w.id
                              and al.normalized_alias = private.normalize_text(a #>> '{}')))
           limit 1;
          if v_other is not null then
            msgs := array_append(msgs, (format('alias "%s" names another wine of this producer: not added', a #>> '{}'))::text);
            continue;
          end if;
          insert into public.wine_aliases (wine_id, alias) values (v_wine, btrim(a #>> '{}'))
            on conflict (wine_id, normalized_alias) do nothing;
          get diagnostics n = row_count;
          changed := changed or n > 0;
        end loop;

        for v in select value from jsonb_array_elements(coalesce(e->'vintages', '[]')) loop
          insert into public.wine_vintages (wine_id, year)
          values (v_wine, case when jsonb_typeof(v) = 'null' then null else (v::text)::smallint end)
            on conflict on constraint wine_vintages_unique do nothing;
          get diagnostics n = row_count;
          changed := changed or n > 0;
        end loop;

        for s in select value from jsonb_array_elements(e->'sources') loop
          if not exists (select 1 from public.wine_sources ws where ws.wine_id = v_wine and ws.url = s->>'url') then
            insert into public.wine_sources (wine_id, source_name, source_ref, license, url)
            values (v_wine, btrim(s->>'name'), nullif(btrim(s->>'ref'), ''), nullif(btrim(s->>'license'), ''), s->>'url');
            changed := true;
          end if;
        end loop;

        results := results || jsonb_build_object('index', i, 'producer', prod_name, 'wine', w_name,
                     'status', coalesce(st, case when changed then 'updated' else 'unchanged' end),
                     'messages', to_jsonb(msgs));
      exception when sqlstate 'P0C01' then
        -- this entry is undone as a whole; the rest of the import goes on
        results := results || jsonb_build_object('index', i, 'producer', prod_name, 'wine', w_name,
                                                 'status', 'conflict', 'messages', jsonb_build_array(sqlerrm));
      end;
    end loop;

    if not p_apply then
      raise exception using errcode = 'P0C02', message = 'dry run';
    end if;
  exception when sqlstate 'P0C02' then
    null;  -- dry run: every change above is undone, the report stays
  end;

  return jsonb_build_object(
    'applied', p_apply,
    'summary', (select jsonb_build_object(
                  'created',   count(*) filter (where r->>'status' = 'created'),
                  'updated',   count(*) filter (where r->>'status' = 'updated'),
                  'unchanged', count(*) filter (where r->>'status' = 'unchanged'),
                  'conflict',  count(*) filter (where r->>'status' = 'conflict'),
                  'invalid',   count(*) filter (where r->>'status' = 'invalid'))
                from jsonb_array_elements(results) r),
    'results', results);
end $$;
revoke all on function public.catalog_import(jsonb, boolean) from public, anon, authenticated;
grant execute on function public.catalog_import(jsonb, boolean) to service_role;

-- ---- 2. A year of a catalogue wine that the catalogue does not list yet --------------------------------------
-- Called by the server when a signed-in person adds bottles of a canonical wine they chose. It writes nothing but the
-- (wine, year) row, only for a canonical wine, only for a real year (or the non-vintage), and is safe to run twice
-- at once (the unique constraint decides). People keep no write access to the catalogue itself.
create function public.catalog_vintage(p_wine_id uuid, p_year int)
  returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  found_id uuid;
begin
  if auth.uid() is null and current_user <> 'service_role' then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  if not exists (select 1 from public.wines w where w.id = p_wine_id and w.status = 'canonical' and w.owner_household_id is null) then
    raise exception 'not a catalogue wine' using errcode = '42501';
  end if;
  if p_year is not null and (p_year < 1800 or p_year > extract(year from now())::int + 1) then
    raise exception 'not a vintage year' using errcode = '22023';
  end if;
  insert into public.wine_vintages (wine_id, year) values (p_wine_id, p_year)
    on conflict on constraint wine_vintages_unique do nothing
    returning id into found_id;
  if found_id is null then
    select v.id into found_id from public.wine_vintages v
     where v.wine_id = p_wine_id and v.year is not distinct from p_year::smallint;
  end if;
  return found_id;
end $$;
revoke all on function public.catalog_vintage(uuid, int) from public, anon;
grant execute on function public.catalog_vintage(uuid, int) to authenticated, service_role;

-- ---- 3. Admin: how big is the catalogue, and is it used? (service role only, counts only) -----------------------
create function public.admin_catalog(p_from timestamptz, p_to timestamptz)
  returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  result jsonb;
begin
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '100 days' then
    raise exception 'invalid_arguments' using errcode = '22023';
  end if;
  select jsonb_build_object(
    'producers', (select count(*) from public.producers where status = 'canonical'),
    'wines',     (select count(*) from public.wines where status = 'canonical'),
    'vintages',  (select count(*) from public.wine_vintages v join public.wines w on w.id = v.wine_id
                   where w.status = 'canonical'),
    'aliases',   (select count(*) from public.wine_aliases al join public.wines w on w.id = al.wine_id
                   where w.status = 'canonical'),
    -- bottles added in the window: of catalogue wines vs. the household's own wines
    'bottles_catalog', (select count(*) from public.bottles b join public.wine_vintages v on v.id = b.vintage_id
                          join public.wines w on w.id = v.wine_id
                         where w.status = 'canonical' and b.created_at >= p_from and b.created_at < p_to),
    'bottles_private', (select count(*) from public.bottles b join public.wine_vintages v on v.id = b.vintage_id
                          join public.wines w on w.id = v.wine_id
                         where w.status = 'provisional' and b.created_at >= p_from and b.created_at < p_to),
    'private_wines_created', (select count(*) from public.wines
                               where status = 'provisional' and created_at >= p_from and created_at < p_to)
  ) into result;
  return result;
end $$;
revoke all on function public.admin_catalog(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.admin_catalog(timestamptz, timestamptz) to service_role;

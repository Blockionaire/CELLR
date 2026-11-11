-- Global wine catalogue foundation (Sprint 004A): external provider records next to the Wine Master, and one
-- server-side search over both, for autocomplete. Design and evidence: docs/sprints/sprint-004a/REPORT.md.
--
-- What this adds, and what it deliberately does NOT do:
-- 1. catalog_providers: one row per external data source, with its licence, what that licence allows (store,
--    display, commercial use), the RIGHTS STATUS (unverified / verified / blocked, with the evidence) and where its
--    records may appear (search_scope: off / pilot / public). Nothing is seeded: the owner registers a provider
--    explicitly (catalog_provider_upsert), so production is unchanged until someone decides to.
--    The database enforces: no import while rights are 'blocked'; no import outside a pilot run, and no public
--    search, until rights are 'verified' with evidence. Unresolved legal questions are blockers, not assumptions.
-- 2. catalog_import_runs + catalog_external_records: a STAGING catalogue of provider records, keyed by
--    (provider, external id), with provenance per record: provider, source identifier, source URL, licence and
--    rights status at import, retrieval date, file hash, and what CELLR modified. These are not CELLR wines:
--    public.wines is never written by an import. A provider record is never promoted to canonical.
-- 3. catalog_record_links: a provider record's relation to a canonical CELLR wine. An import may only SUGGEST a
--    link (one exact identity, never a similar name); only an admin can verify or reject it (audited). A verified
--    record is shown as its canonical wine in search, so the same wine never appears twice.
-- 4. private.catalog_search_entries: a search index (one row per wine name, verified alias and provider record),
--    kept in sync by triggers, with trigram and prefix indexes. Not exposed to the Data API.
-- 5. public.catalog_search(): bounded, ranked, accent/case-insensitive prefix + fuzzy search for one household: its
--    own wines, the catalogue, and records of providers whose search_scope is 'pilot' or 'public' (each result says
--    which, with its licence, attribution and whether CELLR modified it). Another household's wines are never
--    searched. A fuzzy or provider result is never reported as verified. It reads only; it writes nothing.
--
-- Additive only. Shared wine profiles, scan matching, label-text recognition and Purchase Check are untouched.
-- Until this runs, the app's search endpoint answers "unavailable" and every existing flow works as before.

-- ---- 1. Providers -----------------------------------------------------------------------------------------------
create table public.catalog_providers (
  id             text primary key check (id ~ '^[a-z][a-z0-9_]{1,30}$'),
  name           text not null check (char_length(btrim(name)) between 1 and 120),
  -- the licence the records are used under, e.g. 'CC0-1.0', 'CC-BY-4.0', 'commercial-agreement'
  license        text not null check (char_length(btrim(license)) between 1 and 80),
  license_url    text check (license_url ~ '^https://'),
  -- the credit that must be shown wherever its records are shown (null = none required)
  attribution    text check (char_length(attribution) <= 500),
  homepage       text check (homepage ~ '^https://'),
  -- the full legal notice (licence text reference, disclaimers), shown behind "more" wherever records are shown
  legal_notice   text check (char_length(legal_notice) <= 4000),
  -- how CELLR changes records, for licences that require changes to be indicated (e.g. CC BY 4.0, section 3(a)(1)(B))
  modification_notice text check (char_length(modification_notice) <= 500),
  may_store      boolean not null default false,
  may_display    boolean not null default false,
  commercial_use boolean not null default false,
  -- whether the licence terms for CELLR's intended (commercial, EU) use have been established, and how:
  -- unverified = not yet (pilot use only); verified = confirmed, with evidence; blocked = must not be imported
  rights_status  text not null default 'unverified' check (rights_status in ('unverified', 'verified', 'blocked')),
  rights_evidence text check (char_length(rights_evidence) <= 2000),
  rights_verified_at timestamptz,
  rights_verified_by text check (char_length(rights_verified_by) <= 120),
  -- where its records appear: off; pilot = local or staging evaluation only (shown as such, never as licensed data);
  -- public = to people in production
  search_scope   text not null default 'off' check (search_scope in ('off', 'pilot', 'public')),
  notes          text check (char_length(notes) <= 2000),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint catalog_providers_display_needs_store check (not may_display or may_store),
  constraint catalog_providers_verified_has_evidence
    check (rights_status <> 'verified' or (rights_evidence is not null and rights_verified_at is not null
                                           and rights_verified_by is not null)),
  -- shown at all only when storing and showing are allowed; to the public only with verified commercial rights
  constraint catalog_providers_search_needs_rights
    check (search_scope = 'off' or (may_store and may_display and rights_status <> 'blocked')),
  constraint catalog_providers_public_needs_verified
    check (search_scope <> 'public' or (rights_status = 'verified' and commercial_use))
);
create trigger catalog_providers_updated before update on public.catalog_providers
  for each row execute function private.set_updated_at();

-- ---- 2. Import runs and staged provider records -------------------------------------------------------------------
create table public.catalog_import_runs (
  id              uuid primary key default gen_random_uuid(),
  provider_id     text not null references public.catalog_providers on delete restrict,
  dataset_version text not null check (char_length(btrim(dataset_version)) between 1 and 80),
  source_url      text check (source_url ~ '^https://'),
  source_sha256   text check (source_sha256 ~ '^[0-9a-f]{64}$'),
  note            text check (char_length(note) <= 500),
  -- when the file was obtained from the provider (as stated by the importer); provenance for every record of the run
  retrieved_at    timestamptz not null,
  -- a local or staging evaluation run: allowed before rights are verified, never a production import
  pilot           boolean not null default false,
  -- the licence and rights status this run was imported under, kept even if the provider's row changes later
  license         text not null,
  rights_status   text not null check (rights_status in ('unverified', 'verified')),
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  counts          jsonb not null default '{}' check (jsonb_typeof(counts) = 'object')
);
create index catalog_import_runs_provider_idx on public.catalog_import_runs (provider_id, started_at desc);

create table public.catalog_external_records (
  id                  uuid primary key default gen_random_uuid(),
  provider_id         text not null references public.catalog_providers on delete restrict,
  external_id         text not null check (external_id ~ '^[A-Za-z0-9._:-]{1,64}$'),
  producer            text not null check (char_length(btrim(producer)) between 1 and 120),
  name                text not null check (char_length(btrim(name)) between 1 and 160),
  normalized_producer text not null,
  normalized_name     text not null,
  -- null when the provider's type cannot be mapped to CELLR's types (never guessed)
  wine_type           public.wine_type,
  country_code        text check (country_code ~ '^[A-Z]{2}$'),
  region              text check (char_length(region) <= 120),
  appellation         text check (char_length(appellation) <= 160),
  -- the vintages the provider lists; empty = none listed (not "non-vintage")
  vintages            smallint[] not null default '{}'
                        check (cardinality(vintages) <= 300 and 1800 <= all (vintages) and 2100 >= all (vintages)),
  non_vintage         boolean not null default false,
  -- provider identity extras only (grapes, alcohol, the provider's own codes); never ratings, prices or reviews
  details             jsonb not null default '{}'
                        check (jsonb_typeof(details) = 'object' and pg_column_size(details) < 4096),
  -- the provider's own page for this record, when it has one
  source_url          text check (source_url ~ '^https://' and char_length(source_url) <= 500),
  -- what CELLR changed compared with the provider's record (empty = taken as provided), e.g. "type mapped"
  -- (each at most 80 characters: enforced by catalog_external_import, the only writer)
  modifications       text[] not null default '{}' check (cardinality(modifications) <= 12),
  content_hash        text not null check (content_hash ~ '^[0-9a-f]{32}$'),
  status              text not null default 'active' check (status in ('active', 'withdrawn')),
  first_run_id        uuid references public.catalog_import_runs on delete set null,
  last_run_id         uuid references public.catalog_import_runs on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (provider_id, external_id)
);
create index catalog_external_records_identity_idx
  on public.catalog_external_records (normalized_producer, normalized_name);
create index catalog_external_records_run_idx on public.catalog_external_records (provider_id, last_run_id);
create index catalog_external_records_first_run_idx on public.catalog_external_records (first_run_id);

create function private.fill_external_normalized() returns trigger
  language plpgsql set search_path = '' as $$
begin
  new.normalized_producer := private.normalize_text(new.producer);
  new.normalized_name := private.normalize_text(new.name);
  return new;
end $$;
create trigger catalog_external_records_norm before insert or update of producer, name
  on public.catalog_external_records for each row execute function private.fill_external_normalized();
create trigger catalog_external_records_updated before update on public.catalog_external_records
  for each row execute function private.set_updated_at();
create trigger catalog_external_records_immutable before update on public.catalog_external_records
  for each row execute function private.forbid_change('provider_id', 'external_id');

-- ---- 3. Links from a provider record to a canonical CELLR wine ------------------------------------------------------
create table public.catalog_record_links (
  record_id  uuid primary key references public.catalog_external_records on delete cascade,
  wine_id    uuid not null references public.wines on delete cascade,
  -- suggested: an import found exactly one canonical wine with this exact identity (a hint for the admin, nothing
  -- more); verified / rejected: an admin's decision. Only 'verified' changes what people see.
  state      text not null check (state in ('suggested', 'verified', 'rejected')),
  reason     text check (char_length(reason) <= 500),
  decided_by uuid references auth.users on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  constraint catalog_record_links_decided check ((state = 'suggested') = (decided_at is null))
);
create index catalog_record_links_wine_idx on public.catalog_record_links (wine_id);

create function private.catalog_link_canonical_only() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.wines w where w.id = new.wine_id and w.status = 'canonical') then
    raise exception 'a provider record links only to a canonical wine' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger catalog_record_links_canonical before insert or update of wine_id on public.catalog_record_links
  for each row execute function private.catalog_link_canonical_only();

-- Service role only: people never read or write staging data directly (search is the only way in).
alter table public.catalog_providers        enable row level security;
alter table public.catalog_import_runs      enable row level security;
alter table public.catalog_external_records enable row level security;
alter table public.catalog_record_links     enable row level security;
revoke all on public.catalog_providers, public.catalog_import_runs, public.catalog_external_records,
              public.catalog_record_links from public, anon, authenticated;
grant all on public.catalog_providers, public.catalog_import_runs, public.catalog_external_records,
             public.catalog_record_links to service_role;

-- ---- 4. The search index -------------------------------------------------------------------------------------------
-- One row per searchable name: a wine (its producer + name), a canonical wine's verified alias, a provider record.
-- `household_id` is the owner of a household's own wine; null for the catalogue and provider records.
create table private.catalog_search_entries (
  id            bigint generated always as identity primary key,
  kind          text not null check (kind in ('wine', 'alias', 'record')),
  wine_id       uuid references public.wines on delete cascade,
  alias_id      uuid references public.wine_aliases on delete cascade,
  record_id     uuid references public.catalog_external_records on delete cascade,
  household_id  uuid references public.households on delete cascade,
  canonical     boolean not null,
  provider_id   text,
  search_text   text not null,
  producer_text text not null,
  name_text     text not null,
  wine_type     public.wine_type,
  country_code  text,
  region_text   text,
  constraint catalog_search_entries_shape check (
    (kind = 'record') = (record_id is not null) and (kind = 'alias') = (alias_id is not null)
    and (kind = 'record' or wine_id is not null) and (kind <> 'record' or household_id is null))
);
create unique index catalog_search_entries_wine_uq   on private.catalog_search_entries (wine_id)   where kind = 'wine';
create unique index catalog_search_entries_alias_uq  on private.catalog_search_entries (alias_id)  where kind = 'alias';
create unique index catalog_search_entries_record_uq on private.catalog_search_entries (record_id) where kind = 'record';
create index catalog_search_entries_wine_idx on private.catalog_search_entries (wine_id);
create index catalog_search_entries_trgm on private.catalog_search_entries
  using gin (search_text extensions.gin_trgm_ops);
create index catalog_search_entries_producer_prefix on private.catalog_search_entries (producer_text text_pattern_ops);
create index catalog_search_entries_name_prefix on private.catalog_search_entries (name_text text_pattern_ops);
alter table private.catalog_search_entries enable row level security;
revoke all on private.catalog_search_entries from public, anon, authenticated;

-- A wine's rows (its name, and a canonical wine's aliases), rebuilt from the source rows. Idempotent.
create function private.catalog_search_refresh_wine(p_wine uuid) returns void
  language plpgsql security definer set search_path = '' as $$
begin
  delete from private.catalog_search_entries where wine_id = p_wine and kind in ('wine', 'alias');
  insert into private.catalog_search_entries (kind, wine_id, household_id, canonical, search_text, producer_text,
                                              name_text, wine_type, country_code, region_text)
  select 'wine', w.id, w.owner_household_id, w.status = 'canonical',
         btrim(p.normalized_name || ' ' || w.normalized_name), p.normalized_name, w.normalized_name, w.wine_type,
         coalesce(w.country_code, p.country_code), nullif(private.normalize_text(w.region), '')
    from public.wines w join public.producers p on p.id = w.producer_id
   where w.id = p_wine;
  -- only the catalogue's aliases are verified (as everywhere else in CELLR)
  insert into private.catalog_search_entries (kind, wine_id, alias_id, household_id, canonical, search_text,
                                              producer_text, name_text, wine_type, country_code, region_text)
  select 'alias', w.id, a.id, null, true, btrim(p.normalized_name || ' ' || a.normalized_alias), p.normalized_name,
         a.normalized_alias, w.wine_type, coalesce(w.country_code, p.country_code),
         nullif(private.normalize_text(w.region), '')
    from public.wine_aliases a
    join public.wines w on w.id = a.wine_id and w.status = 'canonical'
    join public.producers p on p.id = w.producer_id
   where a.wine_id = p_wine and a.normalized_alias <> '';
end $$;
revoke all on function private.catalog_search_refresh_wine(uuid) from public, anon, authenticated;

create function private.catalog_search_on_wine() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  perform private.catalog_search_refresh_wine(new.id);
  return null;
end $$;
create trigger wines_catalog_search after insert or update of name, wine_type, country_code, region, producer_id
  on public.wines for each row execute function private.catalog_search_on_wine();

create function private.catalog_search_on_producer() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  perform private.catalog_search_refresh_wine(w.id) from public.wines w where w.producer_id = new.id;
  return null;
end $$;
create trigger producers_catalog_search after update of name, country_code
  on public.producers for each row execute function private.catalog_search_on_producer();

create function private.catalog_search_on_alias() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then perform private.catalog_search_refresh_wine(old.wine_id); end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.wine_id <> old.wine_id) then
    perform private.catalog_search_refresh_wine(new.wine_id);
  end if;
  return null;
end $$;
create trigger wine_aliases_catalog_search after insert or update or delete
  on public.wine_aliases for each row execute function private.catalog_search_on_alias();

create function private.catalog_search_on_record() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if new.status <> 'active' then
    delete from private.catalog_search_entries where record_id = new.id and kind = 'record';
    return null;
  end if;
  insert into private.catalog_search_entries (kind, record_id, household_id, canonical, provider_id, search_text,
                                              producer_text, name_text, wine_type, country_code, region_text)
  values ('record', new.id, null, false, new.provider_id,
          btrim(new.normalized_producer || ' ' || new.normalized_name), new.normalized_producer, new.normalized_name,
          new.wine_type, new.country_code, nullif(private.normalize_text(new.region), ''))
  on conflict (record_id) where kind = 'record' do update
    set search_text = excluded.search_text, producer_text = excluded.producer_text, name_text = excluded.name_text,
        wine_type = excluded.wine_type, country_code = excluded.country_code, region_text = excluded.region_text;
  return null;
end $$;
create trigger catalog_external_records_search after insert or update
  on public.catalog_external_records for each row execute function private.catalog_search_on_record();

-- Backfill every existing wine (catalogue and households' own).
select private.catalog_search_refresh_wine(w.id) from public.wines w;

-- ---- 5. Search ------------------------------------------------------------------------------------------------------
-- For one household the caller belongs to (anything else: no rows, never an error that says whether it exists).
-- Every word typed must start a word of "producer name" (prefix), or the whole text must be close to it (fuzzy,
-- pg_trgm word similarity). Results are ranked: exact > prefix > fuzzy, and within that the household's own bottles,
-- its own wines and the verified catalogue above provider records. At most 20 rows; a query is cut at 8 words and
-- 80 characters. Only canonical wines are ever `verified`; `match = 'fuzzy'` is never an identity.
create function public.catalog_search(p_household_id uuid, p_query text, p_type text default null,
                                      p_country text default null, p_region text default null,
                                      p_limit int default 10)
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
begin
  if p_household_id is null or not (p_household_id = any (private.my_household_ids())) then return; end if;
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
                     where (e.household_id is null or e.household_id = $1) %s %s limit %s) x', cand, filters, lim)
      into n_pre using p_household_id;
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
        where (e.household_id is null or e.household_id = $1) %1$s %2$s
        order by char_length(e.search_text), e.id limit 400)
      union
      (select e.* from private.catalog_search_entries e
        where $5 and $2 operator(extensions.<%%) e.search_text
          and (e.household_id is null or e.household_id = $1) %2$s
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
          or (pr.search_scope in ('pilot', 'public')
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
     order by b.total desc, char_length(b.search_text), coalesce(b.wine_id, b.record_id)
     limit $4
  $q$, cand, filters) using p_household_id, q, toks, lim, fuzzy;
end $$;
revoke all on function public.catalog_search(uuid, text, text, text, text, int) from public, anon;
grant execute on function public.catalog_search(uuid, text, text, text, text, int) to authenticated, service_role;

-- ---- 6. Importing provider records (service role only) ------------------------------------------------------------
create function public.catalog_provider_upsert(p jsonb) returns text
  language plpgsql security definer set search_path = '' as $$
begin
  insert into public.catalog_providers (id, name, license, license_url, attribution, homepage, legal_notice,
                                        modification_notice, may_store, may_display, commercial_use, rights_status,
                                        rights_evidence, rights_verified_at, rights_verified_by, search_scope, notes)
  values (p->>'id', p->>'name', p->>'license', p->>'license_url', p->>'attribution', p->>'homepage',
          p->>'legal_notice', p->>'modification_notice',
          coalesce((p->>'may_store')::boolean, false), coalesce((p->>'may_display')::boolean, false),
          coalesce((p->>'commercial_use')::boolean, false), coalesce(p->>'rights_status', 'unverified'),
          p->>'rights_evidence', (p->>'rights_verified_at')::timestamptz, p->>'rights_verified_by',
          coalesce(p->>'search_scope', 'off'), p->>'notes')
  on conflict (id) do update
    set name = excluded.name, license = excluded.license, license_url = excluded.license_url,
        attribution = excluded.attribution, homepage = excluded.homepage, legal_notice = excluded.legal_notice,
        modification_notice = excluded.modification_notice, may_store = excluded.may_store,
        may_display = excluded.may_display, commercial_use = excluded.commercial_use,
        rights_status = excluded.rights_status, rights_evidence = excluded.rights_evidence,
        rights_verified_at = excluded.rights_verified_at, rights_verified_by = excluded.rights_verified_by,
        search_scope = excluded.search_scope, notes = excluded.notes;
  return p->>'id';
end $$;

-- A run needs: a provider whose licence allows storing, rights not 'blocked', and either verified rights or an
-- explicit pilot run (local or staging evaluation). The licence and rights status are recorded with the run.
create function public.catalog_import_run_start(p_provider text, p_version text, p_source_url text,
                                                p_sha256 text, p_note text default null,
                                                p_retrieved_at timestamptz default null, p_pilot boolean default false)
  returns uuid
  language plpgsql security definer set search_path = '' as $$
declare rid uuid; pr public.catalog_providers;
begin
  select * into pr from public.catalog_providers where id = p_provider;
  if pr.id is null or not pr.may_store then
    raise exception 'provider % is unknown or its licence does not allow storing its records', p_provider
      using errcode = '42501';
  end if;
  if pr.rights_status = 'blocked' then
    raise exception 'provider %: importing is blocked until its licence terms are established', p_provider
      using errcode = '42501';
  end if;
  if pr.rights_status <> 'verified' and not coalesce(p_pilot, false) then
    raise exception 'provider %: rights are not verified; only a pilot run is allowed', p_provider
      using errcode = '42501';
  end if;
  insert into public.catalog_import_runs (provider_id, dataset_version, source_url, source_sha256, note, retrieved_at,
                                          pilot, license, rights_status)
  values (p_provider, p_version, p_source_url, p_sha256, p_note, coalesce(p_retrieved_at, now()),
          coalesce(p_pilot, false), pr.license, pr.rights_status)
  returning id into rid;
  return rid;
end $$;

-- One batch (at most 1000 records). Dry run by default: classifies every record and writes nothing.
-- Each record: { external_id, producer, name, wine_type?, country_code?, region?, appellation?, vintages?,
-- non_vintage?, details?, source_url?, modifications? }. Idempotent: the same record again is `unchanged` (only its last run is noted).
-- Never touches public.wines; at most it SUGGESTS a link to the one canonical wine with exactly this identity.
create function public.catalog_external_import(p_provider text, p_run_id uuid, p_records jsonb,
                                               p_apply boolean default false) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare
  r jsonb; ext text; prod text; nm text; typ text; ctry text; vint smallint[]; det jsonb; h text; src text;
  mods text[];
  old_hash text; rid uuid; matches uuid[];
  n_ins int := 0; n_upd int := 0; n_same int := 0; n_bad int := 0; n_sugg int := 0; n_dup int := 0;
  problems jsonb := '[]';
begin
  if not exists (select 1 from public.catalog_providers where id = p_provider and may_store
                   and rights_status <> 'blocked') then
    raise exception 'provider % is unknown, blocked, or its licence does not allow storing its records', p_provider
      using errcode = '42501';
  end if;
  if p_apply and not exists (select 1 from public.catalog_import_runs
                              where id = p_run_id and provider_id = p_provider and finished_at is null) then
    raise exception 'an open import run of this provider is required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_records) <> 'array' or jsonb_array_length(p_records) > 1000 then
    raise exception 'records must be an array of at most 1000' using errcode = '22023';
  end if;

  for r in select * from jsonb_array_elements(p_records) loop
    begin
      ext  := r->>'external_id';
      prod := nullif(btrim(r->>'producer'), '');
      nm   := nullif(btrim(r->>'name'), '');
      typ  := nullif(r->>'wine_type', '');
      ctry := nullif(r->>'country_code', '');
      det  := coalesce(r->'details', '{}');
      if ext is null or ext !~ '^[A-Za-z0-9._:-]{1,64}$' then raise exception 'bad external_id'; end if;
      if prod is null or char_length(prod) > 120 then raise exception 'bad producer'; end if;
      if nm is null or char_length(nm) > 160 then raise exception 'bad name'; end if;
      if typ is not null and typ not in (select unnest(enum_range(null::public.wine_type))::text) then
        raise exception 'bad wine_type';
      end if;
      if ctry is not null and ctry !~ '^[A-Z]{2}$' then raise exception 'bad country_code'; end if;
      if jsonb_typeof(det) <> 'object' or pg_column_size(det) >= 4096 then raise exception 'bad details'; end if;
      if det ?| array['rating', 'ratings', 'price', 'prices', 'review', 'reviews', 'score', 'scores'] then
        raise exception 'details may not hold ratings, prices or reviews';
      end if;
      select coalesce(array_agg(distinct x::smallint order by x::smallint), '{}') into vint
        from jsonb_array_elements_text(coalesce(r->'vintages', '[]')) x;
      if exists (select 1 from unnest(vint) y where y not between 1800 and 2100) then raise exception 'bad vintage'; end if;
      src := nullif(r->>'source_url', '');
      if src is not null and (src !~ '^https://' or char_length(src) > 500) then raise exception 'bad source_url'; end if;
      select coalesce(array_agg(left(m, 80)), '{}') into mods
        from jsonb_array_elements_text(coalesce(r->'modifications', '[]')) m;
      if cardinality(mods) > 12 then raise exception 'too many modifications'; end if;
      if char_length(coalesce(r->>'region', '')) > 120 or char_length(coalesce(r->>'appellation', '')) > 160 then
        raise exception 'bad region or appellation';
      end if;
      h := md5(jsonb_build_object('producer', prod, 'name', nm, 'wine_type', typ, 'country_code', ctry,
                                  'region', nullif(btrim(r->>'region'), ''),
                                  'appellation', nullif(btrim(r->>'appellation'), ''), 'vintages', to_jsonb(vint),
                                  'non_vintage', coalesce((r->>'non_vintage')::boolean, false), 'details', det,
                                  'source_url', src, 'modifications', to_jsonb(mods))::text);
    exception when others then
      n_bad := n_bad + 1;
      if jsonb_array_length(problems) < 20 then
        problems := problems || jsonb_build_object('external_id', left(r->>'external_id', 64), 'reason', sqlerrm);
      end if;
      continue;
    end;

    select e.content_hash into old_hash from public.catalog_external_records e
     where e.provider_id = p_provider and e.external_id = ext;
    if old_hash is null then n_ins := n_ins + 1; elsif old_hash <> h then n_upd := n_upd + 1; else n_same := n_same + 1; end if;
    -- the same identity under another id of this provider: reported, not merged
    if exists (select 1 from public.catalog_external_records e
                where e.provider_id = p_provider and e.external_id <> ext and e.status = 'active'
                  and e.normalized_producer = private.normalize_text(prod)
                  and e.normalized_name = private.normalize_text(nm)
                  and e.wine_type is not distinct from typ::public.wine_type) then
      n_dup := n_dup + 1;
    end if;
    if not p_apply then continue; end if;

    insert into public.catalog_external_records as e
      (provider_id, external_id, producer, name, normalized_producer, normalized_name, wine_type, country_code,
       region, appellation, vintages, non_vintage, details, source_url, modifications, content_hash, first_run_id,
       last_run_id)
    values (p_provider, ext, prod, nm, '', '', typ::public.wine_type, ctry, nullif(btrim(r->>'region'), ''),
            nullif(btrim(r->>'appellation'), ''), vint, coalesce((r->>'non_vintage')::boolean, false), det, src,
            mods, h, p_run_id, p_run_id)
    on conflict (provider_id, external_id) do update
      set producer = excluded.producer, name = excluded.name, wine_type = excluded.wine_type,
          country_code = excluded.country_code, region = excluded.region, appellation = excluded.appellation,
          vintages = excluded.vintages, non_vintage = excluded.non_vintage, details = excluded.details,
          source_url = excluded.source_url, modifications = excluded.modifications,
          content_hash = excluded.content_hash, last_run_id = excluded.last_run_id, status = 'active'
    returning e.id into rid;

    -- a suggestion only for exactly one canonical wine with this exact identity (producer, name or verified alias,
    -- type; no contradicting country); a similar name is never enough
    if not exists (select 1 from public.catalog_record_links l where l.record_id = rid) then
      select array_agg(distinct w.id) into matches
        from public.wines w join public.producers p on p.id = w.producer_id
       where w.status = 'canonical' and p.normalized_name = private.normalize_text(prod)
         and (w.normalized_name = private.normalize_text(nm)
              or exists (select 1 from public.wine_aliases a
                          where a.wine_id = w.id and a.normalized_alias = private.normalize_text(nm)))
         and (typ is null or w.wine_type = typ::public.wine_type)
         and (ctry is null or coalesce(w.country_code, p.country_code) is null
              or coalesce(w.country_code, p.country_code) = ctry);
      if cardinality(matches) = 1 then
        insert into public.catalog_record_links (record_id, wine_id, state, reason)
        values (rid, matches[1], 'suggested', 'exact identity found at import') on conflict do nothing;
        n_sugg := n_sugg + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object('applied', p_apply, 'inserted', n_ins, 'updated', n_upd, 'unchanged', n_same,
                            'invalid', n_bad, 'possible_duplicates', n_dup, 'suggested_links', n_sugg,
                            'problems', problems);
end $$;

-- Closes a run. With p_withdraw_missing (a full file was imported), records of this provider that the run did not
-- see are withdrawn (hidden from search, kept for history and links); nothing is ever deleted.
create function public.catalog_import_run_finish(p_run_id uuid, p_withdraw_missing boolean, p_counts jsonb)
  returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare prov text; n int := 0;
begin
  select provider_id into prov from public.catalog_import_runs where id = p_run_id and finished_at is null;
  if prov is null then raise exception 'no open run %', p_run_id using errcode = '22023'; end if;
  if p_withdraw_missing then
    update public.catalog_external_records
       set status = 'withdrawn'
     where provider_id = prov and status = 'active' and last_run_id is distinct from p_run_id;
    get diagnostics n = row_count;
  end if;
  update public.catalog_import_runs
     set finished_at = now(), counts = coalesce(p_counts, '{}') || jsonb_build_object('withdrawn', n)
   where id = p_run_id;
  return jsonb_build_object('run', p_run_id, 'withdrawn', n);
end $$;

-- An admin's decision about a provider record: 'verified' (it IS this canonical wine) or 'rejected'. Audited.
create function public.admin_catalog_record_decide(p_record uuid, p_wine uuid, p_state text, p_reason text,
                                                   p_actor uuid) returns text
  language plpgsql security definer set search_path = '' as $$
declare v_before jsonb;
begin
  if p_state not in ('verified', 'rejected') then raise exception 'state must be verified or rejected' using errcode = '22023'; end if;
  if not exists (select 1 from public.catalog_external_records where id = p_record) then return 'not_found'; end if;
  if not exists (select 1 from public.wines where id = p_wine and status = 'canonical') then return 'not_canonical'; end if;
  select to_jsonb(l) - 'record_id' into v_before from public.catalog_record_links l where l.record_id = p_record;
  insert into public.catalog_record_links (record_id, wine_id, state, reason, decided_by, decided_at)
  values (p_record, p_wine, p_state, nullif(left(btrim(p_reason), 500), ''), p_actor, now())
  on conflict (record_id) do update
    set wine_id = excluded.wine_id, state = excluded.state, reason = excluded.reason,
        decided_by = excluded.decided_by, decided_at = excluded.decided_at;
  perform private.master_log('link', p_record, p_wine, 'external_record_' || p_state, p_actor, v_before,
                             jsonb_build_object('wine_id', p_wine, 'state', p_state), p_reason);
  return 'ok';
end $$;

-- ---- 7. Provenance of one provider record ("Bronnen & betrouwbaarheid") ------------------------------------------
-- Everything a detail page needs to credit and qualify a provider record: whose it is, its id and page, the licence
-- and its link, the required attribution and full legal notice, when it was retrieved, from which dataset version,
-- and what CELLR modified. Only for a record the caller could find in search (its provider is shown), never more.
create function public.catalog_record_provenance(p_household_id uuid, p_record uuid) returns jsonb
  language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
           'recordId', e.id, 'externalId', e.external_id, 'sourceUrl', e.source_url,
           'provider', jsonb_build_object('id', pr.id, 'name', pr.name, 'homepage', pr.homepage,
                                          'license', pr.license, 'licenseUrl', pr.license_url,
                                          'attribution', pr.attribution, 'legalNotice', pr.legal_notice,
                                          'modificationNotice', pr.modification_notice,
                                          'rightsStatus', pr.rights_status, 'scope', pr.search_scope),
           'firstRetrievedAt', fr.retrieved_at, 'lastRetrievedAt', lr.retrieved_at,
           'datasetVersion', lr.dataset_version, 'importedUnderLicense', lr.license,
           'modifications', to_jsonb(e.modifications),
           'link', (select jsonb_build_object('wineId', l.wine_id, 'state', l.state)
                      from public.catalog_record_links l where l.record_id = e.id))
    from public.catalog_external_records e
    join public.catalog_providers pr on pr.id = e.provider_id and pr.search_scope in ('pilot', 'public')
    left join public.catalog_import_runs fr on fr.id = e.first_run_id
    left join public.catalog_import_runs lr on lr.id = e.last_run_id
   where e.id = p_record and e.status = 'active'
     and p_household_id = any (private.my_household_ids())
$$;
revoke all on function public.catalog_record_provenance(uuid, uuid) from public, anon;
grant execute on function public.catalog_record_provenance(uuid, uuid) to authenticated, service_role;

revoke all on function public.catalog_provider_upsert(jsonb),
                       public.catalog_import_run_start(text, text, text, text, text, timestamptz, boolean),
                       public.catalog_external_import(text, uuid, jsonb, boolean),
                       public.catalog_import_run_finish(uuid, boolean, jsonb),
                       public.admin_catalog_record_decide(uuid, uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.catalog_provider_upsert(jsonb),
                          public.catalog_import_run_start(text, text, text, text, text, timestamptz, boolean),
                          public.catalog_external_import(text, uuid, jsonb, boolean),
                          public.catalog_import_run_finish(uuid, boolean, jsonb),
                          public.admin_catalog_record_decide(uuid, uuid, text, text, uuid)
  to service_role;

-- =====================================================================
-- 0003 wine catalog: producers, wines, vintages, aliases, grapes, sources
-- =====================================================================
-- Wine ≠ vintage ≠ bottle. This migration is the first two.
--
-- CANONICAL rows (owner_household_id IS NULL) are readable by every signed-in user and writable ONLY
-- with the service role (curated import / manual promotion). PROVISIONAL rows are created by users
-- when a scan or manual add finds no match; they are private to the creating household and can never
-- be edited into canonical by a user (WITH CHECK pins status = 'provisional').
-- A user's confirmation of a match is a signal for review, never an automatic write to canonical data.

-- ---- Tables ------------------------------------------------------------------------------------
create table public.producers (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null check (char_length(btrim(name)) between 1 and 120),
  normalized_name    text not null,
  country_code       text check (country_code ~ '^[A-Z]{2}$'),
  status             public.catalog_status not null default 'provisional',
  owner_household_id uuid references public.households on delete cascade,
  origin             public.provenance_source not null default 'user_entered',
  created_by         uuid references auth.users on delete set null default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint producers_status_owner check ((status = 'canonical') = (owner_household_id is null))
);

create table public.wines (
  id                 uuid primary key default gen_random_uuid(),
  producer_id        uuid not null references public.producers,   -- NO ACTION: checked after household-delete cascades
  name               text not null check (char_length(btrim(name)) between 1 and 160),
  normalized_name    text not null,
  wine_type          public.wine_type not null,
  country_code       text check (country_code ~ '^[A-Z]{2}$'),
  region             text check (char_length(region) <= 120),
  appellation        text check (char_length(appellation) <= 160),
  classification     text check (char_length(classification) <= 120),
  -- reusable-bottle-model parameters for the 3D view: {shape, glassColor, capsuleColor, closure, labelAspect}
  bottle_style       jsonb check (bottle_style is null or pg_column_size(bottle_style) < 1024),
  status             public.catalog_status not null default 'provisional',
  owner_household_id uuid references public.households on delete cascade,
  origin             public.provenance_source not null default 'user_entered',
  created_by         uuid references auth.users on delete set null default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint wines_status_owner check ((status = 'canonical') = (owner_household_id is null))
);

-- year NULL = non-vintage. `nulls not distinct` (PG15+) keeps one NV row per wine.
create table public.wine_vintages (
  id         uuid primary key default gen_random_uuid(),
  wine_id    uuid not null references public.wines on delete cascade,
  year       smallint check (year between 1800 and 2100),
  abv        numeric(4,2) check (abv between 0 and 25),
  created_at timestamptz not null default now(),
  constraint wine_vintages_unique unique nulls not distinct (wine_id, year)
);

create table public.wine_aliases (
  id               uuid primary key default gen_random_uuid(),
  wine_id          uuid not null references public.wines on delete cascade,
  alias            text not null check (char_length(btrim(alias)) between 1 and 160),
  normalized_alias text not null,
  locale           text,
  unique (wine_id, normalized_alias)
);

-- Reference data, seeded (supabase/seed). Read-only for clients.
create table public.grapes (
  id              int generated always as identity primary key,
  name            text not null unique,
  normalized_name text not null unique,
  color           text not null check (color in ('red', 'white')),
  aliases         text[] not null default '{}'
);

create table public.wine_grapes (
  wine_id  uuid not null references public.wines on delete cascade,
  grape_id int  not null references public.grapes on delete restrict,
  pct      numeric(5,2) check (pct between 0 and 100),
  primary key (wine_id, grape_id)
);

-- Where a canonical record came from (licence-aware); written by the service role only.
create table public.wine_sources (
  id           uuid primary key default gen_random_uuid(),
  wine_id      uuid not null references public.wines on delete cascade,
  source_name  text not null,
  source_ref   text,
  license      text,
  url          text,
  retrieved_at timestamptz not null default now()
);

-- ---- Indexes -----------------------------------------------------------------------------------
create unique index producers_canonical_unique on public.producers (normalized_name, coalesce(country_code, ''))
  where status = 'canonical';
create unique index producers_provisional_unique on public.producers (owner_household_id, normalized_name, coalesce(country_code, ''))
  where status = 'provisional';
create index producers_trgm_idx on public.producers using gin (normalized_name extensions.gin_trgm_ops);

create unique index wines_canonical_unique on public.wines (producer_id, normalized_name, wine_type)
  where status = 'canonical';
create unique index wines_provisional_unique on public.wines (owner_household_id, producer_id, normalized_name, wine_type)
  where status = 'provisional';
create index wines_producer_idx on public.wines (producer_id);
create index wines_owner_idx on public.wines (owner_household_id) where owner_household_id is not null;
create index wines_trgm_idx on public.wines using gin (normalized_name extensions.gin_trgm_ops);
create index wine_vintages_wine_idx on public.wine_vintages (wine_id);
create index wine_aliases_trgm_idx on public.wine_aliases using gin (normalized_alias extensions.gin_trgm_ops);
create index wine_grapes_grape_idx on public.wine_grapes (grape_id);
create index wine_sources_wine_idx on public.wine_sources (wine_id);

-- ---- Triggers ----------------------------------------------------------------------------------
create function private.fill_normalized_name() returns trigger
  language plpgsql set search_path = '' as $$
begin
  new.normalized_name := private.normalize_text(new.name);
  return new;
end $$;

create function private.fill_normalized_alias() returns trigger
  language plpgsql set search_path = '' as $$
begin
  new.normalized_alias := private.normalize_text(new.alias);
  return new;
end $$;

create trigger producers_norm before insert or update of name on public.producers
  for each row execute function private.fill_normalized_name();
create trigger wines_norm before insert or update of name on public.wines
  for each row execute function private.fill_normalized_name();
create trigger wine_aliases_norm before insert or update of alias on public.wine_aliases
  for each row execute function private.fill_normalized_alias();
create trigger grapes_norm before insert or update of name on public.grapes
  for each row execute function private.fill_normalized_name();

create trigger producers_updated before update on public.producers for each row execute function private.set_updated_at();
create trigger wines_updated    before update on public.wines     for each row execute function private.set_updated_at();

-- A wine's identity fields are fixed once created (a wrong match is replaced, not mutated in place).
create trigger producers_immutable before update on public.producers
  for each row execute function private.forbid_change('status', 'owner_household_id', 'origin');
create trigger wines_immutable before update on public.wines
  for each row execute function private.forbid_change('status', 'owner_household_id', 'origin', 'producer_id');

-- ---- Row level security ------------------------------------------------------------------------
alter table public.producers     enable row level security;
alter table public.wines         enable row level security;
alter table public.wine_vintages enable row level security;
alter table public.wine_aliases  enable row level security;
alter table public.grapes        enable row level security;
alter table public.wine_grapes   enable row level security;
alter table public.wine_sources  enable row level security;

-- producers
create policy producers_select on public.producers for select to authenticated
  using (status = 'canonical' or owner_household_id = any (((select private.my_household_ids()))::uuid[]));
create policy producers_insert on public.producers for insert to authenticated
  with check (status = 'provisional' and origin in ('user_entered', 'label_ocr')
              and owner_household_id = any (((select private.my_household_ids()))::uuid[]));
create policy producers_update on public.producers for update to authenticated
  using (status = 'provisional' and owner_household_id = any (((select private.my_household_ids()))::uuid[]))
  with check (status = 'provisional' and owner_household_id = any (((select private.my_household_ids()))::uuid[]));

-- wines
create policy wines_select on public.wines for select to authenticated
  using (status = 'canonical' or owner_household_id = any (((select private.my_household_ids()))::uuid[]));
create policy wines_insert on public.wines for insert to authenticated
  with check (status = 'provisional' and origin in ('user_entered', 'label_ocr')
              and owner_household_id = any (((select private.my_household_ids()))::uuid[])
              -- a provisional wine may only hang under a producer the caller can see
              and exists (select 1 from public.producers p where p.id = producer_id));
create policy wines_update on public.wines for update to authenticated
  using (status = 'provisional' and owner_household_id = any (((select private.my_household_ids()))::uuid[]))
  with check (status = 'provisional' and owner_household_id = any (((select private.my_household_ids()))::uuid[]));

-- children: readable when the parent wine is visible; writable only on the caller's provisional wines
create policy vintages_select on public.wine_vintages for select to authenticated
  using (exists (select 1 from public.wines w where w.id = wine_id));
create policy vintages_write on public.wine_vintages for all to authenticated
  using (exists (select 1 from public.wines w where w.id = wine_id and w.status = 'provisional'
                 and w.owner_household_id = any (((select private.my_household_ids()))::uuid[])))
  with check (exists (select 1 from public.wines w where w.id = wine_id and w.status = 'provisional'
                      and w.owner_household_id = any (((select private.my_household_ids()))::uuid[])));

create policy aliases_select on public.wine_aliases for select to authenticated
  using (exists (select 1 from public.wines w where w.id = wine_id));
create policy aliases_write on public.wine_aliases for all to authenticated
  using (exists (select 1 from public.wines w where w.id = wine_id and w.status = 'provisional'
                 and w.owner_household_id = any (((select private.my_household_ids()))::uuid[])))
  with check (exists (select 1 from public.wines w where w.id = wine_id and w.status = 'provisional'
                      and w.owner_household_id = any (((select private.my_household_ids()))::uuid[])));

create policy wine_grapes_select on public.wine_grapes for select to authenticated
  using (exists (select 1 from public.wines w where w.id = wine_id));
create policy wine_grapes_write on public.wine_grapes for all to authenticated
  using (exists (select 1 from public.wines w where w.id = wine_id and w.status = 'provisional'
                 and w.owner_household_id = any (((select private.my_household_ids()))::uuid[])))
  with check (exists (select 1 from public.wines w where w.id = wine_id and w.status = 'provisional'
                      and w.owner_household_id = any (((select private.my_household_ids()))::uuid[])));

create policy wine_sources_select on public.wine_sources for select to authenticated
  using (exists (select 1 from public.wines w where w.id = wine_id));
create policy grapes_select on public.grapes for select to authenticated using (true);

-- ---- Grants ------------------------------------------------------------------------------------
-- Column lists: clients cannot set ids, normalized_name, created_by or timestamps.
grant select on public.producers, public.wines to authenticated;
grant insert (name, country_code, status, owner_household_id, origin) on public.producers to authenticated;
grant update (name, country_code) on public.producers to authenticated;
grant insert (producer_id, name, wine_type, country_code, region, appellation, classification, bottle_style,
              status, owner_household_id, origin) on public.wines to authenticated;
grant update (name, country_code, region, appellation, classification, bottle_style) on public.wines to authenticated;
grant select, insert, update, delete on public.wine_vintages, public.wine_aliases, public.wine_grapes to authenticated;
grant select on public.wine_sources, public.grapes to authenticated;

grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- =====================================================================
-- 0004 cellars, locations, label images, bottles, favourites
-- =====================================================================
-- A BOTTLE is one physical bottle owned by a household ("3 bottles" = 3 rows). Its place in the
-- cellar is plain data — (location_id, loc_row, loc_col) — independent of any renderer; the 3D
-- scene is a pure function of these rows. Only OCCUPIED slots exist; there is no slot table.
--
-- Every household-scoped table carries household_id so RLS can use the index-friendly array form,
-- and composite foreign keys (id, household_id) make cross-household references impossible by
-- construction, not just by policy.

-- ---- Tables ------------------------------------------------------------------------------------
create table public.cellars (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  name         text not null check (char_length(btrim(name)) between 1 and 80),
  created_by   uuid references auth.users on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (id, household_id)
);
create index cellars_household_idx on public.cellars (household_id);

-- A grid-shaped storage unit inside a cellar: a rack, a fridge shelf, a cabinet, …
create table public.cellar_locations (
  id           uuid primary key default gen_random_uuid(),
  cellar_id    uuid not null,
  household_id uuid not null,
  label        text not null check (char_length(btrim(label)) between 1 and 40),
  kind         public.location_kind not null default 'rack',
  grid_rows    smallint not null default 5 check (grid_rows between 1 and 30),
  grid_cols    smallint not null default 8 check (grid_cols between 1 and 30),
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (id, household_id),
  unique (cellar_id, label),
  foreign key (cellar_id, household_id) references public.cellars (id, household_id) on delete cascade
);
create index cellar_locations_household_idx on public.cellar_locations (household_id);

-- Household-owned image asset (front/back label photo). Referenced BY bottles, so three identical
-- bottles share one photo. Originals are never overwritten; web/texture are derived copies.
create table public.bottle_images (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households on delete cascade,
  side          public.image_side not null,
  original_path text not null,
  web_path      text,
  texture_path  text,
  crop          jsonb check (crop is null or pg_column_size(crop) < 2048),   -- 4 corner points, normalised 0..1
  width         int check (width > 0),
  height        int check (height > 0),
  blur_color    text check (blur_color ~ '^#[0-9a-fA-F]{6}$'),
  source        text not null default 'user_upload' check (source in ('user_upload')),
  created_by    uuid references auth.users on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  unique (id, household_id),
  -- storage paths always live under the owning household's folder
  constraint bottle_images_original_path check (original_path like household_id::text || '/%'),
  constraint bottle_images_web_path      check (web_path     is null or web_path     like household_id::text || '/%'),
  constraint bottle_images_texture_path  check (texture_path is null or texture_path like household_id::text || '/%')
);
create index bottle_images_household_idx on public.bottle_images (household_id);

create table public.bottles (
  id                    uuid primary key default gen_random_uuid(),
  household_id          uuid not null references public.households on delete cascade,
  vintage_id            uuid not null references public.wine_vintages,
  format_ml             int not null default 750 check (format_ml between 100 and 30000),
  status                public.bottle_status not null default 'in_cellar',
  location_id           uuid,
  loc_row               smallint check (loc_row >= 1),
  loc_col               smallint check (loc_col >= 1),
  purchase_price_cents  int check (purchase_price_cents >= 0),
  currency              text check (currency ~ '^[A-Z]{3}$'),
  purchased_at          date,
  purchased_from        text check (char_length(purchased_from) <= 120),
  notes                 text check (char_length(notes) <= 2000),
  front_image_id        uuid,
  back_image_id         uuid,
  bottle_style_override jsonb check (bottle_style_override is null or pg_column_size(bottle_style_override) < 1024),
  added_by              uuid references auth.users on delete set null default auth.uid(),
  opened_by             uuid references auth.users on delete set null,
  opened_at             timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  -- a location is all-or-nothing, and only bottles that are actually in the cellar have one
  constraint bottles_location_complete check ((location_id is null) = (loc_row is null) and (location_id is null) = (loc_col is null)),
  constraint bottles_location_only_in_cellar check (status = 'in_cellar' or location_id is null),
  -- NO ACTION on purpose: a rack/image that is still referenced cannot be deleted from under a bottle
  foreign key (location_id,    household_id) references public.cellar_locations (id, household_id),
  foreign key (front_image_id, household_id) references public.bottle_images     (id, household_id),
  foreign key (back_image_id,  household_id) references public.bottle_images     (id, household_id)
);
create index bottles_household_status_idx on public.bottles (household_id, status, created_at desc);
create index bottles_household_vintage_idx on public.bottles (household_id, vintage_id);
create index bottles_vintage_idx on public.bottles (vintage_id);
-- One bottle per physical slot.
create unique index bottles_slot_unique on public.bottles (location_id, loc_row, loc_col)
  where status = 'in_cellar' and location_id is not null;

create table public.favorites (
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  wine_id    uuid not null references public.wines on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, wine_id)
);

-- ---- Triggers ----------------------------------------------------------------------------------
create trigger cellars_updated   before update on public.cellars          for each row execute function private.set_updated_at();
create trigger locations_updated before update on public.cellar_locations for each row execute function private.set_updated_at();
create trigger bottles_updated   before update on public.bottles          for each row execute function private.set_updated_at();
create trigger bottles_household_immutable before update on public.bottles
  for each row execute function private.forbid_change('household_id');

-- Slot bounds + "leaving the cellar frees the slot". SECURITY DEFINER so it can read the location
-- regardless of RLS; the household match keeps it from ever reading another household's rack.
create function private.check_bottle_location() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare r smallint; c smallint;
begin
  if new.status <> 'in_cellar' then
    new.location_id := null; new.loc_row := null; new.loc_col := null;
    return new;
  end if;
  if new.location_id is null then return new; end if;
  select l.grid_rows, l.grid_cols into r, c
    from public.cellar_locations l where l.id = new.location_id and l.household_id = new.household_id;
  if not found or new.loc_row > r or new.loc_col > c then
    raise exception 'slot_out_of_bounds' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger bottles_location before insert or update on public.bottles
  for each row execute function private.check_bottle_location();

-- Opening a bottle records who and when (backdating `opened_at` for imports is allowed; `opened_by` is not).
create function private.stamp_bottle_opened() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if new.status = 'opened' and old.status is distinct from 'opened' then
    new.opened_at := coalesce(new.opened_at, now());
    new.opened_by := auth.uid();
  end if;
  return new;
end $$;
create trigger bottles_opened before update on public.bottles
  for each row execute function private.stamp_bottle_opened();

-- A rack cannot shrink below bottles that are still in it.
create function private.check_location_resize() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if (new.grid_rows < old.grid_rows or new.grid_cols < old.grid_cols) and exists (
       select 1 from public.bottles b
       where b.location_id = new.id and b.status = 'in_cellar'
         and (b.loc_row > new.grid_rows or b.loc_col > new.grid_cols)) then
    raise exception 'location_in_use' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger locations_resize before update of grid_rows, grid_cols on public.cellar_locations
  for each row execute function private.check_location_resize();

-- ---- Row level security ------------------------------------------------------------------------
alter table public.cellars          enable row level security;
alter table public.cellar_locations enable row level security;
alter table public.bottle_images    enable row level security;
alter table public.bottles          enable row level security;
alter table public.favorites        enable row level security;

create policy cellars_select on public.cellars for select to authenticated
  using (household_id = any (((select private.my_household_ids()))::uuid[]));
create policy cellars_insert on public.cellars for insert to authenticated
  with check (household_id = any (((select private.my_household_ids()))::uuid[]));
create policy cellars_update on public.cellars for update to authenticated
  using (household_id = any (((select private.my_household_ids()))::uuid[]))
  with check (household_id = any (((select private.my_household_ids()))::uuid[]));
create policy cellars_delete on public.cellars for delete to authenticated
  using (private.is_household_owner(household_id));

create policy locations_select on public.cellar_locations for select to authenticated
  using (household_id = any (((select private.my_household_ids()))::uuid[]));
create policy locations_insert on public.cellar_locations for insert to authenticated
  with check (household_id = any (((select private.my_household_ids()))::uuid[]));
create policy locations_update on public.cellar_locations for update to authenticated
  using (household_id = any (((select private.my_household_ids()))::uuid[]))
  with check (household_id = any (((select private.my_household_ids()))::uuid[]));
create policy locations_delete on public.cellar_locations for delete to authenticated
  using (private.is_household_owner(household_id));

create policy images_all on public.bottle_images for all to authenticated
  using (household_id = any (((select private.my_household_ids()))::uuid[]))
  with check (household_id = any (((select private.my_household_ids()))::uuid[]));

create policy bottles_select on public.bottles for select to authenticated
  using (household_id = any (((select private.my_household_ids()))::uuid[]));
-- A bottle may only point at a vintage whose wine the caller can see (closes the guessed-UUID leak
-- that a plain foreign key would allow).
create policy bottles_insert on public.bottles for insert to authenticated
  with check (household_id = any (((select private.my_household_ids()))::uuid[])
              and status = 'in_cellar'
              and exists (select 1 from public.wine_vintages v where v.id = vintage_id));
create policy bottles_update on public.bottles for update to authenticated
  using (household_id = any (((select private.my_household_ids()))::uuid[]))
  with check (household_id = any (((select private.my_household_ids()))::uuid[])
              and exists (select 1 from public.wine_vintages v where v.id = vintage_id));
-- Members "remove" a bottle by status; only owners hard-delete.
create policy bottles_delete on public.bottles for delete to authenticated
  using (private.is_household_owner(household_id));

create policy favorites_select on public.favorites for select to authenticated using (user_id = auth.uid());
create policy favorites_insert on public.favorites for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.wines w where w.id = wine_id));
create policy favorites_delete on public.favorites for delete to authenticated using (user_id = auth.uid());

-- ---- Grants (column lists: clients never set ids, authorship, timestamps) -----------------------
grant select, delete on public.cellars, public.cellar_locations, public.bottles to authenticated;
grant insert (household_id, name) on public.cellars to authenticated;
grant update (name) on public.cellars to authenticated;
grant insert (cellar_id, household_id, label, kind, grid_rows, grid_cols, sort_order) on public.cellar_locations to authenticated;
grant update (label, kind, grid_rows, grid_cols, sort_order) on public.cellar_locations to authenticated;

grant select, delete on public.bottle_images to authenticated;
grant insert (household_id, side, original_path, web_path, texture_path, crop, width, height, blur_color, source)
  on public.bottle_images to authenticated;
grant update (web_path, texture_path, crop, width, height, blur_color) on public.bottle_images to authenticated;

grant insert (household_id, vintage_id, format_ml, status, location_id, loc_row, loc_col, purchase_price_cents,
              currency, purchased_at, purchased_from, notes, front_image_id, back_image_id, bottle_style_override)
  on public.bottles to authenticated;
grant update (vintage_id, format_ml, status, location_id, loc_row, loc_col, purchase_price_cents, currency,
              purchased_at, purchased_from, notes, front_image_id, back_image_id, bottle_style_override, opened_at)
  on public.bottles to authenticated;

grant select, insert, delete on public.favorites to authenticated;

grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;

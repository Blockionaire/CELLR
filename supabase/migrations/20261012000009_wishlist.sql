-- =====================================================================
-- 0009 wishlist: wines the household would like to buy
-- =====================================================================
-- One row per wine (and, optionally, a particular vintage) the household has its eye on. Everyone in the
-- household can see, add, change and remove them — it is a shared list, like the cellar itself. The wine is
-- an ordinary wine row (found or created exactly as when adding a bottle), so "I bought it" is just the add-
-- bottle flow with the wine already chosen.

create table public.wishlist_items (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references public.households on delete cascade,
  wine_id         uuid not null references public.wines on delete cascade,
  -- null = any vintage
  year            smallint check (year between 1800 and 2100),
  note            text check (char_length(note) <= 500),
  max_price_cents int check (max_price_cents between 0 and 10000000),
  added_by        uuid references auth.users on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
-- The same wine and vintage is on the list once ("any vintage" counts as its own entry).
create unique index wishlist_items_unique on public.wishlist_items (household_id, wine_id, coalesce(year, 0));
create index wishlist_items_household_idx on public.wishlist_items (household_id, created_at desc);

create trigger wishlist_items_updated before update on public.wishlist_items
  for each row execute function private.set_updated_at();
create trigger wishlist_items_household_immutable before update on public.wishlist_items
  for each row execute function private.forbid_change('household_id');
create trigger wishlist_items_wine_immutable before update on public.wishlist_items
  for each row execute function private.forbid_change('wine_id');

-- ---- Row level security -------------------------------------------------------------------------
alter table public.wishlist_items enable row level security;

create policy wishlist_select on public.wishlist_items for select to authenticated
  using (household_id = any (((select private.my_household_ids()))::uuid[]));
-- A member may add a wine they can actually see (their own household's or the shared catalogue).
create policy wishlist_insert on public.wishlist_items for insert to authenticated
  with check (household_id = any (((select private.my_household_ids()))::uuid[])
              and exists (select 1 from public.wines w where w.id = wine_id));
create policy wishlist_update on public.wishlist_items for update to authenticated
  using (household_id = any (((select private.my_household_ids()))::uuid[]))
  with check (household_id = any (((select private.my_household_ids()))::uuid[]));
create policy wishlist_delete on public.wishlist_items for delete to authenticated
  using (household_id = any (((select private.my_household_ids()))::uuid[]));

-- ---- Grants: clients never choose who added it, and cannot move an item to another wine or household ----
grant select, delete on public.wishlist_items to authenticated;
grant insert (household_id, wine_id, year, note, max_price_cents) on public.wishlist_items to authenticated;
grant update (year, note, max_price_cents) on public.wishlist_items to authenticated;

grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;

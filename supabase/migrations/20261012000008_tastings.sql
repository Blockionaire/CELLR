-- =====================================================================
-- 0008 tastings: what you thought of a bottle you opened
-- =====================================================================
-- One row per person per opened bottle: a rating in half stars (stored as 1..10, so 9 = 4½ stars), a few
-- descriptive words and a note. Ratings are individual — two people who open the same bottle each leave
-- their own — but everyone in the household can read them, since that is what "our cellar" means.

create table public.tastings (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  vintage_id   uuid not null references public.wine_vintages on delete cascade,
  -- The bottle that was opened. A hard-deleted bottle leaves its tastings behind (the memory outlives the glass).
  bottle_id    uuid references public.bottles on delete set null,
  -- References profiles (not auth.users) so the author's name can be read along with the tasting.
  user_id      uuid not null default auth.uid() references public.profiles on delete cascade,
  score        smallint check (score between 1 and 10),
  descriptors  text[] not null default '{}' check (cardinality(descriptors) <= 12),
  note         text check (char_length(note) <= 2000),
  tasted_at    timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- a tasting says something
  constraint tastings_has_content check (score is not null or note is not null or cardinality(descriptors) > 0)
);
create index tastings_household_idx on public.tastings (household_id, tasted_at desc);
create index tastings_vintage_idx   on public.tastings (vintage_id, household_id);
create index tastings_user_idx      on public.tastings (user_id, tasted_at desc);
-- One tasting per person per bottle.
create unique index tastings_one_per_person on public.tastings (user_id, bottle_id) where bottle_id is not null;

create trigger tastings_updated before update on public.tastings
  for each row execute function private.set_updated_at();

-- A tasting's bottle must be one of the household's own, of the same vintage. SECURITY DEFINER so it can read
-- the bottle whatever the caller's policies say; the household match keeps it from ever leaking another's.
create function private.check_tasting() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if new.bottle_id is not null and not exists (
       select 1 from public.bottles b
        where b.id = new.bottle_id and b.household_id = new.household_id and b.vintage_id = new.vintage_id) then
    raise exception 'tasting_bottle_mismatch' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger tastings_check before insert on public.tastings
  for each row execute function private.check_tasting();

-- ---- Row level security -------------------------------------------------------------------------
alter table public.tastings enable row level security;

create policy tastings_select on public.tastings for select to authenticated
  using (household_id = any (((select private.my_household_ids()))::uuid[]));
-- You can only write your own, in a household you belong to, about a wine you can see.
create policy tastings_insert on public.tastings for insert to authenticated
  with check (user_id = auth.uid()
              and household_id = any (((select private.my_household_ids()))::uuid[])
              and exists (select 1 from public.wine_vintages v where v.id = vintage_id));
create policy tastings_update on public.tastings for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy tastings_delete on public.tastings for delete to authenticated
  using (user_id = auth.uid());

-- ---- Grants: clients never choose the author, the household, the wine or the bottle after the fact ----
grant select, delete on public.tastings to authenticated;
grant insert (household_id, vintage_id, bottle_id, score, descriptors, note, tasted_at) on public.tastings to authenticated;
grant update (score, descriptors, note, tasted_at) on public.tastings to authenticated;

grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- =====================================================================
-- 0011 bottle extras + wine insights
-- =====================================================================
-- bottle_extras: what only the household knows about one physical bottle — bought or a gift (and from whom),
-- and whether it is being kept for an occasion (what, and when: the app reminds you).
-- vintage_insights: what the AI could tell about a vintage (stored so it is never paid for twice), plus the
-- household's own idea of what it is worth now. Both are private to the household, like the cellar itself.

create table public.bottle_extras (
  bottle_id      uuid primary key references public.bottles on delete cascade,
  household_id   uuid not null references public.households on delete cascade,
  acquired_how   text check (acquired_how in ('bought', 'gift')),
  gift_from      text check (char_length(gift_from) <= 120),
  occasion_title text check (char_length(occasion_title) <= 120),
  occasion_on    date,
  updated_at     timestamptz not null default now(),
  -- a date without an occasion means nothing
  constraint bottle_extras_occasion_complete check (occasion_on is null or occasion_title is not null)
);
create index bottle_extras_household_idx on public.bottle_extras (household_id, occasion_on) where occasion_on is not null;

create trigger bottle_extras_updated before update on public.bottle_extras
  for each row execute function private.set_updated_at();
create trigger bottle_extras_household_immutable before update on public.bottle_extras
  for each row execute function private.forbid_change('household_id');
create trigger bottle_extras_bottle_immutable before update on public.bottle_extras
  for each row execute function private.forbid_change('bottle_id');

create table public.vintage_insights (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  vintage_id   uuid not null references public.wine_vintages on delete cascade,
  -- the AI's answer, already checked by the app (null = only the household's own value is stored)
  output       jsonb check (output is null or pg_column_size(output) < 8192),
  model        text check (char_length(model) <= 80),
  generated_at timestamptz,
  my_value_cents int check (my_value_cents between 0 and 10000000),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (household_id, vintage_id)
);

create trigger vintage_insights_updated before update on public.vintage_insights
  for each row execute function private.set_updated_at();
create trigger vintage_insights_household_immutable before update on public.vintage_insights
  for each row execute function private.forbid_change('household_id');
create trigger vintage_insights_vintage_immutable before update on public.vintage_insights
  for each row execute function private.forbid_change('vintage_id');

-- ---- Row level security -------------------------------------------------------------------------
alter table public.bottle_extras    enable row level security;
alter table public.vintage_insights enable row level security;

create policy bottle_extras_select on public.bottle_extras for select to authenticated
  using (household_id = any (((select private.my_household_ids()))::uuid[]));
-- the bottle must be this household's own
create policy bottle_extras_insert on public.bottle_extras for insert to authenticated
  with check (household_id = any (((select private.my_household_ids()))::uuid[])
              and exists (select 1 from public.bottles b where b.id = bottle_id and b.household_id = bottle_extras.household_id));
create policy bottle_extras_update on public.bottle_extras for update to authenticated
  using (household_id = any (((select private.my_household_ids()))::uuid[]))
  with check (household_id = any (((select private.my_household_ids()))::uuid[]));
create policy bottle_extras_delete on public.bottle_extras for delete to authenticated
  using (household_id = any (((select private.my_household_ids()))::uuid[]));

create policy vintage_insights_select on public.vintage_insights for select to authenticated
  using (household_id = any (((select private.my_household_ids()))::uuid[]));
-- the vintage must be one this household can see (its own wine, or the shared catalogue)
create policy vintage_insights_insert on public.vintage_insights for insert to authenticated
  with check (household_id = any (((select private.my_household_ids()))::uuid[])
              and exists (select 1 from public.wine_vintages v where v.id = vintage_id));
create policy vintage_insights_update on public.vintage_insights for update to authenticated
  using (household_id = any (((select private.my_household_ids()))::uuid[]))
  with check (household_id = any (((select private.my_household_ids()))::uuid[]));
create policy vintage_insights_delete on public.vintage_insights for delete to authenticated
  using (household_id = any (((select private.my_household_ids()))::uuid[]));

grant select, delete on public.bottle_extras, public.vintage_insights to authenticated;
grant insert (bottle_id, household_id, acquired_how, gift_from, occasion_title, occasion_on) on public.bottle_extras to authenticated;
grant update (acquired_how, gift_from, occasion_title, occasion_on) on public.bottle_extras to authenticated;
grant insert (household_id, vintage_id, output, model, generated_at, my_value_cents) on public.vintage_insights to authenticated;
grant update (output, model, generated_at, my_value_cents) on public.vintage_insights to authenticated;

grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;

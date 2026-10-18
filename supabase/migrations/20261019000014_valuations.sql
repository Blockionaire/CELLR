-- =====================================================================
-- 0014 valuations: what a bottle is worth, over time, and where that comes from
-- =====================================================================
-- Each time the AI looks up what one bottle of a vintage sells for, the answer is kept as a new row: the range,
-- a sentence on what it rests on, and the web pages it came from. Nothing is overwritten, so the cellar's value
-- can be shown over time. The app allows a new lookup at most once a month per vintage.
-- Private to the household, like the cellar itself.

create table public.vintage_valuations (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  vintage_id   uuid not null references public.wine_vintages on delete cascade,
  low_cents    int  not null check (low_cents between 1 and 100000000),
  high_cents   int  not null check (high_cents between 1 and 100000000),
  currency     text not null check (currency ~ '^[A-Z]{3}$'),
  basis        text not null default '' check (char_length(basis) <= 300),
  -- [{ "name": "...", "url": "https://..." }], at most a handful
  sources      jsonb not null default '[]'::jsonb
               check (jsonb_typeof(sources) = 'array' and pg_column_size(sources) < 4096),
  model        text check (char_length(model) <= 80),
  valued_at    timestamptz not null default now(),
  constraint vintage_valuations_range check (low_cents <= high_cents)
);
create index vintage_valuations_lookup_idx on public.vintage_valuations (household_id, vintage_id, valued_at desc);

-- The values the AI gave inside a wine profile so far become the first entry of each history (no sources then).
insert into public.vintage_valuations (household_id, vintage_id, low_cents, high_cents, currency, basis, model, valued_at)
select i.household_id, i.vintage_id,
       (i.output -> 'value' ->> 'lowCents')::numeric::int,
       (i.output -> 'value' ->> 'highCents')::numeric::int,
       i.output -> 'value' ->> 'currency',
       left(coalesce(i.output -> 'value' ->> 'basis', ''), 300),
       i.model,
       coalesce(i.generated_at, i.created_at)
  from public.vintage_insights i
 where jsonb_typeof(i.output -> 'value') = 'object'
   and (i.output -> 'value' ->> 'lowCents')::numeric::int between 1 and 100000000
   and (i.output -> 'value' ->> 'highCents')::numeric::int between (i.output -> 'value' ->> 'lowCents')::numeric::int and 100000000
   and (i.output -> 'value' ->> 'currency') ~ '^[A-Z]{3}$';

-- ---- Row level security -------------------------------------------------------------------------
alter table public.vintage_valuations enable row level security;

create policy vintage_valuations_select on public.vintage_valuations for select to authenticated
  using (household_id = any (((select private.my_household_ids()))::uuid[]));
-- the vintage must be one this household can see (its own wine, or the shared catalogue)
create policy vintage_valuations_insert on public.vintage_valuations for insert to authenticated
  with check (household_id = any (((select private.my_household_ids()))::uuid[])
              and exists (select 1 from public.wine_vintages v where v.id = vintage_id));

-- History is not rewritten: no update, no delete (it goes with the household or the vintage).
grant select on public.vintage_valuations to authenticated;
grant insert (household_id, vintage_id, low_cents, high_cents, currency, basis, sources, model) on public.vintage_valuations to authenticated;

grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;

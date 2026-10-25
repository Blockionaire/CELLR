-- A person's own taste preferences, as they told CELLR (onboarding or later): which wines they mostly drink, and
-- where they like body, tannin, sweetness and acidity on the app's 1–5 scales. Every answer is optional (NULL =
-- not said). Private to the person: no household or friend can read it. Trends computed from ratings are never
-- stored here; they are worked out from the tastings each time.
create table public.taste_preferences (
  user_id    uuid primary key default auth.uid() references auth.users on delete cascade,
  wine_focus text check (wine_focus in ('red', 'white_rose', 'both')),
  body       smallint check (body between 1 and 5),
  tannin     smallint check (tannin between 1 and 5),
  sweetness  smallint check (sweetness between 1 and 5),
  acidity    smallint check (acidity between 1 and 5),
  -- Answered or skipped the short onboarding (so it is not offered again unasked).
  onboarded_at timestamptz,
  updated_at timestamptz not null default now()
);

create trigger taste_preferences_updated before update on public.taste_preferences
  for each row execute function private.set_updated_at();

alter table public.taste_preferences enable row level security;
create policy taste_preferences_select on public.taste_preferences for select to authenticated
  using (user_id = (select auth.uid()));
create policy taste_preferences_insert on public.taste_preferences for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy taste_preferences_update on public.taste_preferences for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy taste_preferences_delete on public.taste_preferences for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.taste_preferences from public, anon;
grant select, insert, update, delete on public.taste_preferences to authenticated;
grant all on public.taste_preferences to service_role;

-- Private beta feedback: what a signed-in person chose to tell us, nothing collected behind their back.
--
-- - Only a signed-in person can add feedback, and only as themselves (user_id is set from auth.uid() and checked).
-- - Nobody reads it through the app: not the person who wrote it, not other members of a household, not visitors.
--   There is no household link at all. Only the internal admin dashboard reads it, through the service-role-only
--   function below, after its own admin check (CELLR_ADMIN_USER_IDS).
-- - Nothing is ever changed or deleted through the app; deleting the account deletes the feedback (cascade).
-- - No IP address, no full user agent, no URL query, no diagnostics: only the fields below, all bounded.

create table public.beta_feedback (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  category   text not null check (category in ('bug', 'confusing', 'idea', 'other')),
  message    text not null check (char_length(btrim(message)) between 10 and 2000),
  -- Where it happened, in the person's own words or the screen they picked (optional).
  location   text check (location is null or char_length(location) between 1 and 120),
  -- A coarse device line the person chose to include ("iPhone · Safari · app on home screen"), optional.
  device     text check (device is null or char_length(device) between 1 and 160),
  created_at timestamptz not null default now()
);

create index beta_feedback_created_idx on public.beta_feedback (created_at desc, id);

alter table public.beta_feedback enable row level security;

create policy beta_feedback_insert_own on public.beta_feedback
  for insert to authenticated
  with check (user_id = (select auth.uid()));

revoke all on public.beta_feedback from public, anon, authenticated;
grant insert (category, message, location, device) on public.beta_feedback to authenticated;
grant all on public.beta_feedback to service_role;

-- ---- The admin inbox: one bounded page, newest first, with counts per category ------------------------------
create function public.admin_beta_feedback(p_category text, p_limit int, p_offset int)
  returns jsonb
  language plpgsql stable security definer set search_path = '' as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 or p_offset is null or p_offset < 0 or p_offset > 1000000
     or (p_category is not null and p_category not in ('bug', 'confusing', 'idea', 'other')) then
    raise exception 'invalid_arguments' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'total', (select count(*) from public.beta_feedback f
               where p_category is null or f.category = p_category),
    'counts', (select coalesce(jsonb_object_agg(c.category, c.n), '{}'::jsonb)
                 from (select f.category, count(*) as n from public.beta_feedback f group by f.category) c),
    'rows', (select coalesce(jsonb_agg(jsonb_build_object(
                       'id', r.id, 'category', r.category, 'message', r.message,
                       'location', r.location, 'device', r.device, 'createdAt', r.created_at)
                     order by r.created_at desc, r.id), '[]'::jsonb)
               from (select f.* from public.beta_feedback f
                      where p_category is null or f.category = p_category
                      order by f.created_at desc, f.id
                      limit p_limit offset p_offset) r)
  );
end $$;

revoke all on function public.admin_beta_feedback(text, int, int) from public, anon, authenticated;
grant execute on function public.admin_beta_feedback(text, int, int) to service_role;

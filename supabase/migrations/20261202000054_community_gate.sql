-- The CELLR community stays CLOSED in the database until its owner opens it (Ratings sprint, activation order).
--
-- Why: the app's routes answer 404 without the `community_reviews` switch, but once 20261130000052 is applied its
-- functions are callable through the API (PostgREST) by any signed-in person, switch or no switch. Publishing and
-- reporting are therefore refused here until the owner opens the community with a logged step, after moderation is
-- operational (docs/sprints/ratings/ACTIVATION.md). Reading stays possible but has nothing to show while closed.
-- External ratings need no gate of their own: they are shown only for a provider in the public scope.
--
-- Additive: one settings row, one log, two triggers, two functions. Closing again stops new reviews and new reports at
-- once; existing reviews are kept (their authors can still edit or remove them, and moderation goes on).
--
-- Applying 0052 and this migration in one `db push` leaves a window of seconds in which 0052's functions exist
-- ungated; nothing links to them, and ACTIVATION.md step 6 checks that no review or report was made.

create table private.community_settings (
  id          boolean primary key default true check (id),
  open        boolean not null default false,
  changed_at  timestamptz not null default now(),
  changed_by  text not null default 'migration 20261202000054'
);
insert into private.community_settings (id) values (true) on conflict do nothing;
alter table private.community_settings enable row level security;
revoke all on private.community_settings from public, anon, authenticated;

create table public.community_settings_log (
  id         bigint generated always as identity primary key,
  open       boolean not null,
  reason     text not null check (char_length(btrim(reason)) between 3 and 300),
  actor      text not null check (char_length(btrim(actor)) between 1 and 120),
  created_at timestamptz not null default now()
);
alter table public.community_settings_log enable row level security;
revoke all on public.community_settings_log from public, anon, authenticated;
grant select on public.community_settings_log to service_role;

-- Writes by people are refused while closed: a person is whoever auth.uid() names, which reads the JSON claims
-- PostgREST sets (`request.jwt.claims`; current PostgREST no longer sets `request.jwt.claim.sub`). The service role
-- and the database owner (moderation, tests, migrations) carry no person.
create function private.community_must_be_open() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null
     and not coalesce((select open from private.community_settings where id), false) then
    raise exception 'the CELLR community is not open yet' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.community_must_be_open() from public, anon, authenticated;
create trigger community_reviews_open before insert on public.community_reviews
  for each row execute function private.community_must_be_open();
create trigger community_review_reports_open before insert on public.community_review_reports
  for each row execute function private.community_must_be_open();

-- The owner's switch (service role only: the SQL editor or the admin server with its own admin check), logged.
create function public.admin_community_open(p_open boolean, p_reason text, p_actor text) returns jsonb
  language plpgsql security definer set search_path = '' as $$
begin
  if p_open is null or nullif(btrim(coalesce(p_reason, '')), '') is null
     or nullif(btrim(coalesce(p_actor, '')), '') is null then
    raise exception 'open, a reason and an actor are required' using errcode = '22023';
  end if;
  update private.community_settings set open = p_open, changed_at = now(), changed_by = left(btrim(p_actor), 120)
   where id;
  insert into public.community_settings_log (open, reason, actor) values (p_open, btrim(p_reason), btrim(p_actor));
  return jsonb_build_object('open', p_open);
end $$;
revoke all on function public.admin_community_open(boolean, text, text) from public, anon, authenticated;
grant execute on function public.admin_community_open(boolean, text, text) to service_role;

-- Whether it is open (for the app and for checks; no secret).
create function public.community_is_open() returns boolean
  language sql stable security definer set search_path = '' as $$
  select coalesce((select open from private.community_settings where id), false)
$$;
revoke all on function public.community_is_open() from public, anon;
grant execute on function public.community_is_open() to authenticated, service_role;

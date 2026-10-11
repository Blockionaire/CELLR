-- =====================================================================
-- 0007 private-beta sign-up gate
-- =====================================================================
-- The Supabase publishable key is public by design, so anyone can call Supabase Auth directly; an
-- allow-list enforced only in the Next.js API would be decoration. The authoritative gate is here:
-- a trigger on auth.users that refuses NEW accounts whose email is not on the list.
--
--   * EMPTY list  = sign-up is open (the default; nothing to configure).
--   * Entries are full emails ('a@b.com') or whole domains ('@b.com'), lower-case.
--   * Existing users are never affected — the trigger only fires on INSERT.
--
-- Manage the list in the SQL editor (or with the service role):
--   insert into private.allowed_signups (entry, note) values ('friend@example.com', 'Merel');
--   insert into private.allowed_signups (entry) values ('@family.nl');

create table private.allowed_signups (
  entry      text primary key check (entry = lower(btrim(entry)) and entry ~ '^(@[^@\s]+|[^@\s]+@[^@\s]+)$'),
  note       text,
  created_at timestamptz not null default now()
);
alter table private.allowed_signups enable row level security;   -- no policies: definer functions only

create function private.is_signup_allowed(p_email text) returns boolean
  language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from private.allowed_signups)
      or exists (select 1 from private.allowed_signups a
                 where a.entry = lower(btrim(p_email))
                    or (left(a.entry, 1) = '@' and a.entry = '@' || split_part(lower(btrim(p_email)), '@', 2)))
$$;

create function private.enforce_signup_allowlist() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_signup_allowed(new.email) then
    raise exception 'signup_closed' using errcode = 'P0001';
  end if;
  return new;
end $$;
-- Named so it fires before the profile-creating trigger (alphabetical order).
create trigger a_enforce_signup_allowlist before insert on auth.users
  for each row execute function private.enforce_signup_allowlist();

-- For the app's friendly pre-check ("this email isn't on the list yet"). Returns true for anyone
-- already registered, so a person removed from the list can still sign in. Service role only: if anon
-- could call this, it would let strangers enumerate the guest list.
create function public.check_signup_allowed(p_email text) returns boolean
  language sql stable security definer set search_path = '' as $$
  select private.is_signup_allowed(p_email)
      or exists (select 1 from auth.users u where lower(u.email) = lower(btrim(p_email)))
$$;
revoke execute on function public.check_signup_allowed(text) from public, anon, authenticated;
grant  execute on function public.check_signup_allowed(text) to service_role;

grant all on private.allowed_signups to service_role;

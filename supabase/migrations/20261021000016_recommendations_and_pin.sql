-- =====================================================================
-- 0016 recommendations and sign-in PIN
-- =====================================================================
-- 1. A wine recommended to a friend: what it is (copied at the moment it is sent, so it stays readable whatever
--    happens to the sender's cellar), an optional note, and whether the friend has seen it or put it on their
--    wishlist. Only friends can recommend to each other, and only wines the sender can see.
-- 2. An optional 6-digit PIN to sign back in without an email code. Only its hash is kept, and only the server
--    (service role) ever reads or writes it. Five wrong tries in a row and the PIN is switched off.

-- ---- Recommendations ------------------------------------------------------------------------------------
create table public.wine_recommendations (
  id           uuid primary key default gen_random_uuid(),
  sender       uuid not null references auth.users on delete cascade,
  recipient    uuid not null references auth.users on delete cascade,
  producer     text not null check (char_length(producer) between 1 and 120),
  wine         text not null check (char_length(wine) between 1 and 160),
  year         smallint check (year between 1800 and 2100),
  wine_type    public.wine_type not null,
  region       text check (char_length(region) <= 120),
  country_code text check (country_code ~ '^[A-Z]{2}$'),
  note         text check (char_length(note) <= 500),
  created_at   timestamptz not null default now(),
  seen_at      timestamptz,
  saved_at     timestamptz,
  constraint wine_recommendations_not_self check (sender <> recipient)
);
create index wine_recommendations_recipient_idx on public.wine_recommendations (recipient, created_at desc);
create index wine_recommendations_sender_idx on public.wine_recommendations (sender, created_at desc);

alter table public.wine_recommendations enable row level security;

-- Sender and recipient both see it; either can delete it (withdraw / dismiss). Only the recipient marks it.
create policy wine_recommendations_select on public.wine_recommendations for select to authenticated
  using (recipient = (select auth.uid()) or sender = (select auth.uid()));
create policy wine_recommendations_delete on public.wine_recommendations for delete to authenticated
  using (recipient = (select auth.uid()) or sender = (select auth.uid()));
create policy wine_recommendations_update on public.wine_recommendations for update to authenticated
  using (recipient = (select auth.uid())) with check (recipient = (select auth.uid()));

grant select, delete on public.wine_recommendations to authenticated;
grant update (seen_at, saved_at) on public.wine_recommendations to authenticated;
-- No insert grant: recommendations are made through recommend_wine() below.

-- Recommend one of your wines (a vintage you can see) to a friend, with an optional note. Returns its id.
create function public.recommend_wine(p_friend uuid, p_vintage uuid, p_note text default null) returns uuid
  language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); r record; new_id uuid;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if p_friend is null or not private.are_friends(uid, p_friend) then raise exception 'not_found'; end if;
  select pr.name as producer, w.name as wine, v.year, w.wine_type, w.region, w.country_code into r
    from public.wine_vintages v
    join public.wines w on w.id = v.wine_id
    join public.producers pr on pr.id = w.producer_id
   where v.id = p_vintage
     and (w.owner_household_id is null or w.owner_household_id = any (private.my_household_ids()));
  if not found then raise exception 'not_found'; end if;
  if not private.consume_rate_limit(uid, 'recommend_wine', 40, interval '1 hour') then
    raise exception 'rate_limited' using errcode = '54000';
  end if;
  insert into public.wine_recommendations
    (sender, recipient, producer, wine, year, wine_type, region, country_code, note)
  values (uid, p_friend, r.producer, r.wine, r.year, r.wine_type, r.region, r.country_code,
          nullif(left(btrim(coalesce(p_note, '')), 500), ''))
  returning id into new_id;
  return new_id;
end $$;

-- Wines recommended to you by people who are still your friends, newest first, with who sent them.
create function public.my_recommendations()
  returns table (id uuid, sender uuid, handle text, display_name text, friend_code text,
                 producer text, wine text, year smallint, wine_type text, region text, country_code text,
                 note text, created_at timestamptz, seen_at timestamptz, saved_at timestamptz)
  language sql stable security definer set search_path = '' as $$
  select r.id, r.sender, p.handle, p.display_name, p.friend_code,
         r.producer, r.wine, r.year, r.wine_type::text, r.region, r.country_code,
         r.note, r.created_at, r.seen_at, r.saved_at
    from public.wine_recommendations r
    join public.profiles p on p.id = r.sender
   where r.recipient = auth.uid()
     and private.are_friends(r.recipient, r.sender)
   order by r.created_at desc
   limit 200;
$$;

revoke all on function public.recommend_wine(uuid, uuid, text), public.my_recommendations() from public, anon;
grant execute on function public.recommend_wine(uuid, uuid, text), public.my_recommendations() to authenticated;

-- ---- Sign-in PIN ------------------------------------------------------------------------------------------
create table public.account_pins (
  user_id    uuid primary key references auth.users on delete cascade,
  pin_hash   text not null check (char_length(pin_hash) between 20 and 300),
  failed     int  not null default 0 check (failed >= 0),
  updated_at timestamptz not null default now()
);
alter table public.account_pins enable row level security;
-- No policies and no grants for signed-in people or visitors: only the server, with the service role.
revoke all on public.account_pins from public, anon, authenticated;

-- The PIN of the account with this email, for the server to check. Service role only.
create function public.pin_for_email(p_email text)
  returns table (user_id uuid, email text, pin_hash text)
  language sql stable security definer set search_path = '' as $$
  select p.user_id, u.email::text, p.pin_hash
    from public.account_pins p
    join auth.users u on u.id = p.user_id
   where lower(u.email) = lower(btrim(p_email))
   limit 1;
$$;

-- A wrong PIN: count it, and switch the PIN off at the fifth one in a row. Returns the count. Service role only.
create function public.pin_failed(p_user uuid) returns int
  language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.account_pins set failed = failed + 1 where user_id = p_user returning failed into n;
  if n >= 5 then delete from public.account_pins where user_id = p_user; end if;
  return coalesce(n, 0);
end $$;

revoke all on function public.pin_for_email(text), public.pin_failed(uuid) from public, anon, authenticated;
grant execute on function public.pin_for_email(text), public.pin_failed(uuid) to service_role;

grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;

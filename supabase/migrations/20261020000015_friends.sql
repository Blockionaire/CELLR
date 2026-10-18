-- =====================================================================
-- 0015 friends: an account name, friend requests, and what you share with whom
-- =====================================================================
-- Everyone gets a short friend code; an account name (@name) can be chosen. People find each other only by an
-- exact name or code (no browsing). A request, once accepted, makes two people friends. Each person decides, for
-- their ratings, their taste profile and their cellar, whether all friends see it, nobody, or only friends they
-- pick. Friends' data is read only through the functions below, which check all of that every time.

-- ---- Account name and friend code -----------------------------------------------------------------
create function private.new_friend_code() returns text
  language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';  -- no 0/O, 1/I/L: easy to read out
  b bytea := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
  code text := '';
  i int;
begin
  -- bytes 6 and 8 of a v4 uuid carry its version and variant; the others are random
  foreach i in array array[0, 1, 2, 3, 4, 5, 10, 11] loop
    code := code || substr(alphabet, (get_byte(b, i) % 31) + 1, 1);
  end loop;
  return code;
end $$;

alter table public.profiles
  add column handle text unique
    check (handle ~ '^[a-z0-9][a-z0-9_.]{2,19}$' and handle !~ '\.\.'),
  add column friend_code text unique default private.new_friend_code();
update public.profiles set friend_code = private.new_friend_code() where friend_code is null;
alter table public.profiles alter column friend_code set not null;

grant update (handle) on public.profiles to authenticated;

-- ---- Friendships -----------------------------------------------------------------------------------
create table public.friendships (
  id           uuid primary key default gen_random_uuid(),
  requester    uuid not null references public.profiles on delete cascade,
  addressee    uuid not null references public.profiles on delete cascade,
  status       text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at   timestamptz not null default now(),
  accepted_at  timestamptz,
  constraint friendships_not_self check (requester <> addressee)
);
-- one row per pair, whoever asked
create unique index friendships_pair on public.friendships (least(requester, addressee), greatest(requester, addressee));
create index friendships_addressee_idx on public.friendships (addressee, status);

-- ---- What each person shares ---------------------------------------------------------------------
create table public.sharing_settings (
  user_id    uuid primary key default auth.uid() references public.profiles on delete cascade,
  ratings    text not null default 'friends' check (ratings in ('friends', 'none', 'chosen')),
  taste      text not null default 'friends' check (taste in ('friends', 'none', 'chosen')),
  cellar     text not null default 'none'    check (cellar in ('friends', 'none', 'chosen')),
  updated_at timestamptz not null default now()
);
create trigger sharing_settings_updated before update on public.sharing_settings
  for each row execute function private.set_updated_at();

-- with 'chosen': exactly these friends
create table public.sharing_picks (
  owner  uuid not null default auth.uid() references public.profiles on delete cascade,
  friend uuid not null references public.profiles on delete cascade,
  item   text not null check (item in ('ratings', 'taste', 'cellar')),
  primary key (owner, friend, item),
  constraint sharing_picks_not_self check (owner <> friend)
);

-- ---- The rules -------------------------------------------------------------------------------------
create function private.are_friends(p_a uuid, p_b uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.friendships f
                  where least(f.requester, f.addressee) = least(p_a, p_b)
                    and greatest(f.requester, f.addressee) = greatest(p_a, p_b)
                    and f.status = 'accepted');
$$;

-- May `viewer` see `owner`'s ratings / taste / cellar? Yourself always; a friend as the owner decided.
create function private.can_see(p_viewer uuid, p_owner uuid, p_what text) returns boolean
  language sql stable security definer set search_path = '' as $$
  select p_viewer = p_owner or (
    private.are_friends(p_viewer, p_owner) and
    case coalesce((select case p_what when 'ratings' then s.ratings when 'taste' then s.taste else s.cellar end
                     from public.sharing_settings s where s.user_id = p_owner),
                  case p_what when 'cellar' then 'none' else 'friends' end)
      when 'friends' then true
      when 'chosen' then exists (select 1 from public.sharing_picks sp
                                  where sp.owner = p_owner and sp.friend = p_viewer and sp.item = p_what)
      else false
    end);
$$;

-- The household a person's cellar is: the one they have open, as long as they are still in it.
create function private.cellar_of(p_person uuid) returns uuid
  language sql stable security definer set search_path = '' as $$
  select p.active_household_id from public.profiles p
   where p.id = p_person
     and exists (select 1 from public.household_members m
                  where m.household_id = p.active_household_id and m.user_id = p_person);
$$;

-- ---- Row level security ----------------------------------------------------------------------------
alter table public.friendships      enable row level security;
alter table public.sharing_settings enable row level security;
alter table public.sharing_picks    enable row level security;

create policy friendships_select on public.friendships for select to authenticated
  using (requester = (select auth.uid()) or addressee = (select auth.uid()));
grant select on public.friendships to authenticated;
-- (written only through the functions below)

create policy sharing_settings_own on public.sharing_settings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, delete on public.sharing_settings to authenticated;
grant insert (ratings, taste, cellar) on public.sharing_settings to authenticated;
grant update (ratings, taste, cellar) on public.sharing_settings to authenticated;

create policy sharing_picks_select on public.sharing_picks for select to authenticated
  using (owner = (select auth.uid()));
create policy sharing_picks_insert on public.sharing_picks for insert to authenticated
  with check (owner = (select auth.uid()) and private.are_friends(owner, friend));
create policy sharing_picks_delete on public.sharing_picks for delete to authenticated
  using (owner = (select auth.uid()));
grant select, delete on public.sharing_picks to authenticated;
grant insert (friend, item) on public.sharing_picks to authenticated;

grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- ---- Finding people and asking them ----------------------------------------------------------------
-- Only an exact account name or friend code finds someone: no browsing, no guessing in bulk.
create function public.find_person(p_query text)
  returns table (id uuid, handle text, display_name text, friend_code text, relation text)
  language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); q text := lower(btrim(coalesce(p_query, '')));
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if not private.consume_rate_limit(uid, 'find_person', 60, interval '1 hour') then
    raise exception 'rate_limited' using errcode = '54000';
  end if;
  q := regexp_replace(q, '^@', '');
  return query
    select p.id, p.handle, p.display_name, p.friend_code,
           coalesce((select case when f.status = 'accepted' then 'friends'
                                 when f.requester = uid then 'requested' else 'incoming' end
                       from public.friendships f
                      where least(f.requester, f.addressee) = least(uid, p.id)
                        and greatest(f.requester, f.addressee) = greatest(uid, p.id)), 'none')
      from public.profiles p
     where p.id <> uid
       and (p.handle = q or p.friend_code = upper(regexp_replace(q, '[^a-z0-9]', '', 'g')))
     limit 1;
end $$;

-- Returns 'sent', or 'accepted' when they had already asked you, or 'already' when you are friends or asked.
create function public.send_friend_request(p_user uuid) returns text
  language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); f public.friendships;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if p_user is null or p_user = uid or not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'not_found';
  end if;
  if not private.consume_rate_limit(uid, 'friend_request', 30, interval '1 hour') then
    raise exception 'rate_limited' using errcode = '54000';
  end if;
  select * into f from public.friendships
   where least(requester, addressee) = least(uid, p_user)
     and greatest(requester, addressee) = greatest(uid, p_user)
   for update;
  if not found then
    insert into public.friendships (requester, addressee) values (uid, p_user);
    return 'sent';
  end if;
  if f.status = 'pending' and f.addressee = uid then
    update public.friendships set status = 'accepted', accepted_at = now() where id = f.id;
    return 'accepted';
  end if;
  return 'already';
end $$;

-- Accept or decline a request made to you. Declining simply removes it.
create function public.respond_friend_request(p_id uuid, p_accept boolean) returns boolean
  language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); n int;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if p_accept then
    update public.friendships set status = 'accepted', accepted_at = now()
     where id = p_id and addressee = uid and status = 'pending';
  else
    delete from public.friendships where id = p_id and addressee = uid and status = 'pending';
  end if;
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- Withdraw a request, or stop being friends. What either of you picked to share with the other goes too.
create function public.remove_friend(p_user uuid) returns boolean
  language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); n int;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  delete from public.friendships
   where least(requester, addressee) = least(uid, p_user)
     and greatest(requester, addressee) = greatest(uid, p_user);
  get diagnostics n = row_count;
  delete from public.sharing_picks where (owner = uid and friend = p_user) or (owner = p_user and friend = uid);
  return n > 0;
end $$;

-- Your friends and requests, with the names that go with them (people outside your household are otherwise
-- not readable).
create function public.my_friends()
  returns table (friendship_id uuid, user_id uuid, handle text, display_name text, friend_code text,
                 status text, direction text, since timestamptz)
  language sql stable security definer set search_path = '' as $$
  select f.id, p.id, p.handle, p.display_name, p.friend_code, f.status,
         case when f.requester = auth.uid() then 'outgoing' else 'incoming' end,
         coalesce(f.accepted_at, f.created_at)
    from public.friendships f
    join public.profiles p on p.id = case when f.requester = auth.uid() then f.addressee else f.requester end
   where auth.uid() in (f.requester, f.addressee)
   order by f.status, coalesce(f.accepted_at, f.created_at) desc;
$$;

-- ---- What a friend shares ------------------------------------------------------------------------
-- Which of the three a friend lets you see (all false for someone who is not a friend).
create function public.friend_access(p_friend uuid)
  returns table (ratings boolean, taste boolean, cellar boolean)
  language sql stable security definer set search_path = '' as $$
  select auth.uid() <> p_friend and private.can_see(auth.uid(), p_friend, 'ratings'),
         auth.uid() <> p_friend and private.can_see(auth.uid(), p_friend, 'taste'),
         auth.uid() <> p_friend and private.can_see(auth.uid(), p_friend, 'cellar');
$$;

-- Their ratings: every tasting they wrote, newest first.
create function public.friend_ratings(p_friend uuid)
  returns table (tasting_id uuid, producer text, wine text, year smallint, wine_type text, region text,
                 country_code text, score smallint, descriptors text[], note text, tasted_at timestamptz)
  language sql stable security definer set search_path = '' as $$
  select t.id, pr.name, w.name, v.year, w.wine_type::text, w.region, w.country_code,
         t.score, t.descriptors, t.note, t.tasted_at
    from public.tastings t
    join public.wine_vintages v on v.id = t.vintage_id
    join public.wines w on w.id = v.wine_id
    join public.producers pr on pr.id = w.producer_id
   where t.user_id = p_friend
     and private.can_see(auth.uid(), p_friend, 'ratings')
   order by t.tasted_at desc
   limit 500;
$$;

-- Their taste profile: only totals (which kinds and regions they like, how wines they love tend to feel,
-- the words they use most, their favourites) — never a single rating unless ratings are shared too.
create function public.friend_taste(p_friend uuid) returns jsonb
  language sql stable security definer set search_path = '' as $$
  with mine as (
    select t.score, t.descriptors, w.wine_type::text as type, w.region, w.country_code,
           pr.name as producer, w.name as wine, v.year, i.output -> 'structure' as structure
      from public.tastings t
      join public.wine_vintages v on v.id = t.vintage_id
      join public.wines w on w.id = v.wine_id
      join public.producers pr on pr.id = w.producer_id
      left join public.vintage_insights i on i.household_id = t.household_id and i.vintage_id = t.vintage_id
     where t.user_id = p_friend and private.can_see(auth.uid(), p_friend, 'taste')
  ), scored as (select * from mine where score is not null)
  select case when not private.can_see(auth.uid(), p_friend, 'taste') then null else jsonb_build_object(
    'tastings', (select count(*) from mine),
    'average', (select round(avg(score)::numeric / 2, 1) from scored),
    'byType', coalesce((select jsonb_agg(jsonb_build_object('type', type, 'count', n, 'average', a) order by n desc)
                          from (select type, count(*) n, round(avg(score)::numeric / 2, 1) a from mine group by type) x), '[]'),
    'regions', coalesce((select jsonb_agg(jsonb_build_object('region', region, 'count', n, 'average', a) order by a desc nulls last, n desc)
                           from (select region, count(*) n, round(avg(score)::numeric / 2, 1) a from mine
                                  where region is not null group by region order by n desc limit 6) x), '[]'),
    'words', coalesce((select jsonb_agg(jsonb_build_object('word', d, 'count', n) order by n desc)
                         from (select d, count(*) n from mine, unnest(descriptors) d group by d order by n desc limit 10) x), '[]'),
    -- how the wines they rated well (4 stars or more) tend to feel, from the wines' profiles
    'structure', (select jsonb_build_object(
        'body', round(avg((structure ->> 'body')::numeric), 1),
        'tannin', round(avg((structure ->> 'tannin')::numeric), 1),
        'sweetness', round(avg((structure ->> 'sweetness')::numeric), 1),
        'acidity', round(avg((structure ->> 'acidity')::numeric), 1))
      from scored where score >= 8 and jsonb_typeof(structure) = 'object'),
    'favourites', coalesce((select jsonb_agg(jsonb_build_object('producer', producer, 'wine', wine, 'year', year, 'type', type, 'stars', round(s::numeric / 2, 1)) order by s desc)
                              from (select producer, wine, year, type, max(score) s from scored
                                     group by producer, wine, year, type order by max(score) desc limit 5) x), '[]')
  ) end;
$$;

-- Their cellar: the wines in it, with how many bottles and where.
create function public.friend_cellar(p_friend uuid)
  returns table (producer text, wine text, year smallint, wine_type text, region text, country_code text,
                 bottles bigint, places text[])
  language sql stable security definer set search_path = '' as $$
  select pr.name, w.name, v.year, w.wine_type::text, w.region, w.country_code, count(*),
         array_remove(array_agg(distinct l.label), null)
    from public.bottles b
    join public.wine_vintages v on v.id = b.vintage_id
    join public.wines w on w.id = v.wine_id
    join public.producers pr on pr.id = w.producer_id
    left join public.cellar_locations l on l.id = b.location_id
   where b.household_id = private.cellar_of(p_friend)
     and b.status = 'in_cellar'
     and private.can_see(auth.uid(), p_friend, 'cellar')
   group by pr.name, w.name, v.year, w.wine_type, w.region, w.country_code
   order by count(*) desc, pr.name, w.name
   limit 1000;
$$;

-- Their racks: each storage place, and which kind of wine lies in which spot.
create function public.friend_racks(p_friend uuid) returns jsonb
  language sql stable security definer set search_path = '' as $$
  select case when not private.can_see(auth.uid(), p_friend, 'cellar') then null else coalesce((
    select jsonb_agg(jsonb_build_object(
             'label', l.label, 'kind', l.kind, 'rows', l.grid_rows, 'cols', l.grid_cols,
             'bottles', coalesce((select jsonb_agg(jsonb_build_object(
                                    'row', b.loc_row, 'col', b.loc_col, 'type', w.wine_type,
                                    'producer', pr.name, 'wine', w.name, 'year', v.year))
                                    from public.bottles b
                                    join public.wine_vintages v on v.id = b.vintage_id
                                    join public.wines w on w.id = v.wine_id
                                    join public.producers pr on pr.id = w.producer_id
                                   where b.location_id = l.id and b.status = 'in_cellar'), '[]'))
             order by l.sort_order, l.label)
      from public.cellar_locations l
     where l.household_id = private.cellar_of(p_friend)), '[]') end;
$$;

revoke all on function private.new_friend_code(), private.are_friends(uuid, uuid), private.can_see(uuid, uuid, text),
  private.cellar_of(uuid) from public;
revoke all on function public.find_person(text), public.send_friend_request(uuid), public.respond_friend_request(uuid, boolean),
  public.remove_friend(uuid), public.my_friends(), public.friend_access(uuid), public.friend_ratings(uuid),
  public.friend_taste(uuid), public.friend_cellar(uuid), public.friend_racks(uuid) from public, anon;
grant execute on function public.find_person(text), public.send_friend_request(uuid), public.respond_friend_request(uuid, boolean),
  public.remove_friend(uuid), public.my_friends(), public.friend_access(uuid), public.friend_ratings(uuid),
  public.friend_taste(uuid), public.friend_cellar(uuid), public.friend_racks(uuid) to authenticated;
grant execute on function private.are_friends(uuid, uuid) to authenticated;

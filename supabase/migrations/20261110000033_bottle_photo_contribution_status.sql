-- Bottle-photo contribution UX (Sprint T), on top of the bottle library (Sprint P) and its 1–3 photo contributions and
-- verified links (Sprint R). Additive; nothing existing is removed, every past submission and review stays as it is.
--
-- 1. One identity per wine for contributions: a catalogue wine is itself; a household's own wine is the catalogue wine
--    it is verifiably mapped to (the same mapping 2D artwork inheritance reads: wine_links, else an approved
--    candidate), otherwise itself. Vintages never matter.
-- 2. bottle_photo_status(wines): for the signed-in person, per wine they can see: published (a 2D picture is shown, its
--    own or inherited: nothing is needed), submitted (they have a pending, approved or used contribution of that
--    identity), rejected (their contributions were all rejected: new photos are welcome), eligible (none yet); and the
--    points the ledger actually holds for them for it. Only their own submissions count; nobody else's are revealed.
-- 3. A second ordinary contribution while one is active is refused in submit_bottle_photos itself (not only hidden),
--    under a per-person-and-wine lock so two requests at once cannot both pass. After a rejection a new one is
--    accepted. The one-time +10 ledger rule is unchanged (it never pays twice).
-- 4. bottle_photo_invite(household): the one wine Home may invite the person to picture: in that household's cellar,
--    no published or inherited picture, eligible and never rewarded, the most recently added first. None for 30 days
--    after the person dismisses the invitation (kept on their profile, so on every device).

-- ---- 1. Identity and published artwork --------------------------------------------------------------------------
create function private.bottle_photo_key(p_wine uuid) returns uuid
  language sql stable security definer set search_path = '' as $$
  select case when w.status = 'canonical' then w.id else coalesce(private.bottle_art_mapping(w.id), w.id) end
    from public.wines w where w.id = p_wine
$$;
revoke all on function private.bottle_photo_key(uuid) from public, anon, authenticated;

-- The same rule as wine_bottle_art_for: the wine's own published picture, or (a household's own wine) the one of the
-- catalogue wine it maps to.
create function private.bottle_art_published(p_wine uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.wines w
      join public.wine_bottle_art x on x.vintage_id is null and x.published_at is not null
       and (x.wine_id = w.id or (w.status = 'provisional' and x.wine_id = private.bottle_art_mapping(w.id)))
     where w.id = p_wine)
$$;
revoke all on function private.bottle_art_published(uuid) from public, anon, authenticated;

-- The person's own contributions, with the identity each is about now (a later verified link moves it with the wine).
create function private.my_bottle_photo_keys(p_user uuid)
  returns table (key uuid, status text, source_wine_id uuid, canonical_wine_id uuid)
  language sql stable security definer set search_path = '' as $$
  select coalesce(private.bottle_photo_key(s.source_wine_id), s.canonical_wine_id), s.status, s.source_wine_id,
         s.canonical_wine_id
    from public.bottle_photo_submissions s where s.user_id = p_user
$$;
revoke all on function private.my_bottle_photo_keys(uuid) from public, anon, authenticated;

-- ---- 2. The status, for the signed-in person ---------------------------------------------------------------------
create function public.bottle_photo_status(p_wine_ids uuid[])
  returns table (wine_id uuid, status text, points int)
  language sql stable security definer set search_path = '' as $$
  with w as (
    -- only wines the person can see: the catalogue's and their own households'
    select x.id, private.bottle_photo_key(x.id) as k from public.wines x
     where x.id = any (p_wine_ids[1:100])
       and (x.status = 'canonical' or x.owner_household_id = any (private.my_household_ids()))
  ),
  mine as (select * from private.my_bottle_photo_keys(auth.uid()))
  select w.id,
         case
           when private.bottle_art_published(w.id) then 'published'
           when exists (select 1 from mine m where (m.key = w.k or m.canonical_wine_id = w.k)
                                              and m.status in ('pending', 'approved', 'used')) then 'submitted'
           when exists (select 1 from mine m where (m.key = w.k or m.canonical_wine_id = w.k)
                                              and m.status = 'rejected') then 'rejected'
           else 'eligible' end,
         -- what the ledger holds for this person for this wine (the reward is once per person and wine)
         coalesce((select max(a.points) from public.account_points a
                    where a.user_id = auth.uid() and a.reason = 'bottle_photo'
                      and (a.ref_id in (w.id, w.k)
                           or a.ref_id in (select m.source_wine_id from mine m where m.key = w.k or m.canonical_wine_id = w.k)
                           or a.ref_id in (select m.canonical_wine_id from mine m where m.key = w.k))), 0)::int
    from w
$$;
revoke all on function public.bottle_photo_status(uuid[]) from public, anon;
grant execute on function public.bottle_photo_status(uuid[]) to authenticated;

-- ---- 3. One active contribution per person and wine --------------------------------------------------------------
-- Same as Sprint R (20261107000030), plus: the identity is locked for this person for the rest of the transaction, and
-- a contribution is refused ('already_contributed') while one of theirs for it is pending, approved or used.
create or replace function public.submit_bottle_photos(p_vintage_id uuid, p_photos jsonb, p_consent boolean)
  returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  v record;
  hid uuid;
  canon uuid;
  k uuid;
  sid uuid;
  ph jsonb;
  n int;
  i int := 0;
  earned int := 0;
  reward constant int := 10;
begin
  if me is null then raise exception 'not_found'; end if;
  if p_consent is not true then raise exception 'consent_required' using errcode = '22023'; end if;
  if p_photos is null or jsonb_typeof(p_photos) <> 'array' then raise exception 'bad_photos' using errcode = '22023'; end if;
  n := jsonb_array_length(p_photos);
  if n < 1 or n > 3 then raise exception 'bad_photos' using errcode = '22023'; end if;
  for ph in select * from jsonb_array_elements(p_photos) loop
    if coalesce(ph->>'path', '') not like me::text || '/%'
       or not exists (select 1 from storage.objects o where o.bucket_id = 'bottle-submissions' and o.name = ph->>'path')
       or (select count(*) from jsonb_array_elements(p_photos) x where x->>'path' = ph->>'path') > 1 then
      raise exception 'bad_path' using errcode = '22023';
    end if;
  end loop;
  select b.household_id into hid from public.bottles b
   where b.vintage_id = p_vintage_id and b.household_id = any (private.my_household_ids())
     and b.status in ('in_cellar', 'opened')
   order by (b.status = 'in_cellar') desc, b.created_at desc limit 1;
  if hid is null then raise exception 'not_found'; end if;
  select wv.id as vintage_id, wv.year, w.id as wine_id, w.name, w.wine_type, w.status, p.name as producer
    into v
    from public.wine_vintages wv join public.wines w on w.id = wv.wine_id join public.producers p on p.id = w.producer_id
   where wv.id = p_vintage_id;
  if not found then raise exception 'not_found'; end if;

  -- one active contribution per person and wine (any vintage): two requests at once wait for each other here
  k := private.bottle_photo_key(v.wine_id);
  perform pg_advisory_xact_lock(hashtextextended('bottle_photo:' || me::text || ':' || k::text, 0));
  if exists (select 1 from private.my_bottle_photo_keys(me) m
              where (m.key = k or m.canonical_wine_id = k) and m.status in ('pending', 'approved', 'used')) then
    raise exception 'already_contributed';
  end if;

  if (select count(*) from public.bottle_photo_submissions s
       where s.user_id = me and s.created_at > now() - interval '24 hours') >= 20 then
    raise exception 'rate_limited' using errcode = '54000';
  end if;
  canon := case when v.status = 'canonical' then v.wine_id end;

  insert into public.bottle_photo_submissions
    (user_id, household_id, source_wine_id, source_vintage_id, canonical_wine_id, producer_text, wine_text, wine_type,
     year, photo_path, width, height, consent_granted_at)
  values (me, hid, v.wine_id, v.vintage_id, canon, left(v.producer, 120), left(v.name, 160), v.wine_type, v.year,
          p_photos->0->>'path', (p_photos->0->>'width')::int, (p_photos->0->>'height')::int, now())
  returning id into sid;
  for ph in select * from jsonb_array_elements(p_photos) loop
    i := i + 1;
    insert into public.bottle_photo_images (submission_id, position, photo_path, width, height)
    values (sid, i, ph->>'path', (ph->>'width')::int, (ph->>'height')::int);
  end loop;

  insert into public.account_points (user_id, reason, ref_id, points)
  values (me, 'bottle_photo', coalesce(canon, v.wine_id), reward)
  on conflict on constraint account_points_once do nothing;
  if found then
    earned := reward;
    update public.bottle_photo_submissions set reward_points = reward, reward_granted_at = now() where id = sid;
  end if;
  return jsonb_build_object('id', sid, 'points', earned);
end $$;

-- ---- 4. Home's invitation ----------------------------------------------------------------------------------------
alter table public.profiles add column bottle_photo_invite_dismissed_at timestamptz;

create function public.bottle_photo_invite(p_household_id uuid)
  returns table (wine_id uuid, vintage_id uuid, producer text, name text, wine_type text, year int)
  language sql stable security definer set search_path = '' as $$
  with h as (
    select p_household_id as id where p_household_id = any (private.my_household_ids())
      and not exists (select 1 from public.profiles p where p.id = auth.uid()
                        and p.bottle_photo_invite_dismissed_at > now() - interval '30 days')
  ),
  owned as (
    -- the wines in this household's cellar, the most recently added first (at most 100 are looked at)
    select v.wine_id, max(b.created_at) as added from public.bottles b
      join public.wine_vintages v on v.id = b.vintage_id
      join h on h.id = b.household_id
     where b.status = 'in_cellar'
     group by v.wine_id
     order by max(b.created_at) desc
     limit 100
  ),
  st as (select * from public.bottle_photo_status((select array_agg(o.wine_id) from owned o)))
  select o.wine_id,
         (select b.vintage_id from public.bottles b join public.wine_vintages v on v.id = b.vintage_id
           where b.household_id = p_household_id and v.wine_id = o.wine_id and b.status = 'in_cellar'
           order by b.created_at desc limit 1),
         p.name, w.name, w.wine_type::text,
         (select v.year::int from public.bottles b join public.wine_vintages v on v.id = b.vintage_id
           where b.household_id = p_household_id and v.wine_id = o.wine_id and b.status = 'in_cellar'
           order by b.created_at desc limit 1)
    from owned o
    join st on st.wine_id = o.wine_id and st.status = 'eligible' and st.points = 0
    join public.wines w on w.id = o.wine_id
    join public.producers p on p.id = w.producer_id
   order by o.added desc
   limit 1
$$;
revoke all on function public.bottle_photo_invite(uuid) from public, anon;
grant execute on function public.bottle_photo_invite(uuid) to authenticated;

-- "Not now": no invitation on Home for 30 days, on every device.
create function public.dismiss_bottle_photo_invite() returns void
  language sql volatile security definer set search_path = '' as $$
  update public.profiles set bottle_photo_invite_dismissed_at = now() where id = auth.uid()
$$;
revoke all on function public.dismiss_bottle_photo_invite() from public, anon;
grant execute on function public.dismiss_bottle_photo_invite() to authenticated;

-- =====================================================================
-- 0048 The social sommelier: a friend's taste in my sommelier's answers, only when that friend allows it
-- =====================================================================
-- ADDITIVE: one new table, two new functions. Nothing that exists changes; no existing sharing setting is read as
-- consent for this.
--
-- WHY ITS OWN CONSENT. Sharing a taste profile with friends (sharing_settings.taste, on by default since 0015) lets
-- friends LOOK at it. Having it weighed in a friend's sommelier answers is another use of the same data, so it gets
-- its own switch, off for everyone until they turn it on. Both must hold: the friend shares their taste with me AND
-- allows the sommelier to use it. Turning either off, or ending the friendship, stops it at the next question:
-- nothing is cached, and the function below reads the settings every time it is called.
--
-- WHAT LEAVES THE DATABASE. For each name asked about: whether it is one of my accepted friends who allows this
-- (never whether an account exists, or a request is pending), and, only then, a handful of closed signals: the
-- kind of wine they said they mostly drink, where they said they like body, tannin, sweetness and acidity (1-5),
-- which kinds and regions their own ratings favour (at least three different wines each, as the taste profile
-- itself requires), and how the wines they rate highly tend to feel. No wine, no producer, no note, no score, no
-- cellar, no id. A friend's cellar is not part of this at all.

-- ---- 1. The consent ----------------------------------------------------------------------------------------------
create table public.sommelier_sharing (
  user_id           uuid primary key default auth.uid() references auth.users on delete cascade,
  -- "When a friend names me in a question to their sommelier, it may take my taste into account."
  taste_for_friends boolean not null default false,
  updated_at        timestamptz not null default now()
);
create trigger sommelier_sharing_updated before update on public.sommelier_sharing
  for each row execute function private.set_updated_at();

alter table public.sommelier_sharing enable row level security;
-- Mine alone: nobody else can read whether I allow it (they only ever see the effect, through the function below).
create policy sommelier_sharing_select on public.sommelier_sharing for select to authenticated
  using (user_id = (select auth.uid()));
create policy sommelier_sharing_insert on public.sommelier_sharing for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy sommelier_sharing_update on public.sommelier_sharing for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy sommelier_sharing_delete on public.sommelier_sharing for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.sommelier_sharing from public, anon, authenticated;
grant select, delete on public.sommelier_sharing to authenticated;
grant insert (taste_for_friends) on public.sommelier_sharing to authenticated;
grant update (taste_for_friends) on public.sommelier_sharing to authenticated;
grant all on public.sommelier_sharing to service_role;

-- ---- 2. One person's taste as closed signals ---------------------------------------------------------------------
-- Private: only called by the function in section 3, after it has checked friendship and both consents.
-- The minimums are the taste profile's own (packages/domain/src/taste.ts): a favourite kind or region needs three
-- different rated wines averaging 3.5 stars (7 of 10); a trend needs three wines rated 4 stars (8 of 10) or more
-- whose structure is known. Below a minimum nothing is said, so no single rating can be read back from the result.
create function private.sommelier_taste_signals(p_user uuid) returns jsonb
  language sql stable security definer set search_path = '' as $$
  with points as (
    -- A region counts only for a wine of the reviewed catalogue: a household can write anything in the region
    -- of a wine it added itself, and that text would travel to another person.
    select w.id as wine_id, w.wine_type::text as type,
           case when w.status = 'canonical' and btrim(w.region) ~ '^[[:alpha:]][[:alpha:] .''-]{1,59}$'
                then btrim(w.region) end as region,
           avg(t.score)::numeric as score
      from public.tastings t
      join public.wine_vintages v on v.id = t.vintage_id
      join public.wines w on w.id = v.wine_id
     where t.user_id = p_user and t.score is not null
     group by w.id, w.wine_type, w.region
  ), felt as (
    select v.wine_id,
           avg(case when jsonb_typeof(i.output #> '{structure,body}') = 'number' then (i.output #>> '{structure,body}')::numeric end) as body,
           avg(case when jsonb_typeof(i.output #> '{structure,tannin}') = 'number' then (i.output #>> '{structure,tannin}')::numeric end) as tannin,
           avg(case when jsonb_typeof(i.output #> '{structure,sweetness}') = 'number' then (i.output #>> '{structure,sweetness}')::numeric end) as sweetness,
           avg(case when jsonb_typeof(i.output #> '{structure,acidity}') = 'number' then (i.output #>> '{structure,acidity}')::numeric end) as acidity
      from public.tastings t
      join public.wine_vintages v on v.id = t.vintage_id
      join public.vintage_insights i on i.household_id = t.household_id and i.vintage_id = t.vintage_id
     where t.user_id = p_user
     group by v.wine_id
  ), loved as (
    select f.* from points p join felt f using (wine_id) where p.score >= 8
  )
  select jsonb_build_object(
    'focus', (select tp.wine_focus from public.taste_preferences tp where tp.user_id = p_user),
    'said', coalesce((select jsonb_strip_nulls(jsonb_build_object(
                         'body', tp.body, 'tannin', tp.tannin, 'sweetness', tp.sweetness, 'acidity', tp.acidity))
                        from public.taste_preferences tp where tp.user_id = p_user), '{}'::jsonb),
    'styles', coalesce((select jsonb_agg(x.type order by x.m desc, x.n desc, x.type)
                          from (select type, avg(score) m, count(*) n from points
                                 group by type having count(*) >= 3 and avg(score) >= 7
                                 order by avg(score) desc, count(*) desc, type limit 2) x), '[]'::jsonb),
    'regions', coalesce((select jsonb_agg(left(x.region, 60) order by x.m desc, x.n desc, x.region)
                           from (select region, avg(score) m, count(*) n from points
                                  where region is not null
                                  group by region having count(*) >= 3 and avg(score) >= 7
                                  order by avg(score) desc, count(*) desc, region limit 2) x), '[]'::jsonb),
    'trends', jsonb_strip_nulls(jsonb_build_object(
      'body',      (select least(5, greatest(1, round(avg(body), 1)))      from loved where body is not null      having count(*) >= 3),
      'tannin',    (select least(5, greatest(1, round(avg(tannin), 1)))    from loved where tannin is not null    having count(*) >= 3),
      'sweetness', (select least(5, greatest(1, round(avg(sweetness), 1))) from loved where sweetness is not null having count(*) >= 3),
      'acidity',   (select least(5, greatest(1, round(avg(acidity), 1)))   from loved where acidity is not null   having count(*) >= 3)))
  );
$$;
revoke all on function private.sommelier_taste_signals(uuid) from public, anon, authenticated;

-- ---- 3. The friends named in a question -------------------------------------------------------------------------
-- Takes account names as a person typed them ("anna", "@Anna") and answers, per name:
--   'included'     one of my accepted friends, who shares their taste with me AND allows the sommelier to use it
--   'no-taste'     one of my accepted friends, who does not (either switch)
--   'unavailable'  anyone else: a stranger, a pending request in either direction, someone I removed, myself, or a
--                  name that does not exist. These are never told apart.
-- At most five names per call. The taste is only present for 'included'.
-- Each call counts against the caller's own limit (600 an hour): the app asks once per question, and nobody
-- gets to probe names faster than that, whichever way they call it.
create function public.sommelier_friend_context(p_handles text[])
  returns table (handle text, status text, taste jsonb)
  language plpgsql volatile security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;
  if p_handles is null or cardinality(p_handles) > 5 then
    raise exception 'At most five names.' using errcode = '22023';
  end if;
  if not private.consume_rate_limit(me, 'sommelier_friends', 600, interval '1 hour') then
    raise exception 'Too many questions about friends; try again later.' using errcode = '53400';
  end if;
  return query
  with asked as (
    select distinct lower(regexp_replace(btrim(h), '^@', '')) as name
      from unnest(p_handles) h
     where h is not null
  ), who as (
    select a.name, p.id as friend
      from asked a
      left join public.profiles p
        on p.handle = a.name and p.id <> me and private.are_friends(me, p.id)
  ), allowed as (
    select w.name, w.friend,
           w.friend is not null
             and private.can_see(me, w.friend, 'taste')
             and coalesce((select s.taste_for_friends from public.sommelier_sharing s
                            where s.user_id = w.friend), false) as ok
      from who w
  )
  select a.name,
         case when a.friend is null then 'unavailable' when a.ok then 'included' else 'no-taste' end,
         case when a.ok then private.sommelier_taste_signals(a.friend) end
    from allowed a;
end $$;
revoke all on function public.sommelier_friend_context(text[]) from public, anon;
grant execute on function public.sommelier_friend_context(text[]) to authenticated;

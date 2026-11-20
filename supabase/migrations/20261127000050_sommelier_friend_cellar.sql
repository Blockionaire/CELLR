-- =====================================================================
-- 0050 The social sommelier: a friend's cellar in my sommelier's answers, only when that friend allows it
-- =====================================================================
-- NOT APPLIED ANYWHERE. RELEASE ORDER (docs/sprints/sommelier-3-mega/RELEASE_PLAN.md): after 0047 (on `main`,
-- not yet applied to production on 2026-11-20), 0048 (which creates the table this file alters) and 0049.
-- Once applied, its function can be called by any signed-in person through the API, whatever the app's switches
-- say. What that allows: asking about ONE of one's own accepted friends, which returns that friend's wines only
-- when the friend (1) shows their cellar to this person under the sharing rules that already exist (0015; off
-- for everyone by default) AND (2) turned on the new consent below (off for everyone by default).
--
-- ADDITIVE: one new column, one new function. No existing sharing setting is read as consent for this.
--
-- WHY ITS OWN CONSENT. Showing a cellar to friends (sharing_settings.cellar, off by default since 0015) lets a
-- friend LOOK at it. Having it weighed by that friend's sommelier ("@thomas is bringing a bottle: what does he own
-- that suits us both?", "a present he does not have yet") is another use of the same data. Both must hold.
-- Turning either off, or ending the friendship, stops it at the next question: nothing is cached, and the
-- function reads the settings every time it is called.
--
-- WHAT LEAVES THE DATABASE. For the one name asked about: 'unavailable' for anyone who is not an accepted friend
-- (never whether an account exists or a request is pending); 'not-shared' for a friend who does not allow it
-- (which of the two settings is off is not told); 'included' with the wines that are in their cellar now:
-- producer, wine, vintage, kind, region, appellation, country. That is what this person can already see on the
-- friend's page (public.friend_cellar), MINUS the number of bottles and MINUS where they lie: no location, rack
-- or place ever leaves through this function.

-- ---- 1. The consent ----------------------------------------------------------------------------------------------
alter table public.sommelier_sharing
  add column cellar_for_friends boolean not null default false;
comment on column public.sommelier_sharing.cellar_for_friends is
  'When a friend names me in a question to their sommelier, it may look at the wines in my cellar (never where '
  'they lie), if I also show my cellar to that friend. Off until I turn it on.';
grant insert (cellar_for_friends) on public.sommelier_sharing to authenticated;
grant update (cellar_for_friends) on public.sommelier_sharing to authenticated;

-- ---- 2. One friend's cellar, for the asker's sommelier ------------------------------------------------------------
-- One name per call. Each call counts against the caller's own limit (120 an hour, the server's own limiter).
create function public.sommelier_friend_cellar(p_handle text) returns jsonb
  language plpgsql volatile security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  v_name text := lower(regexp_replace(btrim(coalesce(p_handle, '')), '^@', ''));
  v_friend uuid;
  v_wines jsonb;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  if v_name !~ '^[a-z0-9][a-z0-9_.]{2,19}$' then
    raise exception 'invalid_arguments' using errcode = '22023';
  end if;
  if not private.consume_rate_limit(me, 'sommelier_friend_cellar', 120, interval '1 hour') then
    raise exception 'rate_limited' using errcode = '54000';
  end if;

  select p.id into v_friend
    from public.profiles p
   where p.handle = v_name and p.id <> me and private.are_friends(me, p.id);
  if v_friend is null then
    return jsonb_build_object('status', 'unavailable', 'wines', '[]'::jsonb);
  end if;
  -- Both: they show their cellar to me (the rules of 0015), and they allow a friend's sommelier to use it.
  if not private.can_see(me, v_friend, 'cellar')
     or not coalesce((select s.cellar_for_friends from public.sommelier_sharing s
                       where s.user_id = v_friend), false) then
    return jsonb_build_object('status', 'not-shared', 'wines', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.producer, x.wine, x.year), '[]'::jsonb) into v_wines
    from (select pr.name as producer, w.name as wine, v.year, w.wine_type::text as type,
                 w.region, w.appellation, w.country_code as "countryCode"
            from public.bottles b
            join public.wine_vintages v on v.id = b.vintage_id
            join public.wines w on w.id = v.wine_id
            join public.producers pr on pr.id = w.producer_id
           where b.household_id = private.cellar_of(v_friend)
             and b.status = 'in_cellar'
           group by pr.name, w.name, v.year, w.wine_type, w.region, w.appellation, w.country_code
           order by pr.name, w.name, v.year
           limit 300) x;
  return jsonb_build_object('status', 'included', 'wines', v_wines);
end $$;

revoke all on function public.sommelier_friend_cellar(text) from public, anon;
grant execute on function public.sommelier_friend_cellar(text) to authenticated;

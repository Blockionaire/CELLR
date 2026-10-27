-- =====================================================================
-- 0025 decimal ratings: a rating in tenths of a star (4.2 / 5)
-- =====================================================================
-- tastings.score keeps its scale: half stars, 1..10, so stars = score / 2 (9 = 4.5 stars, as before). It only
-- gains one decimal so it can hold tenths of a star: 4.2 stars = 8.4. Every existing whole-number score is
-- unchanged and means exactly what it meant. numeric(3,1) is exact (no floating point), and a score must be a
-- whole number of tenths of a star (a multiple of 0.2), so 8.4 is accepted and 8.5 (4.25 stars) is not.
-- Additive and safe to run on a live database: the change of type only widens the column.

alter table public.tastings alter column score type numeric(3,1);
alter table public.tastings add constraint tastings_score_tenths check (score is null or (score * 5) = trunc(score * 5));

-- A friend's ratings return the score as stored (it was declared smallint).
drop function public.friend_ratings(uuid);
create function public.friend_ratings(p_friend uuid)
  returns table (tasting_id uuid, producer text, wine text, year smallint, wine_type text, region text,
                 country_code text, score numeric, descriptors text[], note text, tasted_at timestamptz)
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
revoke all on function public.friend_ratings(uuid) from public, anon;
grant execute on function public.friend_ratings(uuid) to authenticated;

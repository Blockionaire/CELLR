-- Recognition cache (Sprint G): an identical photo that this household already confirmed is recognised without
-- asking the vision model again.
--
-- There is no separate cache table. A photo is remembered by the SHA-256 fingerprint of its processed JPEG (the
-- exact bytes CELLR stored after removing metadata), kept on the household's own bottle_images row. What that
-- photo IS comes from the household's own confirmations: the bottles that use the photo, and their vintage.
-- So the answer is derived when it is asked for, never copied:
--   * an AI reading nobody confirmed is never remembered (no bottle uses the photo);
--   * correcting a bottle's wine or year, merging wines, or replacing the photo changes the answer at once;
--   * deleting or removing the bottle forgets it; deleting the household deletes everything (cascade).
-- Photos that point at different wines are ambiguous, and the app then asks the model as before.
--
-- The fingerprint only matches the very same processed image. Another photo of the same bottle has a different
-- fingerprint; recognising those is future work (docs/RECOGNITION-ROADMAP.md).
--
-- Additive only. Until this runs, the app keeps scanning exactly as before (it treats the cache as unavailable).

-- ---- 1. The fingerprint, and whether the cache answered (for measuring) --------------------------------------
alter table public.bottle_images
  add column fingerprint  text check (fingerprint ~ '^[0-9a-f]{64}$'),
  add column cache_result text check (cache_result in ('hit', 'miss'));

comment on column public.bottle_images.fingerprint is
  'SHA-256 (hex) of the processed JPEG. Household-private like the photo itself; only an identical image matches.';
comment on column public.bottle_images.cache_result is
  'For a scan: hit = recognised from an earlier confirmed scan (no vision call), miss = not, null = no lookup.';

create index bottle_images_fingerprint_idx on public.bottle_images (household_id, fingerprint)
  where fingerprint is not null;
create index bottle_images_cache_idx on public.bottle_images (created_at)
  where cache_result is not null;
-- Which bottles use a photo (also makes deleting photos cheaper).
create index bottles_front_image_idx on public.bottles (front_image_id) where front_image_id is not null;
create index bottles_back_image_idx  on public.bottles (back_image_id)  where back_image_id  is not null;

-- The server writes both when it stores a scan photo, as the signed-in person (RLS: their own households only).
grant insert (fingerprint, cache_result) on public.bottle_images to authenticated;

-- ---- 2. What an identical photo was confirmed as, in one household ------------------------------------------
-- SECURITY INVOKER: every row is read through the caller's own RLS (photos, bottles and vintages of households
-- they belong to), so it can never see another household's photos or confirmations.
create function public.recall_confirmed_scan(p_household_id uuid, p_fingerprint text)
  returns table (wine_id uuid, year int)
  language sql stable security invoker set search_path = '' as $$
  select distinct v.wine_id, v.year::int
    from public.bottle_images i
    join public.bottles b
      on b.household_id = i.household_id
     and (b.front_image_id = i.id or b.back_image_id = i.id)
    join public.wine_vintages v on v.id = b.vintage_id
   where i.household_id = p_household_id
     and i.fingerprint = p_fingerprint
     and p_fingerprint ~ '^[0-9a-f]{64}$'
     and b.status <> 'removed'
   limit 3;
$$;

revoke all on function public.recall_confirmed_scan(uuid, text) from public, anon;
grant execute on function public.recall_confirmed_scan(uuid, text) to authenticated, service_role;

-- ---- 3. Admin: did the cache save vision calls? (service role only, counts only) -----------------------------
create function public.admin_recognition_cache(p_from timestamptz, p_to timestamptz)
  returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  result jsonb;
begin
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '100 days' then
    raise exception 'invalid_arguments' using errcode = '22023';
  end if;
  select jsonb_build_object(
           'hits',   count(*) filter (where cache_result = 'hit'),
           'misses', count(*) filter (where cache_result = 'miss'))
    into result
    from public.bottle_images
   where cache_result is not null and created_at >= p_from and created_at < p_to;
  return result;
end $$;

revoke all on function public.admin_recognition_cache(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.admin_recognition_cache(timestamptz, timestamptz) to service_role;

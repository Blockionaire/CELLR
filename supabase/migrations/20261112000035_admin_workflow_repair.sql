-- Repair after Sprint U (20261111000034_admin_portal_workflow.sql). That migration was run by hand in production
-- before its last commit, so production kept the earlier definitions of three functions. This brings any database,
-- whichever 0034 it ran, to the final ones, verbatim from the merged 0034:
--   private.bottle_photo_stage     the workflow stage follows the wine's CURRENT artwork: a used contribution whose
--                                  picture was taken off reads draft, one whose picture was removed reads
--                                  artwork_needed (earlier: used was always "published")
--   public.admin_work_queue        counts every contribution that is not rejected by that stage (earlier: pending and
--                                  approved only, so used contributions needing artwork again were missed)
--   public.admin_publish_bottle_art  the provenance check refuses a ticked photo with no catalogue mapping that is not
--                                  of this wine (earlier "null = wine" let it through)
-- Only CREATE OR REPLACE FUNCTION with the same signatures, return types, language, SECURITY DEFINER and empty
-- search_path; owners and grants are kept, and re-stated below exactly as before. No table, row, review record or
-- picture is touched. Safe to run again, and a no-op on a database that already has the final 0034.

-- ---- 1. The workflow stage of a contribution ---------------------------------------------------------------------
create or replace function private.bottle_photo_stage(s public.bottle_photo_submissions) returns text
  language sql stable security definer set search_path = '' as $$
  with art as (
    select bool_or(a.published_at is not null) as published, bool_or(a.published_at is null) as draft
      from public.wine_bottle_art a
     where a.wine_id in (s.source_wine_id, s.canonical_wine_id) and a.vintage_id is null)
  select case
    when s.status = 'pending' then 'pending'
    when s.status = 'rejected' then 'rejected'
    when s.status = 'used' and art.published then 'published'
    when art.draft then 'draft'
    when art.published then 'published'
    else 'artwork_needed' end
    from art
$$;
revoke all on function private.bottle_photo_stage(public.bottle_photo_submissions) from public, anon, authenticated;

-- ---- 2. Publishing a picture with the photos it was made from ----------------------------------------------------
create or replace function public.admin_publish_bottle_art(p_art uuid, p_sources uuid[], p_actor uuid)
  returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare wid uuid; wstatus public.catalog_status;
begin
  select a.wine_id, w.status into wid, wstatus
    from public.wine_bottle_art a join public.wines w on w.id = a.wine_id
   where a.id = p_art and a.vintage_id is null for update of a;
  if wid is null then return false; end if;
  if exists (
    select 1 from unnest(coalesce(p_sources, '{}'::uuid[])) as src(id)
      left join public.bottle_photo_submissions s on s.id = src.id
     where s.id is null
        or not coalesce(s.source_wine_id = wid
                or (wstatus = 'canonical' and s.canonical_wine_id = wid and s.reviewed_by is not null
                    and s.status in ('approved', 'used')
                    and not private.link_contradicts(s.source_wine_id, wid)), false)) then
    raise exception 'bad_source' using errcode = '22023';
  end if;
  update public.wine_bottle_art set published_at = null, published_by = null
   where wine_id = wid and vintage_id is null and published_at is not null and id <> p_art;
  update public.wine_bottle_art set published_at = now(), published_by = p_actor where id = p_art;
  update public.bottle_photo_submissions
     set status = 'used', art_id = p_art, reviewed_at = now(), reviewed_by = p_actor
   where id = any (coalesce(p_sources, '{}'));
  return true;
end $$;

-- ---- 3. The overview's work queue ----------------------------------------------------------------------------------
create or replace function public.admin_work_queue()
  returns jsonb language sql stable security definer set search_path = '' as $$
  with open_photos as (
    select private.bottle_photo_stage(s) as stage
      from public.bottle_photo_submissions s where s.status <> 'rejected')
  select jsonb_build_object(
    'photosPending', (select count(*) from open_photos where stage = 'pending'),
    'artworkNeeded', (select count(*) from open_photos where stage = 'artwork_needed'),
    'photosWithDraft', (select count(*) from open_photos where stage = 'draft'),
    'artDrafts', (select count(distinct a.wine_id) from public.wine_bottle_art a
                   where a.vintage_id is null and a.published_at is null),
    'corrections', (select count(distinct c.wine_id) from public.catalog_scan_signals c
                     where c.kind = 'catalog' and c.status = 'open'),
    'catalogueWithoutArt', (select count(*) from public.wines w
                             where w.status = 'canonical' and not exists (
                               select 1 from public.wine_bottle_art a
                                where a.wine_id = w.id and a.vintage_id is null and a.published_at is not null)))
$$;

do $$
declare f text;
begin
  foreach f in array array['public.admin_publish_bottle_art(uuid, uuid[], uuid)', 'public.admin_work_queue()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

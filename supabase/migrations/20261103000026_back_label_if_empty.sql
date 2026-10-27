-- =====================================================================
-- 0026 back label "only if there is none": atomic, household-scoped
-- =====================================================================
-- A back-label photo taken while scanning is put on the wine only when the wine has no back label yet. Checking
-- first and writing after (two requests) lets two members of a household both pass the check and the second
-- silently replace the first. This does it in one transaction: lock the household's bottles of the vintage, look,
-- then write. A second caller waits on the lock and then sees the first one's label ("exists").
--
-- SECURITY INVOKER: every read and write goes through the caller's own row-level security (only their household's
-- photos and bottles). Replacing on purpose (after the person confirmed) stays the plain update the app already
-- does; the front label is untouched.

create function public.attach_back_label_if_empty(p_vintage_id uuid, p_image_id uuid)
  returns text language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_household uuid;
  v_updated int;
begin
  -- the photo must be one of the caller's household's (RLS hides any other)
  select i.household_id into v_household from public.bottle_images i where i.id = p_image_id;
  if v_household is null then return 'not_found'; end if;

  perform 1 from public.bottles b
   where b.household_id = v_household and b.vintage_id = p_vintage_id and b.status in ('in_cellar', 'opened')
   for update;
  if not found then return 'not_found'; end if;

  if exists (select 1 from public.bottles b
              where b.household_id = v_household and b.vintage_id = p_vintage_id
                and b.status in ('in_cellar', 'opened') and b.back_image_id is not null) then
    return 'exists';
  end if;

  update public.bottles b set back_image_id = p_image_id
   where b.household_id = v_household and b.vintage_id = p_vintage_id and b.status in ('in_cellar', 'opened');
  get diagnostics v_updated = row_count;
  return case when v_updated > 0 then 'attached' else 'not_found' end;
end $$;
revoke all on function public.attach_back_label_if_empty(uuid, uuid) from public, anon;
grant execute on function public.attach_back_label_if_empty(uuid, uuid) to authenticated;

-- =====================================================================
-- 0012 merge two wines: the same wine entered twice becomes one
-- =====================================================================
-- A household that typed a wine twice (or scanned it and then typed it) can fold the extra into the right one.
-- Everything the household keeps about the extra moves to the other: bottles, what people said about them,
-- the AI profile and the household's own value, the wishlist entry, and anyone's favourite star.
--
-- This needs a database function and not just API calls: a tasting cannot be moved to another vintage by anyone
-- (and nobody can touch another person's), and the rules about what may be touched live best next to the data.
-- It is deliberately narrow: the wine being folded away must be one the caller's own household entered (never the
-- shared catalogue), and the wine it is folded into must be one the caller can see.

create function public.merge_wines(p_source uuid, p_target uuid) returns int
  language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  src public.wines;
  tgt public.wines;
  hid uuid;
  sv record;
  tv uuid;
  moved int := 0;
  n int;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if p_source is null or p_target is null or p_source = p_target then
    raise exception 'invalid_merge' using errcode = '22023';
  end if;

  select * into src from public.wines where id = p_source;
  select * into tgt from public.wines where id = p_target;
  if src.id is null or tgt.id is null then raise exception 'not_found' using errcode = '22023'; end if;

  -- The extra must be the caller's own household's (so also never the shared catalogue)...
  hid := src.owner_household_id;
  if src.status <> 'provisional' or hid is null
     or not (hid = any (((select private.my_household_ids()))::uuid[])) then
    raise exception 'not_yours' using errcode = '42501';
  end if;
  -- ...and the wine it goes into one the caller may see: the shared catalogue, or their own household's.
  if not (tgt.status = 'canonical' or tgt.owner_household_id = any (((select private.my_household_ids()))::uuid[])) then
    raise exception 'not_yours' using errcode = '42501';
  end if;
  -- Two private wines of different households cannot be joined.
  if tgt.status = 'provisional' and tgt.owner_household_id <> hid then
    raise exception 'not_yours' using errcode = '42501';
  end if;

  for sv in select id, year from public.wine_vintages where wine_id = p_source loop
    select id into tv from public.wine_vintages where wine_id = p_target and year is not distinct from sv.year;
    if tv is null then
      insert into public.wine_vintages (wine_id, year) values (p_target, sv.year) returning id into tv;
    end if;

    update public.bottles set vintage_id = tv where household_id = hid and vintage_id = sv.id;
    get diagnostics n = row_count;
    moved := moved + n;

    update public.tastings set vintage_id = tv where household_id = hid and vintage_id = sv.id;

    -- The profile and the household's own value: kept for the target unless it already has its own.
    insert into public.vintage_insights (household_id, vintage_id, output, model, generated_at, my_value_cents)
      select household_id, tv, output, model, generated_at, my_value_cents
        from public.vintage_insights where household_id = hid and vintage_id = sv.id
      on conflict (household_id, vintage_id) do nothing;
    delete from public.vintage_insights where household_id = hid and vintage_id = sv.id;
  end loop;

  -- Wishes and favourites follow the wine.
  insert into public.wishlist_items (household_id, wine_id, year, note, max_price_cents, added_by)
    select household_id, p_target, year, note, max_price_cents, added_by
      from public.wishlist_items where household_id = hid and wine_id = p_source
    on conflict do nothing;
  insert into public.favorites (user_id, wine_id)
    select f.user_id, p_target from public.favorites f
     where f.wine_id = p_source and f.user_id in (select user_id from public.household_members where household_id = hid)
    on conflict do nothing;

  -- Nothing of this household's is left on the extra: it goes (its vintages, wishes and stars with it).
  delete from public.wines where id = p_source;
  return moved;
end $$;

revoke execute on function public.merge_wines(uuid, uuid) from public, anon;
grant execute on function public.merge_wines(uuid, uuid) to authenticated;
grant execute on all functions in schema public to service_role;

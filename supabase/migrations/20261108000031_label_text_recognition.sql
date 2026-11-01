-- Database-first wine recognition (Sprint S): a NEW photo of a known catalogue wine is recognised from its printed
-- label text, read on the phone (local OCR), without the vision model. The decision is made in plain code
-- (packages/domain/src/label-text.ts); the database only finds the wines whose producer or name is printed.
--
-- 1. find_wines_by_label_text: the wines one household can see (its own and the catalogue's, never another
--    household's) whose producer or name is one of the phrases printed on the label, plus the household's own wines
--    verifiably linked (wine_links) to those catalogue wines. Bounded; indexed lookups; nothing is stored. The label
--    text itself is never stored anywhere (it is a query, not a record).
-- 2. Measuring, on the household's own photo row (household-private, like the Sprint G fingerprint): whether the label
--    text answered the scan, which wine and year it proposed, and how long the OCR and the lookup took. The admin
--    sees aggregate counts and timings only (section 4).
-- 3. Sprint Q learning knows where a proposal came from: 'vision' (the model read the label) or 'text' (the label
--    text matched the catalogue). A misread vintage from the phone's OCR is then never counted as the vision model's,
--    and a correction after a text match is shown as such to the reviewer. Nothing here changes a catalogue wine.
--
-- Additive only. Until this runs, the app scans exactly as before (the lookup is treated as unavailable).

-- ---- 1. Which wines does this label text name? ----------------------------------------------------------------
-- SECURITY DEFINER only to read wine_links (service-role only); every row is limited to the caller's own household
-- (checked against their memberships) and the catalogue.
create function public.find_wines_by_label_text(p_household_id uuid, p_phrases text[])
  returns table (wine_id uuid, producer text, name text, wine_type text, country_code text, region text,
                 canonical boolean, aliases text[], linked_to uuid)
  language sql stable security definer set search_path = '' as $$
  with me as (
    select p_household_id as id where p_household_id = any (private.my_household_ids())
  ),
  ph as (
    select distinct x from unnest(p_phrases[1:400]) x where char_length(x) between 2 and 160
  ),
  prod as (
    select p.id from public.producers p, me
     where p.normalized_name in (select x from ph)
       and (p.status = 'canonical' or p.owner_household_id = me.id)
  ),
  named as (
    -- the wines of a printed producer (the catalogue's, or the household's own)
    select w.id from public.wines w, me
     where w.producer_id in (select id from prod)
       and (w.status = 'canonical' or w.owner_household_id = me.id)
    union
    -- the household's own wines whose name is printed (another spelling of the producer must not hide them)
    select w.id from public.wines w, me
     where w.owner_household_id = me.id and w.normalized_name in (select x from ph)
  ),
  hits as (
    select n.id from named n
    union
    -- the household's own wines verifiably linked to a catalogue wine that was found: the same wine, for them
    select l.source_wine_id from public.wine_links l join public.wines s on s.id = l.source_wine_id, me
     where l.canonical_wine_id in (select n.id from named n join public.wines c on c.id = n.id
                                    where c.status = 'canonical')
       and s.owner_household_id = me.id
  )
  select w.id, p.name, w.name, w.wine_type::text, coalesce(w.country_code, p.country_code), w.region,
         w.status = 'canonical',
         case when w.status = 'canonical'
              then coalesce((select array_agg(a.alias order by a.alias) from public.wine_aliases a where a.wine_id = w.id),
                            '{}') else '{}' end,
         case when w.status = 'provisional'
              then (select l.canonical_wine_id from public.wine_links l
                      join public.wines c on c.id = l.canonical_wine_id and c.status = 'canonical'
                     where l.source_wine_id = w.id) end
    from public.wines w join public.producers p on p.id = w.producer_id
   where w.id in (select id from hits)
   order by w.status = 'canonical' desc, w.id
   limit 40;
$$;
revoke all on function public.find_wines_by_label_text(uuid, text[]) from public, anon;
grant execute on function public.find_wines_by_label_text(uuid, text[]) to authenticated, service_role;

-- A household's own wines by name (the producer lookups use the existing (normalized_name, …) indexes).
create index wines_owner_name_idx on public.wines (owner_household_id, normalized_name)
  where owner_household_id is not null;

-- ---- 2. Measuring the fast path (household-private, written with the photo) ----------------------------------
alter table public.bottle_images
  add column text_result  text check (text_result in ('hit', 'miss', 'no_text')),
  add column text_wine_id uuid references public.wines on delete set null,
  add column text_year    smallint check (text_year between 1800 and 2100),
  add column ocr_ms       integer check (ocr_ms between 0 and 60000),
  add column lookup_ms    integer check (lookup_ms between 0 and 60000),
  -- a proposed wine and year only for a hit (the wine may be gone since: on delete set null)
  add constraint bottle_images_text_hit check ((text_wine_id is null and text_year is null) or text_result = 'hit');

comment on column public.bottle_images.text_result is
  'For a scan: hit = recognised from the printed label text (no vision call), miss = text read but not conclusive '
  '(read by the model), no_text = the phone''s OCR gave nothing (unavailable, timed out, empty), null = not tried.';
comment on column public.bottle_images.text_wine_id is
  'The wine the label text proposed (hit only). The label text itself is never stored.';

create index bottle_images_text_idx on public.bottle_images (created_at) where text_result is not null;

grant insert (text_result, text_wine_id, text_year, ocr_ms, lookup_ms) on public.bottle_images to authenticated;

-- ---- 3. Where a learning proposal came from (Sprint Q) --------------------------------------------------------
alter table public.catalog_scan_reads
  add column source text not null default 'vision' check (source in ('vision', 'text'));
alter table public.catalog_scan_signals
  add column source text not null default 'vision' check (source in ('vision', 'text'));

-- Same as before, plus where the proposal came from. The old five-argument form is replaced (p_source defaults
-- to 'vision', so a caller that does not say is unchanged).
drop function public.catalog_note_scan_proposal(uuid, uuid, uuid, jsonb, int);
create function public.catalog_note_scan_proposal(p_image_id uuid, p_user_id uuid, p_wine_id uuid, p_ai jsonb,
                                                  p_year int, p_source text default 'vision')
  returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare v jsonb;
begin
  if p_user_id is null or not private.catalog_may_count(p_user_id) then return false; end if;
  if p_source is null or p_source not in ('vision', 'text') then return false; end if;
  -- a text match is only ever a catalogue wine: the phone's OCR never proposes a new wine of its own
  if p_source = 'text' and p_wine_id is null then return false; end if;
  if p_wine_id is not null then
    select private.catalog_identity(p.name, w.name, w.wine_type::text, coalesce(w.country_code, p.country_code),
                                    w.region, p_year)
      into v
      from public.wines w join public.producers p on p.id = w.producer_id
     where w.id = p_wine_id and w.status = 'canonical';
    if v is null then return false; end if;
  else
    if p_ai is null or jsonb_typeof(p_ai) <> 'object' then return false; end if;
    v := private.catalog_identity(p_ai->>'producer', p_ai->>'name', p_ai->>'type', p_ai->>'country',
                                  p_ai->>'region', p_year);
    if v->>'producer' is null or v->>'name' is null then return false; end if;
  end if;
  update public.catalog_scan_reads
     set proposal_kind = case when p_wine_id is null then 'ai' else 'catalog' end,
         proposed_wine_id = p_wine_id, proposed = v, source = p_source
   where image_id = p_image_id and user_id = p_user_id and outcome_at is null
     and read_at >= now() - private.catalog_scan_read_ttl();
  return found;
end $$;
revoke all on function public.catalog_note_scan_proposal(uuid, uuid, uuid, jsonb, int, text)
  from public, anon, authenticated;
grant execute on function public.catalog_note_scan_proposal(uuid, uuid, uuid, jsonb, int, text) to service_role;

-- Same as Sprint Q (20261106000029), except that every signal carries the proposal's source, and a correction after
-- a text match is deduplicated apart from the same correction after a vision reading.
create or replace function public.catalog_record_scan_outcome(p_wine_id uuid, p_year int, p_image_id uuid)
  returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid     uuid := auth.uid();
  r         public.catalog_scan_reads;
  w         record;
  v_final   jsonb;
  v_changed text[] := '{}';
  v_signal  text;
  v_scan    text[] := '{}';
  v_confirmed jsonb;
  v_fp      text;
  f         text;
  norm_fields constant text[] := array['producer', 'name', 'region'];
begin
  if v_uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  if not private.catalog_may_count(v_uid) then return 'off'; end if;
  select * into r from public.catalog_scan_reads
   where image_id = p_image_id and user_id = v_uid and outcome_at is null and proposal_kind is not null
     and read_at >= now() - private.catalog_scan_read_ttl()
   for update;
  if not found then return 'none'; end if;

  select x.id, x.name, x.wine_type, coalesce(x.country_code, p.country_code) as country, x.region, x.created_at,
         p.name as producer
    into w
    from public.wines x join public.producers p on p.id = x.producer_id
   where x.id = p_wine_id and (x.status = 'canonical' or x.owner_household_id = r.household_id);
  if not found then return 'none'; end if;
  if not exists (select 1 from public.bottles b join public.wine_vintages v on v.id = b.vintage_id
                  where v.wine_id = w.id and v.year is not distinct from p_year::smallint
                    and b.household_id = r.household_id and b.status <> 'removed'
                    and (b.front_image_id = p_image_id or b.back_image_id = p_image_id)) then
    return 'none';
  end if;

  v_final := private.catalog_identity(w.producer, w.name, w.wine_type::text, w.country, w.region, p_year);
  foreach f in array array['producer', 'name', 'type', 'country', 'region', 'year'] loop
    if r.proposed ? f and (
         (f = any (norm_fields) and private.normalize_text(r.proposed->>f)
                                    is distinct from private.normalize_text(v_final->>f))
         or (not f = any (norm_fields) and (r.proposed->>f) is distinct from (v_final->>f))) then
      v_changed := v_changed || f;
    end if;
  end loop;

  if r.proposal_kind = 'catalog' then
    v_scan := case when 'year' = any (v_changed) then array['year'] else '{}'::text[] end;
    v_changed := array_remove(v_changed, 'year');
  end if;

  v_signal := case
    when cardinality(v_changed) = 0 and (r.proposal_kind = 'ai' or w.id = r.proposed_wine_id) then 'accepted'
    when r.proposal_kind = 'catalog' and w.id <> r.proposed_wine_id and w.created_at < r.read_at then 'different_wine'
    when 'producer' = any (v_changed) and 'name' = any (v_changed) then 'different_wine'
    when cardinality(v_changed) = 0 then 'accepted'
    else 'corrected' end;

  update public.catalog_scan_reads set outcome_at = now() where image_id = r.image_id;

  if r.proposal_kind = 'ai' then
    insert into public.catalog_scan_signals (kind, user_id, signal, changed_fields, source)
    values ('ai', v_uid, v_signal, v_changed, r.source);
    return v_signal;
  end if;

  -- a misread vintage on the same wine: recognition quality only (of the model, or of the phone's OCR), never
  -- catalogue evidence
  if cardinality(v_scan) > 0 and v_signal <> 'different_wine' then
    insert into public.catalog_scan_signals (kind, user_id, signal, changed_fields, source)
    values ('ai', v_uid, 'corrected', v_scan, r.source);
  end if;

  if v_signal = 'accepted' then
    insert into public.catalog_scan_signals (kind, wine_id, household_id, user_id, signal, proposed, source)
    values ('catalog', r.proposed_wine_id, r.household_id, v_uid, 'accepted', r.proposed - 'year', r.source)
    on conflict (wine_id, user_id) where kind = 'catalog' and signal = 'accepted' do update
       set household_id = excluded.household_id, proposed = excluded.proposed, source = excluded.source,
           last_seen_at = now();
  else
    v_confirmed := (select jsonb_object_agg(k, v_final->k) from unnest(v_changed) k where v_final ? k);
    v_fp := md5(case when r.source = 'text' then 'text|' else '' end ||
                v_signal || '|' || array_to_string(v_changed, ',') || '|' || coalesce(v_confirmed::text, ''));
    if exists (select 1 from public.catalog_scan_signals
                where kind = 'catalog' and signal <> 'accepted' and wine_id = r.proposed_wine_id
                  and user_id = v_uid and fingerprint = v_fp) then
      update public.catalog_scan_signals set last_seen_at = now()
       where kind = 'catalog' and signal <> 'accepted' and wine_id = r.proposed_wine_id and user_id = v_uid
         and fingerprint = v_fp;
    elsif (select count(*) from public.catalog_scan_signals
            where kind = 'catalog' and signal <> 'accepted' and wine_id = r.proposed_wine_id
              and user_id = v_uid) < 5 then
      insert into public.catalog_scan_signals (kind, wine_id, household_id, user_id, signal, changed_fields,
                                               proposed, confirmed, fingerprint, status, source)
      values ('catalog', r.proposed_wine_id, r.household_id, v_uid, v_signal, v_changed, r.proposed - 'year',
              v_confirmed, v_fp, 'open', r.source);
    end if;
  end if;
  return v_signal;
end $$;

-- The reviewer sees which corrections followed a text match (more likely the label was another bottling than that the
-- catalogue record is wrong).
create or replace function public.admin_catalog_correction(p_wine uuid)
  returns jsonb language sql stable security definer set search_path = '' as $$
  select case when w.id is null then null else jsonb_build_object(
    'wineId', w.id, 'producer', p.name, 'name', w.name, 'type', w.wine_type,
    'country', coalesce(w.country_code, p.country_code), 'region', w.region,
    'signals', coalesce((select jsonb_agg(jsonb_build_object(
                  'id', s.id, 'signal', s.signal, 'changedFields', to_jsonb(s.changed_fields),
                  'proposed', s.proposed, 'confirmed', s.confirmed, 'status', s.status, 'note', s.admin_note,
                  'reviewedAt', s.reviewed_at, 'createdAt', s.created_at, 'lastSeenAt', s.last_seen_at,
                  'source', s.source)
                  order by (s.status = 'open') desc nulls last, s.created_at desc)
               from public.catalog_scan_signals s where s.kind = 'catalog' and s.wine_id = w.id), '[]'::jsonb)) end
    from (select 1) one
    left join public.wines w on w.id = p_wine and w.status = 'canonical'
    left join public.producers p on p.id = w.producer_id
$$;

-- How scan readings fared: the vision model's (as before), and the phone's OCR on its own.
create or replace function public.admin_catalog_ai_signals(p_days int)
  returns jsonb language sql stable security definer set search_path = '' as $$
  with s as (select * from public.catalog_scan_signals
              where kind = 'ai' and created_at >= now() - make_interval(days => least(greatest(p_days, 1), 365))),
  v as (select * from s where source = 'vision'),
  t as (select * from s where source = 'text')
  select jsonb_build_object(
    'accepted', (select count(*) from v where signal = 'accepted'),
    'corrected', (select count(*) from v where signal = 'corrected'),
    'differentWine', (select count(*) from v where signal = 'different_wine'),
    'fields', coalesce((select jsonb_object_agg(f, n) from (select f, count(*) as n from v, unnest(v.changed_fields) f
                                                             group by f) x), '{}'::jsonb),
    'text', jsonb_build_object(
      'corrected', (select count(*) from t where signal = 'corrected'),
      'fields', coalesce((select jsonb_object_agg(f, n) from (select f, count(*) as n from t, unnest(t.changed_fields) f
                                                               group by f) x), '{}'::jsonb)))
$$;

-- ---- 4. Admin: recognition paths (service role only; counts and timings, never households, wines or text) ------
-- Every scan photo since p_from: answered by the identical-photo cache, by the label text, or read by the model.
-- For text hits, what the person did with the proposal, derived from their bottles now (as Sprint G derives the
-- cache): saved as proposed, saved with another year, saved as another wine, or not saved (yet).
create function public.admin_recognition_paths(p_from timestamptz, p_to timestamptz)
  returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  result jsonb;
begin
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '100 days' then
    raise exception 'invalid_arguments' using errcode = '22023';
  end if;
  with i as (
    select x.* from public.bottle_images x
     where x.created_at >= p_from and x.created_at < p_to
       and (x.cache_result is not null or x.text_result is not null)
  ),
  hit as (
    select i.id, i.text_wine_id, i.text_year,
           (select jsonb_agg(distinct jsonb_build_object('w', v.wine_id, 'y', v.year))
              from public.bottles b join public.wine_vintages v on v.id = b.vintage_id
             where b.household_id = i.household_id and b.status <> 'removed'
               and (b.front_image_id = i.id or b.back_image_id = i.id)) as saved
      from i where i.text_result = 'hit'
  ),
  outcome as (
    select h.*,
           case when h.saved is null then 'unsaved'
                when h.text_year is null and not exists (select 1 from jsonb_array_elements(h.saved) e
                                                          where (e->>'w')::uuid is distinct from h.text_wine_id)
                  then 'year_filled'
                when h.saved @> jsonb_build_array(jsonb_build_object('w', h.text_wine_id, 'y', h.text_year))
                     and jsonb_array_length(h.saved) = 1 then 'accepted'
                when exists (select 1 from jsonb_array_elements(h.saved) e
                              where (e->>'w')::uuid = h.text_wine_id) then 'year_changed'
                else 'different_wine' end as verdict
      from hit h
  )
  , vision as (
    -- the vision reads of label photos in the same window, as recorded (latency and known cost of successful calls)
    select u.latency_ms, u.cost_usd_micro from public.ai_usage u
     where u.task = 'label_extraction' and u.status = 'ok' and u.at >= p_from and u.at < p_to
  )
  select jsonb_build_object(
    'scans', (select count(*) from i),
    'cacheHits', (select count(*) from i where cache_result = 'hit'),
    'textAttempts', (select count(*) from i where text_result in ('hit', 'miss')),
    'textHits', (select count(*) from i where text_result = 'hit'),
    'textMisses', (select count(*) from i where text_result = 'miss'),
    'noText', (select count(*) from i where text_result = 'no_text'),
    'textHitsWithYear', (select count(*) from i where text_result = 'hit' and text_year is not null),
    'ocrMs', jsonb_build_object(
      'hit', (select round(avg(ocr_ms)) from i where text_result = 'hit'),
      'miss', (select round(avg(ocr_ms)) from i where text_result = 'miss'),
      'p50', (select percentile_cont(0.5) within group (order by ocr_ms) from i where ocr_ms is not null),
      'p90', (select percentile_cont(0.9) within group (order by ocr_ms) from i where ocr_ms is not null)),
    'lookupMs', jsonb_build_object(
      'avg', (select round(avg(lookup_ms)) from i where lookup_ms is not null),
      'p90', (select percentile_cont(0.9) within group (order by lookup_ms) from i where lookup_ms is not null)),
    'vision', jsonb_build_object(
      'calls', (select count(*) from vision),
      'avgMs', (select round(avg(latency_ms)) from vision),
      'p90Ms', (select percentile_cont(0.9) within group (order by latency_ms) from vision where latency_ms is not null),
      'costedCalls', (select count(*) from vision where cost_usd_micro is not null),
      'avgCostUsdMicro', (select round(avg(cost_usd_micro)) from vision where cost_usd_micro is not null)),
    'outcomes', jsonb_build_object(
      'accepted', (select count(*) from outcome where verdict = 'accepted'),
      'yearChanged', (select count(*) from outcome where verdict = 'year_changed'),
      'yearFilled', (select count(*) from outcome where verdict = 'year_filled'),
      'differentWine', (select count(*) from outcome where verdict = 'different_wine'),
      'unsaved', (select count(*) from outcome where verdict = 'unsaved')))
    into result;
  return result;
end $$;
revoke all on function public.admin_recognition_paths(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.admin_recognition_paths(timestamptz, timestamptz) to service_role;

-- Wine intelligence & correction signals (Sprint Q), on top of catalogue learning (Sprint J).
--
-- * When a scan PROPOSES a wine, the server notes that proposal next to the existing scan reading (same table, same
--   lifetime, same rule: only for a person who may count under the owner's catalogue-learning mode and their own
--   choice). Two kinds: "catalog" = the reading matched an existing catalogue wine; "ai" = nothing matched, the AI's
--   own reading was proposed as a new wine. A match with a household's own wine, or several possible matches, is not
--   noted: that is private, or not one proposal.
-- * When the person SAVES (adds bottles with that photo), the database compares what was proposed with what they
--   confirmed, once: accepted, corrected (some fields changed) or different_wine (another wine altogether). Never
--   from typing in between, never twice for one photo, and only when the bottles with that photo are really there.
-- * Field provenance: in a catalogue proposal, producer, name, colour, country and region come from the catalogue
--   record; the vintage comes from the scan (a catalogue wine has no single year). Only corrections of catalogue
--   fields are reviewable evidence about the catalogue record. A corrected vintage, like a corrected AI reading when
--   nothing matched, says something about the SCAN, not the catalogue: it is kept as a bare scan signal (which
--   fields changed, kind 'ai'), without values, household or catalogue wine, for recognition-quality analysis only.
-- * History is kept, bounded: a person's acceptance of a catalogue wine is one row (refreshed on each scan); their
--   corrections are separate rows, one per distinct correction (a repeat only refreshes last_seen_at), at most five
--   per person and wine. A later scan never overwrites an earlier correction, its review status or its note.
-- * Shared evidence holds only the wine identity fields (producer, name, colour, country, region, year): no photo,
--   no notes, no prices, no places. Only the service role reads it; the admin sees counts and values, never who.
-- * Nothing here changes a catalogue wine. Saying "no" to catalogue learning removes the person's signals; deleting
--   the account or the household removes them too.
-- * Independence: correction counts take the smaller of distinct households and distinct people (two people of one
--   household, or one person in two households, count once); for candidates, households linked by a confirming
--   person count as one.

-- ---- 1. Households linked by a person count as one (no inflated "independent households") ----------------------
-- For each candidate, households that share a confirming person are one group, however long the chain (A and B share
-- a person, B and C share another: one group). Every row is reported under its group's representative household, so
-- counting distinct households counts independent groups. Deterministic: the representative is the smallest id.
create or replace function private.catalog_active_evidence()
  returns table (candidate_id uuid, household_id uuid, year smallint, source text,
                 producer_text text, name_text text, region text, appellation text, last_seen_at timestamptz)
  language sql stable security definer set search_path = '' as $$
  with recursive active as (
    select e.* from public.catalog_evidence e
     where exists (select 1 from public.bottles b join public.wine_vintages v on v.id = b.vintage_id
                    where v.wine_id = e.wine_id and v.year is not distinct from e.year
                      and b.household_id = e.household_id and b.status <> 'removed')
  ),
  edges as (select distinct a.candidate_id, a.user_id, a.household_id from active a),
  lab (candidate_id, household_id, label) as (
    select distinct e.candidate_id, e.household_id, e.household_id::text from edges e
    union
    select e2.candidate_id, e2.household_id, l.label
      from lab l
      join edges e1 on e1.candidate_id = l.candidate_id and e1.household_id = l.household_id
      join edges e2 on e2.candidate_id = e1.candidate_id and e2.user_id = e1.user_id
  ),
  grp as (select l.candidate_id, l.household_id, min(l.label)::uuid as rep from lab l group by 1, 2)
  select a.candidate_id, g.rep, a.year, a.source, a.producer_text, a.name_text, a.region, a.appellation,
         a.last_seen_at
    from active a join grp g on g.candidate_id = a.candidate_id and g.household_id = a.household_id
$$;

-- ---- 2. The proposal, next to the scan reading -------------------------------------------------------------------
alter table public.catalog_scan_reads
  add column proposal_kind    text check (proposal_kind in ('catalog', 'ai')),
  add column proposed_wine_id uuid references public.wines on delete cascade,
  add column proposed         jsonb check (proposed is null or pg_column_size(proposed) < 2048),
  add column outcome_at       timestamptz,
  add constraint catalog_scan_reads_proposal check (
    (proposal_kind is null and proposed is null and proposed_wine_id is null)
    or (proposal_kind = 'catalog' and proposed_wine_id is not null and proposed is not null)
    or (proposal_kind = 'ai' and proposed_wine_id is null and proposed is not null));

-- The identity fields of a proposal or an answer, trimmed and bounded; nothing else gets in.
create function private.catalog_identity(p_producer text, p_name text, p_type text, p_country text, p_region text,
                                         p_year int) returns jsonb
  language sql immutable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'producer', nullif(left(btrim(p_producer), 120), ''),
    'name', nullif(left(btrim(p_name), 160), ''),
    'type', case when p_type in ('red', 'white', 'rose', 'sparkling', 'orange', 'dessert', 'fortified') then p_type end,
    'country', case when p_country ~ '^[A-Z]{2}$' then p_country end,
    'region', nullif(left(btrim(p_region), 120), ''),
    'year', case when p_year between 1800 and 2100 then p_year end))
$$;

-- Called by the server (service role) right after a scan proposed something, for the signed-in person who scanned.
-- p_wine_id: the catalogue wine that was proposed (its values are taken from the catalogue itself); null = the AI's
-- own reading was proposed (p_ai holds what it read). Kept only where the reading itself was kept (the person may
-- count), and never replaced once the person has answered.
create function public.catalog_note_scan_proposal(p_image_id uuid, p_user_id uuid, p_wine_id uuid, p_ai jsonb,
                                                  p_year int)
  returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare v jsonb;
begin
  if p_user_id is null or not private.catalog_may_count(p_user_id) then return false; end if;
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
         proposed_wine_id = p_wine_id, proposed = v
   where image_id = p_image_id and user_id = p_user_id and outcome_at is null
     and read_at >= now() - private.catalog_scan_read_ttl();
  return found;
end $$;
revoke all on function public.catalog_note_scan_proposal(uuid, uuid, uuid, jsonb, int) from public, anon, authenticated;
grant execute on function public.catalog_note_scan_proposal(uuid, uuid, uuid, jsonb, int) to service_role;

-- ---- 3. The signals -----------------------------------------------------------------------------------------------
create table public.catalog_scan_signals (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('catalog', 'ai')),
  -- the catalogue wine the scan proposed (catalog signals only)
  wine_id        uuid references public.wines on delete cascade,
  household_id   uuid references public.households on delete cascade,
  user_id        uuid not null references auth.users on delete cascade,
  signal         text not null check (signal in ('accepted', 'corrected', 'different_wine')),
  changed_fields text[] not null default '{}'
                 check (changed_fields <@ array['producer', 'name', 'type', 'country', 'region', 'year']),
  -- catalog signals only: the proposed catalogue identity, and the confirmed values of the catalogue fields that changed
  proposed       jsonb check (proposed is null or pg_column_size(proposed) < 2048),
  confirmed      jsonb check (confirmed is null or pg_column_size(confirmed) < 2048),
  -- catalog corrections only: what makes one correction distinct (signal, fields, confirmed values), to deduplicate
  fingerprint    text check (char_length(fingerprint) <= 64),
  -- open | reviewed | dismissed; none for an acceptance (nothing to review)
  status         text check (status in ('open', 'reviewed', 'dismissed')),
  admin_note     text check (char_length(admin_note) <= 500),
  reviewed_at    timestamptz,
  reviewed_by    uuid references auth.users on delete set null,
  created_at     timestamptz not null default now(),
  -- the latest scan that gave this same answer
  last_seen_at   timestamptz not null default now(),
  constraint catalog_scan_signals_shape check (
    (kind = 'catalog' and wine_id is not null and household_id is not null and proposed is not null)
    or (kind = 'ai' and wine_id is null and household_id is null and proposed is null and confirmed is null)),
  constraint catalog_scan_signals_fingerprint check (
    (kind = 'catalog' and signal <> 'accepted') = (fingerprint is not null)),
  -- the vintage is never a catalogue field
  constraint catalog_scan_signals_catalog_fields check (kind = 'ai' or not 'year' = any (changed_fields)),
  -- only catalogue corrections are reviewed; acceptances and AI signals have nothing to review
  constraint catalog_scan_signals_status check (
    (kind = 'ai' and status is null) or (kind = 'catalog' and (signal = 'accepted') = (status is null)))
);
-- one acceptance per person and catalogue wine; one row per distinct correction of a person
create unique index catalog_scan_signals_accepted_once on public.catalog_scan_signals (wine_id, user_id)
  where kind = 'catalog' and signal = 'accepted';
create unique index catalog_scan_signals_correction_once on public.catalog_scan_signals (wine_id, user_id, fingerprint)
  where kind = 'catalog' and signal <> 'accepted';
create index catalog_scan_signals_wine_idx on public.catalog_scan_signals (wine_id) where kind = 'catalog';
create index catalog_scan_signals_user_idx on public.catalog_scan_signals (user_id);
create index catalog_scan_signals_ai_idx on public.catalog_scan_signals (created_at) where kind = 'ai';

alter table public.catalog_scan_signals enable row level security;
revoke all on public.catalog_scan_signals from public, anon, authenticated;
grant all on public.catalog_scan_signals to service_role;

-- A person who says "no" takes their signals back too.
create function private.catalog_forget_declined_signals() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if new.catalog_contribute is false and old.catalog_contribute is distinct from false then
    delete from public.catalog_scan_signals where user_id = new.id;
  end if;
  return new;
end $$;
create trigger profiles_catalog_forget_signals after update of catalog_contribute on public.profiles
  for each row execute function private.catalog_forget_declined_signals();

-- ---- 4. Recording the answer (as the person, when they save) ---------------------------------------------------
-- Called by the server right after the person added bottles with the scanned photo. Compares the proposal noted for
-- that photo with the wine and year they saved, once. Returns accepted | corrected | different_wine | none | off (for a
-- catalogue proposal: the verdict on the catalogue fields; a corrected vintage is recorded as a scan signal).
create function public.catalog_record_scan_outcome(p_wine_id uuid, p_year int, p_image_id uuid)
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

  -- the saved wine: one the household may use, with bottles of it and that year carrying this very photo
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
  -- a field counts as changed only where the proposal said something about it
  foreach f in array array['producer', 'name', 'type', 'country', 'region', 'year'] loop
    if r.proposed ? f and (
         (f = any (norm_fields) and private.normalize_text(r.proposed->>f)
                                    is distinct from private.normalize_text(v_final->>f))
         or (not f = any (norm_fields) and (r.proposed->>f) is distinct from (v_final->>f))) then
      v_changed := v_changed || f;
    end if;
  end loop;

  if r.proposal_kind = 'catalog' then
    -- the vintage came from the scan, not the catalogue: a corrected vintage is a scan signal, kept apart
    v_scan := case when 'year' = any (v_changed) then array['year'] else '{}'::text[] end;
    v_changed := array_remove(v_changed, 'year');
  end if;

  v_signal := case
    when cardinality(v_changed) = 0 and (r.proposal_kind = 'ai' or w.id = r.proposed_wine_id) then 'accepted'
    -- another wine that already existed (picked from the list), or both producer and name are different
    when r.proposal_kind = 'catalog' and w.id <> r.proposed_wine_id and w.created_at < r.read_at then 'different_wine'
    when 'producer' = any (v_changed) and 'name' = any (v_changed) then 'different_wine'
    when cardinality(v_changed) = 0 then 'accepted'
    else 'corrected' end;

  update public.catalog_scan_reads set outcome_at = now() where image_id = r.image_id;

  if r.proposal_kind = 'ai' then
    insert into public.catalog_scan_signals (kind, user_id, signal, changed_fields)
    values ('ai', v_uid, v_signal, v_changed);
    return v_signal;
  end if;

  -- a misread vintage on the same wine: recognition quality only, never catalogue evidence
  if cardinality(v_scan) > 0 and v_signal <> 'different_wine' then
    insert into public.catalog_scan_signals (kind, user_id, signal, changed_fields)
    values ('ai', v_uid, 'corrected', v_scan);
  end if;

  if v_signal = 'accepted' then
    -- one acceptance per person and wine; it never touches their corrections
    insert into public.catalog_scan_signals (kind, wine_id, household_id, user_id, signal, proposed)
    values ('catalog', r.proposed_wine_id, r.household_id, v_uid, 'accepted', r.proposed - 'year')
    on conflict (wine_id, user_id) where kind = 'catalog' and signal = 'accepted' do update
       set household_id = excluded.household_id, proposed = excluded.proposed, last_seen_at = now();
  else
    v_confirmed := (select jsonb_object_agg(k, v_final->k) from unnest(v_changed) k where v_final ? k);
    v_fp := md5(v_signal || '|' || array_to_string(v_changed, ',') || '|' || coalesce(v_confirmed::text, ''));
    if exists (select 1 from public.catalog_scan_signals
                where kind = 'catalog' and signal <> 'accepted' and wine_id = r.proposed_wine_id
                  and user_id = v_uid and fingerprint = v_fp) then
      -- the same correction again: one row, its review and note kept
      update public.catalog_scan_signals set last_seen_at = now()
       where kind = 'catalog' and signal <> 'accepted' and wine_id = r.proposed_wine_id and user_id = v_uid
         and fingerprint = v_fp;
    elsif (select count(*) from public.catalog_scan_signals
            where kind = 'catalog' and signal <> 'accepted' and wine_id = r.proposed_wine_id
              and user_id = v_uid) < 5 then
      insert into public.catalog_scan_signals (kind, wine_id, household_id, user_id, signal, changed_fields,
                                               proposed, confirmed, fingerprint, status)
      values ('catalog', r.proposed_wine_id, r.household_id, v_uid, v_signal, v_changed, r.proposed - 'year',
              v_confirmed, v_fp, 'open');
    end if;
    -- (a person's sixth distinct correction of one wine is not kept: their earlier ones stand)
  end if;
  return v_signal;
end $$;
revoke all on function public.catalog_record_scan_outcome(uuid, int, uuid) from public, anon;
grant execute on function public.catalog_record_scan_outcome(uuid, int, uuid) to authenticated;

-- ---- 5. The admin's view (service role only; counts and values, never who) -------------------------------------
-- Catalogue wines with correction signals (wines only ever accepted as they are are not listed). Independent
-- households: the smaller of distinct households and distinct people, so neither two people of one household nor one
-- person in two households (nor one person's repeated scans) count twice. "conflict": open corrections disagree on
-- what a field should be.
create function public.admin_catalog_corrections()
  returns jsonb language sql stable security definer set search_path = '' as $$
  with s as (select * from public.catalog_scan_signals where kind = 'catalog'),
  corr as (select * from s where s.signal <> 'accepted'),
  per as (
    select c.wine_id,
           least(count(distinct c.household_id) filter (where c.status = 'open'),
                 count(distinct c.user_id) filter (where c.status = 'open')) as open_households,
           least(count(distinct c.household_id) filter (where c.status = 'open' and c.signal = 'corrected'),
                 count(distinct c.user_id) filter (where c.status = 'open' and c.signal = 'corrected')) as corrected,
           least(count(distinct c.household_id) filter (where c.status = 'open' and c.signal = 'different_wine'),
                 count(distinct c.user_id) filter (where c.status = 'open' and c.signal = 'different_wine')) as identity,
           count(*) filter (where c.status = 'open') as open_signals,
           count(*) filter (where c.status in ('reviewed', 'dismissed')) as resolved,
           max(c.last_seen_at) as last_at
      from corr c group by c.wine_id
  ),
  acc as (
    select a.wine_id, least(count(distinct a.household_id), count(distinct a.user_id)) as accepted
      from s a where a.signal = 'accepted' group by a.wine_id
  ),
  fields as (
    select c.wine_id, f, least(count(distinct c.household_id), count(distinct c.user_id)) as n,
           count(distinct c.confirmed->>f) as variants
      from corr c, unnest(c.changed_fields) f
     where c.status = 'open'
     group by c.wine_id, f
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'wineId', w.id, 'producer', p.name, 'name', w.name, 'type', w.wine_type,
           'country', coalesce(w.country_code, p.country_code), 'region', w.region,
           'accepted', coalesce(acc.accepted, 0), 'openHouseholds', per.open_households, 'corrected', per.corrected,
           'identity', per.identity, 'openSignals', per.open_signals, 'resolved', per.resolved,
           'fields', coalesce((select jsonb_object_agg(fields.f, fields.n) from fields where fields.wine_id = w.id),
                              '{}'::jsonb),
           'conflict', exists (select 1 from fields where fields.wine_id = w.id and fields.variants > 1),
           'lastAt', per.last_at)
         order by per.open_households desc, per.last_at desc), '[]'::jsonb)
    from per join public.wines w on w.id = per.wine_id join public.producers p on p.id = w.producer_id
    left join acc on acc.wine_id = per.wine_id
$$;

-- One catalogue wine: its record and every signal about it (without households or people).
create function public.admin_catalog_correction(p_wine uuid)
  returns jsonb language sql stable security definer set search_path = '' as $$
  select case when w.id is null then null else jsonb_build_object(
    'wineId', w.id, 'producer', p.name, 'name', w.name, 'type', w.wine_type,
    'country', coalesce(w.country_code, p.country_code), 'region', w.region,
    'signals', coalesce((select jsonb_agg(jsonb_build_object(
                  'id', s.id, 'signal', s.signal, 'changedFields', to_jsonb(s.changed_fields),
                  'proposed', s.proposed, 'confirmed', s.confirmed, 'status', s.status, 'note', s.admin_note,
                  'reviewedAt', s.reviewed_at, 'createdAt', s.created_at, 'lastSeenAt', s.last_seen_at)
                  order by (s.status = 'open') desc nulls last, s.created_at desc)
               from public.catalog_scan_signals s where s.kind = 'catalog' and s.wine_id = w.id), '[]'::jsonb)) end
    from (select 1) one
    left join public.wines w on w.id = p_wine and w.status = 'canonical'
    left join public.producers p on p.id = w.producer_id
$$;

-- Mark a correction signal reviewed or dismissed (or open again), with an optional internal note. Acceptances have
-- nothing to review. Changes no wine.
create function public.admin_catalog_review_signal(p_id uuid, p_status text, p_note text, p_actor uuid)
  returns boolean language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_status not in ('open', 'reviewed', 'dismissed') then raise exception 'bad_status' using errcode = '22023'; end if;
  update public.catalog_scan_signals
     set status = p_status,
         admin_note = coalesce(nullif(btrim(left(p_note, 500)), ''), admin_note),
         reviewed_at = case when p_status = 'open' then null else now() end,
         reviewed_by = case when p_status = 'open' then null else p_actor end
   where id = p_id and kind = 'catalog' and signal <> 'accepted';
  return found;
end $$;

-- How scan readings fared (counts only): the AI's own reading when nothing in the catalogue matched, and the vintage it
-- read on a catalogue wine.
create function public.admin_catalog_ai_signals(p_days int)
  returns jsonb language sql stable security definer set search_path = '' as $$
  with s as (select * from public.catalog_scan_signals
              where kind = 'ai' and created_at >= now() - make_interval(days => least(greatest(p_days, 1), 365)))
  select jsonb_build_object(
    'accepted', (select count(*) from s where signal = 'accepted'),
    'corrected', (select count(*) from s where signal = 'corrected'),
    'differentWine', (select count(*) from s where signal = 'different_wine'),
    'fields', coalesce((select jsonb_object_agg(f, n) from (select f, count(*) as n from s, unnest(s.changed_fields) f
                                                             group by f) x), '{}'::jsonb))
$$;

do $$
declare f text;
begin
  foreach f in array array['public.admin_catalog_corrections()', 'public.admin_catalog_correction(uuid)',
                           'public.admin_catalog_review_signal(uuid, text, text, uuid)',
                           'public.admin_catalog_ai_signals(int)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

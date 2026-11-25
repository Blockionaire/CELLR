-- CELLR community reviews (Wine Catalogue & Community Ratings sprint, PR 2). Design: docs/sprints/ratings/DESIGN.md §3.
--
-- Rules:
-- 1. A private tasting stays private. A public review is a separate row, made only by its author's explicit publish
--    call (opt-in, with consent) from one of their own tastings that has a score. The tasting's note is never copied:
--    the review's text is what the author writes for the public, optional.
-- 2. The score scale is the tastings' (1–10 in tenths of a star; stars = score / 2). The review follows its tasting:
--    a changed score or tasting date is carried over; a tasting whose score is removed, or that is deleted, takes
--    its review with it.
-- 3. A review is bound to an exact catalogue identity and vintage, fixed when it is published: a canonical wine, or
--    the one provider record a household wine was made from and still matches (R-27), or the canonical wine that
--    record is verified as. A wine only one household knows cannot be reviewed publicly.
-- 4. One review per person per subject and vintage: publishing again (also from another tasting of the same wine and
--    vintage) updates it. A second account, a hidden review and a removed one count for nothing extra.
-- 5. Spam and abuse: rate limits on publishing and reporting, a length limit, no links (http://, https://, www.), one report per person per
--    review, automatic hiding at three open reports pending moderation, admin moderation with a logged reason.
-- 6. People read reviews only through the functions below: published ones, with the author's display name and never
--    their household, email or account id (an opaque per-review author key lets the app mark "yours").
--
-- Additive. Until this runs, the app shows no community reviews and offers no publishing.

create table public.community_reviews (
  id                uuid primary key default gen_random_uuid(),
  tasting_id        uuid not null unique references public.tastings on delete cascade,
  user_id           uuid not null references public.profiles on delete cascade,
  -- the subject: exactly one of a canonical wine or a provider record
  subject_wine_id   uuid references public.wines on delete cascade,
  subject_record_id uuid references public.catalog_external_records on delete cascade,
  -- null = NV
  vintage_year      smallint check (vintage_year between 1800 and 2100),
  score             numeric(3,1) not null check (score between 1 and 10 and (score * 5) = trunc(score * 5)),
  body              text check (body is null or char_length(btrim(body)) between 1 and 1500),
  tasted_on         date not null,
  status            text not null default 'published' check (status in ('published', 'hidden', 'removed')),
  -- why it is hidden or removed: 'reports' (automatic) or a moderator's reason
  status_reason     text check (char_length(status_reason) <= 300),
  moderated_by      uuid references auth.users on delete set null,
  moderated_at      timestamptz,
  published_at      timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint community_reviews_one_subject check (num_nonnulls(subject_wine_id, subject_record_id) = 1),
  constraint community_reviews_no_links check (body is null or body !~* '(https?://|www\.)')
);
create unique index community_reviews_one_per_person_uq
  on public.community_reviews (user_id, coalesce(subject_wine_id, subject_record_id), vintage_year) nulls not distinct;
create index community_reviews_wine_idx on public.community_reviews (subject_wine_id, vintage_year)
  where subject_wine_id is not null and status = 'published';
create index community_reviews_record_idx on public.community_reviews (subject_record_id, vintage_year)
  where subject_record_id is not null and status = 'published';

create table public.community_review_reports (
  id          bigint generated always as identity primary key,
  review_id   uuid not null references public.community_reviews on delete cascade,
  reporter_id uuid not null references auth.users on delete cascade,
  reason      text not null check (reason in ('spam', 'offensive', 'wrong_wine', 'not_a_review', 'other')),
  detail      text check (char_length(detail) <= 300),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolution  text check (resolution in ('upheld', 'dismissed')),
  unique (review_id, reporter_id)
);
create index community_review_reports_open_idx on public.community_review_reports (review_id) where resolved_at is null;

create table public.community_review_moderation_log (
  id         bigint generated always as identity primary key,
  review_id  uuid references public.community_reviews on delete set null,
  action     text not null check (action in ('hide', 'restore', 'remove', 'auto_hide')),
  reason     text not null check (char_length(btrim(reason)) between 1 and 300),
  actor      text not null check (char_length(btrim(actor)) between 1 and 120),
  created_at timestamptz not null default now()
);

-- Nobody reads or writes these tables directly; the functions below are the only way in.
alter table public.community_reviews enable row level security;
alter table public.community_review_reports enable row level security;
alter table public.community_review_moderation_log enable row level security;
revoke all on public.community_reviews, public.community_review_reports, public.community_review_moderation_log
  from public, anon, authenticated;
grant all on public.community_reviews, public.community_review_reports, public.community_review_moderation_log
  to service_role;

-- ---- 1. The subject a household's wine can be reviewed as -----------------------------------------------------
-- (subject_wine_id, subject_record_id): a canonical wine; or the household wine's one active matching origin record
-- (R-27), as the canonical wine it is verified as when there is exactly one such link. Otherwise nothing.
create function private.review_subject_of_wine(p_household_id uuid, p_wine_id uuid,
                                               out subject_wine_id uuid, out subject_record_id uuid)
  language plpgsql stable security definer set search_path = '' as $$
declare w record; recs uuid[]; canon uuid[];
begin
  select id, status, owner_household_id into w from public.wines where id = p_wine_id;
  if w.id is null then return; end if;
  if w.status = 'canonical' then subject_wine_id := w.id; return; end if;
  if w.owner_household_id is distinct from p_household_id then return; end if;
  select array_agg(distinct o.record_id) into recs
    from public.wine_record_origins o join public.catalog_external_records e on e.id = o.record_id
   where o.wine_id = p_wine_id and o.household_id = p_household_id and o.unlinked_at is null
     and e.status = 'active' and private.record_matches_wine(o.record_id, p_wine_id);
  if cardinality(recs) is distinct from 1 then return; end if;
  select array_agg(distinct l.wine_id) into canon
    from public.catalog_record_links l join public.wines cw on cw.id = l.wine_id and cw.status = 'canonical'
   where l.record_id = recs[1] and l.state = 'verified';
  if cardinality(canon) = 1 then subject_wine_id := canon[1]; else subject_record_id := recs[1]; end if;
end $$;
revoke all on function private.review_subject_of_wine(uuid, uuid) from public, anon, authenticated, service_role;

-- ---- 2. Publishing (the author, opt-in) -------------------------------------------------------------------------
-- 'published' · 'updated' · 'not_yours' (not the caller's own tasting) · 'no_score' (a review needs a score) ·
-- 'no_identity' (the wine has no catalogue identity) · 'no_consent' · 'rate_limited' · 'invalid_text'.
create function public.publish_community_review(p_tasting_id uuid, p_body text, p_consent boolean)
  returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare t record; subj record; b text; rid uuid; existing uuid;
begin
  if auth.uid() is null then return jsonb_build_object('status', 'not_yours'); end if;
  if p_consent is not true then return jsonb_build_object('status', 'no_consent'); end if;
  select tg.id, tg.user_id, tg.household_id, tg.score, tg.tasted_at, v.wine_id, v.year
    into t
    from public.tastings tg join public.wine_vintages v on v.id = tg.vintage_id
   where tg.id = p_tasting_id and tg.user_id = auth.uid()
     and tg.household_id = any (private.my_household_ids());
  if t.id is null then return jsonb_build_object('status', 'not_yours'); end if;
  if t.score is null then return jsonb_build_object('status', 'no_score'); end if;
  select * into subj from private.review_subject_of_wine(t.household_id, t.wine_id);
  if subj.subject_wine_id is null and subj.subject_record_id is null then
    return jsonb_build_object('status', 'no_identity');
  end if;
  b := nullif(btrim(regexp_replace(coalesce(p_body, ''), '[[:cntrl:]]+', ' ', 'g')), '');
  if b is not null and (char_length(b) > 1500
                        or b ~* '(https?://|www\.)') then
    return jsonb_build_object('status', 'invalid_text');
  end if;
  if not private.consume_rate_limit(auth.uid(), 'community_review_publish', 20, interval '1 hour') then
    return jsonb_build_object('status', 'rate_limited');
  end if;

  -- one review per person, subject and vintage: an existing one (from this or another tasting) is updated
  select r.id into existing from public.community_reviews r
   where r.user_id = auth.uid()
     and coalesce(r.subject_wine_id, r.subject_record_id) = coalesce(subj.subject_wine_id, subj.subject_record_id)
     and r.vintage_year is not distinct from t.year
   for update;
  if existing is null then
    -- a review of this tasting about another subject (the wine's identity changed since) is replaced
    delete from public.community_reviews where tasting_id = t.id;
    insert into public.community_reviews (tasting_id, user_id, subject_wine_id, subject_record_id, vintage_year,
                                          score, body, tasted_on)
    values (t.id, auth.uid(), subj.subject_wine_id, subj.subject_record_id, t.year, t.score, b,
            (t.tasted_at at time zone 'UTC')::date)
    returning id into rid;
    return jsonb_build_object('status', 'published', 'reviewId', rid);
  end if;
  delete from public.community_reviews where tasting_id = t.id and id <> existing;
  update public.community_reviews
     set tasting_id = t.id, score = t.score, body = b, tasted_on = (t.tasted_at at time zone 'UTC')::date,
         updated_at = now()
   where id = existing;
  return jsonb_build_object('status', 'updated', 'reviewId', existing);
end $$;

-- The author removes their review (the tasting stays). 'deleted' · 'not_found'.
create function public.delete_community_review(p_review_id uuid) returns text
  language plpgsql security definer set search_path = '' as $$
begin
  delete from public.community_reviews where id = p_review_id and user_id = auth.uid();
  return case when found then 'deleted' else 'not_found' end;
end $$;

-- The review follows its tasting: score and date carried over; no score any more = no review.
create function private.community_review_follow_tasting() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if new.score is null then
    delete from public.community_reviews where tasting_id = new.id;
  else
    update public.community_reviews
       set score = new.score, tasted_on = (new.tasted_at at time zone 'UTC')::date, updated_at = now()
     where tasting_id = new.id and (score <> new.score or tasted_on <> (new.tasted_at at time zone 'UTC')::date);
  end if;
  return null;
end $$;
revoke all on function private.community_review_follow_tasting() from public, anon, authenticated;
create trigger tastings_community_review after update of score, tasted_at on public.tastings
  for each row execute function private.community_review_follow_tasting();

-- ---- 3. Reports and moderation ----------------------------------------------------------------------------------
-- 'reported' · 'already_reported' · 'not_found' (no such published review, or your own) · 'rate_limited'.
-- Three open reports hide a review until a moderator decides.
create function public.report_community_review(p_review_id uuid, p_reason text, p_detail text default null)
  returns text
  language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if auth.uid() is null then return 'not_found'; end if;
  if p_reason is null or p_reason not in ('spam', 'offensive', 'wrong_wine', 'not_a_review', 'other') then
    raise exception 'unknown reason' using errcode = '22023';
  end if;
  perform 1 from public.community_reviews where id = p_review_id and status = 'published' and user_id <> auth.uid()
    for update;
  if not found then return 'not_found'; end if;
  if exists (select 1 from public.community_review_reports where review_id = p_review_id and reporter_id = auth.uid()) then
    return 'already_reported';
  end if;
  if not private.consume_rate_limit(auth.uid(), 'community_review_report', 20, interval '1 day') then
    return 'rate_limited';
  end if;
  insert into public.community_review_reports (review_id, reporter_id, reason, detail)
  values (p_review_id, auth.uid(), p_reason, left(nullif(btrim(p_detail), ''), 300));
  select count(*) into n from public.community_review_reports where review_id = p_review_id and resolved_at is null;
  if n >= 3 then
    update public.community_reviews set status = 'hidden', status_reason = 'reports', updated_at = now()
     where id = p_review_id and status = 'published';
    insert into public.community_review_moderation_log (review_id, action, reason, actor)
    values (p_review_id, 'auto_hide', n || ' open reports', 'system');
  end if;
  return 'reported';
end $$;

-- An admin's decision (the server checks the admin first; the database lets only the service role call this).
-- hide / remove: out of every count; restore: published again. Open reports are resolved with the decision.
create function public.admin_moderate_community_review(p_review_id uuid, p_action text, p_reason text,
                                                       p_actor text, p_moderator uuid default null) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare st text;
begin
  if p_action not in ('hide', 'restore', 'remove') then raise exception 'unknown action' using errcode = '22023'; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null or nullif(btrim(coalesce(p_actor, '')), '') is null then
    raise exception 'a reason and an actor are required' using errcode = '22023';
  end if;
  st := case p_action when 'hide' then 'hidden' when 'remove' then 'removed' else 'published' end;
  update public.community_reviews
     set status = st, status_reason = case when st = 'published' then null else left(btrim(p_reason), 300) end,
         moderated_by = p_moderator, moderated_at = now(), updated_at = now()
   where id = p_review_id;
  if not found then raise exception 'no review %', p_review_id using errcode = '22023'; end if;
  update public.community_review_reports
     set resolved_at = now(), resolution = case when p_action = 'restore' then 'dismissed' else 'upheld' end
   where review_id = p_review_id and resolved_at is null;
  insert into public.community_review_moderation_log (review_id, action, reason, actor)
  values (p_review_id, p_action, left(btrim(p_reason), 300), left(btrim(p_actor), 120));
  return jsonb_build_object('review', p_review_id, 'status', st);
end $$;

-- The moderation queue: reviews with open reports, hidden ones first.
create function public.admin_community_review_queue(p_limit int default 50) returns jsonb
  language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(q order by q->>'status' desc, (q->>'openReports')::int desc), '[]'::jsonb) from (
    select jsonb_build_object('reviewId', r.id, 'status', r.status, 'score', r.score, 'body', r.body,
             'vintage', r.vintage_year, 'publishedAt', r.published_at,
             'openReports', count(rp.id), 'reasons', jsonb_agg(distinct rp.reason)) as q
      from public.community_reviews r
      join public.community_review_reports rp on rp.review_id = r.id and rp.resolved_at is null
     group by r.id
     limit least(greatest(coalesce(p_limit, 50), 1), 200)) s
$$;

-- ---- 4. What people read ------------------------------------------------------------------------------------------
-- The published reviews of one subject (a canonical wine also gathers the reviews of records verified as it), per
-- vintage: counts and the distribution for the CELLR score, and the newest reviews with text first.
create function private.community_reviews_impl(p_wine uuid, p_record uuid, p_viewer uuid, p_limit int) returns jsonb
  language sql stable security definer set search_path = '' as $$
  with subj as (
    select r.* from public.community_reviews r
     where r.status = 'published'
       and ((p_wine is not null and (r.subject_wine_id = p_wine
                                     or r.subject_record_id in (select l.record_id from public.catalog_record_links l
                                                                 where l.wine_id = p_wine and l.state = 'verified')))
            or (p_record is not null and r.subject_record_id = p_record))
  )
  select jsonb_build_object(
    'vintages', coalesce((select jsonb_agg(jsonb_build_object('year', v.vintage_year, 'count', v.n,
                                                              'scores', v.scores)
                                           order by v.vintage_year desc nulls last)
                            from (select vintage_year, count(*) as n, jsonb_agg(score order by score) as scores
                                    from subj group by vintage_year) v), '[]'::jsonb),
    'reviews', coalesce((select jsonb_agg(x.j order by x.has_text desc, x.published_at desc)
                           from (select s.body is not null as has_text, s.published_at,
                                        jsonb_build_object(
                                          'id', s.id, 'year', s.vintage_year, 'score', s.score, 'body', s.body,
                                          'tastedOn', s.tasted_on, 'publishedAt', s.published_at,
                                          'edited', s.updated_at > s.published_at + interval '1 minute',
                                          'author', coalesce(nullif(btrim(p.display_name), ''), null),
                                          'mine', s.user_id = p_viewer) as j
                                   from subj s join public.profiles p on p.id = s.user_id
                                  order by (s.body is not null) desc, s.published_at desc
                                  limit least(greatest(coalesce(p_limit, 20), 1), 100)) x), '[]'::jsonb))
$$;
revoke all on function private.community_reviews_impl(uuid, uuid, uuid, int) from public, anon, authenticated, service_role;

-- A household wine's community reviews, for a member of that household (its subject, as when publishing).
create function public.community_reviews_for_wine(p_household_id uuid, p_wine_id uuid, p_limit int default 20)
  returns jsonb
  language plpgsql stable security definer set search_path = '' as $$
declare subj record;
begin
  if auth.uid() is null or p_household_id is null or not (p_household_id = any (private.my_household_ids())) then
    return null;
  end if;
  select * into subj from private.review_subject_of_wine(p_household_id, p_wine_id);
  if subj.subject_wine_id is null and subj.subject_record_id is null then return null; end if;
  return private.community_reviews_impl(subj.subject_wine_id, subj.subject_record_id, auth.uid(), p_limit)
         || jsonb_build_object('reviewable', true);
end $$;

-- A provider record's community reviews (the catalogue page of a record shown to people).
create function public.community_reviews_for_record(p_record_id uuid, p_limit int default 20) returns jsonb
  language plpgsql stable security definer set search_path = '' as $$
declare canon uuid[];
begin
  if auth.uid() is null then return null; end if;
  if not exists (select 1 from public.catalog_external_records e
                   join public.catalog_providers pr on pr.id = e.provider_id and pr.search_scope = 'public'
                                                    and pr.rights_status = 'verified' and pr.may_display
                                                    and pr.commercial_use
                  where e.id = p_record_id and e.status = 'active') then
    return null;
  end if;
  select array_agg(distinct l.wine_id) into canon from public.catalog_record_links l
   where l.record_id = p_record_id and l.state = 'verified';
  if cardinality(canon) = 1 then
    return private.community_reviews_impl(canon[1], null, auth.uid(), p_limit);
  end if;
  return private.community_reviews_impl(null, p_record_id, auth.uid(), p_limit);
end $$;

-- The caller's own review of a tasting (to show "published" and its text), or null.
create function public.my_community_review(p_tasting_id uuid) returns jsonb
  language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', r.id, 'status', r.status, 'body', r.body, 'score', r.score,
                            'publishedAt', r.published_at)
    from public.community_reviews r where r.tasting_id = p_tasting_id and r.user_id = auth.uid()
$$;

revoke all on function public.publish_community_review(uuid, text, boolean),
                       public.delete_community_review(uuid),
                       public.report_community_review(uuid, text, text),
                       public.community_reviews_for_wine(uuid, uuid, int),
                       public.community_reviews_for_record(uuid, int),
                       public.my_community_review(uuid),
                       public.admin_moderate_community_review(uuid, text, text, text, uuid),
                       public.admin_community_review_queue(int)
  from public, anon;
grant execute on function public.publish_community_review(uuid, text, boolean),
                          public.delete_community_review(uuid),
                          public.report_community_review(uuid, text, text),
                          public.community_reviews_for_wine(uuid, uuid, int),
                          public.community_reviews_for_record(uuid, int),
                          public.my_community_review(uuid)
  to authenticated, service_role;
revoke all on function public.admin_moderate_community_review(uuid, text, text, text, uuid),
                       public.admin_community_review_queue(int)
  from authenticated;
grant execute on function public.admin_moderate_community_review(uuid, text, text, text, uuid),
                          public.admin_community_review_queue(int)
  to service_role;

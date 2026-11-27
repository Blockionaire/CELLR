-- Community reviews, hardened before activation (Ratings sprint). Design: docs/sprints/ratings/DESIGN.md §3.
--
-- 1. One text rule against links and contact addresses, the same as the app's (packages/domain/src/review-text.ts,
--    whose patterns a web test finds verbatim below): Unicode NFKC first, invisible format characters removed, then
--    eight case-insensitive patterns: a scheme (http, https, ftp), `www`, an e-mail address, a domain with a generic
--    ending (also with a space before its dot), a domain with a two-letter ending, a spelled-out "dot" or "punt", and
--    any domain-like name followed by a slash (t.me/x); obfuscated dots and at signs ("[.]", "(dot)", "(at)", "·")
--    count. Publishing refuses such a text ('invalid_text'), and a new table check refuses it whatever writes the row.
-- 2. A new account cannot publish or report yet: at least 24 hours old (auth.users.created_at), and confirmed
--    (email_confirmed_at) or signed in at least once (last_sign_in_at). Otherwise 'too_new'. Reading is never
--    blocked. In practice this is an account-age rule: see section 2 below.
-- 3. Publishing also has a daily cap (40 a day) next to the hourly one (20 an hour); reports keep 20 a day.
--
-- Unchanged: the gate of 20261202000054 (the community stays closed until its owner opens it), one review per person
-- per subject and vintage (also across a record and its canonical wine), moderation tombstones, reports counted only
-- from people who use CELLR, and the private note never copied. The two functions are replaced with `create or
-- replace`: same signatures, same grants; their bodies are 20261130000052's plus the steps marked "(0055)".
--
-- Additive. Rolling back: re-run the two function definitions of 20261130000052 and drop the constraint
-- community_reviews_no_links_v2 and the functions private.review_text_has_link, private.community_account_ready.

-- ---- 1. The text rule -------------------------------------------------------------------------------------------
create function private.review_text_has_link(p text) returns boolean
  language sql immutable parallel safe set search_path = '' as $$
  select t ~* '(https?|ftps?)\s*:\s*/'
      or t ~* '(^|[^a-z0-9])www([^a-z0-9]|$)'
      or t ~* '[a-z0-9._%+-](\s*@\s*|\s*[[({<]\s*(@|at)\s*[)\]}>]\s*)[a-z0-9-]+(([.。·]|\s*[[({<]\s*([.。·]|dot|punt)\s*[)\]}>]\s*)[a-z0-9-]+)*([.。·]|\s*[[({<]\s*([.。·]|dot|punt)\s*[)\]}>]\s*)[a-z]{2,}'
      or t ~* '[a-z0-9]([.。·]|\s*[[({<]\s*([.。·]|dot|punt)\s*[)\]}>]\s*)(com|net|org|info|biz|xyz|top|online|site|website|space|shop|store|club|app|dev|wine|vin|link|click|live|life|fun|work|buzz|rest|bond|cfd|sbs|cyou|quest|lol|monster|icu|vip|tech|blog|email|cloud|mobi|asia)([^a-z0-9]|$)'
      or t ~* '[a-z0-9]\s+[.。·]\s*(com|net|org|info|biz|xyz|top|online|site|website|space|shop|store|club|app|dev|wine|vin|link|click|live|life|fun|work|buzz|rest|bond|cfd|sbs|cyou|quest|lol|monster|icu|vip|tech|blog|email|cloud|mobi|asia)([^a-z0-9]|$)'
      or t ~* '[a-z0-9]{2}([.。·]|\s*[[({<]\s*([.。·]|dot|punt)\s*[)\]}>]\s*)[a-z]{2}([^a-z0-9]|$)'
      or t ~* '[a-z0-9]\s+(dot|punt)\s+(com|net|org|info|biz|xyz|top|online|site|website|space|shop|store|club|app|dev|wine|vin|link|click|live|life|fun|work|buzz|rest|bond|cfd|sbs|cyou|quest|lol|monster|icu|vip|tech|blog|email|cloud|mobi|asia|nl|be|de|fr|uk|eu|io|co|ru|cn)([^a-z0-9]|$)'
      or t ~* '[a-z0-9]([.。·]|\s*[[({<]\s*([.。·]|dot|punt)\s*[)\]}>]\s*)[a-z]{2,}\s*/'
    from (select regexp_replace(normalize(coalesce(p, ''), nfkc), '[\u00ad\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]', '', 'g') as t) n
$$;
revoke all on function private.review_text_has_link(text) from public, anon, authenticated;
-- the table check below runs as whoever writes the row: the functions (their owner) and the service role
grant execute on function private.review_text_has_link(text) to service_role;

-- The table refuses such a text too. NOT VALID first, so that this migration can never fail on an existing row; it
-- is validated at once when no row breaks the rule (the community is closed: there are none). Should one exist, it
-- stays NOT VALID with a notice, and a moderator removes that review before `validate constraint` is run. Until then
-- such a row would also refuse any later update of itself (e.g. the follow-tasting trigger carrying over a new
-- score); unreachable while the community is closed, as no review exists.
alter table public.community_reviews
  add constraint community_reviews_no_links_v2 check (body is null or not private.review_text_has_link(body)) not valid;
do $$
begin
  if exists (select 1 from public.community_reviews where body is not null and private.review_text_has_link(body)) then
    raise notice 'community_reviews_no_links_v2 left NOT VALID: an existing review breaks the text rule';
  else
    alter table public.community_reviews validate constraint community_reviews_no_links_v2;
  end if;
end $$;

-- ---- 2. Old enough to take part ---------------------------------------------------------------------------------
-- An account may publish and report once it is at least 24 hours old, and confirmed or signed in at least once.
-- Honestly: the second half adds little. CELLR signs people in only with a code or link sent to their e-mail address
-- (server/auth/gateway.ts: verifyOtp, also behind the PIN), every completed sign-in sets last_sign_in_at, and with
-- e-mail confirmations off (supabase/config.toml: enable_confirmations = false) Supabase Auth sets
-- email_confirmed_at at sign-up already. Anyone able to call this function has signed in, so in practice the rule
-- is "at least 24 hours old"; the second half only keeps out a row with neither value, and can never hold back
-- someone who has signed in. A missing or unknown value counts as not yet.
create function private.community_account_ready(p_user uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select coalesce((select (u.email_confirmed_at is not null or u.last_sign_in_at is not null)
                          and u.created_at <= now() - interval '24 hours'
                     from auth.users u where u.id = p_user), false)
$$;
revoke all on function private.community_account_ready(uuid) from public, anon, authenticated, service_role;

-- ---- 3. Publishing ----------------------------------------------------------------------------------------------
-- 'published' · 'updated' · 'not_yours' · 'no_score' · 'no_identity' · 'no_consent' · 'too_new' (0055: the account
-- is younger than 24 hours, or neither confirmed nor ever signed in) · 'rate_limited' · 'invalid_text' ·
-- 'moderated'. Every refusal before the rate limits spends none of it.
create or replace function public.publish_community_review(p_tasting_id uuid, p_body text, p_consent boolean)
  returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare t record; subj record; b text; rid uuid; ex public.community_reviews; m date;
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
  -- (0055) a new or unconfirmed account takes no part yet
  if not private.community_account_ready(auth.uid()) then
    return jsonb_build_object('status', 'too_new');
  end if;
  -- control characters out, line breaks kept (at most one empty line in a row)
  b := regexp_replace(coalesce(p_body, ''), '[\x01-\x09\x0b-\x1f\x7f]+', ' ', 'g');
  b := nullif(btrim(regexp_replace(b, '\n{3,}', E'\n\n', 'g')), '');
  -- (0055) the one text rule: no link, no address, also obfuscated
  if b is not null and (char_length(b) > 1500 or private.review_text_has_link(b)) then
    return jsonb_build_object('status', 'invalid_text');
  end if;
  -- also serialises two publishes of the same person (the advisory lock in consume_rate_limit), so the lookup
  -- below and the insert cannot race into two reviews
  if not private.consume_rate_limit(auth.uid(), 'community_review_publish', 20, interval '1 hour') then
    return jsonb_build_object('status', 'rate_limited');
  end if;
  -- (0055) and at most 40 a day
  if not private.consume_rate_limit(auth.uid(), 'community_review_publish_day', 40, interval '1 day') then
    return jsonb_build_object('status', 'rate_limited');
  end if;
  m := date_trunc('month', t.tasted_at at time zone 'UTC')::date;

  -- one review per person, subject and vintage, also across a record and the canonical wine it is verified as
  select r.* into ex from public.community_reviews r
   where r.user_id = auth.uid() and r.vintage_year is not distinct from t.year
     and (coalesce(r.subject_wine_id, r.subject_record_id) = coalesce(subj.subject_wine_id, subj.subject_record_id)
          or (subj.subject_wine_id is not null
              and r.subject_record_id in (select l.record_id from public.catalog_record_links l
                                           where l.wine_id = subj.subject_wine_id and l.state = 'verified')))
   order by (r.status <> 'published') desc, r.updated_at desc
   limit 1
   for update;
  -- a moderated review stays as the moderator left it: not revived, not rewritten
  if ex.id is not null and ex.status <> 'published' then
    return jsonb_build_object('status', 'moderated');
  end if;
  -- a second published review of the same wine and vintage (made before a record was verified as that wine)
  -- gives way to this one
  delete from public.community_reviews r
   where r.user_id = auth.uid() and r.vintage_year is not distinct from t.year and r.status = 'published'
     and r.id is distinct from ex.id
     and (coalesce(r.subject_wine_id, r.subject_record_id) = coalesce(subj.subject_wine_id, subj.subject_record_id)
          or (subj.subject_wine_id is not null
              and r.subject_record_id in (select l.record_id from public.catalog_record_links l
                                           where l.wine_id = subj.subject_wine_id and l.state = 'verified')));
  -- this tasting's review about another subject (the wine's identity changed since) gives way
  perform private.community_review_release_tasting(t.id, ex.id);
  if ex.id is null then
    insert into public.community_reviews (tasting_id, user_id, subject_wine_id, subject_record_id, vintage_year,
                                          score, body, tasted_on)
    values (t.id, auth.uid(), subj.subject_wine_id, subj.subject_record_id, t.year, t.score, b, m)
    returning id into rid;
    return jsonb_build_object('status', 'published', 'reviewId', rid);
  end if;
  update public.community_reviews
     set tasting_id = t.id, subject_wine_id = subj.subject_wine_id, subject_record_id = subj.subject_record_id,
         score = t.score, body = b, tasted_on = m, updated_at = now()
   where id = ex.id;
  return jsonb_build_object('status', 'updated', 'reviewId', ex.id);
end $$;

-- ---- 4. Reporting -----------------------------------------------------------------------------------------------
-- 'reported' · 'already_reported' · 'not_found' · 'too_new' (0055, as above) · 'rate_limited'.
create or replace function public.report_community_review(p_review_id uuid, p_reason text, p_detail text default null)
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
  -- (0055) a new or unconfirmed account cannot report yet
  if not private.community_account_ready(auth.uid()) then return 'too_new'; end if;
  if not private.consume_rate_limit(auth.uid(), 'community_review_report', 20, interval '1 day') then
    return 'rate_limited';
  end if;
  insert into public.community_review_reports (review_id, reporter_id, reason, detail)
  values (p_review_id, auth.uid(), p_reason, left(nullif(btrim(p_detail), ''), 300));
  -- only reports of people who use CELLR count towards hiding (a household and a tasting of their own): three
  -- throwaway accounts cannot hide a review; and a review a moderator restored is never hidden again by reports
  -- alone (it goes to the queue). Residual risk, accepted and documented: DESIGN.md §3.
  select count(*) into n
    from public.community_review_reports rp
   where rp.review_id = p_review_id and rp.resolved_at is null
     and exists (select 1 from public.household_members hm where hm.user_id = rp.reporter_id)
     and exists (select 1 from public.tastings tg where tg.user_id = rp.reporter_id);
  if n >= 3 then
    update public.community_reviews set status = 'hidden', status_reason = 'reports', updated_at = now()
     where id = p_review_id and status = 'published' and moderated_at is null;
    if not found then return 'reported'; end if;
    insert into public.community_review_moderation_log (review_id, action, reason, actor)
    values (p_review_id, 'auto_hide', n || ' open reports', 'system');
  end if;
  return 'reported';
end $$;

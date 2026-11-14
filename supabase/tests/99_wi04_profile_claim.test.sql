begin;
-- Wine Intelligence WI-04: the claim that makes two simultaneous first requests for one shared wine profile
-- research it once (public.claim_shared_profile_research).

create function test.wi4_claims() returns bigint language sql security definer as $$
  select count(*) from private.shared_profile_claims
$$;
grant execute on function test.wi4_claims() to public;
create function test.wi4_age(v uuid, lang text, secs int) returns void language sql security definer as $$
  update private.shared_profile_claims set claimed_at = now() - make_interval(secs => secs)
   where vintage_id = v and language = lang
$$;
grant execute on function test.wi4_age(uuid, text, int) to public;
create function test.wi4_columns() returns text language sql security definer as $$
  select string_agg(attname, ',' order by attname) from pg_attribute
   where attrelid = 'private.shared_profile_claims'::regclass and attnum > 0 and not attisdropped
$$;
grant execute on function test.wi4_columns() to public;
-- The claim's answer, as the existing assertions read it: was it granted (to research now)?
create function test.wi4_claim(v uuid, lang text, ttl int default 120) returns boolean language sql as $$
  select (public.claim_shared_profile_research(v, lang, ttl)->>'granted')::boolean
$$;
grant execute on function test.wi4_claim(uuid, text, int) to public;
create function test.wi4_token(v uuid, lang text) returns uuid language sql security definer as $$
  select token from private.shared_profile_claims where vintage_id = v and language = lang
$$;
grant execute on function test.wi4_token(uuid, text) to public;
create function test.wi4_forbidden(q text) returns boolean language plpgsql as $$
begin
  execute q;
  return false;
exception when insufficient_privilege then return true;
end $$;
grant execute on function test.wi4_forbidden(text) to public;

do $$
declare h1 uuid; cp uuid; cw uuid; cv uuid; cv2 uuid; pp uuid; pw uuid; pv uuid; tok uuid; j jsonb; j2 jsonb;
begin
  perform test.mk_users(1);
  perform test.as_user(1); h1 := public.create_household('Claims');
  perform test.su();
  insert into public.producers (name, country_code, status, origin) values ('Bodegas Claim', 'ES', 'canonical', 'verified')
    returning id into cp;
  insert into public.wines (producer_id, name, wine_type, country_code, status, origin)
    values (cp, 'Reserva', 'red', 'ES', 'canonical', 'verified') returning id into cw;
  insert into public.wine_vintages (wine_id, year) values (cw, 2019) returning id into cv;
  insert into public.wine_vintages (wine_id, year) values (cw, 2020) returning id into cv2;
  perform test.as_user(1);
  insert into public.producers (name, country_code, status, owner_household_id, origin)
    values ('Eigen Huis', 'ES', 'provisional', h1, 'user_entered') returning id into pp;
  insert into public.wines (producer_id, name, wine_type, country_code, status, owner_household_id, origin)
    values (pp, 'Eigen Wijn', 'red', 'ES', 'provisional', h1, 'user_entered') returning id into pw;
  insert into public.wine_vintages (wine_id, year) values (pw, 2019) returning id into pv;

  -- people (and anonymous callers) have no right to claim: only the server does, for them
  perform test.rec('claim: people may not claim', test.wi4_forbidden(
    format('select public.claim_shared_profile_research(%L, %L)', cv, 'en')));
  perform test.as_anon();
  perform test.rec('claim: nor anonymous callers', test.wi4_forbidden(
    format('select public.claim_shared_profile_research(%L, %L)', cv, 'en')));
  perform test.rec('claim: the claims are not readable through the API',
    test.denied('select 1 from private.shared_profile_claims'));

  perform test.as_service();
  perform test.rec('claim: the first request gets it', test.wi4_claim(cv, 'en'));
  perform test.rec('claim: a second request moments later does not', not test.wi4_claim(cv, 'en'));
  perform test.rec('claim: nor a third', not test.wi4_claim(cv, 'en'));
  perform test.rec('claim: another language is its own research', test.wi4_claim(cv, 'nl'));
  perform test.rec('claim: another vintage is its own research', test.wi4_claim(cv2, 'en'));
  perform test.rec('claim: three claims, and nothing but a vintage, a language, a time and the owner''s random token in any of them',
    test.wi4_claims() = 3 and test.wi4_columns() = 'claimed_at,language,token,vintage_id');

  -- a claim expires by itself: a request that failed never blocks research for longer than its time
  perform test.wi4_age(cv, 'en', 119);
  perform test.rec('claim: still held just inside its time', not test.wi4_claim(cv, 'en'));
  perform test.wi4_age(cv, 'en', 121);
  perform test.rec('claim: free again once its time has passed', test.wi4_claim(cv, 'en'));
  perform test.rec('claim: and then held by the new claimer', not test.wi4_claim(cv, 'en'));
  -- a caller cannot make a claim worthless by asking for a one-second time: ten seconds is the least
  perform test.wi4_age(cv, 'en', 5);
  perform test.rec('claim: the time asked for is bounded below', not test.wi4_claim(cv, 'en', 1));
  perform test.wi4_age(cv, 'en', 12);
  perform test.rec('claim: and free after that least time', test.wi4_claim(cv, 'en', 1));

  -- giving a claim back: only its owner can, and the next request then takes it at once
  perform test.as_user(1);
  perform test.rec('release: people may not give a claim back', test.wi4_forbidden(
    format('select public.release_shared_profile_research(%L, %L, %L)', cv, 'en', gen_random_uuid())));
  perform test.as_anon();
  perform test.rec('release: nor anonymous callers', test.wi4_forbidden(
    format('select public.release_shared_profile_research(%L, %L, %L)', cv, 'en', gen_random_uuid())));
  perform test.as_service();
  perform test.rec('release: held before it is given back', not test.wi4_claim(cv, 'en'));
  tok := test.wi4_token(cv, 'en');
  perform test.rec('release: a wrong token gives nothing back',
    not public.release_shared_profile_research(cv, 'en', gen_random_uuid())
    and not public.release_shared_profile_research(cv, 'en', null)
    and not test.wi4_claim(cv, 'en') and test.wi4_claims() = 3);
  perform test.rec('release: the token of ANOTHER claim gives nothing back',
    not public.release_shared_profile_research(cv, 'en', test.wi4_token(cv, 'nl'))
    and not public.release_shared_profile_research(cv2, 'en', tok) and test.wi4_claims() = 3);
  perform test.rec('release: the owner''s token gives it back, and only that vintage and language',
    public.release_shared_profile_research(cv, 'en', tok)
    and test.wi4_claims() = 2 and not test.wi4_claim(cv, 'nl') and not test.wi4_claim(cv2, 'en'));
  perform test.rec('release: giving back twice is not an error, and changes nothing',
    not public.release_shared_profile_research(cv, 'en', tok) and test.wi4_claims() = 2);
  -- the answer carries the token to the one who was granted, and to nobody else
  j := public.claim_shared_profile_research(cv, 'en');
  perform test.rec('claim: the granted answer carries the owner''s token',
    (j->>'granted')::boolean and (j->>'token')::uuid = test.wi4_token(cv, 'en'));
  j2 := public.claim_shared_profile_research(cv, 'en');
  perform test.rec('claim: a refused answer carries no token',
    not (j2->>'granted')::boolean and j2->'token' = 'null'::jsonb);
  -- expiry and takeover: the claim changes hands, and the old owner's token is void
  perform test.wi4_age(cv, 'en', 121);
  j2 := public.claim_shared_profile_research(cv, 'en');
  perform test.rec('takeover: an expired claim is granted to the next request with a NEW token',
    (j2->>'granted')::boolean and (j2->>'token') <> (j->>'token'));
  perform test.rec('takeover: the old owner''s late release does not give back the new owner''s claim',
    not public.release_shared_profile_research(cv, 'en', (j->>'token')::uuid)
    and not test.wi4_claim(cv, 'en') and test.wi4_token(cv, 'en') = (j2->>'token')::uuid);
  perform test.rec('takeover: the new owner gives it back', public.release_shared_profile_research(cv, 'en', (j2->>'token')::uuid));
  perform test.rec('release: and it is claimable again', test.wi4_claim(cv, 'en'));

  -- nothing to share, nothing to claim: research goes ahead as before and nothing is written
  perform test.rec('claim: a household''s own wine is always "go ahead", and leaves no claim',
    test.wi4_claim(pv, 'en') and test.wi4_claim(pv, 'en')
    and test.wi4_claims() = 3);
  perform test.rec('claim: "go ahead" for a wine with nothing to share carries no token (nothing to give back)',
    public.claim_shared_profile_research(pv, 'en')->'token' = 'null'::jsonb);
  perform test.rec('claim: so is a vintage that does not exist',
    test.wi4_claim(gen_random_uuid(), 'en') and test.wi4_claims() = 3);
  perform test.rec('claim: an unknown language is refused',
    test.denied(format('select public.claim_shared_profile_research(%L, %L)', cv, 'fr')));

  -- old claims do not pile up; a claim goes with its vintage
  perform test.wi4_age(cv2, 'en', 90000);
  perform test.wi4_claim(cv, 'nl');
  perform test.rec('claim: a claim older than a day is removed', test.wi4_claims() = 2);
  perform test.su();
  delete from public.wine_vintages where id = cv;
  perform test.rec('claim: a deleted vintage takes its claims with it', test.wi4_claims() = 0);
  perform test.rec('claim: taking a claim writes nothing else',
    (select provolatile from pg_proc where oid = 'public.claim_shared_profile_research(uuid, text, int)'::regprocedure) = 'v'
    and test.count_of('select 1 from public.shared_wine_profiles') = 0);
end $$;
rollback;

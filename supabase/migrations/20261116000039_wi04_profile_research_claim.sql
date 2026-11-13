-- Wine Intelligence WI-04: research a shared wine profile once, also when two households ask at the same moment.
-- Additive: one private table and one service-role function. Nothing existing changes.
-- Design: docs/sprints/wine-intelligence-mega/ADR-003-wine-and-vintage-knowledge.md.
--
-- A shared profile (20261030000022) is one row per vintage and language, but two FIRST requests seconds apart both
-- found no row and both paid for the research; only one result was kept. A claim says "this vintage is being
-- researched in this language right now": the first request gets it and researches; a second request does not, and
-- waits a moment for the first one's profile instead of paying for the same research.
--
-- A claim is not a lock: the request that took it gives it back when it is done (researched, failed, or refused by
-- its rate limit), and it expires by itself if that request died. It holds no household or person, and it is only
-- ever taken for a vintage whose profile CAN be shared (a canonical wine of a canonical producer). For any other
-- vintage the answer is "go ahead" and nothing is written.
--
-- A claim has an OWNER: taking it returns a random token, and only that token gives it back. So a request that was
-- slow enough to lose its claim (it expired and another request took over), or one that never held a claim at all
-- (its own call failed and it went ahead anyway), cannot give back somebody else's claim.

create table private.shared_profile_claims (
  vintage_id uuid not null references public.wine_vintages on delete cascade,
  language   text not null check (language in ('en', 'nl')),
  claimed_at timestamptz not null default now(),
  -- who holds it: known only to the request that took it (returned once, never readable through the API)
  token      uuid not null default gen_random_uuid(),
  primary key (vintage_id, language)
);
alter table private.shared_profile_claims enable row level security;
revoke all on private.shared_profile_claims from public, anon, authenticated, service_role;

-- The answer is one of three:
--   {"granted": true,  "token": "<uuid>"}  yours to research now; give it back with this token when done
--   {"granted": true,  "token": null}      nothing to share (not a catalogue vintage): research as before
--   {"granted": false, "token": null}      someone claimed it less than p_ttl_seconds ago: wait for their profile
-- Atomic: of any number of simultaneous callers exactly one gets a token.
create function public.claim_shared_profile_research(p_vintage_id uuid, p_language text,
                                                     p_ttl_seconds int default 120) returns jsonb
  language plpgsql volatile security definer set search_path = '' as $$
declare
  ttl interval := make_interval(secs => least(greatest(coalesce(p_ttl_seconds, 120), 10), 600));
  mine uuid := gen_random_uuid();
  got uuid;
begin
  if p_language not in ('en', 'nl') then
    raise exception 'unknown language' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.wine_vintages v
      join public.wines w on w.id = v.wine_id
      join public.producers pr on pr.id = w.producer_id
     where v.id = p_vintage_id
       and w.status = 'canonical' and w.owner_household_id is null
       and pr.status = 'canonical' and pr.owner_household_id is null) then
    return jsonb_build_object('granted', true, 'token', null);   -- not a shared identity: nothing to claim
  end if;
  insert into private.shared_profile_claims as c (vintage_id, language, token)
  values (p_vintage_id, p_language, mine)
  on conflict (vintage_id, language) do update
     set claimed_at = now(), token = excluded.token   -- an expired claim changes hands: the old token is void
   where c.claimed_at < now() - ttl
  returning c.token into got;
  -- A claim older than a day is of no use to anyone: kept tidy without a schedule. Rows another call is working on
  -- are skipped, so two calls tidying at the same moment never wait for each other.
  delete from private.shared_profile_claims c
   using (select o.vintage_id, o.language from private.shared_profile_claims o
           where o.claimed_at < now() - interval '1 day'
           limit 50 for update skip locked) old
   where c.vintage_id = old.vintage_id and c.language = old.language;
  return jsonb_build_object('granted', got is not null, 'token', got);
end $$;

-- Gives a claim back: the request that held it is done, whatever the outcome. Only the token that took the claim
-- gives it back; any other token (a claim that changed hands meanwhile) changes nothing. True = it was given back.
-- A waiting request then takes the claim at its next look and researches, instead of waiting on.
create function public.release_shared_profile_research(p_vintage_id uuid, p_language text, p_token uuid)
  returns boolean
  language plpgsql volatile security definer set search_path = '' as $$
declare n int;
begin
  if p_token is null then return false; end if;
  delete from private.shared_profile_claims
   where vintage_id = p_vintage_id and language = p_language and token = p_token;
  get diagnostics n = row_count;
  return n = 1;
end $$;

revoke all on function public.claim_shared_profile_research(uuid, text, int),
                       public.release_shared_profile_research(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_shared_profile_research(uuid, text, int),
                          public.release_shared_profile_research(uuid, text, uuid)
  to service_role;

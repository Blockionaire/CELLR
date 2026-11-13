-- Wine Intelligence WI-04: research a shared wine profile once, also when two households ask at the same moment.
-- Additive: one private table and one service-role function. Nothing existing changes.
-- Design: docs/sprints/wine-intelligence-mega/ADR-003-wine-and-vintage-knowledge.md.
--
-- A shared profile (20261030000022) is one row per vintage and language, but two FIRST requests seconds apart both
-- found no row and both paid for the research; only one result was kept. A claim says "this vintage is being
-- researched in this language right now": the first request gets it and researches; a second request does not, and
-- waits a moment for the first one's profile instead of paying for the same research.
--
-- A claim is not a lock: it expires by itself (a request that failed never blocks anyone for longer than the wait),
-- it holds no household or person, and it is only ever taken for a vintage whose profile CAN be shared (a canonical
-- wine of a canonical producer). For any other vintage the answer is "go ahead" and nothing is written.

create table private.shared_profile_claims (
  vintage_id uuid not null references public.wine_vintages on delete cascade,
  language   text not null check (language in ('en', 'nl')),
  claimed_at timestamptz not null default now(),
  primary key (vintage_id, language)
);
alter table private.shared_profile_claims enable row level security;
revoke all on private.shared_profile_claims from public, anon, authenticated, service_role;

-- True = yours to research now (or nothing to share: research as before). False = someone claimed it less than
-- p_ttl_seconds ago: wait for their profile. Atomic: of any number of simultaneous callers exactly one gets true.
create function public.claim_shared_profile_research(p_vintage_id uuid, p_language text,
                                                     p_ttl_seconds int default 120) returns boolean
  language plpgsql volatile security definer set search_path = '' as $$
declare
  ttl interval := make_interval(secs => least(greatest(coalesce(p_ttl_seconds, 120), 10), 600));
  n int;
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
    return true;   -- not a shared identity: nothing to claim, nothing to wait for
  end if;
  insert into private.shared_profile_claims as c (vintage_id, language)
  values (p_vintage_id, p_language)
  on conflict (vintage_id, language) do update
     set claimed_at = now()
   where c.claimed_at < now() - ttl;
  get diagnostics n = row_count;
  -- a claim older than a day is of no use to anyone: kept tidy without a schedule
  delete from private.shared_profile_claims where claimed_at < now() - interval '1 day';
  return n = 1;
end $$;
revoke all on function public.claim_shared_profile_research(uuid, text, int) from public, anon, authenticated;
grant execute on function public.claim_shared_profile_research(uuid, text, int) to service_role;

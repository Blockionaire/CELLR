#!/usr/bin/env bash
# The research claim (20261116000039) under real concurrency: separate database sessions, the same moment.
#   1. 20 sessions claim one vintage: exactly one is granted, with a token; 19 are told to wait.
#   2. 20 sessions each try to give that claim back with a token of their own: none succeeds.
#   3. The owner gives it back; 20 sessions claim again: exactly one is granted, with another token.
#   4. The claim expires; 20 sessions take it over at once: exactly one; the old owner's late release changes nothing.
#   5. 10 sessions each claim, hold for a moment and give back, five rounds in a row (claims and releases crossing
#      each other, and the day-old clean-up running in every call): never two owners at once, and nothing left behind.
# Uses a throwaway Postgres like scripts/db-test.sh.   bash scripts/db-claim-concurrency.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/temp-cluster.sh
source "$ROOT/scripts/lib/temp-cluster.sh"
OUT="$(mktemp -d)"
cleanup() { stop_temp_cluster; rm -rf "$OUT"; }
trap cleanup EXIT
start_temp_cluster 54995
apply_schema "$ROOT"
q() { psql "$PGURL" -X -qtA -v ON_ERROR_STOP=1 -c "$1"; }

V=$(q "with p as (insert into public.producers (name, country_code, status, origin)
                    values ('Claim Estate', 'FR', 'canonical', 'verified') returning id),
            w as (insert into public.wines (producer_id, name, wine_type, country_code, status, origin)
                    select id, 'Cuvée Claim', 'red', 'FR', 'canonical', 'verified' from p returning id)
       insert into public.wine_vintages (wine_id, year) select id, 2019 from w returning id")
# a handful of day-old claims of other vintages, so every call below also runs the clean-up
q "with w as (select wine_id from public.wine_vintages where id = '$V'),
        v as (insert into public.wine_vintages (wine_id, year) select wine_id, y from w, generate_series(1990, 1999) y returning id)
   insert into private.shared_profile_claims (vintage_id, language, claimed_at) select id, 'en', now() - interval '2 days' from v" >/dev/null

claim_all() {   # $1 = label; 20 sessions at once; prints "<granted> <distinct tokens>"
  rm -f "$OUT"/c-*
  for i in $(seq 1 20); do
    q "select public.claim_shared_profile_research('$V', 'en')::text" >"$OUT/c-$i" &
  done
  wait
  local granted tokens
  granted=$(cat "$OUT"/c-* | grep -c '"granted": true' || true)
  tokens=$(cat "$OUT"/c-* | grep -o '"token": "[0-9a-f-]*"' | sort -u | wc -l | tr -d ' ')
  echo "$granted $tokens"
}
owner() { q "select token from private.shared_profile_claims where vintage_id = '$V' and language = 'en'"; }
fail() { echo "✗ $1"; exit 1; }

# 1
r=$(claim_all); [ "$r" = "1 1" ] || fail "20 simultaneous claims: expected exactly one grant with one token, got '$r'"
T1=$(owner)
grep -q "\"token\": \"$T1\"" "$OUT"/c-* || fail "the granted answer does not carry the stored token"
echo "• 20 simultaneous claims: 1 granted, 19 told to wait"

# 2
for i in $(seq 1 20); do
  q "select public.release_shared_profile_research('$V', 'en', gen_random_uuid())" >"$OUT/r-$i" &
done
wait
[ "$(cat "$OUT"/r-* | grep -c '^t$' || true)" = 0 ] || fail "a release with a token that is not the owner's succeeded"
[ "$(owner)" = "$T1" ] || fail "the claim changed although nobody held its token"
echo "• 20 simultaneous releases with other tokens: none gave it back"

# 3
[ "$(q "select public.release_shared_profile_research('$V', 'en', '$T1')")" = t ] || fail "the owner could not give its claim back"
r=$(claim_all); [ "$r" = "1 1" ] || fail "after the release: expected exactly one new grant, got '$r'"
T2=$(owner); [ "$T2" != "$T1" ] || fail "the new claim reuses the old token"
echo "• given back by its owner, claimed again: 1 granted, with a new token"

# 4
q "update private.shared_profile_claims set claimed_at = now() - interval '121 seconds' where vintage_id = '$V'" >/dev/null
r=$(claim_all); [ "$r" = "1 1" ] || fail "takeover of an expired claim: expected exactly one grant, got '$r'"
T3=$(owner); [ "$T3" != "$T2" ] || fail "the takeover kept the expired owner's token"
[ "$(q "select public.release_shared_profile_research('$V', 'en', '$T2')")" = f ] || fail "the expired owner's late release gave back the new owner's claim"
[ "$(owner)" = "$T3" ] || fail "the new owner lost its claim to a stale release"
[ "$(q "select public.release_shared_profile_research('$V', 'en', '$T3')")" = t ] || fail "the new owner could not give its claim back"
echo "• expired, taken over by 1 of 20; the old owner's late release changed nothing"

# 5
: >"$OUT/overlap"
worker() {
  for round in $(seq 1 15); do
    t=$(q "select public.claim_shared_profile_research('$V', 'en')->>'token'")
    if [ -n "$t" ]; then
      # while holding: is the stored owner still me? (two owners at once would show here)
      [ "$(owner)" = "$t" ] || echo "overlap" >>"$OUT/overlap"
      q "select public.release_shared_profile_research('$V', 'en', '$t')" >>"$OUT/released-$1"
    fi
  done
}
for i in $(seq 1 10); do worker "$i" & done
wait
[ ! -s "$OUT/overlap" ] || fail "two requests held the claim at the same time"
released=$(cat "$OUT"/released-* 2>/dev/null | grep -c '^t$' || true)
[ "$released" -ge 5 ] || fail "claims were not handed on ($released releases in 150 attempts)"
[ "$(cat "$OUT"/released-* | grep -c '^f$' || true)" = 0 ] || fail "an owner could not give back its own claim"
[ "$(q "select count(*) from private.shared_profile_claims")" = 0 ] || fail "claims were left behind (including the day-old ones the clean-up should remove)"
echo "• 10 sessions × 15 rounds of claim, check, give back: never two owners, $released hand-overs, nothing left behind"
echo "• the research claim is safe under concurrency"

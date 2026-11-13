# ADR-003 — Wine-level and vintage-level knowledge

Status: accepted for WI-04 (behind `purchase_intel`, off by default) · Date: 2026-11-13

## Context

CELLR stores a researched profile per **vintage** (`shared_wine_profiles`: one row per catalogue vintage and
language; `vintage_insights`: the household's copy). Koopcheck compared only what the person typed. Two questions
came from the audit (brief §1A-D) and from `docs/RECOGNITION-ROADMAP.md`:

1. May Koopcheck use a profile that already exists, for a wine the person does **not** own?
2. May anything of the 2019 profile be used for the 2020?

A profile mixes two kinds of statement. "Made of Merlot and Cabernet Franc" and "full-bodied, firm tannin" describe
the wine in most years. "Drink 2022–2040", "worth €40–60", "13.5%", "a hot, early harvest" describe one year.
Reusing the first kind saves research and helps a buying decision. Reusing the second kind would be wrong in a way
nobody could see on the screen.

## Decision

1. **No new store.** No wine-level profile table, no second cache. Wine-level knowledge is **derived at read time**
   from the vintage profiles that exist. There is nothing to keep in step and nothing that can contradict the
   profiles.
2. **Two types, so the rule is structural** (`packages/domain/src/wine-knowledge.ts`):
   - `VintageKnowledge`: the profile of exactly this vintage. Only this may show a drinking window.
   - `StableWineFacts`: `grapes`, `structure`, `fromYears`. The type has **no** field for a drinking window, a value,
     an alcohol level, a decanting time or any free text. `STABLE_FACT_KEYS` is pinned by a test, and
     `VINTAGE_ONLY_FIELDS` lists what never crosses a year.
3. **The same bar as sharing, checked again when read.** A profile counts only if `reusableInsight` accepts it now:
   current version, research that ran, resting on pages about this exact wine, high confidence, nothing
   contradicting the catalogue. A stored row that no longer qualifies is ignored, not repaired and not shown.
4. **Stable facts are conservative.**
   - Grapes: only when **every** valid profile of the wine names the same varieties. Never percentages (the profile
     schema has none).
   - Structure: a scale (body, tannin, sweetness, acidity) only when all valid profiles know it and lie within one
     step of each other.
   - One valid profile is enough; it is then that vintage's statement, shown with the year it came from.
5. **Unknown is not non-vintage.** No vintage given means no vintage-level knowledge at all; stable facts may still
   apply. The non-vintage wine (`year = null`, `nonVintage = true`) has its own profile like any vintage.
6. **Koopcheck fills only what the person left open** (`enrichPurchaseWine`), in this order: the curated catalogue
   (verified), a valid profile of this vintage, the wine's stable facts. What the person typed is never replaced,
   also when CELLR "knows better". Every added value carries its origin (`cellr_catalog` or `ai_estimate`) and its
   level (`wine` or `vintage`), and the result says so.
7. **Only for an exact catalogue identity.** Knowledge is attached when the confirmed producer and name are exactly
   one catalogue wine (`catalogIdentityOf`, the existing rule). A similar name gets nothing. A record of an external
   source has no catalogue identity, so it gets nothing either: it is compared on its own facts.
8. **`checkPurchase` stays the authority.** The verdict is computed by the same deterministic code from the same
   inputs; it now sometimes has grapes and an appellation where it had none. Structure is shown, not scored:
   changing the scoring needs evidence this epic does not have.
9. **Reading is free and silent.** Koopcheck's compare makes two reads as the signed-in person. It never calls a
   model, never holds budget, never writes, and never starts research because a wine was looked at.
10. **No optional AI explanation (brief WI-04 §4).** Not built. The deterministic reasons already say why a verdict
    was reached; a paid paraphrase adds cost and a new place for invented history, with no demonstrated value yet.

## Research once (single flight)

Two first requests for the same catalogue vintage, seconds apart, both paid for the research (R-22). Migration
`20261116000039` adds a **claim**: `claim_shared_profile_research(vintage, language)` (service role only).

- The first request gets the claim and researches. A second request does not; it polls for the shared profile for
  at most 30 s (`SHARED_WAIT`) and reuses it. If none appears, it researches itself: nobody is blocked.
- A claim expires by itself (120 s by default, bounded 10–600 s). It holds a vintage id, a language and a time: no
  household, no person.
- It is taken only for a vintage whose profile can be shared (canonical wine, canonical producer). For anything else
  the answer is "go ahead" and nothing is written.
- If the claim cannot be asked (function not deployed, database error) research goes ahead as before.

This changes an existing paid path only by **removing** calls. It is active whenever the migration is deployed; it is
not behind a feature flag, because it has no visible behaviour except a short wait for the second of two
simultaneous first requests.

## Consequences

- A person checking a 2020 in a shop sees the grapes "from the profile of 2019", labelled as CELLR's AI estimate, and
  is told that no drinking window is carried over. They do not see a window, a value or a tasting text of 2019.
- A wine with profiles that disagree on grapes yields no grapes. That is the intended loss.
- Nothing here turns an estimate into a fact. `ai_estimate` stays `ai_estimate` however often it is reused.

## Rejected

| Alternative                                      | Why not                                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| A `wine_profiles` table with stable facts        | A second cache to invalidate; can contradict the vintage profiles it was copied from        |
| Nearest-vintage profile shown "as an indication" | Carries a window and a harvest story to another year; exactly the error to prevent          |
| Generate a profile when Koopcheck finds none     | A paid call triggered by looking at a wine; the brief forbids it (§WI-04.2 point 5)         |
| Majority vote on grapes                          | A changed blend is real; the newest or the commonest is still a guess about this year       |
| A Postgres advisory lock held during research    | Held across a minute-long HTTP call and a pooled connection; a claim row with a TTL is safe |

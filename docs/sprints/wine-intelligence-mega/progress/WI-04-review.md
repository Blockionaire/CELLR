# Independent review of WI-02, WI-03 and WI-04 · no P1 · 1 P2 and 3 P3 fixed, 4 minor fixed

Date: 2026-11-13 · Reviewed: `fcc103f` (WI-02), `cd44c9c` (WI-03), `354ce1b` (WI-04) · Fixes: the commit that adds
this file

A separate reviewer, with no part in writing the code, was asked to break eight stated properties: tenant isolation,
identity rules, vintage discipline, "typed is never replaced", no new paid call, the research claim, the search
controller's races, and "flags off = unchanged". It worked read-only and verified what it could with throwaway
tests. Its first run was cut off by a usage limit; it was resumed and completed.

## Findings and what was done

| #   | Sev. | Finding                                                                                                                                                                                                                                                                                             | Verified by the reviewer             | Fix                                                                                                                                                                                                                                                                       |
| --- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | P2   | **The research claim was taken before the rate limit and never given back.** A rate-limited person, a failed research or an unpublishable profile left a claim behind; everyone else asking for that vintage then waited the full 30 s for a profile that was not coming, also with every flag off. | a throwaway test, both scenarios     | The claim is now always given back (`release_shared_profile_research`, in a `finally`): after publishing, after a failure, after a refusal by the rate limit. A waiting request retakes the claim at its next look (2 s) and researches. Tests: unit (5 new), SQL (7 new) |
| 2   | P3   | **The wait (30 s) was shorter than the research it waits for (60 s),** and after the wait all waiters researched at once.                                                                                                                                                                           | reading                              | The wait is one research timeout (60 s). A waiter proceeds only by taking the claim, so one takes over and the rest keep waiting for it. Unit test: three waiters, one research                                                                                           |
| 3   | P3   | **Koopcheck said "Chosen from your own wines" for a catalogue wine** picked from the list shown before typing; that list held the whole catalogue under the title "Your wines".                                                                                                                     | reading                              | The note follows the wine (`wine.catalog`); Koopcheck's idle list holds the household's own wines only. The fallback notices no longer claim the list is "your own wines"                                                                                                 |
| 4   | P3   | **After "too many searches" the notice stayed until the person typed again;** nothing ended the cool-down on screen.                                                                                                                                                                                | reading                              | When the cool-down ends the search asks once, by itself, for what is typed then. Still at most one request per cool-down. Unit tests (2 new, 1 changed)                                                                                                                   |
| 5   | min. | `listSharedProfiles`: 30 rows with no order, while its comment promised "newest vintage first".                                                                                                                                                                                                     | reading                              | Ordered (most recently researched first), 60 rows, and the comment says what happens beyond that: less is shown, never something wrong                                                                                                                                    |
| 6   | min. | Scan review: after a client re-match the server's `resolution` was kept and could go stale.                                                                                                                                                                                                         | reading                              | Dropped on re-match, as the comment always said                                                                                                                                                                                                                           |
| 7   | min. | The result list was always labelled "Wines found"; the chosen wine's check mark had no accessible name.                                                                                                                                                                                             | reading                              | The list is labelled by its visible title; the check mark says "Chosen" / "Gekozen"                                                                                                                                                                                       |
| 8   | min. | UNVERIFIED by the reviewer: the claim's day-old clean-up could deadlock two simultaneous calls.                                                                                                                                                                                                     | not verified (no database available) | Plausible on reading (each call holds its own row and then tries to delete the other's). The clean-up now skips rows another call is working on (`for update skip locked`). **Not reproduced**, so the fix is by construction, not by a failing test                      |

Migration `20261116000039` was edited for 1 and 8. That is allowed: it has not been merged to `main` and has never
been applied to a hosted database (`pnpm migrations:check` passes).

## Checked by the reviewer and found sound

- **Tenant isolation.** The Koopcheck knowledge reads use the signed-in person's client. `getCatalogWine` requires a
  canonical wine without an owner and a canonical producer. The only new service-role use is the claim.
- **Vintage discipline.** Exact profile by `year` equality only; an unknown vintage gets no vintage profile;
  `StableWineFacts` has no window, value, ABV or text; grapes cross a vintage only when every valid profile agrees;
  only open fields are filled; "Correct the wine" returns to what was typed.
- **Identity.** The resolver drops provider records; a catalogue wine is "found" only through `isCatalogIdentity`;
  the client re-match uses only the server's candidates plus the household's own wines.
- **Migration `…0039`.** Additive; RLS on and all grants revoked; `security definer` with an empty search path;
  service role only; atomic upsert; bounded TTL; no dynamic SQL.
- **Budget.** Existing tasks behave as before; unknown task names (including `__proto__`-style) fail closed.
- **Search controller.** The sequence guard covers every stale path, including an abort while the body is read.
- **i18n.** Identical key sets in `en.json` and `nl.json`.
- **Flags off.** WI-02 and WI-03 paths unchanged. The one change without a flag is the claim (finding 1).

## What the review did not cover

- No database was available to the reviewer: SQL behaviour was judged by reading. The SQL tests are mine.
- No browser run: UI findings are from reading. The e2e runs are mine.
- WI-05 onwards.

## After the fixes

| Check                                                                                                   | Result                                                  |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| format, lint, typecheck                                                                                 | pass                                                    |
| unit                                                                                                    | web 771, domain 635, scan-eval 83, catalog-tools 86     |
| `pnpm db:test`, `db:types:check`, `migrations:check`                                                    | 1229 passed; types current; no merged migration changed |
| e2e `wine-search`, `scan-resolver`, `purchase-intel`, `insights`, `sprint-z` (one run, phone + desktop) | 58 passed, 0 failed, 0 flaky                            |

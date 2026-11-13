# WI-001 — Wine Intelligence Mega Sprint: final report

> **DRAFT.** The rows of §4 marked pending are filled in by the final WI-07 commit. Until then, do not read this
> file as a completed regression.

Date: 2026-11-13 · Branch: `claude/wine-intelligence-mega-sprint-agnxu9` · Draft PR:
[Blockionaire/CELLR#68](https://github.com/Blockionaire/CELLR/pull/68) · Base: `main` @ `770aaab`

**Nothing was merged, deployed, imported into a hosted database, enabled for people, purchased or sent.** Every
feature of this epic is behind a server-side switch that is off by default. What "passed" means here: automated
tests on a local stack. What it does not mean is in §9.

## 1. Result by sub-sprint

| ID    | Scope                                      | Status                                                                       | Commit               | Evidence                                        |
| ----- | ------------------------------------------ | ---------------------------------------------------------------------------- | -------------------- | ----------------------------------------------- |
| WI-00 | Baseline, architecture, threat model       | PASS                                                                         | `7f3e365`            | `progress/WI-00.md`                             |
| WI-01 | Provider adapters, identity quality, pilot | PASS · real LWIN import **blocked by design**                                | `2375fa3`            | `progress/WI-01.md`                             |
| WI-02 | Shared search / autocomplete               | PASS (flag `wine_search`)                                                    | `fcc103f`            | `progress/WI-02.md`                             |
| WI-03 | Scan-to-catalogue resolver                 | PASS on programmed readings (flag `scan_resolver`) · real labels **PENDING** | `cd44c9c`            | `progress/WI-03.md`                             |
| WI-04 | Buying intelligence, profile reuse         | PASS (flag `purchase_intel`) · AI explanation **not built**                  | `354ce1b`, `11b7569` | `progress/WI-04.md`, `progress/WI-04-review.md` |
| WI-05 | Sources & reliability                      | PASS (flag `sources_panel`) · shown with test sources only                   | `7895209`            | `progress/WI-05.md`                             |
| WI-06 | Admin, counts, operational safety          | PASS (admin only) · some metrics **not measured**                            | `09c041e`            | `progress/WI-06.md`                             |
| WI-07 | Regression, red team, dossier              | **IN PROGRESS** (this file is a draft until §4 is filled in)                 | this commit          | this file                                       |

## 2. What a person can do once the switches are on

| Switch           | With it                                                                                                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wine_search`    | Type a wine in "Fles toevoegen", in the scan review and in Koopcheck's new "Handmatig zoeken": own wines first, then the CELLR catalogue, with typo tolerance and verified aliases |
| `scan_resolver`  | A scanned label is matched against a bounded set of candidates, and the review says why each wine is offered                                                                       |
| `purchase_intel` | Koopcheck fills what the person left open from the catalogue and from a valid profile, and shows the profile of exactly this vintage as an estimate                                |
| `sources_panel`  | "Bronnen & betrouwbaarheid" on a wine's page and in a Koopcheck result                                                                                                             |
| (none)           | Admin → External sources. Two simultaneous first profile requests pay for research once (after migration `…0039`)                                                                  |

## 3. Migrations (all additive; none applied anywhere but local test databases)

| File                                             | Adds                                                              |
| ------------------------------------------------ | ----------------------------------------------------------------- |
| `20261115000038_wi01_provider_lifecycle.sql`     | one open import run per source; abandon a run; the off switch     |
| `20261116000039_wi04_profile_research_claim.sql` | `private.shared_profile_claims`; claim and release (service role) |
| `20261117000040_wi05_wine_source_notices.sql`    | `wine_source_notices` (read-only, for signed-in people)           |
| `20261118000041_wi06_admin_sources.sql`          | four admin functions (service role)                               |

`pnpm migrations:check`: no file on `main` was changed. **Deployment is blocked** by
`PRODUCTION_MIGRATION_BOOTSTRAP_REQUIRED`: production has no migration history, and `20261114000037` (merged before
this epic) is, according to the 004A report, not applied there either. The owner-only procedure is
[`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md). The prerequisite was verified from the repository's documents and
scripts only; production was never contacted.

## 4. Tests run for this report

Commands, on this branch's head, on one shared 4-vCPU machine:

| Command                                                                                                                          | Result                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                                                                 | **pending**: being run for the final commit of WI-07                                        |
| `pnpm format:check`, `pnpm lint`, `pnpm typecheck`                                                                               | **pending**: being run for the final commit of WI-07                                        |
| `pnpm test`                                                                                                                      | **pending**: being run for the final commit of WI-07                                        |
| `pnpm db:test`                                                                                                                   | 1295 passed, 0 failed (after adding the red-team file); re-run pending for the final commit |
| `pnpm db:types:check`, `pnpm migrations:check`                                                                                   | **pending**: being run for the final commit of WI-07                                        |
| `pnpm db:test:budget`, `pnpm db:test:imports`                                                                                    | **pending**: being run for the final commit of WI-07                                        |
| `pnpm build`                                                                                                                     | **pending**: being run for the final commit of WI-07                                        |
| Playwright, whole suite, phone + desktop, `--retries=2`, features **off** (default server) and the WI specs with features **on** | **pending**: being run for the final commit of WI-07                                        |

CI skips end-to-end tests on pull requests by design, so the e2e result above is from this local run, not from CI.

Baseline for comparison (WI-00, `main` @ `770aaab`): unit web 706 / domain 581 / scan-eval 26 / catalog-tools 14;
`db:test` 1135. Added by this epic: 75 web, 62 domain, 57 scan-eval, 72 catalog-tools and 160 database tests, and
five e2e specs (`wine-search`, `scan-resolver`, `purchase-intel`, `sources`, `admin-sources`).

### Cross-flow matrix (brief §WI-07.2)

| Scenario                                               | Status            | Evidence                                                                                                   |
| ------------------------------------------------------ | ----------------- | ---------------------------------------------------------------------------------------------------------- |
| Add an existing cellar wine by typing                  | PASS              | `wine-search.spec` "an owned wine by keyboard…"                                                            |
| Add a catalogue wine with a new vintage                | PASS              | same test (the year the catalogue lacks is added to that wine; database check)                             |
| Add a wine not in the catalogue                        | PASS              | same test (typed text kept; household's own wine created)                                                  |
| Autocomplete with a typo or alias                      | PASS              | `wine-search.spec`; benchmark v2 perturbations; `99_catalog_search.test.sql`                               |
| Short, empty and common queries                        | PASS              | controller unit tests; benchmark "generic" entries; `99_wi07_redteam.test.sql`                             |
| An unverified pilot record through the public API      | PASS (denied)     | `99_catalog_search.test.sql`, `99_wi07_redteam.test.sql`; the e2e database cannot even set the pilot scope |
| Scan a known label by its printed text                 | PASS (programmed) | `scan-resolver.spec` (0 model calls); golden set texts                                                     |
| Scan a near-twin label                                 | PASS (programmed) | `scan-resolver.spec` "red and white of one name"; golden set                                               |
| Scan an illegible label                                | PASS              | existing `scan.spec` (unchanged path)                                                                      |
| Koopcheck, wine chosen by search                       | PASS              | `wine-search.spec` Koopcheck; `purchase-intel.spec`                                                        |
| Koopcheck, unknown wine                                | PASS              | `wine-search.spec` "typing without choosing a result…"                                                     |
| Koopcheck from a photo                                 | PASS              | existing `sprint-z.spec` (photo never kept)                                                                |
| A valid shared profile exists                          | PASS              | `purchase-intel.spec`; `insights.spec` (one research call for two households)                              |
| No profile / AI unavailable                            | PASS              | `purchase-intel.spec` (stale profile not used); `insights.spec` "when the AI can't…"                       |
| Two households with similar own wines                  | PASS              | `wine-search.spec` API test; `scan-resolver.spec`; `sources.spec` API test; red-team SQL                   |
| A source switched off or blocked                       | PASS              | `wine-search.spec`, `sources.spec`, `admin-sources.spec`, SQL tests of WI-01 / WI-05                       |
| Light / dark, NL / EN                                  | PASS              | axe and screenshots in `wine-search`, `sources`, `sprint-z`                                                |
| iPhone, tablet, desktop                                | **PARTIAL**       | emulated iPhone 13 viewport and desktop. **No tablet project, no physical device**                         |
| Keyboard and screen reader                             | **PARTIAL**       | keyboard and ARIA roles by test, axe clean. **No VoiceOver run**                                           |
| A new paid AI path with the budget service unavailable | N/A + PASS        | no new paid path exists; the guard for a future one is unit-tested (`budget.test.ts`)                      |
| Admin: anonymous and non-admin access                  | PASS              | `admin-http.spec` (existing), `admin-sources.spec` (404 for a signed-in non-admin)                         |

### Red-team list (brief §WI-07.3)

| Attack                                                                                       | Result       | Evidence                                                                                                                           |
| -------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Wildcards, regex, very long text, control characters, odd Unicode, SQL injection in a search | held         | `99_wi07_redteam.test.sql`: 49 hostile queries called directly as a person: no error, never more than 20 rows, `%` matches nothing |
| Enumerating another household's wines; passing its household id                              | held         | same file; e2e API tests                                                                                                           |
| Rate-limit bypass                                                                            | held         | the limiter fails closed (existing tests); the search field stops asking after a 429                                               |
| A pilot or uncleared source reaching people                                                  | held         | SQL (search, provenance, notices); even the service role cannot make an unverified source public                                   |
| A source enabled without evidence                                                            | held         | constraint + function (`99_wi07_redteam`, `99_catalog_search`); no dashboard control                                               |
| Import: wrong file, partial failure, repeat, update-withdraw cycle, older run finishing late | held         | WI-01 tests and `pnpm db:test:imports`                                                                                             |
| Import against a hosted or spoofed target                                                    | held         | 004A's target guard, unchanged; not re-tested against any real host (none was contacted)                                           |
| Unknown vs non-vintage; 2021 vs 2018; second wine vs grand vin; red vs white                 | held         | golden set; `wine-knowledge.test.ts`; identity pairs                                                                               |
| Prompt injection in a label or an imported name                                              | held as data | golden case; resolver unit test. No new model input was added by this epic                                                         |
| HTML / URL injection in a source credit                                                      | held         | React escapes text; `safeHttpUrl` drops non-http(s) (unit test with `javascript:`)                                                 |
| Stale responses and client races                                                             | held         | controller unit tests (sequence guard), e2e delayed-response test                                                                  |
| Concurrent profile generation; budget exhaustion                                             | held         | claim: SQL + unit; `pnpm db:test:budget`. **Found broken by the independent review and fixed** (`progress/WI-04-review.md`)        |
| Opt-out                                                                                      | held         | events are not sent under Do Not Track / GPC (existing `analytics.test.ts`)                                                        |

## 5. Benchmark and performance (from WI-01; the search SQL has not changed since)

| Item                        | Value                                                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Dataset                     | X-Wines "Full", 100,646 records, SHA-256 `eac2d812…62cc`, CC BY 4.0 **as stated by its authors, not verified by CELLR** |
| Where it was loaded         | a throwaway local database only (pilot run). Not in Git, not in any hosted database                                     |
| Benchmark                   | `eval/catalog/benchmark.json` v2: 247 entries (189 positive, 32 perturbations, 6 filter, 4 generic, 16 adversarial)     |
| 004A's 127 queries, re-run  | 95 covered · top-1 77 · top-3 84 · top-8 92 (identical to 004A)                                                         |
| All 189 positives           | 151 covered · top-1 129 · top-3 139 · top-8 147                                                                         |
| Safety                      | provider results marked verified: 0 · sibling before the wine: 0 of 10 · errors: 0 · over the limit: 0                  |
| SQL latency, 16 clients     | p50 33 ms · p95 98 ms · p99 193 ms on 110,958 index rows (target p95 < 250 ms: met)                                     |
| Through the app (local)     | p95 105–166 ms desktop, 255–356 ms on the emulated phone, depending on load; one call 882 ms                            |
| Index and table size        | search index 76 MB; about 190 MB in all for 100k records                                                                |
| Import                      | 100,646 records in 77 s; a second import inserts 0                                                                      |
| Scan golden set (synthetic) | 36 readings, 15 texts: 0 wrong automatic identities                                                                     |

**Not represented:** no source is public, so no user-path result includes provider rows. No number here was measured
on a phone, a mobile network or production. Coverage by price or region was not measured.

## 6. Sources and rights

| Source          | Rights status in the code | May be shown to people | What is needed                                                                                                                                                                       |
| --------------- | ------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CELLR catalogue | own                       | yes (as today)         | —                                                                                                                                                                                    |
| X-Wines         | unverified, scope off     | **no**                 | written confirmation of the licence and of commercial use from the authors (draft: `emails/x-wines-authors.md`, **not sent**)                                                        |
| Liv-ex LWIN     | blocked                   | **no**                 | their terms for storage, display and commercial use (draft: `emails/liv-ex-lwin.md`, **not sent**). No LWIN data was obtained; the adapter reads only CELLR's own fictitious fixture |

Detail per use: `SOURCE_RIGHTS_REGISTER.md`. **Decisions only the owner can take** before any source is shown:

1. Send (or not) the two e-mails.
2. On an answer: record the evidence and call `admin_catalog_provider_rights` (there is deliberately no button).
3. **R-27:** whether a wine created from a source's record must keep that record's id so its page can credit the
   source (`progress/WI-05.md` §7).
4. Whether `results/benchmark-results.json` (which quotes X-Wines record names) should stay in the repository.

## 7. Architecture, roles and privacy (pointers)

- Identities and external ids: `ADR-001-identities.md`. Rights gates and the import lifecycle:
  `ADR-002-provider-rights.md`. Wine-level and vintage-level knowledge: `ADR-003-wine-and-vintage-knowledge.md`.
- Every consumer read is made as the signed-in person under row-level security. New service-role uses: the research
  claim and release; the admin functions behind the admin guard. No consumer route uses the service role.
- What is stored, for how long, and what is not stored at all: `SECURITY_AND_PRIVACY.md` (retention table).
- Events: `docs/METRICS.md` → "Wine Intelligence events".

## 8. Cost

`COST_MODEL.md`. New paid model calls added by this epic: **none**. One class of duplicate call removed (the research
claim). Per-action estimates, from `pricing.ts` and each call's own bounds, not from an invoice:

| Action                                  | Model calls | Upper estimate held by the budget | Per person per hour (rate limit) |
| --------------------------------------- | ----------: | --------------------------------- | -------------------------------- |
| One label scan (vision)                 |      0 or 1 | see `/admin/ai` for real figures  | 40                               |
| One wine profile (research, 2 searches) |           1 | about USD 0.025                   | 40                               |
| One Koopcheck comparison                |           0 | 0                                 | 120                              |
| One search                              |           0 | 0                                 | 600                              |
| Optional AI explanation                 |   not built | —                                 | —                                |

Owner action: a hard monthly spending cap at the model provider. The application budget fails open for the five
existing tasks when it cannot be checked (verified in code, unchanged).

## 9. What is not proven, not built, or open

| Item                                                                                  | State                                                                                 |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Recognition of **real** label photographs                                             | `REAL_LABEL_VALIDATION_PENDING`: 0 consented photos exist                             |
| A physical iPhone, a mobile network, VoiceOver, a tablet                              | not run (`UX_ACCEPTANCE.md` §4)                                                       |
| Production migration history                                                          | `PRODUCTION_MIGRATION_BOOTSTRAP_REQUIRED`: owner only                                 |
| Any real external source shown to people                                              | none; credits were exercised with CELLR's own test sources                            |
| Real LWIN layout                                                                      | unknown; the adapter is marked unverified and refuses any other file                  |
| Optional AI explanation of a verdict                                                  | not built (ADR-003, decision 10)                                                      |
| Live p50 / p95, cancellations, edit-after-confirm rate                                | not measured (`docs/METRICS.md`)                                                      |
| Eight existing specs bound to the old selectors                                       | must be updated in the change that switches `wine_search` on (`progress/WI-02.md` §4) |
| Phone-profile scan specs are racy on baseline (R-26); `insights.spec:113` flaked once | not product defects as far as established; CI masks them with a retry                 |
| The independent review covered WI-02 to WI-04 only                                    | WI-05 and WI-06 are self-verified                                                     |
| `analytics_events` has no automatic expiry                                            | existing behaviour, unchanged                                                         |
| `docs/MIGRATIONS.md` §4 says 36 migrations; `main` has 37                             | reported, not edited (owner's document of record)                                     |

No P0 is open. No tenant leak, no pilot visibility and no wrong automatic identity is known.

## 10. Rollback

- **A feature:** remove its name from `CELLR_FEATURES` and redeploy. No data migration is involved.
- **A source:** Admin → External sources → Switch off (or `admin_catalog_provider_disable`). Household wines and the
  catalogue are untouched.
- **The app:** roll back the deployment; every migration is additive and the previous app does not use the new
  objects.
- **The research claim:** it fails open; if `claim_shared_profile_research` is dropped or errors, research goes
  ahead as before.

## 11. Recommendations

Order of switching on (each reversible): `wine_search` → `sources_panel` → `scan_resolver` → `purchase_intel`
(`RELEASE_CHECKLIST.md` Part C).

The next three improvements, by value:

1. **Thirty to fifty real label photos and one evening with a real iPhone.** It is the only way to turn "passes on
   programmed readings" into a recognition claim, and it costs no engineering (`UX_ACCEPTANCE.md` §3–§4).
2. **Decide the X-Wines question.** The search already works on 100k records in the pilot; one e-mail and one
   decision (R-27) stand between that and people finding their supermarket wines by name.
3. **A bounded "recent wines" endpoint**, replacing the last place the app downloads every visible wine
   (`GET /api/v1/wines`, R-23). It is what keeps add-bottle fast once the catalogue grows.

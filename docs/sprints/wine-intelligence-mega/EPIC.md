# WI-001 — Wine Intelligence Mega Sprint: status

The durable status of the epic. A new session resumes from **this file and the Git tree**, not from chat history.
Brief: [`MASTER_BRIEF.md`](MASTER_BRIEF.md) (v1.1). Per-sub-sprint evidence: [`progress/`](progress/).

## Resume block

```text
LAST VERIFIED CHECKPOINT: WI-08 (hardening of PR #68) + the first CI runs on GitHub (2026-11-14).
                          See progress/WI-08-hardening.md (findings, §7 GO / NO-GO, §8 the CI runs)
BRANCH / SHA: claude/wine-intelligence-mega-sprint-agnxu9 (base: main @ 770aaab); see `git log --oneline`
STATUS: WI-00 to WI-07 as below; WI-08: 1 P1 and 9 P2 fixed; e2e on GitHub green with the switches off and on
CHANGED FILES / PR: draft PR https://github.com/Blockionaire/CELLR/pull/68 (not merged; merging deploys the app)
CURRENT FEATURE FLAGS: CELLR_FEATURES unset everywhere (all four features off)
LAST GREEN CHECKS: format, lint, typecheck, unit (web 793 / domain 643 / scan-eval 83 / catalog-tools 86),
                   db:test 1327, db:test:budget, db:test:imports, db:test:claims, db:types:check, migrations:check
                   (5 new files), build;
                   GitHub, eight shards, 746 e2e tests: run 215 (switches off) and run 213 (every switch on):
                   677 passed, 0 failed, 0 flaky, 69 skipped each;
                   the app on a database without migrations 0037-0042: 212 passed, 0 failed (local)
VERDICT: merge = conditional GO; wine_search, sources_panel, purchase_intel = conditional GO after the migrations,
         in that order; scan_resolver = NO-GO until real labels and a real iPhone; no external source may be shown
PENDING BLOCKERS: PRODUCTION_MIGRATION_BOOTSTRAP_REQUIRED · REAL_LABEL_VALIDATION_PENDING ·
                  LWIN rights blocked · X-Wines rights unverified (pilot only)
NEXT SAFE ACTION: none for the agent. Owner: review PR #68; decide on the merge (progress/WI-08-hardening.md §7.1);
                  look at the e2e run the merge starts on main; RELEASE_CHECKLIST.md Part A and B before any switch
TO REPRODUCE CI LOCALLY: CI runs Playwright's headless shell, not the full Chrome: set PLAYWRIGHT_CHROMIUM_PATH to
                  the headless shell; features on: E2E_BASE_URL=http://localhost:3101 (playwright.config.ts)
DO NOT REPEAT: the baseline audit; the 004A schema review (ADR-001); the reviews of WI-02 to WI-06; the analysis
               of CI run 212; the X-Wines download (the file is in an isolated scratch folder of the session,
               never in Git: re-download it from the authors' Drive folder and check the SHA-256 in pilot.sh)
```

## Status by sub-sprint

| ID    | Name                                            | Status                                                                                       | Evidence                                                                                         |
| ----- | ----------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| WI-00 | Baseline, architecture and threat model         | **PASS**                                                                                     | [`progress/WI-00.md`](progress/WI-00.md)                                                         |
| WI-01 | Provider adapters, identity quality, pilot      | **PASS** (real LWIN import: blocked by design)                                               | [`progress/WI-01.md`](progress/WI-01.md)                                                         |
| WI-02 | Shared search / autocomplete UX                 | **PASS** (behind `wine_search`, off by default)                                              | [`progress/WI-02.md`](progress/WI-02.md)                                                         |
| WI-03 | Scan-to-catalogue resolver                      | **PASS** on programmed readings (behind `scan_resolver`, off); real labels **PENDING**       | [`progress/WI-03.md`](progress/WI-03.md)                                                         |
| WI-04 | Buying intelligence and profile reuse           | **PASS** (behind `purchase_intel`, off); independently reviewed                              | [`progress/WI-04.md`](progress/WI-04.md), [`progress/WI-04-review.md`](progress/WI-04-review.md) |
| WI-05 | Provenance, trust and wine pages                | **PASS** (behind `sources_panel`, off)                                                       | [`progress/WI-05.md`](progress/WI-05.md)                                                         |
| WI-06 | Admin governance, telemetry, operational safety | **PASS** (admin only)                                                                        | [`progress/WI-06.md`](progress/WI-06.md)                                                         |
| WI-07 | Regression, stress, legal readiness, dossier    | **PASS with listed exceptions**                                                              | [`FINAL_REPORT.md`](FINAL_REPORT.md), [`progress/WI-07.md`](progress/WI-07.md)                   |
| WI-08 | Hardening of PR #68 before merge                | **DONE**: 1 P1 and 9 P2 fixed; e2e green on GitHub (switches off and on); GO / NO-GO written | [`progress/WI-08-hardening.md`](progress/WI-08-hardening.md)                                     |

## Branch and PR strategy

This session may push to **one** branch only (`claude/wine-intelligence-mega-sprint-agnxu9`), so the epic is an
**umbrella feature branch with one labelled checkpoint commit per sub-sprint** and **one draft pull request**. Stacked
PRs would need more branches than the session is allowed to push. Each checkpoint commit is green on its own
(`pnpm check`), names its sub-sprint in the subject (`WI-0x: …`), and has its own progress file with a review
checklist, so the PR can be reviewed commit by commit. Nothing is merged, deployed or applied to a hosted database.

## Dependency DAG

```text
WI-00 ──► WI-01 (providers, benchmark, rights register)
   │
   ├────► WI-02 (search UI)  ──► WI-03 (scan resolver) ──► WI-04 (buying intelligence)
   │            │                                                │
   │            └──────────────► WI-05 (sources & reliability) ◄─┘
   │
   └────► WI-06 (admin, telemetry: needs WI-01 link rules, WI-02/03 events)
                                             └──► WI-07 (everything)
```

WI-02 to WI-05 do not depend on any external provider being cleared: they run on the household's own wines and the
canonical catalogue. Provider records reach people only through `catalog_search` scope `public`, which no provider has.

## Who owns what (reuse, do not rebuild)

| Capability                              | Owner (existing)                                                                                   | This epic adds                                         |
| --------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Wine identity (canonical / provisional) | `producers`, `wines`, `wine_vintages`, `wine_aliases`; `packages/domain/src/wine-master.ts`        | nothing (ADR-001)                                      |
| Provider staging, rights, links         | migration `…0037_catalog_search.sql`; `packages/domain/src/catalog-providers.ts`                   | adapters hardened, link review queue (WI-01, WI-06)    |
| Ranked search                           | `public.catalog_search`; `apps/web/src/server/catalog/search*`; `GET /api/v1/catalog/search`       | the UI that uses it (WI-02); resolver on top (WI-03)   |
| Exact identity rule                     | `isCatalogIdentity`, `matchLabel`, `pickExistingWine` in `packages/domain/src/scan.ts`             | reused by the resolver; never relaxed                  |
| Scan                                    | `apps/web/src/server/scans/service.ts`, `features/scan/*`, `label-text.ts`                         | bounded candidate set behind `scan_resolver` (WI-03)   |
| Koopcheck                               | `packages/domain/src/purchase-check.ts` (`checkPurchase`), `server/purchase-check/service.ts`      | search-first entry, profile reuse (WI-02, WI-04)       |
| Wine profiles                           | `server/insights/*`, `shared_wine_profiles`, `vintage_insights`; `packages/domain/src/insights.ts` | read-only reuse in Koopcheck; stable-facts ADR (WI-04) |
| Provenance model                        | `packages/domain/src/provenance.ts`, `catalog_record_provenance`                                   | the wine-page section (WI-05)                          |
| Rate limits and AI budget               | `server/ratelimit/*`, `server/ai/budget.ts`, `ai_budget_hold`                                      | fail-closed guard for NEW paid paths (WI-04)           |
| Admin                                   | `app/admin/*`, `server/admin/*`, proxy allowlist                                                   | provider and link pages inside it (WI-06)              |
| Analytics                               | `packages/domain/src/analytics.ts`, `POST /api/v1/events`, `docs/METRICS.md`                       | a few coarse events, no query text (WI-06)             |

## Feature flags

`CELLR_FEATURES` (server only, comma-separated, or `all`); parsed by `parseFeatures` in
`packages/domain/src/features.ts`, read by `getFeatures()` in `apps/web/src/server/env.ts`. Unset = everything off =
today's behaviour. Unknown names switch nothing on.

| Flag             | Sub-sprint | Off (default)                                     | On                                                       |
| ---------------- | ---------- | ------------------------------------------------- | -------------------------------------------------------- |
| `wine_search`    | WI-02      | wine picker filters the fetched list in memory    | database-backed autocomplete in add-bottle and Koopcheck |
| `scan_resolver`  | WI-03      | `matchLabel` over the household's whole wine list | bounded resolver candidates, same identity rules         |
| `purchase_intel` | WI-04      | Koopcheck compares typed facts only               | reuses a valid shared profile for the chosen wine        |
| `sources_panel`  | WI-05      | no section                                        | "Bronnen & betrouwbaarheid" on wine page and result      |

Each can be switched independently; none needs another to be on. Provider visibility is **not** a feature flag: it is
the provider's rights status and search scope in the database, changed only by `admin_catalog_provider_rights`.

## Stop / go matrix

| Gate                                       | State                                                                                  | Blocks                                                                          |
| ------------------------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `PRODUCTION_MIGRATION_BOOTSTRAP_REQUIRED`  | **OPEN** (owner action, never done here)                                               | any production migration of this epic; any deployment                           |
| X-Wines commercial rights                  | **unverified** (pilot only)                                                            | X-Wines records in people's search                                              |
| LWIN rights                                | **blocked** pending Liv-ex in writing                                                  | any LWIN import, real-file adapter verification                                 |
| `REAL_LABEL_VALIDATION_PENDING`            | **OPEN** (0 consented real photos)                                                     | any recognition-accuracy claim; "field validated" status                        |
| Real iPhone OCR / latency evidence         | **OPEN** (no device in this environment)                                               | any device performance claim                                                    |
| AI budget fail-open on control outage      | **documented**; new paid paths guarded                                                 | nothing, provided new paid paths use the fail-closed guard                      |
| Provider-side hard spending cap            | **owner action** (cannot be set in code)                                               | calling the app-level budget a bill cap                                         |
| Admin non-admin 200 vs 404                 | **closed**: real 404, verified by HTTP                                                 | nothing                                                                         |
| CI E2E skipped on pull requests            | by design (`ci.yml`)                                                                   | "CI green" as E2E evidence: E2E is run locally and logged                       |
| Sharded e2e job                            | **proven on GitHub** on this branch (runs 213, 215): every shard 4 to 20 minutes of 30 | nothing; on `main` it runs with the merge                                       |
| Merging = deploying (Vercel builds `main`) | by design (`BETA-OPERATIONS.md` §5)                                                    | nothing, with every switch off: tested on a database without the new migrations |

## Test matrix

| Layer         | Command                                               | Where it runs                   | Baseline (2026-11-13, main @ 770aaab)       |
| ------------- | ----------------------------------------------------- | ------------------------------- | ------------------------------------------- |
| Format        | `pnpm format:check`                                   | PR CI + local                   | PASS                                        |
| Lint          | `pnpm lint`                                           | PR CI + local                   | PASS (1 existing warning)                   |
| Types         | `pnpm typecheck`                                      | PR CI + local                   | PASS                                        |
| Unit          | `pnpm test`                                           | PR CI + local                   | web 706 (+12 skipped), domain 581, 26, 14   |
| SQL / RLS     | `pnpm db:test`                                        | PR CI + local (Postgres 16)     | 1135 passed, 0 failed                       |
| Types file    | `pnpm db:types:check`                                 | PR CI + local                   | PASS                                        |
| Migrations    | `pnpm migrations:check`, `pnpm migrations:check:test` | PR CI + local                   | PASS                                        |
| Build         | `pnpm build`, `bash scripts/check-bundle-secrets.sh`  | PR CI + local                   | PASS (73 files scanned)                     |
| E2E           | `pnpm --filter @cellr/web e2e`                        | main/nightly CI; **local here** | `admin-http` 3/3 locally; full run in WI-07 |
| Real Supabase | `supabase start` job                                  | CI only (needs Docker)          | CANNOT RUN here (no Docker daemon)          |
| Budget race   | `pnpm db:test:budget`                                 | local only (not in CI)          | run in WI-04                                |
| Import race   | `pnpm db:test:imports`                                | local only (not in CI)          | added in WI-01                              |
| Claim race    | `pnpm db:test:claims`                                 | local only (not in CI)          | added in WI-08                              |

## Risk register

The brief's R-01 to R-21 apply as written (`MASTER_BRIEF.md` §11). Baseline findings that change or sharpen them:

| ID   | Finding at baseline                                                                                                                                                                                                                                                                                                                                       | Handling                                                                                                                              |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| R-17 | Confirmed from `docs/MIGRATIONS.md` §3–§4: production has no migration history. §4 also says "36 migrations", but `main` now has 37 (`…0037_catalog_search.sql` merged in PR #65 and, per the 004A report, never deployed).                                                                                                                               | `RELEASE_CHECKLIST.md`: bootstrap the 36, then apply 0037 and this epic's migrations through §2. Deployment blocked until then.       |
| R-18 | Confirmed in code: `withBudget` lets a call through when the hold cannot be checked, and holds nothing when no budget is set.                                                                                                                                                                                                                             | `SECURITY_AND_PRIVACY.md` §4; new paid paths fail closed (WI-04).                                                                     |
| R-19 | Confirmed: 0 consented real label photos; OCR and iPhone timings are documented as unmeasured.                                                                                                                                                                                                                                                            | `REAL_LABEL_VALIDATION_PENDING`; protocol in WI-03.                                                                                   |
| R-21 | Docs were stale, code is right: non-admin gets 404, anonymous 307.                                                                                                                                                                                                                                                                                        | `sprint-u.md` corrected; closed.                                                                                                      |
| R-22 | **New.** No single-flight for profile generation: two first requests for one vintage can both pay (documented in the roadmap).                                                                                                                                                                                                                            | WI-04 adds a guard only where a NEW path would add calls.                                                                             |
| R-23 | **New.** The scan and manual entry rank **every** wine the household can see in memory (`GET /api/v1/wines`); this does not scale with the catalogue.                                                                                                                                                                                                     | WI-02 and WI-03 move both to bounded server-side candidates.                                                                          |
| R-24 | **New (WI-01).** The search's `match = 'exact'` means "the query equals the producer, the name or both", not "this is the wine".                                                                                                                                                                                                                          | The resolver (WI-03) decides identity with `isCatalogIdentity`, never with the search's match class.                                  |
| R-25 | **New (WI-01).** The import's link suggestion compares normalised text: names differing only in signs ("Auslese \*" / "\*\*") are one identity to it.                                                                                                                                                                                                     | A suggestion is never a link; the review screen (WI-06) shows the names as written and `identityRelation`'s verdict.                  |
| R-26 | **New (WI-02).** The phone-profile scan specs choose a photo right after `page.goto`; before the screen is interactive the choice is lost. 5 of 32 runs failed on **baseline** source here; CI masks it with a retry.                                                                                                                                     | Not a product defect. New specs wait for the screen to be interactive; fixing the old specs is a follow-up (WI-07 list).              |
| R-27 | **New (WI-05). Rights, for the owner.** A wine created from an external record keeps nothing of that record, so its page credits no source. A CC BY source (LWIN, as published) makes that credit a licence condition; a CC0 source (X-Wines, as published) does not, but the rights register still plans a credit.                                       | No source is public, so nothing is shown uncredited today. **Decide before clearing any source for people** (`progress/WI-05.md` §7). |
| R-28 | **New (WI-07). Existing test infrastructure.** On `main` the e2e CI job is cancelled by its 30-minute limit (last four runs), and `flows.spec` leaves a sign-up allowlist entry that makes every later admin test fail. So the whole suite is not a working gate today.                                                                                   | Reported with reproduction in `FINAL_REPORT.md` §4.1. Not changed by this epic. Two cheap fixes are named there.                      |
| R-29 | **New (WI-08), corrected after the CI runs.** A few 3D and contrast tests (`cellar3d`, `racks.spec:371`) fail or flake in the agent's container under load. On GitHub's runners they pass (0 failed, 0 flaky in three runs). The risk that remains is time: the shard with the desktop 3D tests took 13 to 20 minutes of its 30, depending on the runner. |

## Decisions

| ADR                                              | Decision                                                                                                                                                          |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ADR-001](ADR-001-identities.md)                 | External identifiers and identity lifecycle: keep the 004A schema; no second identity system                                                                      |
| [ADR-002](ADR-002-provider-rights.md)            | Three gates before a provider record reaches a person; one open import run per provider; the off switch                                                           |
| [ADR-003](ADR-003-wine-and-vintage-knowledge.md) | Wine-level facts are derived from vintage profiles at read time, never stored; a window, value or text never crosses a vintage; research once per vintage (claim) |

## Status log

- **2026-11-13 — WI-00 PASS.** Baseline reproduced on `main` @ `770aaab`; §1A audit leads verified against code and
  by running tests; feature flags added (all off); EPIC, ADR-001, security and privacy baseline and the owner-only
  release checklist written.
- **2026-11-13 — WI-01 PASS.** File inspection and adapter gates, LWIN-layout fixture and code parser, identity
  comparison with 61 hand-labelled pairs, benchmark v2 (247 entries; the 004A numbers reproduced exactly), one open
  import run per provider (a defect of the merged foundation closed), the off switch, rights register and e-mail
  drafts. An independent review found real defects in the first version; all P1/P2 were fixed before the checkpoint.
  Real LWIN data: not obtained, import blocked by three gates.
- **2026-11-13 — WI-02 PASS.** One search component (combobox + listbox) for add-bottle, the scan review and
  Koopcheck's new "Handmatig zoeken" step, on Sprint 004A's `catalog_search`; behind `wine_search` (off). A second
  e2e server with every feature on (port 3101). Automated only: no physical device, no real network.
- **2026-11-13 — WI-03 PASS (programmed readings).** `resolveWine`: the unchanged `matchLabel` rules over a bounded
  candidate set (own wines, that producer's wines, the best search hits) with a reason per candidate; provider
  records are never scan candidates. Golden set (synthetic): 0 wrong automatic identities in 36 readings and 15
  texts. `REAL_LABEL_VALIDATION_PENDING` stands: 0 real photos, no device.
- **2026-11-13 — WI-04 PASS.** Koopcheck fills only the fields a person left open, from the catalogue and from valid
  shared profiles, and shows the profile of exactly this vintage as CELLR's estimate; another vintage gets grapes
  only (ADR-003). No model call, no write. Migration `…0039`: a research claim so two simultaneous first requests
  pay once (R-22). `BUDGET_MODES`: any future paid task fails closed (R-18). No AI explanation built. The
  independent review was interrupted by a usage limit and restarted: PENDING.
- **2026-11-13 — Independent review of WI-02 to WI-04.** No P1. P2: the research claim was never given back (a
  failed or rate-limited first request made others wait 30 s for nothing, with every flag off); fixed with a
  release function and a take-over by the waiting request. Three P3 and four minor findings fixed.
- **2026-11-13 — WI-05 PASS.** "Bronnen & betrouwbaarheid": four groups on the wine page, the identification block
  in a Koopcheck result. External sources are credited only through `wine_source_notices` (migration `…0040`):
  a verified link, an active record, a source cleared and shown to people right now. Open for the owner: R-27.
- **2026-11-13 — WI-06 PASS.** `/admin/sources`: rights and imports per source, the link review queue with a
  required reason, the off switch; nothing there can switch a source on. Two anonymous events and one property,
  counted without persons (migration `…0041`).
- **2026-11-13 — WI-07.** Static, unit and database checks green (1295 database tests). Whole e2e suite: 644 passed,
  20 failed, 4 flaky; every failure traced to the existing suite or environment and compared with `main` (R-28).
  Red-team test of the search function added. `FINAL_REPORT.md` written. Nothing merged or deployed.
- **2026-11-13 — WI-08, hardening before merge.** Independent review of WI-05 and WI-06: one P1 (a false privacy
  sentence) and three P2 (a hidden source could empty people's search; an approved link survived a change of the
  record's identity; any signed-in person could break the admin page), all fixed with tests (migration `…0042`).
  Research claims have an owner (a token); 20 simultaneous claims, takeovers and late releases tested. External
  records are no longer used from the browser's memory. The sign-up gate test no longer breaks other tests; the scan
  tests wait for the screen; the e2e job is split in eight shards (not yet run on GitHub). Existing specs hold with
  the features on or off. R-28: addressed in the repository, to be proven by the first run on `main`. GO / NO-GO in
  `progress/WI-08-hardening.md` §7. Nothing merged, deployed or switched on.
- **2026-11-14 — the first runs on GitHub.** Run 212 (the owner's, every feature on): four failures. Traced in
  the logs and traces and reproduced with CI's browser (the headless shell): `reminders.spec` depended on the
  browser, `cellar3d.spec` tapped the card's rim, and `sprint-k-a.spec` exposed a product defect that is on `main`
  too (a back label chosen just before "Add" was dropped without a word). All fixed in `899aba5`, the defect with
  regression tests. Run 213 (every feature on) and run 215 (features off): 677 passed, 0 failed, 0 flaky each.
  The verdicts did not change. Nothing merged, deployed or switched on.

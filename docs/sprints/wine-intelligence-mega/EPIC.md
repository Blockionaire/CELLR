# WI-001 — Wine Intelligence Mega Sprint: status

The durable status of the epic. A new session resumes from **this file and the Git tree**, not from chat history.
Brief: [`MASTER_BRIEF.md`](MASTER_BRIEF.md) (v1.1). Per-sub-sprint evidence: [`progress/`](progress/).

## Resume block

```text
LAST VERIFIED CHECKPOINT: WI-00
BRANCH / SHA: claude/wine-intelligence-mega-sprint-agnxu9 (base: main @ 770aaab)
STATUS: WI-00 PASS; WI-01 next
CHANGED FILES / PR: see "Status by sub-sprint"; one umbrella draft PR for the branch
CURRENT FEATURE FLAGS: CELLR_FEATURES unset everywhere (all four features off)
LAST GREEN CHECKS: format, lint, typecheck, unit (web 706 / domain 586 / scan-eval 26 / catalog-tools 14),
                   db:test 1135, db:types:check, migrations:check, build, bundle-secrets, e2e admin-http 3/3
PENDING BLOCKERS: PRODUCTION_MIGRATION_BOOTSTRAP_REQUIRED · REAL_LABEL_VALIDATION_PENDING ·
                  LWIN rights blocked · X-Wines rights unverified (pilot only)
NEXT SAFE ACTION: WI-01 (provider adapters, benchmark to 200+, rights register)
DO NOT REPEAT: the baseline audit below; the 004A schema review (no redesign needed, ADR-001)
```

## Status by sub-sprint

| ID    | Name                                            | Status      | Evidence                                 |
| ----- | ----------------------------------------------- | ----------- | ---------------------------------------- |
| WI-00 | Baseline, architecture and threat model         | **PASS**    | [`progress/WI-00.md`](progress/WI-00.md) |
| WI-01 | Provider adapters, identity quality, pilot      | not started |                                          |
| WI-02 | Shared search / autocomplete UX                 | not started |                                          |
| WI-03 | Scan-to-catalogue resolver                      | not started |                                          |
| WI-04 | Buying intelligence and profile reuse           | not started |                                          |
| WI-05 | Provenance, trust and wine pages                | not started |                                          |
| WI-06 | Admin governance, telemetry, operational safety | not started |                                          |
| WI-07 | Regression, stress, legal readiness, dossier    | not started |                                          |

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

| Gate                                      | State                                    | Blocks                                                     |
| ----------------------------------------- | ---------------------------------------- | ---------------------------------------------------------- |
| `PRODUCTION_MIGRATION_BOOTSTRAP_REQUIRED` | **OPEN** (owner action, never done here) | any production migration of this epic; any deployment      |
| X-Wines commercial rights                 | **unverified** (pilot only)              | X-Wines records in people's search                         |
| LWIN rights                               | **blocked** pending Liv-ex in writing    | any LWIN import, real-file adapter verification            |
| `REAL_LABEL_VALIDATION_PENDING`           | **OPEN** (0 consented real photos)       | any recognition-accuracy claim; "field validated" status   |
| Real iPhone OCR / latency evidence        | **OPEN** (no device in this environment) | any device performance claim                               |
| AI budget fail-open on control outage     | **documented**; new paid paths guarded   | nothing, provided new paid paths use the fail-closed guard |
| Provider-side hard spending cap           | **owner action** (cannot be set in code) | calling the app-level budget a bill cap                    |
| Admin non-admin 200 vs 404                | **closed**: real 404, verified by HTTP   | nothing                                                    |
| CI E2E skipped on pull requests           | by design (`ci.yml`)                     | "CI green" as E2E evidence: E2E is run locally and logged  |

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

## Risk register

The brief's R-01 to R-21 apply as written (`MASTER_BRIEF.md` §11). Baseline findings that change or sharpen them:

| ID   | Finding at baseline                                                                                                                                                                                                         | Handling                                                                                                                        |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| R-17 | Confirmed from `docs/MIGRATIONS.md` §3–§4: production has no migration history. §4 also says "36 migrations", but `main` now has 37 (`…0037_catalog_search.sql` merged in PR #65 and, per the 004A report, never deployed). | `RELEASE_CHECKLIST.md`: bootstrap the 36, then apply 0037 and this epic's migrations through §2. Deployment blocked until then. |
| R-18 | Confirmed in code: `withBudget` lets a call through when the hold cannot be checked, and holds nothing when no budget is set.                                                                                               | `SECURITY_AND_PRIVACY.md` §4; new paid paths fail closed (WI-04).                                                               |
| R-19 | Confirmed: 0 consented real label photos; OCR and iPhone timings are documented as unmeasured.                                                                                                                              | `REAL_LABEL_VALIDATION_PENDING`; protocol in WI-03.                                                                             |
| R-21 | Docs were stale, code is right: non-admin gets 404, anonymous 307.                                                                                                                                                          | `sprint-u.md` corrected; closed.                                                                                                |
| R-22 | **New.** No single-flight for profile generation: two first requests for one vintage can both pay (documented in the roadmap).                                                                                              | WI-04 adds a guard only where a NEW path would add calls.                                                                       |
| R-23 | **New.** The scan and manual entry rank **every** wine the household can see in memory (`GET /api/v1/wines`); this does not scale with the catalogue.                                                                       | WI-02 and WI-03 move both to bounded server-side candidates.                                                                    |

## Decisions

| ADR                              | Decision                                                                                     |
| -------------------------------- | -------------------------------------------------------------------------------------------- |
| [ADR-001](ADR-001-identities.md) | External identifiers and identity lifecycle: keep the 004A schema; no second identity system |

## Status log

- **2026-11-13 — WI-00 PASS.** Baseline reproduced on `main` @ `770aaab`; §1A audit leads verified against code and
  by running tests; feature flags added (all off); EPIC, ADR-001, security and privacy baseline and the owner-only
  release checklist written.

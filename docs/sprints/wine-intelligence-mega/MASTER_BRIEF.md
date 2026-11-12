[MASTER_BRIEF.md](https://github.com/user-attachments/files/34772657/MASTER_BRIEF.md)
# CELLR — WINE INTELLIGENCE MEGA SPRINT
## Master execution brief for Claude Code · v1.1 · 12 November 2026

**Project:** `Blockionaire/CELLR`  
**Initiative:** WI-001 — Universal Wine Identification, Search, Enrichment & Personal Buying Advice  
**Recommended orchestrator:** Claude Fable 5.2 · High effort; alternative: Opus 5.5 · High  
**Execution philosophy:** one intensive, continuous engineering mission, split into bounded sub-sprints with explicit quality gates and durable progress reports  
**Delivery:** reviewable implementation, tests, evidence, documents and PR(s); **NO automatic merge, production deployment, commercial provider enablement, secrets handling outside approved mechanisms, or production imports.**

> **START HERE — instruction to the coding agent**  
> You own implementation of this initiative within the CELLR codebase, subject to the safety boundaries below. Work through the sub-sprints in order. After each sub-sprint, run its checks, document what actually passed, publish a concise checkpoint, commit the result, and proceed to the next sub-sprint when its dependencies and safety gates are satisfied. Do not stop simply because one source/provider is unavailable: pursue the legal and technically safe fallback. Do not claim work complete unless you have produced evidence. Do not silently broaden scope, weaken protections, or report green checks you did not run. Respect the user's authority over merge, release, cost commitments, external agreements, and production data.

---

# 0. Executive decision: what we are building

CELLR should feel like a **personal sommelier connected to an intelligent wine cellar**, not like a generic wine-name autocomplete or a vast, unstructured wine spreadsheet.

**North-star experience A — scan-to-knowledge:**

1. User scans a bottle label to add a bottle to CELLR.
2. Existing client OCR and/or the existing vision fallback extracts visible facts: producer, wine/cuvée, wine type, vintage, geography, optional ABV/volume.
3. CELLR searches its owned/canonical catalogue and rights-approved external sources using a server-side resolver.
4. It proposes safe ranked candidates, explicitly distinguishing a confirmed identity, a plausible candidate and an ambiguous result.
5. User confirms the specific wine and vintage. Never substitute a different cuvée, classification, vintage or country silently.
6. CELLR finds the existing canonical wine/vintage, if one exists. It reuses a valid shared profile when eligible.
7. If no adequate profile exists, it offers or triggers the existing bounded AI-analysis mechanism according to current feature entitlement and policy (do not launch unbudgeted calls on every scan).
8. User lands on a complete cellar wine page with sourced facts, clearly labeled AI estimates, bottle data and their own notes.

**North-star experience B — type-to-buying-advice:**

1. User opens **Koopcheck** and chooses **Handmatig zoeken**.
2. User types a producer or a recognizable wine name. Within a short time, CELLR displays ranked, readable results.
3. Results prioritize the user's cellar, then the household's entries, then verified canonical CELLR wines, then legally enabled external catalog records; display status honestly.
4. User selects the correct wine, confirms vintage, optional type/region and asking price.
5. CELLR reuses available verified wine facts and, where possible and allowed, existing wine/vintage intelligence; never fabricates missing facts.
6. Existing Purchase Check comparison evaluates that candidate against the user's cellar and real taste signals. If a model-generated explanation is included, it must be grounded in the deterministic verdict and properly bounded/cost-controlled.
7. User receives a **personalized purchase recommendation** with reasons, overlap/variety implications, caveats, provenance and an appropriate next action; the wine is **not automatically added to the cellar**.

**North-star experience C — progressively better coverage:** confirmed existing identities and approved corrections reduce work for subsequent users while preserving tenant privacy, provenance, provider rights and human-controlled promotion.

**Business outcome:** quicker recognition, lower repetitive AI spend, more credible buying advice, higher usefulness on first use, and an extensible proprietary layer of verified CELLR wine intelligence built on top of properly licensed source data.

---

# 1. Verified repository baseline — do not rebuild it

As of the audit on **2026-11-11**, GitHub PR **#65** (Sprint 004A) is **merged into main**. Before starting, verify live repository state again; `main` is source of truth.

Established components and paths (verify whether subsequently renamed):

| Existing capability | Repository starting point | Constraint |
| --- | --- | --- |
| Wine Master / canonical and provisional identities | `docs/CATALOG.md`, catalog migrations, `packages/domain/src/wine-master.ts` | Reuse, no duplicate master table |
| Provider staging, rights, import logs, external source records | `supabase/migrations/20261114000037_catalog_search.sql` | Merged; migration immutability matters |
| Server-side catalog search API | `apps/web/src/app/api/v1/catalog/search/route.ts`, `apps/web/src/server/catalog/search*` | Return bounded ranked results, enforce RLS and rights |
| Provider adapters & pilot tools | `packages/domain/src/catalog-providers.ts`, `scripts/catalog-tools/` | Preserve audit, hashes, target guards |
| Search contracts and confirmation rules | `packages/domain/src/catalog-search.ts` | External and fuzzy hits are NOT verified |
| Client-side current add-bottle picker | `apps/web/src/features/cellar/choose-wine.tsx`, `add-bottle-flow.tsx` | Currently filters fetched wine list in memory |
| Current scan flow | `apps/web/src/features/scan/*`, `apps/web/src/server/scans/*` | Existing OCR, vision fallback, image protections, matching and user confirmation |
| Current Purchase Check | `apps/web/src/features/purchase-check/*`, `apps/web/src/server/purchase-check/*` | **Personal comparison currently runs in deterministic code**, not a general-purpose LLM each time |
| Wine intelligence and shared profiles | `apps/web/src/server/insights/*`, `apps/web/src/features/cellar/wine-insight.tsx` | Reuse cached canonical vintage/language profiles; no cross-tenant data leak |
| Provenance model | `packages/domain/src/provenance.ts` | Data model exists; actual wine-page UI is not yet integrated |
| Rights-guarded SQL search | `public.catalog_search`, `public.catalog_search_pilot` | Pilot data inaccessible through ordinary public API |
| Repository validation | root `package.json`, `pnpm check`, `pnpm db:types:check`, Playwright, migrations guard | CI E2E may be skipped; local execution requires proof |

Current Sprint 004A benchmark (reference only; reproduce to validate):

- X-Wines: **100,646** records in an isolated pilot database.
- Reference set: **127** manually curated test wines; X-Wines unequivocally covered **76/127 (~60%)**; 11 ambiguous; other misses/partials.
- Search benchmark: **77 top-1**, **92 top-8** of 95 present/covered queries; rank ties made deterministic.
- Pilot database p95 search: approximately **24 / 47 / 93 ms** at 1 / 8 / 16 clients; people's path 36 ms at 8 clients **without public external data**. These are NOT production API latency claims.
- Licensing status: **LWIN blocked pending contractual clarification**, **X-Wines unverified, pilot only**, **no provider cleared for production**.
- The earlier user-facing design sprint for bottle-card visuals must remain visually stable; do not redesign CELLR indiscriminately.

**Critical doctrine:** Extending CELLR is the goal. Recreating scan, search, taste modeling, household permissions or wine profiles is failure even if the new implementation looks elegant.

---

# 1A. Independent repository audit addendum — 12 November 2026

A separate Claude Code session reported an additional read-only repo/documentation survey. **Treat these as audit leads, not executed evidence.** This separate session ran no tests. WI-00 must verify each claim against the CURRENT repo and deployed-state documentation rather than silently relying on a stale snapshot. This section modifies the acceptance gates below.

## A. Production migration-history/bootstrap is a critical deployment dependency

The audit reports that production was assembled partly by manually applying SQL in the Supabase editor, leaving migration history incomplete, and that `docs/MIGRATIONS.md` §4 documents a practiced bootstrap that has NOT been authorized or executed. Before any schema-related sprint work, inspect the current migration history process, published production reference, deployment method and safe reconciliation plan *without connecting to production or exposing credentials*. Record this as `PRODUCTION_MIGRATION_BOOTSTRAP_REQUIRED` until independently verified otherwise. Do not call `supabase db push`, `migration repair`, migration bootstrap, schema changes, backfills or destructive operations against production; no owner approval for those actions is implied by this brief. Work with isolated local/staging stacks and additive migration files. Write an owner-only, step-by-step pre-deploy checklist with preflight evidence, dry-run, backups, verification and recovery/rollback actions. Block production deployment if history is unreconciled.

## B. AI budget fail-open must be investigated before expanding AI use

The independent audit reports that some existing AI budget checks fail open on their own errors. Confirm actual behavior, which paths and limits are affected, and the existing external API/provider spending controls. Do not replace every fallback with an outage without an explicit design decision, but ensure new bulk, on-scan, on-search, auto-profile and optional explanation paths **cannot cause unbounded paid model calls** when a budget service or database is unavailable. Prefer fail-closed for NEW paid operations and retain useful non-AI search/comparison when cost controls fail. Test budget-service outage, simultaneous requests, rate-limit exhaustion, timeout/retry storms, duplicate generation and a hard upper bound per request. Document which controls require the product owner to configure provider-side spending limits, because code-level rate limits alone are not a hard bill cap. Never alter a provider account or purchase a paid service autonomously.

## C. Practical validation must use real label photos and real device evidence

The audit says `docs/RECOGNITION-ROADMAP.md`/D9 still lacks a curated real-world label-photo set; real iPhone OCR latency, recognition quality and 3D/mobile UX have not been measured. Prepare a **user-photo acquisition protocol** (consent, minimization, storage/retention, permitted wine-only images, image deletion, no photo re-use in provider catalogs) and a small repeatable benchmark schema. Do not invent photographs or represent synthetic labels as real ones. Build synthetic tests now; mark `REAL_LABEL_VALIDATION_PENDING` until real consented labels and actual device evidence exist. Distinguish 'automated technical pass' from 'field/device validated' in final report and launch gate. Do not silently make recognition accuracy claims from synthetic fixtures.

## D. Separate stable wine knowledge from vintage-specific judgments

Review `docs/RECOGNITION-ROADMAP.md` and the existing profile/cache logic for the proposed reuse of stable facts across vintages. Stable **source-backed** attributes such as producer identity, appellation and some carefully supported wine-level properties MAY be reused across vintages under confidence/source/rights rules. Vintage-specific attributes (harvest notes, drink window, valuation, dated awards, vintage-specific grape percentages, vintage rating, ageability or expected price) MUST NOT cross vintages unless independently evidenced for that year. Preserve separate wine-level and vintage-level provenance and avoid creating a second incompatible cache. Deliver an ADR/decision note and tests showing correct reuse and blocked cross-vintage contamination. Do not treat broad regional grape patterns as verified producer specifications.

## E. Smaller audit follow-ups, not core scope diversions

- Admin authorization/docs conflict: Sprint U docs suggest non-admin admin pages returned HTTP 200, while the reported `proxy.ts` behavior suggests HTTP 404. Verify actual *HTTP status, server-side access control and data disclosure* with non-admin and anonymous requests. If resolved, fix stale documentation; if not, fix exposure without redesigning admin navigation.
- CI E2E is reportedly skipped on pull requests; targeted full-stack tests must run outside PR CI with documented test environment and artifacts. Preserve CI-enforced migration immutability.
- Several cellar/3D/admin components are large; use focused changes, regression tests, and integration boundaries, not broad refactoring during this epic.
- Reported repo and test totals are snapshots, not acceptance evidence; measure actual current counts.

# 2. Authority, risk and operating contract

## 2.1 Actions permitted without additional user approval

- Inspect and test local repository code and existing development environments.
- Create branches, implement code, write and run tests, modify documentation, produce local fixtures, build binaries/artifacts.
- Use existing official public documentation and legally accessible files for research.
- Download an officially published dataset to a **local isolated evaluation area** only if acquisition and local evaluation are permitted; record source, checksum, timing and conditions.
- Run isolated local and approved staging tests with synthetic accounts/data, subject to existing environment/rights safeguards.
- Commit and push reviewed changes to a non-main branch and open **draft** or regular PRs; post factual progress and test results in the PR.
- Continue between internally green work-package gates, avoiding unnecessary requests for approval.

## 2.2 Explicitly forbidden without user's approval / appropriate legal clearance

- Merge into `main`, deploy/release, change production DB migrations state, perform a production import, run backfills on real accounts or edit production rights status.
- Switch an external provider to `public`, set `rights_status=verified`, remove rights guards, rewrite logged license evidence, or bypass production/staging identity protection.
- Scrape protected commercial wine platforms, bypass sign-in/registration/captcha, harvest images, ratings, reviews, or prices with unclear rights.
- Agree to a provider's terms, pay for an API/plan, disclose credentials or contact providers while falsely representing written permission.
- Read, print, store or exfiltrate production secrets or identifiable household data for benchmarking.
- Quietly publish external records, train/fine-tune on provider data, or place rights-restricted source content into LLM prompts where terms prohibit that use.
- Modify personal user information, bottle quantities, pricing, tastings, user preferences or ratings without user action.
- Alter or squash applied migrations; break the migration immutability contract.
- Turn unsafe failures into success by silencing checks, weakening RLS, skipping tests or making exclusions broader.

## 2.3 STOP vs CONTINUE protocol

**STOP ONLY the affected workstream** and report the blocker immediately if any action requires production data access, paid enrollment, a new external license, ambiguous/contradictory permissions, unauthorized sensitive data use, major destructive migration, changes to production safeguards or an irreversible action. Do not stall the entire mega sprint: continue with local fixtures, existing CELLR canonical data, public documentation and other workstreams.

**CONTINUE** through normal engineering choices: component boundaries, minor database indexes, tests, fixture creation, translation strings, performance tuning, isolated design improvements, provided all invariants and exit criteria remain satisfied.

If an unexpected failure occurs, investigate, fix, rerun. Do not ask the user to approve routine retries; report a blocker only when actually blocked.

---

# 3. Non-negotiable architecture invariants

1. **Wine identity != vintage != bottle != bottle size.** Distinct identities across producer, cuvée, geography, style and, where meaningful, classification. A vintage-specific fact cannot be silently applied to another vintage.
2. **LWIN hierarchy:** LWIN-7 is wine identity; LWIN-11 adds vintage; LWIN-16 adds bottle size; LWIN-18 adds pack details. Model only confirmed fields and do not invent LWIN codes. A provider code is an external reference, not the CELLR primary key.
3. **External record != canonical CELLR wine.** An external record is candidate information, not a verified canonical identity. Canonical promotion and external-to-canonical link verification follow existing human-controlled audit rules.
4. **Provisional household wines stay private.** Never promote, export or attribute household observations to a shared wine unless the existing opt-in/approval framework permits and the value is safe to share.
5. **Provenance is field-aware where feasible:** each externally sourced fact can be traced to provider/dataset/version/retrieval/licence; AI-generated estimates are distinguishable from verified metadata and user inputs.
6. **No unsafe source mixing.** Provider rights apply separately to import, storage, display, enrichment, caches, LLM inference and training where relevant; explicit permission is required if ambiguity is material.
7. **No opaque matching.** Confidence and candidate ranking are for offering choices, not permission to silently assert an identity. Exact/verified-alias matches need conflict checks; fuzzy/partial matches require confirmation.
8. **Personal recommendations are per person/household.** Never cache a personal verdict globally; the shared AI profile, if eligible, covers a specific wine/vintage/language, without personal cellar or ratings.
9. **Public API never exposes pilot source records**, even with service-role access to the regular API; pilot tool remains separate and owner-marked.
10. **Current scan, Purchase Check, cellar, heroes, bottle illustrations, account/entitlement, privacy and accessibility flows keep working.** Add compatibility tests before changing interfaces.
11. **Reversible/expand-only schema changes**, additive first; type generation and RLS tests required; no changes to previous migrations.
12. **No fabricated facts or silently assumed sources.** Absent data shows as absent or an explicitly labeled estimate.

---

# 4. External dataset and legal policy

## 4.1 X-Wines (100,646 records)

Official repository: `https://github.com/rogerioxavier/X-Wines`  
License: CC0 1.0 in repository. Source data described by authors as collected from the open web in 2022.  
**Status for this initiative:** use in **isolated local/staging research** according to existing pilot controls. Do not assert that CC0 extinguishes third-party rights. Public commercial use remains blocked until provider/source-chain rights have been deliberately resolved and logged.

- Use textual identity/factual columns first (wine, winery, country, region, wine type; grapes if permitted and reliable). Avoid user ratings, user records, photographs, logos and reviews.
- Preserve source ID, licence snapshot, publication and retrieval dates, file hash and transformations.
- Treat a listed `Vintages` year as a **dataset-reported reference**, not proof a producer released that vintage.
- Compare quality against confirmed realistic user needs; X-Wines is not the sole catalog authority.
- Make author-contact letter and exact rights questions available as a deliverable, but do not send externally without user's authorization.

## 4.2 Liv-ex LWIN (200k+ wine/spirit identifiers)

Official pages: `https://www.liv-ex.com/lwin/`, `https://www.liv-ex.com/lwin-creative-commons-licence/`, `https://www.liv-ex.com/liv-ex-membership-terms/`, `https://www.liv-ex.com/website-terms-of-use/`  
**Status for this initiative:** code adapter and run unit/fixture tests. Do not bypass registration form, scrape pages, or import actual LWIN data unless acquired by a lawful authorized channel and the relevant license/context permits the planned pilot. A commercial `public` switch requires documented authorization and explicit owner approval.

- LWIN CC BY 4.0 page says copying/adaptation even commercially are allowed with appropriate attribution, link to license and change indication.
- Membership/website terms contain potentially conflicting restrictions about data storage, redistribution and AI use; clarify which terms govern the **separately licensed LWIN base catalogue**.
- Separate **open LWIN basic textual catalog** from paid Liv-ex market pricing, bids/offers, auction data, critic scores or API services. Never silently import the latter.
- Obtain actual official file and schema through permitted channel; compare with the existing assumed LWIN adapter. Reject unknown layouts; never guess column mappings.
- Verify whether LWIN codes, producer strings and region/classification fields can be shown in CELLR; record approved source/credit wording.
- Never present Liv-ex as endorsing or sponsoring CELLR.

## 4.3 Source clearance matrix

Record a rights decision for **each provider and each intended use**, not just a single vague `licensed=true` status:

| Intended use | Evidence required |
| --- | --- |
| Download/evaluation in isolated environment | Published license or written permission sufficient for evaluation, and source-acquisition terms |
| Store entire dataset in CELLR/Supabase | Reproduction/database rights and storage terms |
| Display records to consumers | Public display/reutilization rights, attribution and derivative-data terms |
| Combine/enrich data across providers | Sublicensing/derivative/attribution/database-right implications |
| Pass data to model for AI inference | Provider AI-use clauses; provider content processing and privacy conditions |
| Use dataset for model training | Separate, explicit right; **out of scope by default** |
| Keep derived fields after license termination | Contract-specific retention and removal rights |

Do not treat this table as legal advice or overclaim clearance. Document evidence links, exact version, scope, reviewer, date, limitations and follow-up. If evidence is insufficient, keep provider `unverified` or `blocked` and `search_scope` not public.

**An isolated pilot is not a production workaround.** Production never receives pilot data under the name of testing.

## 4.4 Source credit expectations

For each wine page, show a compact **Bronnen & betrouwbaarheid / Sources & reliability** section listing only actually used sources, including required licence links, modification notes and no-endorsement text. AI estimates and user-contributed values must be separated visually and in the data model. Ensure downloadable/accessible full legal notices where needed. Include a global acknowledgements/licenses page if required, but don't rely on it alone if a provider's license calls for more prominent credit.

## 4.5 Written-contact drafts (create; do not send)

Prepare two short, respectful e-mail drafts:

- **Liv-ex:** confirm that the LWIN CC BY 4.0 database (only identifiers + producer/wine/region/type/classification text; no pricing/market data) can be downloaded, stored in CELLR's commercial app DB, searched/displayed with attribution, used as context for user-specific AI inference, and whether membership/website restrictions apply to the separately CC-licensed LWIN download. Ask about permitted update access and exact required attribution.
- **X-Wines authors:** request detail on upstream websites, how collection/compliance was handled, whether any known third-party database/contract rights restrict commercial use of identity fields, and whether they have an authoritative list of source attributions.

Include e-mail drafts under sprint documentation. Do not assert provider consent until actually received.

---

# 5. Operating structure: one mission, eight sub-sprints

## Branching and PR policy

Preferred execution model: **one umbrella initiative, incremental reviewable sub-sprint PRs**. If continuous execution cannot wait for merges, use **stacked branches/PRs** or an umbrella feature branch with explicitly labeled, green checkpoint commits and a draft PR. Choose the option consistent with the existing CELLR repository workflow and report it before coding.

- Never open eight unrelated PRs whose dependencies are unclear.
- Do not merge any PR. Do not modify `main` locally beyond normal updating/rebasing.
- Every checkpoint should be independently understandable: code, test evidence, docs, known limitations.
- Where a sub-sprint cannot meet its safety gate, mark it **BLOCKED** and continue independent sub-sprints; do not quietly mark it done.
- Create an **EPIC.md** status document, updated after each sub-sprint, and an ADR for each consequential design change.
- Run an independent adversarial review after schema/security/matching changes, preferably through a separate agent that did not implement the component.
- A single very large final PR is an exception, not a target. If size forces a mega-PR, preserve meaningful commits and per-component review checklists.

## Planned work packages

| ID | Name | Primary outcome | Can proceed if external rights unresolved? |
| --- | --- | --- | --- |
| **WI-00** | Baseline, architecture & threat model | Current-state audit, baseline tests, explicit execution plan | Yes |
| **WI-01** | Provider adapters, identity quality & pilot coverage | Clean, benchmarked two-source staging foundation | With fixtures/X-Wines permitted pilot; LWIN gated |
| **WI-02** | Shared search/autocomplete UX | Fast typing and candidate selection in cellar and Purchase Check | Yes, canonical + private CELLR data |
| **WI-03** | Scan-to-catalog resolver | Consistent scan matching and safe confirmation | Yes, same legal fallback |
| **WI-04** | Buying intelligence and profile reuse | Reuse good data and personalized advice without redundant AI | Yes, source-gated |
| **WI-05** | Provenance, trust & wine pages | Visible sources and AI-estimate labeling | Yes |
| **WI-06** | Admin governance, telemetry & operational safety | Review queues, quality and rights controls, observability | Yes |
| **WI-07** | Full regression, stress, legal-readiness & release dossier | Evidence-based go/no-go with preview/PRs | Yes; public external launch may remain blocked |

**Do not confuse sub-sprint completion with public launch**. The mission may finish with all core CELLR functionality built and external providers deliberately disabled pending legal approval.

---

# 6. Sub-sprint specifications and acceptance gates

## WI-00 — Repository baseline, execution map and baseline tests

**Objective:** establish a reliable starting state and a plan grounded in the code that exists **now**.

### Implementation tasks

1. Fetch main, inspect latest merged PRs including #65 and any later changes. Record branch, base SHA, migration head, environment capabilities and dependency versions without exposing secrets.
2. Read `docs/CATALOG.md`, **`docs/MIGRATIONS.md` §4 and `docs/RECOGNITION-ROADMAP.md`**, Sprint 004A report, auth/RLS documents, user agreement/privacy notes, key UI components and existing CI configuration. Independently verify every claim from the 12 November read-only repo audit (§1A).
3. Trace all paths from input to outcome:
   - cellar add: `ChooseWine` → wine pick/new → vintage → bottle addition;
   - scan: photo/OCR → server recognition → candidates → user confirmation → bottle;
   - Purchase Check: manual/photo → confirm → comparison → verdict;
   - insight: wine/vintage → household cached/shared profile → model generation → display.
4. Map canonical, provisional, verified external link, provider record, vintage ID and bottle ID shapes and ownership.
5. Run baseline `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm db:test`, `pnpm db:types:check`, `pnpm build` and appropriate targeted Playwright checks where tooling exists. Distinguish **run/passed**, **run/failed**, **skipped** and **cannot run**.
6. Identify feature-flag conventions and whether new features can be enabled independently. If missing, add a minimal safe pattern consistent with repo; defaults must preserve current user behavior.
7. Create `docs/sprints/wine-intelligence-mega/EPIC.md` with dependency DAG, PR/branch strategy, component ownership, baseline issues, test matrix, risk register and status log.
8. Create an architecture decision record **ADR-001: external identifiers and identity lifecycle**. Confirm no need to redesign the already-merged Sprint 004A schema.
9. Review privacy/authorization impact: search query, purchase-check processing, photos, user/household data, logs and AI providers.
10. **Deployment prerequisite:** inspect migration-history/bootstrap documentation and produce `PRODUCTION_MIGRATION_BOOTSTRAP_REQUIRED` decision and owner-only reconciliation checklist. Never execute production migrations/bootstrap as part of this epic.
11. **AI spending control baseline:** verify fail-open/closed behavior for every affected model-call path, external spending limits, concurrency and failure paths; record risks and critical new-call safeguards.
12. **Practical scan validation baseline:** inspect recognition roadmap/D9; record count of permissioned real-label photos and real iPhone measurements separately from synthetic tests.
13. Verify the admin non-admin 200-vs-404 claim by actual auth/HTTP tests or explicitly mark it unverified.

### Gate WI-00

- Current-state diagram and existing-code ownership mapped.
- Baseline test report with exact commands, environment and failures.
- Stop/go matrix and feature flags defined.
- No production data used, no migration changes without necessity.
- Written work plan supports the rest of the epic without repeated discovery.
- `PRODUCTION_MIGRATION_BOOTSTRAP_REQUIRED` (or evidenced closure), a safe owner-only pre-deploy checklist and the production deployment block are recorded.
- AI budget fail-open findings and risk-controlled new paid-call policy are documented.
- `REAL_LABEL_VALIDATION_PENDING` and real-device test requirements are visible in the stop/go matrix.
- Admin 200/404 discrepancy is verified or explicitly tracked.

### User-facing checkpoint

Briefly report the status of the initial repo, test baseline, selected PR/branch strategy, biggest risks and next module. Do not claim external licenses cleared.

---

## WI-01 — External catalog ingest, deduplication, provenance and evidence

**Objective:** mature the already merged provider staging catalog and validate a two-provider identity strategy without introducing commercially unapproved records into public user flows.

### 1. Data acquisition and fixtures

- Reuse `scripts/catalog-tools/` importer, provider admin tools and LWIN/X-Wines adapters. Do not duplicate provider tables or create alternative search infrastructure.
- Use existing 100,646-record X-Wines checksum-verified pilot as a reproducible baseline, **only within permitted isolated evaluation**.
- For LWIN, obtain file only through authorized channel and permission. If not available, use **synthetic LWIN-schema fixtures** and keep real data test as blocked; explicitly mark adapter as unverified.
- Store external input files outside Git except deliberately small non-copyright-risk fixtures. Never commit entire large provider datasets, passwords or API keys.
- Validate CSV/encoding/unicode/null values/delimiter, duplicate IDs, unknown wine types, implausible years and source schema versions.
- Preserve first/last import provenance, source checksum, version, timestamp, country/region, provider external IDs, textual corrections and map decisions.
- Make imports idempotent and restartable. A partial failure must not silently leave a provider shown as complete.
- Verify withdrawal and source-disable behavior. When rights are rescinded or provider data withdrawn, search and provenance stop exposing it.
- Check `admin_catalog_provider_rights` remains separate from provider registration/import. A normal import must not mutate rights status.

### 2. Canonical link and dedup rules

- Implement or improve **candidate matching**, not automatic canonical promotion. Use existing `catalog_record_links` and admin review, never a second link system.
- Distinguish spelling differences (diacritics, punctuation, articles, estate descriptors) from real cuvée changes (`Reserve`, `Gran Reserva`, `Second Wine`, `Blanc`, `Rosé`, grand vin etc.).
- Require producer + cuvée + compatible wine type and known non-conflicting country for exact-candidate suggestions. Region/appellation can help, but do not let region strings force a false merge.
- A verified LWIN code, when legally available, is stronger evidence than loose string similarity. Do not assign LWIN IDs by guessing.
- Keep a reversible audit trail of confirmed/rejected source-to-canonical links and record who approved, when and why.
- Avoid duplicate candidates from several providers in the UI when a **verified link** exists. If two external records seem the same but not verified, group suggestions conservatively with visible sources, not a false unified identity.
- Do not infer wine release availability from X-Wines' ratings-derived vintage lists.

### 3. Benchmark and calibration

- Start from `eval/catalog/benchmark.json` (127 wines) and extend to at least **200 curated identity queries**, with disclosed composition, source/evidence and reproducible expected answers. Use legitimate catalog data and synthetic perturbations; do not fabricate real-world identity claims.
- Representation: Bordeaux/Burgundy/Rhône, Champagne, Rioja/Ribera, Tuscany/Piedmont, Portugal, Germany/Austria, New World, supermarket/entry level, Netherlands, uncommon names, brand aliases, NV, vintage-specific labels, similar cuvées and difficult conflicts.
- Include negative cases: different country, wine color, producer, second wine, wrong vintage, swapped appellation, generic `chateau`, OCR misspellings and malicious strings.
- Measure coverage by provider/segment; exact verified match precision; top-1/top-3/top-8; ambiguous rate; no-match; wrong-identity rate; duplicate candidate rate.
- Never present precision measured on a dataset where the ground-truth oracle was generated by the same fuzzy matcher.
- Compare with baseline numbers (77/95 top-1; 92/95 top-8 for covered wines), using matched baseline queries to avoid misleading percentage changes.
- Search against realistic load (100k+ external records, at least 10k synthetic private wines) and document query plans/index sizes.

### 4. Licensing gate

Create `SOURCE_RIGHTS_REGISTER.md` with exact source URL, dated evidence, claimed license, any conflicting terms, storage/display/inference permissions, proposed attribution and **status: verified / unverified / blocked**. No model-generated sentence may change the actual database rights flags. Do not automatically set `public`.

### Gate WI-01

- Reproducible pilot import + second import leaves no duplicated records.
- LWIN fixture adaptation tested; actual LWIN import is clearly gated on lawful file + schema verification.
- No unauthorized records visible through ordinary authenticated API.
- Unknown rights remain disabled for production.
- No false canonical auto-promotion; explain every benchmark error.
- Full SQL rights, RLS and import tests pass, plus catalog tool unit tests.

---

## WI-02 — Universal autocomplete and manual selection

**Objective:** make database-backed autocomplete a fast, premium and consistent experience wherever someone manually enters a wine.

### 1. Shared UI component and hook

Create a reusable, accessible wine search / combobox component aligned with CELLR's existing field, button, card and theme primitives. One component should serve **cellar add** and **Purchase Check** with mode-specific actions; do not make parallel, subtly different search UX.

Preferred interaction:

- Immediate focus on search field where the original form does so.
- Debounce approximately 200–300 ms; issue no network search for queries shorter than the backend minimum.
- Abort or ignore older requests; stale responses can never override the latest query.
- Query through existing `GET /api/v1/catalog/search`, not by downloading all 100k wines to the device.
- Show a compact list (e.g. up to 8 visible, full server bound 20), with producer, wine/cuvée, region/country and appropriate wine type; optional vintage is user selection, not fabricated metadata.
- Distinguish **In jouw kelder**, **CELLR-catalogus** and **Externe databron (nog niet geverifieerd)** only when actually appropriate; for public UI, only commercially permitted provider records appear.
- Owned wines rank well, but ranking must not hide exact matches of another cuvée just because a similar owned wine exists.
- Select exact result by keyboard and touch; screen reader announcements as appropriate.
- Support arrow keys, Enter, Escape, focus/blur, dismissal and visible loading/empty/error states; accessible roles/labels and stable touch targets.
- Preserve existing Add New Wine action: if no match or user rejects results, allow manual entry with the typed values preserved.
- Preserve data through Back, edit, modal dismissal and navigation.
- Light/dark theme and NL/EN locales; don't change unrelated layout or the 2D bottle rendering.

### 2. Identity selection behavior

- **Owned/household/canonical result:** use existing identity where allowed, preserving household permissions and vintage selection.
- **External record:** explicitly confirm provider producer/name/type/country/region; do not pass external `record_id` where a CELLR `wine_id` is required. Create the household's provisional wine through the existing safe flow if no verified canonical link exists; optionally retain a provenance hint **only if such storage is legally permitted and architecturally appropriate**.
- **Alias/fuzzy/prefix:** selection is a user choice, never silent canonical verification. Preserve manual correction options.
- **Year:** select or type vintage separately; handle NV and unknown without defaulting to current year.
- **No-match:** continue cleanly to manual workflow, never block adding a bottle or buying advice.

### 3. Integrations

A. `ChooseWine` in `add-bottle-flow.tsx` and related scan fallback flows. Keep the existing QR/photo action and existing quantity/location inputs intact.  
B. `PurchaseCheckScreen` manual ConfirmStep: preferably a lightweight new *search first* entry path with selected candidate and editable confirmation. User can still choose **Type manually without selecting a result**.  
C. Reuse where other manually typed wine identity fields exist only if the business purpose and permissions match. Avoid broad UI replacement by default.

### 4. Compatibility and error treatment

- If `/catalog/search` is unavailable (e.g. deployment order), fall back to current manual/local lists, not a broken screen.
- For `429`, avoid repeated retries and show respectful rate-limit help.
- For offline/timeout, preserve typed text and manual entry.
- For incorrect producer labels and Unicode input, selection remains consistent.
- No uncontrolled API request amplification from rapid typing or remounts.

### Gate WI-02

- End-to-end tests: search → choose owned wine → add bottle; canonical wine → vintage → add; no match → create; external candidate (pilot in test-only harness) → explicit confirmation → provisional; manual Koopcheck → choose → price → verdict.
- Keyboard/screen-reader/axe checks, iPhone-size + desktop, NL/EN and light/dark.
- Negative tests for races: old response returns after new, unmount, network error, `429`.
- Existing cellar create workflow, photo upload, location, quantity and wish fulfillment still work.
- Measured API and user-perceived autocomplete latency, with hardware/network/profile noted.
- No new PII leak in response, logs or browser state.

---

## WI-03 — Scan-to-catalog recognition integration

**Objective:** reuse the same server-side identification and matching philosophy for scanned labels; reduce unnecessary model calls without compromising identity correctness.

### 1. Preserve current scan architecture

Use current scan OCR, `recognizeLabelText`, `matchLabel`, photo/fingerprint cache, current image sanitization and vision fallback. Do not replace the entire scan pipeline or make the app dependent on a single external provider.

### 2. New or refined server-side resolver

Implement a narrow orchestration interface (name it after repo conventions) that takes **normalized extracted facts** and a household context, returns **ranked candidate references plus reasons**, and never changes a wine identity by itself.

Example contract (adapt to existing schemas):

```ts
// Illustrative only. Reuse the domain package's current types.
type ResolveWineRequest = {
  producer: string | null;
  name: string | null;
  year: number | null;
  nonVintage: boolean;
  type: WineType | null;
  countryCode: string | null;
  region: string | null;
  appellation: string | null;
  labelText?: string | null;
};

type ResolveWineOutcome =
  | { status: "exact_candidate"; candidates: Candidate[]; year: number | null }
  | { status: "ambiguous"; candidates: Candidate[]; year: number | null }
  | { status: "not_found"; candidates: []; facts: NormalizedFacts }
  | { status: "unavailable"; facts: NormalizedFacts };
```

Recommended lookup order:

1. Recognized identical household scan cache, if valid and consent/ownership rules still match.
2. Existing household-owned wine exact identity.
3. Existing verified canonical catalog wine (including aliases, with strong conflict guards).
4. Rights-approved external results, as **suggestions only** if not linked/verified.
5. Bounded fuzzy candidates when exact paths fail.
6. Current vision model fallback if OCR lacks enough information, is ambiguous, or yields no safe match; never assume the model has access to licensed provider data.

An OCR confidence score is about transcription; a catalog match score is about identity. **Do not conflate them.** The UI should show uncertainty when appropriate. Avoid parallel duplicative AI calls.

### 3. Critical review screens

- High-confidence exact candidate may be preselected **only if existing CELLR confirmation rules allow**; still show correct name and vintage for user review.
- Ambiguous candidates show discriminating properties (producer, cuvée, wine type, region, year) instead of a vague single suggestion.
- Explicit **Niet deze wijn** / **Not this wine** action leads to editable manual details.
- A scan of a new wine must not create duplicate canonical records.
- Multi-bottle or series scanning, back-label handling and existing privacy behavior remain functional.
- Buying-check scan photos remain ephemeral as before; do not use cellar scan storage assumptions for purchasing photos.

### 4. Golden scan evaluation

**Practical-evidence gate:** distinguish synthetic/benchmark fixture results from consented real label photos and real-device performance. If genuine photos or physical-device access are missing, produce a repeatable acceptance protocol and mark practical validation **PENDING**, not **PASS**. Do not represent a browser mobile emulator as an iPhone hardware measurement.

Build a regression set of label-text/OCR samples and synthetic images representing:

- correct exact/alias; fuzzy; OCR errors (`0/O`, `1/I`, accent removal, hyphenation);
- differing reserve/gran reserva / second wines;
- missing name / only estate / ambiguous generic producer;
- year present, NV, unknown, implausible future year;
- country/style contradiction;
- multi-line names and labels with branded non-wine text;
- matching a household-owned wine versus same-named canonical;
- provider disabled mid-session;
- tenant boundary and scan-result replay.

**Safety target:** zero wrong automatic identity assertions in the adversarial golden set; ambiguous cases must request confirmation. Report auto-exact rate and false positive rate separately; do not optimize match rate by relaxing precision.

### Gate WI-03

- Scan-to-catalog pipeline works on allowed catalog and fixtures without regression.
- No external pilot records visible in consumer scan flow.
- No wrong-wine autoassignment in golden suite.
- OCR-only savings measured, model fallback retained.
- Scan flows tested on real or emulator iPhone/desktop where tooling allows.
- Existing purchased-image privacy and cellar-image retention behavior unchanged.

---

## WI-04 — Shared wine intelligence, personalized Koopcheck and bounded AI

**Objective:** create the perceived value that makes CELLR useful beyond generic catalog search: a trusted wine profile plus genuinely personalized buying advice, without duplicate AI costs.

### 1. Trace and preserve existing intelligence layers

Separate at least these layers:

| Layer | Scope | Reuse policy |
| --- | --- | --- |
| Wine identity and factual attributes | Canonical CELLR wine / source record | Share only as permitted, with provenance |
| Vintage-specific wine profile (grapes, style, drinking window, confidence) | Canonical wine + vintage + language + profile version | Reuse only if current validation, source quality, freshness and rights allow |
| Household cellar context | Household | Never globally share |
| Personal tastings/preferences | Individual user | Never globally share; use existing access rules |
| Buying verdict | User × wine/vintage × price × cellar/taste context | Compute per request; do not globally cache |
| AI prose explanation | Derived per user, if implemented | Must be grounded and visibly labeled; rate-limited |

Existing `shared_wine_profiles`, household `vintage_insights`, `profileUpgrade`, `checkInsight`, `shareableInsight` and `PurchaseCheck` comparison logic are the starting point. Do not create another global profile table unless justified by a reviewed ADR and migration tests.

### 2. Candidate wine profile retrieval

**Stable-facts enhancement (from `docs/RECOGNITION-ROADMAP.md`):** evaluate whether existing wine-level, source-backed facts can be reused safely across vintages separately from the existing vintage-specific AI profiles. Preserve provenance and source permissions. Explicitly forbid reusing drink windows, vintage valuations, year-specific harvest assertions and unsupported grape percentages across vintages. Add an ADR and positive/negative reuse tests; implement only if it fits existing architecture without creating contradictory caches.


For manual Purchase Check, the candidate may **not be in the user's cellar**, and may be an external pilot/verified record with no canonical ID. Design an explicit route that works without creating a fake bottle or private tasting:

1. If canonical wine/vintage identity exists and a valid shared profile is permitted, reuse it.
2. If no profile but reliable structured facts exist, calculate only what can be supported deterministically, marking unavailable signals as unknown.
3. If user requests detail and AI use is allowed for this source and user tier, generate via existing bounded infrastructure with a dedicated subject/context, validate output, and store only in an appropriate legal scope; do not mislabel inferred data as verified facts.
4. If the candidate is an unverified provider record, never inject it into the globally shared cache as canonical.
5. Never launch expensive auto-generation merely because autocomplete results were returned or the user tapped a result.
6. Avoid dogmatic cache hits: if age, source conflicts, profile version or evidence quality invalidates a cached profile, do not reuse it blindly.
7. Prevent duplicate simultaneous model generations for the same eligible key (idempotency/lock if necessary), with documented retry behavior.

Potential cache key includes verified canonical wine ID, exact vintage (including NV/unknown distinction), language and analysis schema/model version. Avoid duplicate generation from different flows. Record `cache_hit`, `cache_miss`, `cache_stale`, `ai_blocked_by_license`, time/cost and profile validation result without personal sensitive content.

### 3. Personalized buying verdict

Keep the current deterministic `checkPurchase` as the authoritative recommendation engine unless an ADR and evidence justify a change.

- Take exact selected candidate, optional price and currently available taste signals from the *signed-in person* and permitted household cellar data.
- Compare expected style, body/tannin/acidity/sweetness, grapes where confidently known, overlap/diversification, existing cellar stock, user feedback and preference evidence.
- Distinguish recommendation confidence from identity confidence. A recognized bottle can still have insufficient taste evidence.
- Explanations must honestly describe why a score/verdict was produced; no hallucinated user history, producer awards, critic scores, market value, vintage-specific notes or personal ratings.
- Price/value verdict must not imply current market pricing unless that data actually exists from an authorized source. If user enters shelf price, compare only according to supported logic and clearly state limitations.
- Show a clear uncertainty state: not enough preferences, limited wine attributes, source not confirmed or no stored profile.
- **Never add the wine to cellar** after purchase check unless user separately chooses that action and confirms.

### 4. Optional AI explanation (stretch within WI-04, not a reason to block core)

If significant value is demonstrated and existing policies/entitlements permit it:

- Add a bounded, on-demand explanation layer on top of deterministic findings (not a second independent verdict). Accept only normalized, minimized facts relevant to the explanation.
- Validate prompt and output schemas. The LLM may summarize and contextualize; it may not override score or invent evidence.
- Add explicit rate/usage limit, timeouts, model failure fallback, token-cost visibility in telemetry and safety checks for prompt injection from wine names/labels.
- Honor provider restrictions on using metadata in AI requests; if unclear, **do not use that provider data in model inference** and continue with permitted CELLR metadata only.
- Treat free/paid features and costs as existing product policy; no unilateral paywall or entitlement redesign.

### 5. Required tests

- Reproduced budget-service failure in every NEW paid model path: no unbounded calls, no infinite retry, deterministic non-AI fallback remains available, and provider-side hard spending cap requirement is documented for owner setup.
- Cross-vintage stable facts are reused only when clearly wine-level and source-backed; vintage-specific drink windows and prices are NOT reused.

- Same canonical wine/vintage/language/valid profile reused without an extra LLM invocation; different vintage not reused incorrectly.
- Invalid/stale profile triggers appropriate fallback, not silent fabricated output.
- New candidate not in cellar receives a verdict without creating bottle records.
- Correct taste/cellar data used only for the authenticated actor; household cross-leak denied.
- Buying verdict without price or taste data gives honest uncertainty.
- LLM unavailability/budget exhaustion does not break deterministic comparison.
- Parallel calls do not generate duplicate expensive profiles where a safe shared key exists.
- Provenance and source rights govern every data path, including LLM inputs.

### Gate WI-04

- Concrete personalized Koopcheck works for a manually selected wine not owned by the user.
- Existing deterministic behavior and scoring remain correct and non-regressed.
- Shared profiles reused where safe; added AI costs measured and limited.
- No personal verdicts or cellar data in global caches.
- Negative prompt-injection and cross-tenant tests pass.

---

## WI-05 — Premium wine page provenance, reliability and consistent UI

**Objective:** make complex data and AI conclusions understandable without turning CELLR's wine detail into a legal dashboard.

### 1. Surface for actual facts

Add a compact, reusable **Bronnen & betrouwbaarheid / Sources & reliability** section near the lower part of the wine detail page and, where meaningful, in purchase-result detail.

Suggested groups:

- **Wijnidentificatie / Wine identification:** CELLR catalog; if applicable licensed external provider + licence link.
- **Wijnkenmerken / Wine characteristics:** source-backed fields with confidence and a way to inspect provenance.
- **CELLR AI-analyse:** labeled AI estimate, when generated, with date and caveats for drinking windows and projections.
- **Jouw gegevens / Your data:** tasting notes, purchase price, cellar inventory, subjective ratings.

Only show sources **actually used** for a fact, never a generic provider logo on every wine. The section must be visible and usable in NL and EN, mobile and desktop, light and dark themes. Default styling should preserve CELLR dark burgundy/gold elegance and readable white/warm text.

### 2. Information precision

- Never say a producer fact is *verified* merely because it came from a public dataset.
- Distinguish original provider value from CELLR normalization/transformation where required.
- Show provider link, license, any modifications, dataset age and no-endorsement sentence in an accessible details panel.
- Do not imply a drinking window or valuation is an objective fact; an AI-generated forecast must be labeled and its uncertainty preserved.
- No raw legal notices crowding the top of cards; use a compact disclosure + full legal notice view if compliant with provider terms.
- If a wine was entered entirely by the user, do not fabricate external sources.
- If a wine is sourced from multiple providers, list each applicable contributor, do not attribute all fields to LWIN or X-Wines indiscriminately.
- Respect existing generated 2D bottle art and cellr logo design; do not load external provider image assets or copy wine label artwork.

### 3. UX quality

- Accessible disclosures, keyboard navigation, screen reader status, focus handling, sufficient contrast and 44px-ish touch affordances where consistent with design system.
- Screenshots: phone and desktop, dark/light, NL/EN, real canonical profile + no-source case + multiple-source case + empty/AI-only case.
- If optional legal notices link externally, no trackers or embedded remote content are introduced.
- External provider attribution string must be data-driven, not hardcoded by source name.

### Gate WI-05

- Each information origin is accurately identified; required CC BY credit/link/change notice shown where applicable.
- No unsupported claims of licensing, source endorsement or verification.
- Mobile visual QA and axe checks pass; current wine card and hero remain stable.
- Component and E2E tests verify specific source visibility and hidden-source cases.

---

## WI-06 — Admin quality, controls, metrics and supportability

**Objective:** make the wine catalog operable after launch, not just demo-ready.

### 1. Admin workflows

Review existing Wine Master admin rather than opening a parallel control panel. Add only features genuinely missing:

- Provider list with rights status, evidence link, audit history and live/pilot/off distinction.
- Queue of suggested external-to-canonical links with side-by-side discriminators and actions **Approve / Reject / Needs investigation**. All decisions logged with actor and reason.
- Duplicate and conflict dashboard (same provider external ID changing identity, two sources disagreeing, two canonical candidates, wrong type/country).
- Data freshness and provider outage indicators; per-source counts and last successful import, withdrawals and parsing rejects.
- Optional sample-review interface for LWIN import when authorized file exists.
- Clear notice that license verification is a human administrative responsibility, not a model conclusion.

### 2. Import and update lifecycle

- Idempotent and auditable scheduled/manual import design; do not enable recurring production imports without authorization and documented provider terms.
- Support input version detection, diff report, sample preview, idempotent apply, error rollback/restart, withdrawn records and review on material identity changes.
- No accidental source rights escalation through source config or import scripts; preserve hardcoded production protection and environment identity checks.
- Source shutoff/rollback must quickly remove externally sourced records from consumer searches while leaving household-owned content intact.
- Data updates must not mutate an already verified CELLR canonical identity without reviewed correction flow.

### 3. Observability (privacy first)

Measure aggregated metrics without sensitive wine-label images or raw personal queries in logs by default:

- search count, success/zero-result, latency p50/p95, cancellation, 429, error rate;
- source contribution by provider and status;
- result selected rank and confirmation/edit rate (with explicit privacy evaluation);
- scan OCR path vs vision fallback, match ambiguity, confirmed mistakes;
- AI profile cache hit/miss/stale, AI spend, latency and failures;
- purchase-check completed and uncertainty rates;
- catalog update conflicts, duplicate links, source rights blocks and import incidents.

Use existing analytics style and rate limits; do not invent a second analytics SDK. Use coarse/aggregated safe events, no plaintext search queries or personal taste responses unless explicit approved requirements exist.

### 4. Governance and privacy

- Confirm Supabase RLS by role and household; no service-role shortcut in a consumer route.
- Document retention and deletion behavior for any new external record relationships, image references and analytics.
- Update draft privacy notice only with facts backed by the implementation; do not assert compliance without review.
- Explicit role access checks around admin-only rights and link decisions.
- Assert legal source disable/withdraw is enforced on consumer search **and** provenance endpoints.

### Gate WI-06

- Admin can review links safely with audit trail, existing security model and per-record source display.
- Bad source, lost rights or ambiguous import is denied/reviewable rather than silently active.
- Aggregated metrics produced without sensitive query/photo logging.
- Appropriate access/permissions and immutable audit tests pass.

---

## WI-07 — Integrated verification, performance, security and release dossier

**Objective:** prove that the combined product actually works and document exactly what is *not* released.

### 1. Full build and regression

Run at minimum (adjust to repository scripts, report actual commands):

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm db:test
pnpm db:types:check
pnpm build
pnpm migrations:check
```

Run relevant Playwright projects in a real local stack / valid preview environment; CI end-to-end is known sometimes to be skipped on PRs, so `CI green` **does not substitute** for executing at least the changed user journeys. If infrastructure prevents E2E execution, report specific unavailable tests, not "everything passed".

### 2. Mandatory cross-flow E2E matrix

Verify the production-migration bootstrap prerequisite **without applying anything to production**. Confirm any admin HTTP status/access discrepancy through actual anonymous/non-admin tests. Include failures of the new paid AI paths when usage-budget services are unavailable. Add a separate physical-device field-test checklist for real labels, mobile network and camera/OCR latency, leaving its status pending without actual hardware evidence.

| Scenario | Expected outcome |
| --- | --- |
| Add existing cellar wine manually | Exact selected wine, correct vintage, quantities/location preserved |
| Add canonical wine with new vintage | Existing canonical identity, allowed safe vintage flow |
| Add wine not in catalog | Typed details preserved, provisional household identity created |
| Autocomplete typo/alias | Candidate offered, explicit user confirmation, no false verification |
| Search short/empty/common names | Stable bounded results and efficient response |
| Select external unverified pilot record through public API | **Denied / not visible** |
| Scan known label via OCR | Correct candidate and vintage; vision model avoided when safe |
| Scan ambiguous near-twin label | No silent choice; explicit review screen |
| Scan illegible label | Existing vision/manual fallback and photo handling |
| Purchase Check manual recognized wine | Candidate → vintage → price → personalized verdict; no cellar mutation |
| Purchase Check unknown wine | Manual option and honest uncertainty |
| Purchase Check photo input | Current ephemeral image behavior retained |
| Valid shared profile exists | Reused, no redundant AI call |
| No cached profile / AI unavailable | Graceful fallback without fabricated claims |
| Two households with similarly named provisional wines | No cross-household search, profiles, notes or verdict leakage |
| Provider status switched to off/blocked | Public search/provenance stop returning its records |
| User toggles light/dark or NL/EN | Search, cards, disclosures and results still usable |
| iPhone, tablet and desktop | Touch targets, layout, search keyboard and navigation correct |
| Keyboard/screen reader accessibility | Combobox roles, navigation, focus and source details work |

### 3. Security and data correctness

Red-team list:

- Trigram/fuzzy abuse with wildcards/regex, excessive query lengths, malformed Unicode, SQL injection, control characters.
- Nonsense country/type, non-wine labels and lookalike producers.
- Prompt injection strings embedded in labels and imported wine names (must remain treated as **data**).
- Brute-force enumeration of private wines; RLS and rate-limit bypass; caller switching household ID.
- Service-role staging access from public routes; accidental pilot provider exposure.
- Provider enabled without evidence; legal-data disable and withdrawal.
- Import with production/staging URLs, spoofed project refs, wrong schema, partial failure, repeated import, update-withdraw cycles.
- Unknown/changed vintage; NV and year 2021 vs 2018; second wine vs grand vin; dark vs white/rosé.
- HTML/URL injection in source credits; XSS; malicious external URLs.
- Client race conditions and stale query responses.
- Concurrent cached profile generation, unauthorized leakage and budget exhaustion.
- User opt-out and private data consent boundaries.

### 4. Performance and economics

Use representative **actual** production-shaped or synthetic test loads, clearly specifying environment:

- Catalog local SQL `p95 < 250 ms` at 100k+ provider + 10k+ household records, 16 clients, without sacrificing match quality; compare baseline.
- Consumer API latency after server/network under realistic mobile conditions: define and measure; suggested initial target p95 <= ~700 ms server+network **excluding deliberate debounce**. If not achieved, report contributors rather than adjusting data invisibly.
- UI: results appear quickly and scroll smoothly; avoid large payloads and network requests per keystroke.
- Run a 200+ query recall/precision benchmark and an adversarial scan identity suite.
- Calculate approximate cost of one label scan, one AI profile, one candidate comparison and one optional AI explanation; show worst-case rate-limit exposure and expected effect of cache reuse.
- Measure DB index size, import time, fresh/stale cache ratio and source coverage by price/geographic segment if data supports such conclusions. Never invent provider prices or sell rates.
- State explicitly that a source not public in the test environment is not represented by user-path performance results.

### 5. Final release dossier

Deliver `FINAL_REPORT.md` with:

- Scope completed, partial and blocked by sub-sprint.
- PR(s), commit SHAs, migration files and deployment instructions.
- Tests: commands, results, skipped checks, screenshots and links.
- Benchmark: exact dataset version, record counts, verified set, top-1/top-8, false-match cases, p95 and environment.
- Legal sources: documented approved/unapproved, source URLs, required attribution, consent status and explicit public-enable decision list.
- Data model, architecture decisions, DB roles, RLS and privacy handling.
- Cost/latency estimates with actual evidence and caveats.
- Risks, rollback plan, release checklist, product recommendations and next 3 priority improvements.

### Gate WI-07

- Zero unresolved **P0** issues; no known tenant data leaks; no pilot visibility; no wrong autoidentity failures in golden suite.
- P1 issues documented and mitigated, not silently ignored.
- All executable required tests pass; skipped tests are listed with reason and follow-up; key E2E scenarios have real evidence.
- User-facing preview or screenshots ready, with correct feature flags.
- PR open for human review, not merged; production external provider switch remains off unless separately approved.

---

# 7. Quality targets and definitions of done

These are engineering targets, not evidence that a baseline already meets them. Never fabricate results to satisfy them.

| Dimension | Target / rule | How measured |
| --- | --- | --- |
| Identity safety | **0** wrong automatic canonical identity assignments in adversarial golden set | Negative E2E/unit tests with independent expected outcomes |
| External source visibility | **0** pilot/unverified results in public API | Authenticated/RLS/SQL integration tests |
| Data licensing | **0** unapproved public providers; every shown source has recorded license + provenance | Rights register + runtime rights checks + rendered UI tests |
| Tenant isolation | **0** cross-household private wine, profile, tasting or purchase data leaks | SQL RLS and service-route tests |
| Search quality | No regression on original 127 cases; aim at least baseline 92/95 top-8 for covered 004A queries | Reproduced named benchmark, plus expanded test set |
| Search speed | SQL p95 under 250ms on comparable local benchmark; measure full API separately | Repeatable load harness, p50/p95 and query plans |
| AI reuse | When safe, valid shared profile reused without extra generation; no cross-vintage reuse | Spy/mock tests and usage telemetry |
| User action | No cellar bottle mutation during a purchase comparison | E2E and server service tests |
| Accessibility | No serious axe violations in changed screens, keyboard navigation complete | Automated checks + manual exploratory review |
| Locale and themes | NL/EN, dark/light work, no untranslated key or severe layout failures | UI and snapshot/visual checks |
| Regression | Existing scan, Purchase Check, cellar, profile, homepage and migration tests preserved | Full repo check + targeted end-to-end |
| Review | One clean report/commit status per subsprint; clear final merge plan | EPIC.md and PR descriptions |

**Definition of done for a sub-sprint:** code is integrated, regression tests written and run, CI or equivalent local checks pass, documentation reflects the exact shipped behavior, UX evidence captured if relevant, user checkpoint written, commit created and no critical known unresolved fault. A blocked dependency means **not done**, not automatically failed for unrelated work.

---

# 8. Architecture blueprint (verify before implementation)

```text
[Scan label / Manual wine search / Purchase Check]
                         |
                         v
              [Normalized input facts]
                         |
                         v
             [Catalog Resolver / Search]
               |                 |
               v                 v
    [CELLR household+canonical] [Legally public provider records]
               |                 |
               +--------+--------+
                        |
             [Candidates + explanation]
                        |
                [User confirmation]
                        |
              +---------+---------+
              |                   |
       [CELLR canonical]    [Provisional household]
              |                   |
              v                   v
      [Exact wine/vintage]  [User-entered facts]
              |                   |
              +---------+---------+
                        |
            [Shared profile if eligible]
                        |
           [User taste + cellar + price]
                        |
                [Koopcheck engine]
                        |
         [Grounded verdict + uncertainty]
                        |
            [Sources & reliability UI]
```

Recommended conceptual contracts (do not impose if repository already has better domain contracts):

```ts
type CandidateKind = "owned" | "household" | "canonical" | "external";
type MatchClass = "exact" | "verified_alias" | "prefix" | "fuzzy";

type CandidateIdentity = {
  kind: CandidateKind;
  wineId?: string;    // only for CELLR wine identities
  recordId?: string;  // only for external provider records
  producer: string;
  name: string;
  type?: WineType | null;
  countryCode?: string | null;
  region?: string | null;
  match: MatchClass;
  identityVerified: boolean; // false for unverified external/fuzzy candidates
  provenance?: SourceNotice[];
};

type SelectedWineForBuying = {
  identity: CandidateIdentity;
  year: number | null;
  nonVintage: boolean;
  shelfPriceCents?: number | null;
  currency?: string | null;
};
```

When using the *actual* code, prefer existing `CatalogSearchHit`, `CatalogSearchQuerySchema`, `needsConfirmation`, `PurchaseWine`, `ScanResult` and existing source/license models. An adapter is better than a second source of truth. Keep all input/output validation in the domain/server boundaries.

**Data-path separation:** fetching external text for listing, sending provider data into a model, persisting shared AI profiles, logging, and publishing to UI are distinct actions with distinct rights checks. A valid catalog read never implies permission to do every downstream action.

---

# 9. Testing catalog and release protocol

## 9.1 Test organization

- **Domain unit:** fuzzy ranking, normalization, identity conflicts, vintages, provenance, source metadata, cache eligibility.
- **Server unit:** route/service behavior, rate limiting, cost spending, fallback, cancellation, provider off-state, personal verdict.
- **SQL permission:** public user vs anon vs service role, household scope, pilot/public data, rights/audit, partial import, uniqueness, indexing, migration guards.
- **Integration:** end-to-end catalog search, choose wine, add bottle, scan OCR/vision fallback, candidate mismatch, Purchase Check no mutation, shared profile reuse.
- **UI/E2E:** iPhone + desktop, NL/EN, dark/light, accessibility, error/empty/load states, real click-through.
- **Load/perf:** ranked quality at 100k+ search records, p95 at varied concurrency, import/reimport overhead and E2E perceived latency.
- **Manual targeted:** dark bottles, white bottles and difficult visual cards only where relevant to changed component.

## 9.2 Representative test cases

Use named fixtures (synthetic when licensing/accuracy is uncertain) for:

1. `Château Margaux` vs `Pavillon Rouge du Château Margaux`;
2. `Rioja Crianza` vs `Reserva` and `Gran Reserva` from same producer;
3. the same producer/wine in 2018 and 2021, differing characteristics;
4. `Champagne` NV vs a declared vintage;
5. two unrelated producers sharing a common surname;
6. accented, unaccented and misspelled producer aliases;
7. a private household wine with a name equal to a shared canonical wine;
8. an X-Wines record with no reliable verified wine identity;
9. LWIN-7 vs LWIN-11/16/18 interpreted as different abstraction levels;
10. a provider record with rights revoked while the user has search UI open;
11. very common prefix (`chateau`, `domaine`, `bodega`) at large scale;
12. label text containing malicious instructions that are *data*, not a command.

Do not put third-party copyrighted label art into test fixtures. Where sample product names refer to real brands, they are examples to drive behavior, not evidence of identity mapping unless documented.

## 9.3 Evidence discipline

Every checkpoint should show:

```text
Check: pnpm db:test
Status: PASS / FAIL / SKIPPED / UNAVAILABLE
Environment: local PostgreSQL 16 / Supabase local / CI
Run evidence: [log path, CI run, screenshot or count]
Known gaps: [specific]
```

Never convert “Claude says 1,135 SQL checks pass” into an independent assertion unless the tests actually ran in the current branch/environment. CI checks that are skipped are labeled **SKIPPED**, not green.

## 9.4 Rollback and feature safety

- New entry experiences have a feature flag; default can be off until QA approval.
- Dataset visibility changes through rights/scope flags, not by dropping historical rows.
- Reverting UI changes cannot corrupt existing wine identities or bottle records.
- Migrations additive first; if schema change is irreversible or large, stop for user approval with a rollback plan.
- Disabling a provider must remove its public records immediately without removing unrelated household wines.
- User data must be recoverable from existing backup procedures; do not create snapshots of real production data for this sprint.

---

# 10. Progress reporting, checkpoints and continuity

## 10.1 Communication format after every sub-sprint

Produce a compact message with these **six headings**:

```text
CELLR WI-0x — [module] · [PASS / PARTIAL / BLOCKED]
DELIVERED: concrete behavior and changed files
VERIFIED: exact tests and result counts; preview/screenshots when applicable
SECURITY / RIGHTS: what is still blocked, and whether public scope changed (should be no)
RISKS: factual remaining issues; whether previous behavior regressed
NEXT: next sub-sprint, dependencies, branch/PR commit SHA
```

For meaningful issues, update user-facing message promptly, but keep ongoing reporting factual; avoid repetitive “still working” messages. Write durable progress to `EPIC.md` as well as a brief chat update; chat history is not the sole status record.

## 10.2 Checkpoint files

Maintain:

```text
docs/sprints/wine-intelligence-mega/
  EPIC.md                  # status by sub-sprint, decisions, hashes, dependencies
  ADR-001-identities.md   # canonical / external / vintage rules
  ADR-002-provider-rights.md
  SOURCE_RIGHTS_REGISTER.md
  DATASET_BENCHMARK.md
  SEARCH_PERFORMANCE.md
  SECURITY_AND_PRIVACY.md
  COST_MODEL.md
  UX_ACCEPTANCE.md
  RELEASE_CHECKLIST.md
  FINAL_REPORT.md
  progress/
    WI-00.md
    WI-01.md
    WI-02.md
    WI-03.md
    WI-04.md
    WI-05.md
    WI-06.md
    WI-07.md
```

Create files as useful; avoid empty boilerplate documents where one well-written file suffices. Each progress document must cite real code, tests and linked PRs.

## 10.3 Context-window and interrupted session recovery

After each completed sub-sprint, persist a resume block in `EPIC.md`:

```text
LAST VERIFIED CHECKPOINT: WI-0x
BRANCH / SHA:
STATUS:
CHANGED FILES / PR:
CURRENT FEATURE FLAGS:
LAST GREEN CHECKS:
PENDING BLOCKERS:
NEXT SAFE ACTION:
DO NOT REPEAT:
```

If the agent's context runs out, the next session resumes from `EPIC.md` and the actual Git tree, not remembered claims. Do not promise to keep working after a session stops unless an actual ongoing task system is configured and in use.

## 10.4 Subagent orchestration

Use a single capable **orchestrator** that holds the architecture, security model, status and final review. Delegation is optional, not decoration.

Good subagent scopes:

- External provider licensing/documentation and legal uncertainty (read-only research).
- SQL migration/RLS adversarial review.
- Search ranking benchmarks and query plans.
- Client autocomplete and accessibility tests.
- Scan regression + privacy.
- Cost/AI cache correctness and review.
- E2E test reliability and performance.

**Rules for delegation:**

- Subagents receive a precise task, relevant paths, restrictions and output shape. Never delegate unrestricted production actions.
- Where multiple agents edit files, assign **disjoint ownership** or branch/worktree isolation. Do not race on shared files, migrations or generated DB types.
- Main orchestrator reviews every diff, resolves conflicts and independently tests integrated code.
- Allow smaller models (e.g., Sonnet/Haiku) for repetitive tests, searching and fixture generation if available, while the main Fable/Opus agent reviews high-risk architecture, SQL, rights and identity matching.
- Parallelize only *independent* work. Rights review, schema design and API contracts must be settled before dependent UI work is merged.
- Subagents must not claim a source is legally cleared or rewrite the top-level safety instructions.

**Effort choice:** Fable 5.2 High is the recommended default for the full orchestration; Opus 5.5 High is a viable alternative. Go above High only for a demonstrated difficult architecture/security problem; high effort alone is not a substitute for independent tests.

---

# 11. Risk register and mitigations

| ID | Risk | Severity | Mitigation / validation |
| --- | --- | --- | --- |
| R-01 | Incorrect wine identity matched automatically | Critical | Conservative exact rules, independent gold set, explicit review on ambiguity |
| R-02 | Unlicensed provider data in commercial UI | Critical | Rights gates, off by default, SQL + API negative tests, human evidence |
| R-03 | Household/privacy data leaking through search/AI | Critical | RLS, auth, minimize LLM inputs, cross-tenant tests |
| R-04 | Duplicate canonical wine identities | High | Existing Wine Master, admin verification, idempotent links, audits |
| R-05 | Cross-vintage cached advice | High | Profile key exact vintage + locale/version; NV separated |
| R-06 | Unpredictable cost from repeated AI calls | High | Reuse shared valid profiles, single-flight, rate limit and spend telemetry |
| R-07 | Search results slow for common wine terms | High | Indexed bounded server search, benchmark common terms, explain plans |
| R-08 | E2E CI skipped and hidden regression | High | Local full-stack targeted tests, screenshot/repro evidence, report skips |
| R-09 | Large simultaneous code changes impossible to review | High | Small sub-sprint commits/PRs, independent reviews, checkpoints |
| R-10 | External source discontinued/licence revoked | High | Immediate provider disable, rollback, provenance, alternate sources |
| R-11 | LWIN schema assumptions wrong | High | Verify real official file before real import; hard rejection of unknown schema |
| R-12 | X-Wines incomplete/outdated coverage | Medium-high | Benchmark per segment, curated growth, no completeness claims |
| R-13 | UI returns generic verdict misrepresented as AI personalization | High | Clear logic ownership; personalized signals verified; uncertainty display |
| R-14 | Photos, logos and market prices accidentally imported | High | Explicit allowlist of textual fields, parser tests, no remote images |
| R-15 | Admin can inadvertently alter source legal status | High | Separate explicit audited rights workflow, two-person review recommended |
| R-16 | Feature flags deployed partially | Medium-high | Backwards-compatible API, missing endpoint fallbacks, rollout checks |
| R-17 | Production migration history incomplete | Critical | No db push/bootstrap; independent audit of `docs/MIGRATIONS.md` §4, owner-only reconciliation plan and deployment block |
| R-18 | Paid AI budgets fail open on control outage | Critical | Verify current behavior; new paid calls fail closed/are hard-bounded, concurrency/retry tests, provider-side caps require owner action |
| R-19 | Synthetic scan benchmarks mistaken for real iPhone accuracy | High | Golden real-photo consented test set and physical-device evidence; pending state when unavailable |
| R-20 | Vintage-specific wine facts reused incorrectly across years | High | Wine-level vs vintage-level provenance contract, explicit non-reuse tests for valuations and drink windows |
| R-21 | Admin authorization/docs status discrepancy | Medium-high | Test actual HTTP status and server-side auth; reconcile documentation or fix exposure |

---

# 12. Prioritization when time, tokens or infrastructure are limited

**Tier 1 — must work first:** WI-00 baseline, safe source/search architecture, WI-02 manual autocomplete in cellar and Purchase Check, exact/ambiguous identity correctness, purchase-check no-mutation, rights/RLS tests.

**Tier 2 — high-value expansion:** WI-03 scan resolver integration, WI-04 canonical/vintage profile reuse + personalized verdict, WI-05 visible sources/AI-estimate reliability.

**Tier 3 — make durable:** WI-06 admin workflow/observability, WI-07 exhaustive E2E, performance and release dossier.

**Blocked-but-not-fatal:** legally gated external public data. Build the entire user experience on permitted CELLR existing canonical/private wines and test fixtures; wire real external catalog records only in lawful pilot environments until clearance.

**Do not swap the priorities** merely to produce an impressive number like “300k wines available”. Catalog quality, rights and functional user journeys outrank source count.

---

# 13. Final deliverables checklist

At the end of the master sprint, deliver all applicable checked items:

- [ ] Fully working database-backed autocomplete for manually adding wine to the CELLR cellar.
- [ ] Fully working manual wine selection within Purchase Check, complete with vintage, price and personal result.
- [ ] Scan recognition integrated with bounded catalog resolver, preserving OCR/vision fallback and confirmation.
- [ ] Reuse of eligible shared vintage AI profile; safe candidate path without creating a fake wine/bottle.
- [ ] Wine detail **Sources & reliability** section with source/licence/AI/user distinction.
- [ ] Benchmark covering at least 200 mixed and adversarial wine queries, with grounded classifications.
- [ ] Source-safe X-Wines pilot and tested LWIN adapter (real LWIN integration only if access/rights allow).
- [ ] Verified provider storage, rights, disable, RLS, audit and admin review behaviors.
- [ ] Per-sub-sprint commits, docs, test evidence, active PR(s), and a full final report.
- [ ] No uncontrolled imports, payment commitments, production changes or unapproved merges.
- [ ] Explicit backlog for legal provider clearance and the next app release gate.

This checklist does not require provider legal approval to be falsely asserted. Label incomplete and blocked items accurately; provide fallback product functionality.

---

# 14. START COMMAND — give this document to Claude Code

> **Read this document completely and treat it as the engineering brief for the CELLR Wine Intelligence Mega Sprint.**
>
> Start by verifying the live main branch and existing merged PR #65, run WI-00, and build the plan/status artifacts described here. Then execute WI-01 through WI-07 as far as technically possible within the same mission, using independently reviewable checkpoints and tests. You may continue autonomously after green gates; do not repeatedly stop for routine decisions. Delegation is encouraged only for clearly bounded, independent subtasks.
>
> **The objective is tangible user-facing progress**, especially manual wine autocomplete in CELLR and Purchase Check, scan-to-catalog recognition, safe reuse of wine knowledge and credible personal recommendations — not only more architecture docs.
>
> **Strict authority limits:** do not merge, deploy, write to production, import outside authorized isolated environments, enable an external source for public access, claim legal clearance or sign/subscribe to provider contracts. An unresolved source license is a blocker for that provider, not for the rest of the mission.
>
> Keep a durable `EPIC.md`, publish a factual checkpoint after each sub-sprint, run the listed quality gates and do an adversarial review before declaring security-critical work complete. At the end, open reviewable PR(s), provide preview/screenshots where appropriate, and report completed, partial and blocked elements precisely.
>
> **Begin now with WI-00 and then continue the mission.**

---

# 15. Reference links and verification notes

**Checked 2026-11-11.** The document is an engineering brief, not formal legal advice. Re-check source terms before each real import/enablement.

- CELLR repository: https://github.com/Blockionaire/CELLR
- Merged baseline PR #65: https://github.com/Blockionaire/CELLR/pull/65
- LWIN product and download path: https://www.liv-ex.com/lwin/
- LWIN official Creative Commons conditions: https://www.liv-ex.com/lwin-creative-commons-licence/
- Liv-ex membership terms: https://www.liv-ex.com/liv-ex-membership-terms/
- Liv-ex website terms: https://www.liv-ex.com/website-terms-of-use/
- Official LWIN guide to code lengths: https://www.liv-ex.com/contact-faqs/
- X-Wines official repo, license and citation policy: https://github.com/rogerioxavier/X-Wines
- X-Wines article: https://doi.org/10.3390/bdcc7010020
- CC BY 4.0 license: https://creativecommons.org/licenses/by/4.0/
- CC0 1.0: https://creativecommons.org/publicdomain/zero/1.0/
- EU Database Directive 96/9/EC, Article 7: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=celex:31996L0009
- Anthropic Fable 5.2 model/prompt guidance: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-2
- Claude Code model configuration: https://support.claude.com/en/articles/11940350-claude-code-model-configuration

**Notes on legal uncertainty:**

- CC BY 4.0 generally allows commercial adaptation of licensed material, but applicability of separate Liv-ex contractual terms to the actual LWIN download and the intended AI/redistribution uses is an unresolved source-specific question.
- CC0 dedication by X-Wines authors covers rights they own, but may not settle third-party rights in data collected from other sites.
- Do not confuse a technical pilot, a legally cleared production dataset and a publicly enabled provider. These are three distinct states.

---

**End of master execution brief.**

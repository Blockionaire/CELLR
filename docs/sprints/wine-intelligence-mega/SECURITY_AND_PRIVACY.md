# WI-001 — Security, privacy and AI-spend model

Written at WI-00 from the code on `main` @ `770aaab`; each later sub-sprint appends what it changed. This is an
engineering record, not legal advice and not a compliance statement.

## 1. Trust boundaries

```text
browser (person, household member)
   │  cookie session; CSRF origin check on every write (server/http.ts: authed → checkOrigin → requireContext)
   ▼
Next.js route / server component ── servicesFor(ctx) ── repositories run AS THE PERSON (RLS applies)
   │                                   │
   │                                   └─ server/privileged/* : service role, narrow functions only
   ▼                                        (AI usage + budget, shared profiles, catalogue learning, admin)
Postgres (Supabase): RLS on every table; security-definer functions check membership themselves
   │
   ├─ household data (bottles, tastings, notes, prices, photos, provisional wines): members only
   ├─ canonical catalogue + shared profiles: readable by everyone signed in, writable by the service role only
   └─ provider staging (catalog_providers, _import_runs, _external_records, _record_links): service role only;
      people reach it only through public.catalog_search and public.catalog_record_provenance
external: the AI provider (OpenAI-compatible endpoint), Web Push
```

## 2. Threats this epic touches, and the control that exists

| Threat                                                    | Existing control (verified)                                                                                                                                                                               | Epic work                                                      |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Another household's wines appear in search                | `catalog_search` returns nothing unless `p_household_id = any(private.my_household_ids())`; the index filter is `household_id is null or = $1`                                                            | keep; add resolver tests on the same boundary (WI-03)          |
| Pilot / unverified provider data reaches people           | scope `public` only in `catalog_search`, rights re-checked at query time; `catalog_search_pilot` is service-role only and refuses in production; the app drops non-public rows again (`publicSearchHits`) | never call the pilot function from the app; tests in WI-01/02  |
| An import escalates a provider's rights                   | `catalog_provider_register` sets name, homepage and notes only; rights only via `admin_catalog_provider_rights` (logged)                                                                                  | keep; admin UI uses the same function (WI-06)                  |
| A fuzzy or provider hit is treated as a verified identity | `toSearchHit` forces `verified = false` for records and household wines; `needsConfirmation`; `matchLabel` exact-identity rule                                                                            | UI must honour `needsConfirmation` (WI-02); golden set (WI-03) |
| Search used to enumerate or scrape                        | 2-character minimum, 80 characters / 8 words, at most 20 rows, `catalog_search` rate limit 600/h per person (fails closed on a database error)                                                            | client debounces and aborts (WI-02)                            |
| Injection through the query                               | the query is normalised (`normalize_text`) and bound with `format(%L)`; filters are checked against the enum / a regex before use                                                                         | red-team queries in WI-07                                      |
| Prompt injection through a label or a wine name           | label text is only ever looked up (never sent to a model as instructions); the vision prompt asks for a fixed JSON schema and the answer is plausibility-checked in code (`normalizeExtraction`)          | any new prompt takes facts as data in a schema (WI-04)         |
| Koopcheck changes the cellar                              | `compare` reads only; `recognize` uses `images.prepare` (never `save`); no bottle, image or learning signal is written                                                                                    | compatibility test before the UI changes (WI-02, WI-04)        |
| A personal verdict or cellar fact lands in a shared cache | `shared_wine_profiles` has no household, person, price, note or rating column; only canonical vintages; written by the service role after `shareableInsight`                                              | Koopcheck only READS shared profiles (WI-04)                   |
| Non-admin reaches admin data                              | proxy 404 + `getAdminSession()`/`assertAdmin` in every page and action + service-role-only `admin_*` functions; verified by `e2e/admin-http.spec.ts` (3 passed, 2026-11-13)                               | new admin pages follow the same three layers (WI-06)           |

## 3. Privacy impact of the new flows

| Data                      | Today                                                                                                    | With this epic                                                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Search queries            | sent to the app's own API, searched in the app's own database, **not stored, not logged**                | unchanged. Telemetry counts searches and outcomes; it never carries the query text (WI-06).                                      |
| Koopcheck facts and price | sent to the app's API for the comparison; not stored                                                     | unchanged. The chosen wine and the price stay in the request and the browser's memory only.                                      |
| Koopcheck photo           | cleaned in memory, read, discarded; never stored, never a learning signal                                | unchanged.                                                                                                                       |
| Cellar scan photo         | stored for the household (the person's own bottle image); sent to the AI provider to be read             | unchanged. The resolver receives the facts the scan already produced, not the photo.                                             |
| Tastings, ratings, cellar | read under RLS for the signed-in person (taste) and their active household (cellar)                      | unchanged; never part of any shared profile, log or telemetry property.                                                          |
| AI provider               | receives label photos (scan, Koopcheck) and public wine identity (profiles, valuations); no account data | no new data category. Provider-catalogue records are **not** sent to a model unless that provider's rights allow AI use (WI-04). |
| Logs                      | one-line JSON, error codes only (`server/log.ts`)                                                        | new code logs codes and counts only.                                                                                             |

Open privacy work that is **not** done by code: the tester-facing privacy text must mention the wine search and the
sources section once they are switched on; `REAL_LABEL_VALIDATION_PENDING` needs a consent text for collected label
photos (protocol in `UX_ACCEPTANCE.md`, WI-03).

## 4. AI spend: what is bounded, and what fails open (verified in code)

Every model call goes through `getLlmProvider()` → `withBudget(provider, plan, holdAiBudget)`
(`apps/web/src/server/ai/index.ts`, `budget.ts`, `privileged/ai-budget.ts`).

| Path (task)                            | Per-person rate limit | Per-request bound                                                 | Trigger                          |
| -------------------------------------- | --------------------- | ----------------------------------------------------------------- | -------------------------------- |
| Scan vision (`label_extraction`)       | `scans` 40/h          | 800 output tokens, 40 s, 1 image                                  | a scan the text and cache missed |
| Koopcheck photo (`purchase_check`)     | `scans` 40/h (shared) | 800 output tokens, 40 s, 1 image                                  | a Koopcheck photo                |
| Profile (`wine_insight`)               | `insights` 40/h       | 1200 tokens, 60 s, ≤ 2 searches; at most one retry without search | adding bottles / opening a wine  |
| Valuation (`wine_valuation`)           | `valuations` 30/h     | 700 tokens, 60 s, ≤ 4 searches; once a month per vintage          | the person asks                  |
| Sommelier / Tonight (`sommelier_chat`) | `chat` 60/h           | 900 tokens, 30 s                                                  | the person asks                  |

Controls and how each fails:

| Control                                             | When it cannot be checked                                                                                                    | Verdict                    |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Per-person rate limit (`consume_rate_limit`)        | the database error is thrown; services catch only `RATE_LIMITED`; **no model call is made**                                  | **fails closed**           |
| Platform budget (`ai_budget_hold`, daily / monthly) | `holdAiBudget` throws; `withBudget` catches and **lets the call through** without a hold (documented trade-off, unit-tested) | **fails open**             |
| Platform budget, not configured                     | `AI_BUDGET_DAILY_USD` and `AI_BUDGET_MONTHLY_USD` unset: nothing is held at all                                              | **no limit** (by default)  |
| Usage record (`ai_usage`)                           | best effort; an unrecorded call's hold expires on its own                                                                    | does not block             |
| Duplicate generation of one profile                 | no lock: two first requests seconds apart may both pay (documented in `RECOGNITION-ROADMAP.md`)                              | bounded by the rate limits |

**Worst case today, per signed-in person and hour, with the budget service down:** 40 label reads + 40 profiles
(each ≤ 2 searches, possibly one retry) + 30 valuations (≤ 4 searches) + 60 chat answers. The rate limits still hold,
because they fail closed; the platform-wide ceiling does not.

### Policy for this epic (R-18)

1. **No new automatic paid call.** Autocomplete, tapping a result, the resolver and the sources section never call a
   model. Search is database-only.
2. **A NEW paid path must fail closed.** It goes through a guard that refuses when the platform budget cannot be
   checked or is not configured, in addition to its own per-person rate limit, with one attempt, a token ceiling and a
   timeout. The existing paths keep their documented behaviour: changing them would switch AI off for everyone on a
   database blip, which is a product decision for the owner, not a side effect of this epic.
3. **The deterministic answer never depends on a model.** Koopcheck's verdict is `checkPurchase`; if AI, budget or
   database controls fail, the comparison still answers.
4. **The app-level budget is not a bill cap.** It is an estimate held in the app's own database. A hard ceiling exists
   only at the AI provider: **owner action** — set a monthly spending limit and an alert on the provider account, and
   keep `AI_BUDGET_DAILY_USD` / `AI_BUDGET_MONTHLY_USD` set in production. Nothing in this epic changes a provider
   account or buys anything.

## 5. Changes by sub-sprint

- **WI-00:** none to behaviour. `CELLR_FEATURES` added (server only, everything off by default).
- **WI-01:** imports only (service role, operator's machine). One open run per provider; the off switch
  `admin_catalog_provider_disable`. No consumer path changed.
- **WI-02 (`wine_search`):** the browser now calls `GET /api/v1/catalog/search` while typing. Same endpoint, same
  membership check and rate limit (600 per hour, fails closed) as Sprint 004A. The query is not logged and not kept
  in the browser beyond a one-minute in-memory cache. A chosen external record stores nothing: the person's
  confirmed form becomes their own wine. Response keys are pinned by an e2e test.
- **WI-03 (`scan_resolver`):** three reads as the signed-in person replace "every visible wine". Provider records
  are dropped before matching, whatever their scope. No new data leaves the server: `resolution.reasons` holds
  reason codes per candidate wine id, nothing else. Photo handling, retention and the vision call are unchanged.
- **WI-04 (`purchase_intel`):** Koopcheck's compare reads one catalogue wine and up to 30 shared profiles of it,
  as the person (RLS: a shared profile is readable by a signed-in person who can see its vintage, which for a
  catalogue wine is everyone; it holds public wine knowledge only, and a check constraint keeps values out). It writes nothing and calls no model. The response gains `knowledge`: catalogue
  facts and CELLR's own estimate, no household's data. Verified by e2e: the researching household's id, e-mail and
  price never appear in another household's answer.
- **WI-04, research claim:** `private.shared_profile_claims` (vintage, language, time). RLS on, no grants, reachable
  only through `claim_shared_profile_research` (security definer, empty search path, service role only). It is
  called from the one privileged module that already publishes shared profiles. No person or household is recorded.
- **WI-04, budget:** `BUDGET_MODES` makes any future paid task fail closed (§4). No task uses it yet.

- **WI-05 (`sources_panel`):** one new read route, `GET /api/v1/wines/:id/sources` (404 without the feature). The
  wine is read under RLS (another household's own wine is "not found"); credits come from `wine_source_notices`
  (security definer, empty search path, membership checked, the provider's rights and scope read at call time). The
  provider tables stay closed to people. A notice is checked against a schema on the server, so internal columns
  (rights evidence) cannot travel even if the function changed. Links are http(s) only and open with
  `noopener noreferrer nofollow`; nothing of a source is embedded.

- **WI-06 (no flag; admin only):** `/admin/sources` behind the existing admin guard (verified session on the
  server-only allowlist, checked by the layout, the page and again by each Server Action). Four new service-role
  functions (migration `…0041`): three read, one writes a note on a suggested link. **No function, page or action
  can switch a source on or mark rights verified**; the dashboard only narrows (the off switch) and decides links,
  each with a required reason, logged with the admin's id. The repository's own boundary tests
  (`admin-pages.test.ts`) were extended to the new page, its two actions and the new privileged module.
- **WI-06, events:** two new first-party events and one property (`docs/METRICS.md`). Built from counters and fixed
  words; no typed text, wine, source, price or taste. Not sent under Do Not Track / GPC. The admin function that
  counts them joins no person or household.

### Retention and deletion of what this epic added

| Data                                          | Where                                  | Kept until                                                                 | Deleted with                                                              |
| --------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| A source's records and import runs            | `catalog_external_records`, `…_runs`   | withdrawn (kept, hidden) when the source stops listing them                | nothing of a person; a provider row is not deletable while it has records |
| Links record ↔ catalogue wine, with decisions | `catalog_record_links`, `master_audit` | kept as the audit of who decided what                                      | the record or the wine (cascade); the audit row stays                     |
| Rights changes                                | `catalog_provider_rights_log`          | kept                                                                       | the provider                                                              |
| Research claims                               | `private.shared_profile_claims`        | given back at once; else 120 s; tidied after a day                         | the vintage (cascade)                                                     |
| Search queries                                | nowhere                                | not stored: not in logs, not in events, one minute in the browser's memory | —                                                                         |
| A Koopcheck's wine, price and photo           | nowhere                                | not stored                                                                 | —                                                                         |
| Usage events                                  | `analytics_events`                     | no automatic expiry (existing behaviour)                                   | the account                                                               |

### Prompt injection, as of WI-04

No model input was added in WI-02 to WI-04, so there is no new injection surface. For the record: text of a wine
name, a label or an external record reaches a model only on the paths that existed (label reading, profile research,
sommelier), with their existing output schemas and checks. Records of external providers are in none of those
prompts. A profile's text is shown to people as plain text (React escapes it) and is never executed or re-sent to a
model by Koopcheck.

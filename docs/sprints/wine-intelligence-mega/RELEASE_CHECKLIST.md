# WI-001 — Release checklist (owner only)

> **State 2026-11-18: Parts A and B are done; Part C is separate.** 0037–0042 were released by
> [`RELEASE_RUNBOOK_0042.md`](RELEASE_RUNBOOK_0042.md) (closed), and 0043–0046 separately after them. Production holds
> 0001–0046 and equals the repository (read-only, `docs/MIGRATIONS.md` §3). B5 and B6 hold: the catalogue environment
> is `production`, and no provider is shown (none is registered). B7's app check is the runbook's V5 smoke, which the
> owner still has to confirm. **No migration switches a feature on.** Part C stays one switch at a time, each an
> owner decision; C4 (`scan_resolver`) stays NO-GO. `CELLR_FEATURES` in Vercel was not read for this check.

> **State 2026-11-17: Part A is DONE. Part B is REPLACED by
> [`RELEASE_RUNBOOK_0042.md`](RELEASE_RUNBOOK_0042.md). Part C is unchanged.** Checked read-only on 2026-11-17:
>
> - **History (A5):** production's history holds exactly 0001–0036. 0037 was not run, so A4 held.
> - **Schema:** the repository at 0036 plus the accepted deviations.
> - **Plan and backups:** Supabase organisation on **Pro**, with daily physical backups (A1: confirm a completed backup
>   from the last 24 hours).
>
> **Do not run Part B as written.** `main` now also holds 0043–0045 (Smart Cellar 3D) and **0046** (Sommelier V1,
> merged with PR #75). From `main`, B2/B3 would apply 0037–**0046**. This epic's migrations go out on their own from a
> checkout of `248206a` (exactly 0001–0042), with `--skip-vault`, by the runbook. Its post-checks cover B4–B7. The CI
> state that release relies on is in [`CI_EXCEPTIONS_0042.md`](CI_EXCEPTIONS_0042.md).
>
> _Before 2026-11-17 the state was `PRODUCTION_MIGRATION_BOOTSTRAP_REQUIRED`; the text below is kept as written then._

**Merging is deploying.** Vercel builds production from `main` (`docs/BETA-OPERATIONS.md` §5), so the merge in B1
puts this epic's app code on production before its migrations. That is the order this checklist assumes, and
`BETA-OPERATIONS.md` calls it forgiving; what the app does in between is in B1. The verdicts per step are in
[`progress/WI-08-hardening.md`](progress/WI-08-hardening.md) §7.

Nothing in this file was executed by the coding agent. No command here was run against production, staging or any
hosted project during the epic. Every step is for the owner, on their own machine, with their own credentials.
The rules it follows are in [`docs/MIGRATIONS.md`](../../MIGRATIONS.md); where the two disagree, `MIGRATIONS.md` wins
and this file must be corrected.

## Why deployment is blocked

Verified from the repository on 2026-11-13 (documents and scripts only; production was not contacted):

1. `docs/MIGRATIONS.md` §3: production was built by pasting migrations into the SQL Editor and has **no migration
   history** (`supabase_migrations.schema_migrations` does not exist). Read-only inventory of 2026-11-02: 380 object
   groups identical, 13 explained deviations, no drift.
2. `docs/MIGRATIONS.md` §4: the bootstrap that records history was rehearsed on a throwaway database
   (`scripts/migration-audit/rehearse-bootstrap.sh`) but is "owner action, not yet done".
3. **`MIGRATIONS.md` §4 is one migration behind.** It says "exactly the 36 files on `main` (0001–0036)". `main` now has
   **37**: `20261114000037_catalog_search.sql` was merged with PR #65 and, according to the Sprint 004A report, was
   never applied to production. The §4 command as written (`ls supabase/migrations/*.sql`) would therefore record
   **0037 as applied although its objects do not exist**. That must not happen: it would silently skip the migration
   forever. Part A below records only the 36.
4. This epic adds further migrations after 0037 (listed in `FINAL_REPORT.md`). They can only be applied through
   `MIGRATIONS.md` §2, which requires a history.

Until the history exists, `supabase db push` would try to run every migration again. **Never run it to "catch up".**

## Part A — Bootstrap the history (once; changes only the history table)

Prerequisites: the owner's laptop, the repository at the commit that is being released, the database password, a
quiet moment, one sitting.

| #   | Step                                                                                                                                                                                                | Must show                                                         | If not                         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------ |
| A1  | Supabase → Database → Backups: confirm a backup from today. Optionally `pnpm exec supabase db dump --linked -f prebootstrap-schema.sql` (read-only).                                                | a restorable backup exists                                        | stop                           |
| A2  | `bash scripts/migration-audit/compare.sh --target "$DATABASE_URL" --accept scripts/migration-audit/production-accepted.txt` (read-only session)                                                     | differences **only** for the objects of 0037 and later migrations | stop; `MIGRATIONS.md` §5       |
| A3  | `psql "$DATABASE_URL" -Atc "select to_regclass('supabase_migrations.schema_migrations')"`                                                                                                           | an empty line                                                     | stop: a history already exists |
| A4  | `psql "$DATABASE_URL" -Atc "select to_regclass('public.catalog_providers')"`                                                                                                                        | an empty line (0037 was never run)                                | see "If 0037 was already run"  |
| A5  | Record **only** 0001–0036: `pnpm exec supabase migration repair --linked --status applied $(ls supabase/migrations/*.sql \| xargs -n1 basename \| cut -c1-14 \| awk '$1 <= 20261113000036')`        | 36 versions repaired                                              | A8                             |
| A6  | `pnpm exec supabase migration list --linked`                                                                                                                                                        | 0001–0036 on both sides; 0037 and later local only                | A8                             |
| A7  | `pnpm exec supabase db push --linked --dry-run`                                                                                                                                                     | lists **exactly** 0037 and this epic's migrations, nothing else   | A8                             |
| A8  | **Rollback (only if A5–A7 looked wrong):** the same command as A5 with `--status reverted`. Then `migration list` shows 0 remote and `compare.sh` gives the same answer as A2. Never drop a schema. | the starting state                                                |                                |

A2 note: `compare.sh` compares with the repository's full schema, so before 0037 is applied it reports that
migration's objects as missing. That is the expected and only difference. Use
`bash scripts/migration-audit/inventory.sh` to attribute each reported object to its migration; anything attributed to
0001–0036 is drift and stops the procedure.

**If 0037 was already run** (A4 prints `catalog_providers`): do not guess. Compare (A2); if every object of 0037
matches, include it in A5 (`awk '$1 <= 20261114000037'`); if not, follow `MIGRATIONS.md` §5.

## Part B — Apply the new migrations (the normal workflow, `MIGRATIONS.md` §2)

| #   | Step                                                                                                                                                                                                                                                                                                                                        | Must show                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| B1  | The release commit is merged to `main` by the owner; CI is green, including the migration-integrity job. **This deploys the app**, every switch off. Until B3 every flow works as today (tested on a database without these migrations: `progress/WI-08-hardening.md` §6); Admin → External sources says its database step has not been run | green; smoke: sign in, add a bottle, scan, Koopcheck |
| B2  | `pnpm exec supabase db push --linked --dry-run`                                                                                                                                                                                                                                                                                             | exactly the migrations listed in `FINAL_REPORT.md`   |
| B3  | `pnpm exec supabase db push --linked`                                                                                                                                                                                                                                                                                                       | applied, no error                                    |
| B4  | `bash scripts/migration-audit/compare.sh --target "$DATABASE_URL" --accept scripts/migration-audit/production-accepted.txt`                                                                                                                                                                                                                 | `RESULT: equivalent`                                 |
| B5  | `psql "$DATABASE_URL" -Atc "select private.catalog_environment()"`                                                                                                                                                                                                                                                                          | `production`                                         |
| B6  | `psql "$DATABASE_URL" -Atc "select count(*) from public.catalog_providers where search_scope <> 'off'"`                                                                                                                                                                                                                                     | `0`                                                  |
| B7  | The app is already deployed (B1). `CELLR_FEATURES` stays unset: every flow behaves as before. Open Admin → External sources                                                                                                                                                                                                                 | the page loads and lists no source that is shown     |

Migrations are forward-only: if the app misbehaves, roll back the **app** (`BETA-OPERATIONS.md` §5) and leave the
schema. Every migration of this epic is additive; the previous app version does not use the new objects.

The migrations of this epic, in order (B2 must list exactly these, after `20261114000037`):
`20261115000038_wi01_provider_lifecycle`, `20261116000039_wi04_profile_research_claim`,
`20261117000040_wi05_wine_source_notices`, `20261118000041_wi06_admin_sources`,
`20261119000042_hardening_search_scope_link_review`. After B3, with every switch still
off, two things are live: Admin → External sources, and the research claim (two simultaneous first profile requests
research once).

## Part C — Switch features on (one at a time, each reversible by removing its name)

Verdicts and their reasons: `progress/WI-08-hardening.md` §7.2. In short: C1, C2 and C3 are a conditional GO after
Part B; **C4 (`scan_resolver`) is a NO-GO until real label photos and a real iPhone have been through it**. The
values below are cumulative.

| #   | `CELLR_FEATURES` value (cumulative)                      | Check before the next step                                                                                                                     |
| --- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | `wine_search`                                            | add a bottle by typing; Koopcheck "Handmatig zoeken"; no provider rows in results                                                              |
| C2  | `wine_search,sources_panel`                              | a wine page shows its sources; a typed wine shows only "Door jullie ingevoerd"                                                                 |
| C3  | `wine_search,sources_panel,purchase_intel`               | Koopcheck on a catalogue wine with a shared profile shows it, with no AI usage row                                                             |
| C4  | `wine_search,sources_panel,purchase_intel,scan_resolver` | **only after `REAL_LABEL_VALIDATION_PENDING` is lifted**: scan a known wine and an unknown one; `/admin/ai` recognition numbers look as before |

## Part D — Not part of any release without a separate, explicit decision

- [ ] Any provider in `search_scope = 'public'` or `rights_status = 'verified'` (needs written evidence in
      `SOURCE_RIGHTS_REGISTER.md` and `admin_catalog_provider_rights` by the owner).
- [ ] Any import into production or a hosted staging project (staging needs its ref in
      `scripts/catalog-tools/approved-targets.json` through a reviewed PR and an owner-set `private.catalog_settings` row).
- [ ] Catalogue learning mode (`catalog_learning.mode`), unchanged by this epic.
- [ ] A provider-side hard spending limit and alert on the AI account (owner; see `SECURITY_AND_PRIVACY.md` §4).
- [ ] `REAL_LABEL_VALIDATION_PENDING`: consented real label photos and a physical iPhone run (`UX_ACCEPTANCE.md`).
- [ ] Sending the Liv-ex and X-Wines e-mails (drafts only, in this folder).
- [ ] **R-27:** decide whether a wine created from a source's record keeps that record's id, so its page can credit
      the source (`progress/WI-05.md` §7). Needed before any source is shown to people.
- [x] The existing specs bound to the old selectors hold with the features on or off (`progress/WI-08-hardening.md`
      §4). To run the whole suite against a build with every feature on: Actions → CI → Run workflow → features `on`.

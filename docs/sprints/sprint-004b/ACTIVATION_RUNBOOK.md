# Activation runbook: an external wine source in production (prepared in Sprint 004B, NOT executed)

**Nothing in this file was run.** It is the order of operations for the day a source's rights are confirmed in
writing. Until then the answer to "may we activate X-Wines or LWIN?" is **NO** (`SOURCE_RIGHTS_REGISTER.md` §4).
Every step is the owner's, on their own machine. `docs/MIGRATIONS.md` and `RELEASE_CHECKLIST.md` win where they
disagree with this file.

## 0. Preconditions (all must hold; any "no" stops here)

| #   | Condition                                                                                                                                                                                  | Evidence                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| P1  | The source's rights for **store**, **display to consumers** and **commercial use** are confirmed **in writing** (X-Wines: answers to X1, X2; LWIN: L1–L5)                                  | the written answer filed with `SOURCE_RIGHTS_REGISTER.md`, its status line updated in a reviewed PR |
| P2  | The attribution wording and placement are known (LWIN: Liv-ex's; X-Wines: the citation the register proposes)                                                                              | same                                                                                                |
| P3  | **R-27** decided: does a household wine created from a record keep the record's id so its page can credit the source?                                                                      | decision recorded; needed before anything is shown                                                  |
| P4  | For LWIN only: the real file was obtained lawfully and the adapter's layout verified against it (`layoutVerified = true` in a reviewed commit, with a test on a sample of the real header) | commit + test                                                                                       |
| P5  | The same file was imported and checked in an approved staging project (`STAGING.md` S1–S8), with `staging-check.ts` passing before and after                                               | the two JSON reports                                                                                |
| P6  | A completed production backup from the last 24 hours                                                                                                                                       | Supabase → Database → Backups                                                                       |

## 1. Record the rights (the existing, logged procedure; no button exists by design)

In production, as the service role (server-side admin, never from a browser), **only after P1–P2**:

```sql
select public.catalog_provider_register('{"id":"xwines","name":"X-Wines dataset","homepage":"https://github.com/rogerioxavier/X-Wines"}');
select public.admin_catalog_provider_rights('xwines', '{
  "license":"CC0-1.0", "license_url":"https://creativecommons.org/publicdomain/zero/1.0/",
  "attribution":"<the confirmed credit>", "legal_notice":"<from the register>",
  "modification_notice":"Names normalised and types mapped by CELLR.",
  "may_store":true, "may_display":true, "commercial_use":true,
  "rights_status":"verified", "rights_evidence":"<what, from whom, where it is filed>",
  "rights_verified_at":"<date>", "rights_verified_by":"<owner>",
  "search_scope":"off"}', '<reason>', '<owner>');
```

`search_scope` stays **`off`** here. The database refuses `verified` without evidence, date and verifier, and refuses
`public` without verified commercial rights (004A/WI constraints). Every change lands in `catalog_provider_rights_log`.

## 2. Import (not yet visible to anyone)

The tools **refuse production** (`PRODUCTION_PROJECT_REFS`) and will keep doing so: a production import is a
deliberate change to that guard in a reviewed PR for that one release, or the same SQL functions called by the owner.
The recommended way is the latter, with the importer's own payloads:

1. Dry run first (`catalog_external_import(..., p_apply => false)` per batch): the counts must equal staging's.
2. `catalog_import_run_start(provider, version, source_url, sha256, note, retrieved_at, p_pilot => false)` (refused
   unless rights are `verified`), batches of 500 with `p_apply => true`, then
   `catalog_import_run_finish(run, p_withdraw_missing => true, counts)`.
3. If anything fails half-way: `catalog_import_run_abandon(run, reason)` withdraws nothing; a new run supersedes an
   open one; re-running the same file is idempotent (rehearsed: kill -9 mid-run, re-run completes, 0 duplicates).

## 3. Checks right after the import (still not visible)

| Check                                                                                                                          | Must show                             |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| Records active = file records (staging's number)                                                                               | equal                                 |
| `select count(*) from (select 1 from public.catalog_external_records group by provider_id, external_id having count(*) > 1) d` | 0                                     |
| `select count(*) from public.wines where origin = 'licensed_import'`                                                           | 0 (imports never write CELLR wines)   |
| `select count(*) from public.catalog_record_links where state = 'verified'`                                                    | unchanged (an import only suggests)   |
| People's search for a known record (signed in, any household)                                                                  | **no** provider rows (scope is `off`) |
| `staging-check.ts`-equivalent queries for gates and RLS (its SQL, run read-only by the owner)                                  | all pass                              |
| Index size and `catalog_search` p95 for people (`perf.ts --mode public` method)                                                | within staging's numbers              |

## 4. Make it visible (one switch, reversible)

1. `admin_catalog_provider_rights(provider, '{"search_scope":"public"}', '<reason>', '<owner>')`.
2. Feature switches as in `RELEASE_CHECKLIST.md` Part C (`wine_search`, then `sources_panel`), one at a time.
3. Check, signed in as a test household: a known record appears **below** the household's own wines and the CELLR
   catalogue, labelled with the source, licence link and "bewerkt door CELLR"; choosing it pre-fills a new wine that
   the person confirms; no record is ever "verified".

## 5. Switch it off at once (seconds, no data loss)

`select public.admin_catalog_provider_disable('<provider>', '<reason>', '<owner>');` (or Admin → External sources →
Switch off). The provider's records vanish from every search and source block immediately; `p_block => true` also
blocks further imports. Removing `wine_search` from `CELLR_FEATURES` hides the search field altogether.

## 6. Why households' data stays intact

- Imports write only `catalog_*` staging tables. `wines`, `producers`, `bottles`, tastings, valuations and profiles
  are never written by an import or a provider switch (SQL tests; rehearsal invariant "CELLR wines written by
  imports: 0").
- A household wine created from a record is the household's own provisional wine: switching the source off, or
  withdrawing the record, leaves it exactly as it is.
- A failed or abandoned run withdraws nothing; a damaged export (empty, partial, far smaller) is refused before it
  can withdraw anything (WI-01).

## 7. Updates later

1. Fetch the provider's new file; verify its checksum or record the new one; run `quality.ts` on it and compare with
   the previous report (records, identities, duplicates, skipped rows).
2. Import into staging first (`STAGING.md` S7), `--withdraw-missing` only with a complete file (the tool refuses a
   sharp drop in records).
3. Then the production steps 2–3. Changed records are `updated`; an approved link whose record changed identity is
   sent back to review (migration `…0042`). Records the new file no longer has are withdrawn, never deleted.

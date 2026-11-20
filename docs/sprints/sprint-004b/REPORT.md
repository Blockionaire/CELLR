# Sprint 004B — External wine database integration & staging import: final report

Date: 2026-11-20 · Branch `claude/sprint-004b-xwines-staging` (from `main` @ `07bc80c`) · Gap analysis:
[`GAP_ANALYSIS.md`](GAP_ANALYSIS.md) · Staging: [`STAGING.md`](STAGING.md) · Activation:
[`ACTIVATION_RUNBOOK.md`](ACTIVATION_RUNBOOK.md) · Evidence: [`results/`](results/)

## 0. Where things stand

| Level                      | What                                                                                                                                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Implemented**            | LWIN multi-level codes; external-record suggestions in the scan resolver; `quality.ts`, `staging-check.ts`, `recognition.ts`, `staging-rehearsal.sh`; staging and activation documents |
| **Tested locally**         | everything above: unit tests, the database suite on Postgres 16 **and** 17, and the full X-Wines import route on a throwaway Postgres 17.12 marked `staging`                           |
| **Tested in staging**      | **nothing**: CELLR has no approved staging project (§2)                                                                                                                                |
| **Deployed to production** | **nothing**. No migration was added; no import, no provider row, no deployment                                                                                                         |
| **Activated for users**    | **nothing**. X-Wines stays `unverified` (pilot only), LWIN `blocked`; no source is public                                                                                              |

Nothing here is "live". The rehearsal database was deleted after each run.

## 1. Results

| Part               | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **X-Wines import** | **100,646 of 100,646** rows imported (0 invalid, 0 skipped, **0.0 % errors**) in **56.4 s** (52.1 s in the run before the review fixes); re-import 0 inserted / 0 updated / **100,646 unchanged** in 56.0 s. Import tool peak memory **1.1 GB**. Kill -9 mid-run (asserted: a run left open, 30,500 of 100,646 written) → re-run updated the rest: **1,525 + 3,508 = 5,033** changed records, exact; 0 duplicates; the killed run marked abandoned. Restoring the original updated exactly those 5,033 back |
| **Staging**        | No approved staging project exists. The route was rehearsed on a local Postgres 17 (production's major version) marked `staging` by its owner: unmarked → refused; marked → read-only `staging-check` **PASS (8 checks)** before and after the import                                                                                                                                                                                                                                                       |
| **Search**         | Benchmark v2 on current `main`: 004A's 127 queries **77 / 84 / 92** of 95 (top-1 / 3 / 8), all 189 positives **129 / 139 / 147** of 151, both **identical to 004A and WI-01**. Near-twin sibling first: 0 of 10. Filter contradictions: 0. Adversarial: 0 errors, 0 over the limit. Provider rows marked verified: **0**                                                                                                                                                                                    |
| **Matching**       | Recognition chain on the 100k pilot records, 90 covered wines × 3 readings: clean label → right record **1st in 85 / 90**, top-3 in 86; OCR-style misread → 1st in 50, none in 39; producer only → top-3 in 44. **Wrong automatic identities: 0; suggestions of another colour, country or producer: 0.** With 5 canonical CELLR wines seeded, 11 clean readings (incl. typo and near-twin queries of the same wines) resolved to exactly that CELLR wine                                                   |
| **LWIN**           | Adapter reads LWIN-7/11/16/18 and folds rows of one wine; conflicting identity is fatal. Tested only on CELLR's own fictitious fixtures. Real import **blocked**: rights unconfirmed, no file, layout unverified                                                                                                                                                                                                                                                                                            |
| **Security**       | Pilot separation on the full dataset: people's search **0** provider rows, pilot search 20, a signed-in person calling the pilot search: `permission denied`. 1591 / 1591 SQL assertions (Postgres 16 and 17). Independent review: §8                                                                                                                                                                                                                                                                       |
| **Production**     | **NO-GO** for any external source (rights). **GO** for merging this branch's code after review: it changes nothing people see while no source is public (§9)                                                                                                                                                                                                                                                                                                                                                |
| **Code**           | §10                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## 2. Phase B — staging

- **Projects on the account** (read-only listing, 2026-11-19): `vvelgyhbjfmjvxkzekyz` = production (refused by the
  tools in every form); `dqwkbtsstvakcvlnwvwk` "Blockionaire's Project" (created 2026-05-12). Nothing identifies the
  second as CELLR staging, so it was **not used, opened or queried**.
- **What is needed from you** (`STAGING.md` S1): either approve a new staging project (likely extra cost on the Pro
  plan: paid infrastructure, not created), or confirm in writing that `dqwkbtsstvakcvlnwvwk` may be wiped and used.
  Then S2–S8: schema by `MIGRATIONS.md` §6, mark it (`private.catalog_settings`), add its ref to
  `approved-targets.json` in a reviewed PR, run `staging-check.ts`, import exactly as the rehearsal does.
- **Proof that isolated import works:** `staging-rehearsal.sh`, a reproducible script; its last full run is in
  `results/` (Postgres 17.12, exit 0).

## 3. Phase C — X-Wines import and data quality

Source: the authors' Drive folder linked from their repository; `XWines_Full_100K_wines.csv` SHA-256
`eac2d812…62cc` = the authors' published hash; repository HEAD unchanged since 2024 (`5e43c7f`). Re-checked
2026-11-19: no change, no new rights evidence.

| Measure (`results/quality-xwines.json`)                                                            | Value                                                                                                                             |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Rows / records / skipped / duplicate external ids / encoding problems                              | 100,646 / 100,646 / 0 / 0 / 0                                                                                                     |
| Producers as written / normalised                                                                  | 30,190 / 30,161                                                                                                                   |
| Distinct identities (producer, name, colour, country)                                              | 100,481                                                                                                                           |
| Countries / regions / grapes                                                                       | 62 / 2,159 / 777                                                                                                                  |
| Types                                                                                              | red 56,162 · white 29,196 · sparkling 7,366 · rosé 4,401 · dessert 2,409 · fortified 1,112 (Dessert/Port mapped)                  |
| Vintages listed                                                                                    | 2,149,993 (1950–2022); records marked N.V. 6,504; **N.V. only 97**; no vintage at all 0 beyond those 97                           |
| Empty fields                                                                                       | only `Website` (17,867); identity fields never empty                                                                              |
| Producer written more than one way                                                                 | 28 groups ("Château Bel-Air" / "Chateau Bel-Air" / "Château Bel Air")                                                             |
| Producers differing only by estate words                                                           | 500 groups ("Aurora" / "Cantine Aurora" / "Aurora Cellars"): **not merged**, they may be different estates                        |
| Identical identities under different ids                                                           | 155 groups, 320 records (reported as `possible_duplicates`, never merged)                                                         |
| Same name, other colour, one producer                                                              | 6                                                                                                                                 |
| Near-identical names of one producer                                                               | 59 variant + 9 uncertain pairs (e.g. word order)                                                                                  |
| Beyond basic Latin                                                                                 | accented 34,742 · Cyrillic 311 · Greek 143 · Georgian/Armenian 61 · Arabic/Hebrew 34 · CJK 14; all stored and searched as written |
| CELLR wines written by the import / verified links / suggested links                               | 0 / 0 / 0                                                                                                                         |
| Sizes after import (final run; previous run 149 / 93 / 263 MB, before `VACUUM` timing differences) | `catalog_external_records` 130 MB, `catalog_search_entries` 83 MB, database 235 MB                                                |

Rights were never changed to get an import through: X-Wines was registered `unverified`, `may_store`, `may_display`,
`commercial_use = false`, scope `pilot`; a non-pilot import was refused ("rights are not verified; only a pilot run is
allowed"), and the pilot route was used.

## 4. Phase D — search, recognition and matching

**Built:** `suggestRecordsForReading` (`packages/domain/src/record-suggestions.ts`). When a label is read and no CELLR
wine is the exact match, the resolver also ranks the provider records that people's search already returned: same
name → name variant → similar name → another bottling; a record that lists the year read goes first; a record whose
**colour, country or producer contradicts** the reading is never offered. They travel apart from the identity
candidates (`resolution.records`), from public sources only (filtered again, fail closed), and never make a scan
"found". No new scan engine: the existing resolver, `matchLabel` rules and search are reused.

| Check (`results/recognition-results.json`)                    | Result                                                                                   |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Clean readings, right record first / top-3 / none             | 85 / 86 / 0 of 90                                                                        |
| Misread readings (capitals, accents lost, one letter dropped) | 50 / 51 / 39 of 90                                                                       |
| Producer-only readings                                        | 24 / 44 / 6 of 90 (6 with none: other producers' wines are no longer offered, review P1) |
| Automatic identity from a record                              | **0** (by construction and by assertion)                                                 |
| Suggestion of the other colour                                | **0**                                                                                    |
| Seeded canonical wines: clean reading → that CELLR wine       | 11 readings (5 seeds + 6 other queries for them)                                         |
| Search per reading (pilot path)                               | p50 20 ms, p95 56 ms                                                                     |

Fail cases, explained: Santa Rita "120 Cabernet Sauvignon" and Trapiche Malbec (the provider names them
"120 Reservado …" / "Pure Malbec"; shown as producer-only alternatives); a misread **producer** often finds nothing
because the fuzzy threshold (0.6, chosen in 004A against false matches) rejects it — the person then types, as today.
Synthetic misreadings are not real OCR; real label photos are still `REAL_LABEL_VALIDATION_PENDING`.

**Not changed** (deliberately): ranking weights, fuzzy threshold, the scan UI (the review does not yet render
`resolution.records`; it already offers records through "zoek" when a source is public).

## 5. Phase E — LWIN readiness

| Item                         | State                                                                                                                                                                                                                                                                 |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LWIN-7                       | supported (as before)                                                                                                                                                                                                                                                 |
| LWIN-11 / 16 / 18            | **new**: read as the LWIN-7 wine with vintage / bottle size (`bottle_ml`); rows of one wine folded                                                                                                                                                                    |
| Vintage placeholder `1000`   | reported as `vintage_placeholder`, never "non-vintage" (meaning unconfirmed, question L8)                                                                                                                                                                             |
| Conflicts                    | two rows naming different wines (name, colour, country, region, appellation, classification) under one LWIN-7 → the file is not imported                                                                                                                              |
| Mapping to CELLR wines       | as for every source: a suggested link only for exactly one canonical identity; admin verifies (audited)                                                                                                                                                               |
| Dedup LWIN ↔ X-Wines ↔ CELLR | per provider: unique `(provider, external id)`; across providers: `quality.ts` counts identical identities in other providers; in search a verified record is shown as its CELLR wine; two unverified records of one wine from two sources would both show (labelled) |
| Provenance                   | LWIN-7 in `details.lwin7`, run, licence and retrieval date per record (unchanged)                                                                                                                                                                                     |
| Real file validation         | the adapter refuses any file but CELLR's two pinned fixtures until `layoutVerified` is set in a reviewed commit                                                                                                                                                       |
| Updates                      | idempotent re-import; withdrawal only with a complete file (unchanged)                                                                                                                                                                                                |

**Remaining dependencies (exact):** (1) Liv-ex's written answer to L1–L5 (`SOURCE_RIGHTS_REGISTER.md` §2); (2) a
lawfully obtained file; (3) its real header and the meaning of `1000` (L8) checked, `layoutVerified = true` with a
test on the real header; (4) attribution wording from Liv-ex; (5) R-27.

## 6. Phase F — performance and regression

Measured in the final rehearsal after the review fixes (Postgres 17.12, 4 vCPU container, noisier than the one before: the run before the fixes is given as the second figure; 100,646 X-Wines records + 10,300 synthetic
household wines; 1,914 searches per run after a warm-up):

| Path                                                    |     p50 |                p95 |      p99 | Earlier (004A / WI)                   |
| ------------------------------------------------------- | ------: | -----------------: | -------: | ------------------------------------- |
| Evaluation search, 1 client                             |  7.8 ms | **25.8 ms** (22.6) |  67.8 ms | 004A 24 ms                            |
| Evaluation search, 8 clients                            | 15.8 ms | **54.5 ms** (48.6) | 107.6 ms | 004A 47 ms                            |
| Evaluation search, 16 clients                           | 31.9 ms | **99.7 ms** (88.3) | 186.4 ms | 004A 93 ms; WI after `…0042` 115 ms   |
| People's search, 8 clients, **before** the X-Wines data | 63.9 ms |    102.6 ms (80.1) | 121.3 ms | WI: 45 ms before `…0042`, 84 ms after |
| People's search, 8 clients, **after** (100k hidden)     | 14.0 ms |     72.8 ms (58.5) | 197.5 ms | —                                     |

- Target p95 < 250 ms: met on every path.
- People's search on current `main` is ~80–103 ms p95 at 8 clients **before any external data** (Postgres 16 on
  the same machine: 82.8 ms) — this is `main`'s search after migration `…0042`, not a regression of this sprint. With
  the data loaded it measured lower in both runs (58.5 / 72.8 ms), likely different statistics after `ANALYZE`; we
  report it, we do not claim it.
- Import 52–56 s vs WI 77 s (different machine and Postgres version; not comparable as an improvement).
- **Memory:** the import tool peaks at 1.1 GB (quality tool 1.4 GB) for a 36 MB file: it holds the parsed file, the
  records and the batch JSON at once. Fine on a laptop or CI runner; streaming is an improvement for a larger file.
- **Existing functionality:** unit and SQL suites unchanged and green; the people's search is not slower with the
  dataset loaded; imports write no CELLR table (invariants above).
- **Interrupted / failed imports:** §1; damaged exports (empty, partial, far smaller) refused (WI-01, unchanged).

## 7. Security tests

| Test                                                                                                                                                                                                                                                                           | Result                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| Pilot records through people's search, on 100k records                                                                                                                                                                                                                         | 0 rows                                   |
| A signed-in person calling the pilot search                                                                                                                                                                                                                                    | `permission denied`                      |
| Tools against an unmarked (production) database                                                                                                                                                                                                                                | refused                                  |
| `staging-check` (8 checks): people cannot run pilot, rights, import, finish, abandon, link-decision or off-switch functions; only the owner can mark the DB; pilot-scope trigger on; RLS on all 7 catalogue tables; no table privilege for anon / authenticated on any of them | PASS before and after                    |
| A non-pilot import of an unverified source                                                                                                                                                                                                                                     | refused                                  |
| The LWIN fixture offered as real LWIN                                                                                                                                                                                                                                          | refused before reading into the database |
| Suggestions: pilot, unscoped or mis-cased scope rows                                                                                                                                                                                                                           | dropped (unit tests)                     |
| Database suite                                                                                                                                                                                                                                                                 | 1591 / 1591 on Postgres 16 and on 17     |

## 8. Independent review

A separate agent that wrote none of this code reviewed the diff (database integrity, security/RLS, privacy, licence
and provenance, scalability, performance, identity correctness, regressions, recoverability). Findings and what was
done with them: §8.1. It ran its own probes and the targeted tests (49 domain, 95 tools, 70 web: all passed).

### 8.1 Findings

| #   | Severity | Finding                                                                                                                                                                                                       | Fix                                                                                                          | Proof                                                                                                           |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| 1   | **P1**   | With no wine name on the label, `suggestRecordsForReading` never compared the producer: "Castello Banfi" was offered other Castellos' wines (seen in the rehearsal's own output). Latent: no source is public | the producer must be the record's (compared with the record's own name on both sides)                        | unit test with the reviewer's case; recognition now counts producer and country contradictions as violations: 0 |
| 2   | P2       | The runbook's direct SQL route skipped three guards that live only in the import tool (shrink, `invalid > 0`, unverified layout) before withdrawing                                                           | explicit manual checks; finish without withdrawal unless all hold; §6 corrected                              | `ACTIVATION_RUNBOOK.md` §2–§6                                                                                   |
| 3   | P2       | The kill test did not prove a mid-run kill, and its snapshot was taken while the last batch was still committing (1,500 + 3,508 ≠ 5,033)                                                                      | wait until no import statement runs; assert an open run and a partial write; assert before + re-run = change | final run: 1,525 + 3,508 = 5,033, exact                                                                         |
| 4   | P3       | A deleted LWIN-7 still produced a record through its live LWIN-11/16 rows                                                                                                                                     | the wine is withdrawn at every vintage and bottle size                                                       | unit test, both row orders                                                                                      |
| 5   | P3       | Two identical LWIN rows folded silently instead of failing as a repeated row                                                                                                                                  | the same full code twice is fatal                                                                            | unit test                                                                                                       |
| 6   | P3       | Folded `modifications` depended on row order (false "updated" on a re-sorted export)                                                                                                                          | sorted                                                                                                       | unit test: reversed rows give the same record                                                                   |
| 7   | P3       | LWIN vintages accepted up to 2100                                                                                                                                                                             | a vintage after next year is dropped and noted                                                               | unit test                                                                                                       |
| 8   | P3       | Recognition seeding not re-runnable; producer lookup ignored the country; `::1` never matched                                                                                                                 | `on conflict` with lookup; country in the lookup; `[::1]`                                                    | final run                                                                                                       |
| 9   | P3       | `staging-check` missed three service-only functions; RLS check was only the flag                                                                                                                              | functions added; no table privilege for anon / authenticated                                                 | 8 checks PASS                                                                                                   |

Found sound by the reviewer: the LWIN gate (hash of the file's bytes; the real adapter has none), the fold's identity
comparison (null vs empty, classification carried forward), records never deciding an identity or a "found" scan,
the scan result's JSON shape (the field only when non-empty), exposure (RLS, `publicSearchHits`, permission denied
on the pilot search), the tools' targets, the runbook SQL against the real function signatures, and the cost of
suggestions (no extra queries). All findings were fixed; the rehearsal and every check were run again afterwards.

## 9. Production: GO / NO-GO

| Decision                             | Verdict                  | Conditions                                                                                                                |
| ------------------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Merge this branch (code only)        | **GO after your review** | merging deploys the app (Vercel builds `main`); no migration; behaviour for people is unchanged while no source is public |
| Create / designate a staging project | **your decision**        | paid infrastructure or written designation of `dqwkbtsstvakcvlnwvwk`                                                      |
| X-Wines in production (store)        | **NO-GO**                | written answers to X1, X2 (origin of the data, third-party rights); register updated; `ACTIVATION_RUNBOOK.md` P1–P6       |
| X-Wines shown to people              | **NO-GO**                | the above, plus R-27, plus the credit                                                                                     |
| LWIN anything                        | **NO-GO**                | §5 remaining dependencies                                                                                                 |

## 10. Code

Branch `claude/sprint-004b-xwines-staging` (the designated branch could not be force-reset by policy; this new
branch was created as the brief asks). Commits on top of `main`:

| Commit                          | What                                                                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `00d3cb8`                       | LWIN 11/16/18-digit codes, fold, fixture, pinned hash list; gap analysis                                                     |
| `d232de0`                       | Record suggestions for a wine nobody in CELLR has added                                                                      |
| `df50f54`                       | quality, staging-check, recognition, staging-rehearsal; peak memory in import reports                                        |
| `ad7a248`                       | STAGING.md and ACTIVATION_RUNBOOK.md                                                                                         |
| `82d1b01`, `5681dfd`, `19f6ee4` | rehearsal fixes (expected refusal; local seeds; identity check by identity)                                                  |
| `e49e1e5`                       | this report                                                                                                                  |
| `1f9a489`, `45a04f8`            | the independent review's fixes (§8.1)                                                                                        |
| `f1c8b12`                       | `results/` from the final run after the review fixes                                                                         |
| others                          | intermediate `results/` snapshots taken while rehearsals were running; superseded by `f1c8b12` (a squash merge is suggested) |

Tests: web 1287 (+5) + 12 skipped · domain 961 (+22) · catalog-tools 95 (+9) · scan-eval 83 · storage-backup 75 ·
SQL 1591 (no migration) · format, lint (1 existing warning), typecheck, db types, build, bundle-secret scan,
migration guard: all pass. Not run: e2e (CI runs it on `main`), the real-Supabase-stack job (CI).

Also changed in this container only: Postgres 17 was installed from the official PostgreSQL apt repository to rehearse
on production's major version.

## 11. What is still really needed

1. **Your decision on staging** (new project = cost, or designate the existing one).
2. **Send the two e-mails** (drafts in `wine-intelligence-mega/emails/`) — the only path to any source going live.
3. **R-27** (keep a record's id on a wine created from it, for the credit).
4. Real label photos and a real iPhone (`REAL_LABEL_VALIDATION_PENDING`), before `scan_resolver`.
5. When a source can be shown: render `resolution.records` in the scan review (small UI step; the data is there).
6. Optional engineering: stream the import (memory); look at `main`'s people's-search p95 (~80 ms at 8 clients).

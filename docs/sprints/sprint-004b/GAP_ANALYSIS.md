# Sprint 004B — gap analysis (audit of `main` @ `07bc80c`, 2026-11-19)

Short by design: Sprint 004A and the Wine Intelligence epic (WI-00…WI-08) built and reviewed most of this. This file
says what already works, what had to be repaired, and what this sprint builds. Evidence is in `REPORT.md`.

## Changes since the existing reports

| Checked                                                                      | Result                                                                                                                                  |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| X-Wines repository (`github.com/rogerioxavier/X-Wines`)                      | HEAD still `5e43c7f` (May 2024); LICENSE unchanged (CC0 1.0)                                                                            |
| X-Wines Drive folder                                                         | same 15 files; `XWines_Full_100K_wines.csv` SHA-256 `eac2d812…62cc`, equal to the authors' `INFO_Hashing.txt`                           |
| Liv-ex LWIN licence page                                                     | same text: "Creative Commons", commercial adaptation, attribution, no version or licensor named                                         |
| E-mails to the X-Wines authors and Liv-ex (`wine-intelligence-mega/emails/`) | drafts, not sent; no answer on file                                                                                                     |
| Supabase projects on the account                                             | the production project and `dqwkbtsstvakcvlnwvwk` "Blockionaire's Project" (created 2026-05-12, nothing identifies it as CELLR staging) |

**Conclusion:** no new evidence; rights stay X-Wines `unverified` (pilot only) and LWIN `blocked`.

## Works (reused unchanged)

| Area                                                                                                               | Where                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Staging tables, run lifecycle (one open run, abandon, finish/withdraw), rights gates, pilot separation, provenance | migrations `…0037`, `…0038`, `…0040`–`…0042`                                                           |
| Admin rights procedure (logged) and the off switch                                                                 | `admin_catalog_provider_rights`, `admin_catalog_provider_disable`; `scripts/catalog-tools/provider.ts` |
| Target guard: local or approved staging ref, never production; the database must say what it is                    | `scripts/catalog-tools/lib.ts`, `target.ts`                                                            |
| File inspection before import (layout, UTF-8, unique ids, ragged rows, damaged exports)                            | `inspectProviderFile`, `importBlocker`                                                                 |
| X-Wines adapter (layout verified against the real file)                                                            | `fromXWinesRow`                                                                                        |
| Search with prefix, alias, fuzzy, filters, ranking; pilot-only evaluation function                                 | `catalog_search`, `catalog_search_pilot`                                                               |
| Typing → record → confirmed draft → household wine                                                                 | `wine-search` controller (`confirmRecord`), add-bottle and scan review                                 |
| Scan resolver (bounded candidates, unchanged identity rules)                                                       | `server/catalog/resolver.ts`, `domain/wine-resolver.ts`                                                |
| Benchmark v2 (247 entries), identity pairs, pilot, load test                                                       | `eval/catalog/`, `scripts/catalog-tools/`                                                              |

## Repair

| Gap                                                      | Effect                                                                                                                                                                 | This sprint                                                                                                                                         |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| LWIN adapter reads only 7-digit codes                    | a real file with one row per vintage or bottle size (LWIN-11/16/18, as Liv-ex's FAQ describes) would skip every such row, then be refused as "probably not the layout" | rows at any documented level are folded into one LWIN-7 record with its vintages and bottle sizes; a conflicting identity under one LWIN-7 is fatal |
| The unverified-layout gate pins exactly one fixture file | a second fixture (the multi-level one) could not be tested                                                                                                             | the gate takes a list of pinned fixture hashes; still refuses every other file                                                                      |

## Build

| Gap                                                                                                                                                          | This sprint                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No data-quality report of an import (uniques, distributions, empties, duplicates, spelling variants, accents, cross-provider overlap, links)                 | `scripts/catalog-tools/quality.ts`, run on the full pilot                                                                                                                                                                                                                                             |
| No proof that a crashed import (process killed mid-run) recovers                                                                                             | pilot step: kill, restart, check counts, runs and duplicates                                                                                                                                                                                                                                          |
| Memory of an import not measured                                                                                                                             | pilot measures peak RSS of the import tool                                                                                                                                                                                                                                                            |
| Recognition of a wine no CELLR user has added: the resolver never offers records (by design), so the scan review offers a record only if the person searches | `suggestRecordsForReading`: ranks provider records for a label reading (colour, vintage, country, identity relation), never an identity; the resolver returns them separately, from people's search only (public sources: none today); `recognition.ts` evaluates the chain on the 100k pilot records |
| No staging project; no way to check one before importing                                                                                                     | `staging-check.ts` (read-only), `STAGING.md` (owner steps); proven on a local database marked `staging`                                                                                                                                                                                               |
| No production activation runbook for a source                                                                                                                | `ACTIVATION_RUNBOOK.md` (prepared, not executed)                                                                                                                                                                                                                                                      |

## Not in scope (unchanged decisions)

Showing any external record to people; changing a rights status or scope; a real LWIN download; UI changes beyond
what existing flags already gate; the `scan_resolver` GO (needs real label photos and a real iPhone).

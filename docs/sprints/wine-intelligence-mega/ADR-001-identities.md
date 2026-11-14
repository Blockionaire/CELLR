# ADR-001 — External identifiers and the identity lifecycle

Status: accepted (WI-00, 2026-11-13) · Applies to: every sub-sprint of WI-001

## Context

The epic adds autocomplete, a scan resolver, buying advice on wines the household does not own, and a sources section.
Each of them handles several kinds of "wine" at once: the household's own wines, the shared catalogue, and records of
external providers. Sprint 004A (migration `20261114000037_catalog_search.sql`, merged in PR #65) already modelled
these. The question for this epic is whether that model is enough, or needs redesigning before more is built on it.

## The identities that exist (verified in code, 2026-11-13)

| Thing                    | Table / key                                                                                       | Who owns it                          | Who may read it                                                                | Who may write it                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Canonical producer, wine | `producers`, `wines` with `status = 'canonical'`, `owner_household_id is null`; `wines.id` (uuid) | CELLR (the owner curates)            | everyone signed in                                                             | service role only: `catalog_import`, the Wine Master admin                                                        |
| Verified alias           | `wine_aliases` of a canonical wine                                                                | CELLR                                | everyone signed in                                                             | service role only                                                                                                 |
| Provisional wine         | `wines` with `status = 'provisional'`, `owner_household_id = H`                                   | household H                          | members of H only (RLS)                                                        | members of H (`createWine`, `updateWine`)                                                                         |
| Household link           | `wine_links` (household wine → canonical wine; null = explicitly not linked)                      | CELLR (an admin's verified decision) | service role only; people see its effect through `find_wines_by_label_text`    | admin decision, audited in `master_audit`                                                                         |
| Vintage                  | `wine_vintages (wine_id, year)`; `year is null` = non-vintage                                     | follows the wine                     | follows the wine                                                               | household for its own wines; `catalog_vintage()` for canonical wines                                              |
| Bottle                   | `bottles (household_id, vintage_id, format_ml, …)`                                                | household H                          | members of H only                                                              | members of H                                                                                                      |
| Provider                 | `catalog_providers.id` (text, e.g. `xwines`)                                                      | CELLR                                | service role only                                                              | `catalog_provider_register` (name, homepage, notes); rights only through `admin_catalog_provider_rights` (logged) |
| External record          | `catalog_external_records (provider_id, external_id)`; `id` uuid                                  | the provider's data, staged by CELLR | people: only through `catalog_search` when the provider is `public` + verified | `catalog_external_import` in an open import run                                                                   |
| Record link              | `catalog_record_links (record_id → wine_id, state)`                                               | CELLR                                | service role only                                                              | import may **suggest**; only `admin_catalog_record_decide` verifies/rejects                                       |
| Shared profile           | `shared_wine_profiles (vintage_id, language)`                                                     | CELLR                                | everyone signed in                                                             | service role only (`publish_shared_wine_profile`), canonical vintages only                                        |
| Household profile        | `vintage_insights (household_id, vintage_id)`                                                     | household H                          | members of H only                                                              | the server, for H                                                                                                 |

## Decision

1. **Keep the 004A schema. No second identity system, no new master table, no new link table.** Everything this epic
   needs can be expressed with the rows above. New database objects in this epic are read functions, review queues and
   telemetry: additive, in new migrations.
2. **The CELLR `wines.id` is the only identity a bottle, a vintage, a profile or a verdict may refer to.** A provider's
   `external_id` (an X-Wines `WineID`, an LWIN) is an external reference stored on the record, never a CELLR key.
3. **LWIN levels are abstraction levels, not strings to be cut.** LWIN-7 names a wine; LWIN-11 adds the vintage; LWIN-16
   the bottle size; LWIN-18 the pack. Only the LWIN-7 is a record identity (`details.lwin7`). A longer code maps to
   `(wine, year, format, pack)` only when it parses exactly (WI-01: `parseLwin`); nothing is derived by guessing, and no
   LWIN is ever assigned to a wine by name similarity.
4. **The identity lifecycle has four states and only humans move a record up:**

   ```text
   external record ──(import: exact identity, exactly one canonical wine)──► suggested link
   suggested link  ──(admin_catalog_record_decide, audited)───────────────► verified | rejected
   provisional wine ─(catalogue learning: households + a public source + admin approval)─► canonical wine
   canonical wine  ──(Wine Master admin edit, audited)────────────────────► corrected canonical wine
   ```

   Nothing in this epic adds an automatic transition. Choosing a provider record in the UI creates (or reuses) the
   household's **provisional** wine through the existing `createWine`; it never creates a canonical wine and never
   verifies a link.

5. **What each consumer may treat as an identity** (the rule `needsConfirmation` in `catalog-search.ts` already
   encodes):

   | Hit                                                  | May be used without asking again                               |
   | ---------------------------------------------------- | -------------------------------------------------------------- |
   | canonical wine, matched exactly or by verified alias | yes: it is that `wines.id`                                     |
   | the household's own wine, typed exactly              | yes                                                            |
   | any `prefix` or `fuzzy` match                        | no: the person picks it explicitly                             |
   | any provider record                                  | no: the person confirms the fields; a provisional wine results |

   The scan keeps its own, stricter rule (`matchLabel` / `isCatalogIdentity` / `recognizeLabelText`): a catalogue wine
   is "found" only on an exact identity, and the person confirms in every mode.

6. **Vintage is never part of a search or resolver identity.** A candidate is a wine; the year is what the label said
   or what the person chose. `null` means non-vintage in `wine_vintages` and "not known" in a Koopcheck
   (`PurchaseWine.year` with `nonVintage = false`); the two are never converted into each other, and "now" is never
   used as a default.
7. **A provenance hint is not a link.** When a person builds a provisional wine from a provider record, nothing is
   stored about that record in this epic: `wine_sources` is written by the service role only (it holds the curated
   catalogue's public sources), and a household-private pointer to staged provider data would outlive a rights
   withdrawal. Revisit only when a provider is legally cleared.

## Consequences

- WI-02 and WI-03 are adapters over `catalog_search` and the existing matchers; they add no ranking of their own that
  could disagree with them.
- WI-04's "candidate not in the cellar" path carries a `wineId` only when the chosen hit is a CELLR wine; a provider
  record carries facts only, so it can never reach `shared_wine_profiles`.
- WI-06's link review is a screen over `catalog_record_links` + `admin_catalog_record_decide`, not a new workflow.
- If Liv-ex clears LWIN, real files are checked against `LWIN_COLUMNS` first; a different layout is refused (R-11).

## Alternatives rejected

- **A unified `wine_identities` table** spanning canonical, provisional and external rows: it would duplicate the Wine
  Master, weaken the RLS split that keeps provisional wines private, and need every existing foreign key rewritten.
- **Storing `record_id` on a household wine at selection time**: see decision 7.
- **Auto-verifying links on an exact string identity**: an exact string is a suggestion; two estates can share a name,
  and the audit trail must show a person decided.

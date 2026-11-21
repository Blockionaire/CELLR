# LWIN: technical completion and the real-file checklist (Sprint 004C)

**Status:** technically complete and tested on CELLR's own fictitious records. Not usable for people.

- **Rights:** no LWIN data has been obtained or imported. The provider stays `blocked` in the static assessment (`PROVIDERS.lwin`) and `unverified / off / may_store=false` in the database.
- **Layout:** the adapter reads only the layout CELLR **assumes** LWIN has (`lwin-assumed-layout-v0`). A real file is refused until that layout has been checked against a lawfully obtained file, in a reviewed commit.

## 1. What the adapter does

| Item                    | Behaviour                                                                                                                                                                                                                               | Where it is tested                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| LWIN-7 (the wine)       | One CELLR record per LWIN-7: producer title + name joined; colour/type mapped; spirits skipped                                                                                                                                          | `catalog-providers.test.ts`, `eval.test.ts`                                |
| LWIN-11 (+ vintage)     | Read as its LWIN-7 wine with that vintage. `1000` is the "no vintage" placeholder: noted, never read as N.V. or as a year. Vintages after next year are dropped and noted                                                               | same                                                                       |
| LWIN-16 (+ bottle size) | Bottle size kept as `details.bottle_ml` (sorted, de-duplicated). A trade detail; CELLR bottles carry their own size                                                                                                                     | same                                                                       |
| LWIN-18 (+ pack)        | **New in 004C:** pack kept as `details.pack_size` (e.g. `[6, 12]`). A trade detail, never shown as a fact about a bottle, not part of the identity                                                                                      | `catalog-providers.test.ts` (pack sizes united, sorted, order-independent) |
| Folding                 | All rows of one LWIN-7 become one record. Vintages, sizes and packs are united; modifications are sorted, so row order never changes the content hash                                                                                   | same                                                                       |
| Conflicts               | Two rows of one LWIN-7 that disagree on producer, name, colour, type, country, region, appellation or classification are **fatal**: the file is not imported, and CELLR never picks one of two identities                               | same                                                                       |
| Duplicates              | The same full code twice is fatal                                                                                                                                                                                                       | same                                                                       |
| Anomalies               | Codes of an undocumented length, all-zero codes, impossible vintages or sizes, and a pack of 0 are skipped, with the reason counted                                                                                                     | `catalog-identity` tests                                                   |
| Withdrawal              | A `Deleted` LWIN-7 withdraws the wine at every level: its live vintage and size rows are not imported either. With `--withdraw-missing`, a record the new file no longer lists is withdrawn. A file that shrinks needs `--allow-shrink` | `eval.test.ts`, the rehearsal                                              |
| Updates                 | A changed field or new vintage updates the record. The same file again changes nothing                                                                                                                                                  | the rehearsal                                                              |

## 2. Matching LWIN ↔ X-Wines ↔ CELLR wines

There is **no second matching engine**. Everything goes through CELLR's existing identity rules (`identityRelation`) and the existing link model:

- **Record → CELLR wine** (`catalog_record_links`): an import whose record has exactly the identity of one canonical CELLR wine adds a `suggested` link. Only an admin's `verified` decision changes what people see. This is provider-independent; the rehearsal shows the LWIN record and the X-Wines-layout record suggested to the **same** CELLR wine.
- **LWIN ↔ X-Wines** (new, read-only): `quality.ts --against <file> --against-provider <id>` compares two sources' files with `crossSourceMatches`. It reports, per record, the closest record of the other source: `same`, `variant` (spelling, accents, estate statements such as "Grand Vin"), `uncertain` (a slipped letter: for a person), `different_cuvee`, or none. Two records of the other source that are the same wine are counted as `ambiguous`, never picked between. Nothing is written; two sources agreeing is **not** a verification.
- Database view (`quality.ts --db`): `same_identity_in_other_providers` counts exact normalised identities shared across sources.

Fixture result (`results/lwin/quality-lwin_fixture.json`): `same 3 · variant 1 · uncertain 1 · different_cuvee 0 · none 2 · ambiguous 0`. The white of a name never matches its red; a producer of its own matches nothing.

## 3. Provenance

Each record keeps provider, external id (the LWIN-7), dataset version, retrieval date, the run that last saw it, and the list of CELLR's modifications (e.g. "LWIN-18 read as its LWIN-7 wine"). A household wine created from a record keeps that origin (R-27, `wine_record_origins`). The credit disappears when the source is switched off; the wine and its bottles stay.

## 4. The rehearsal (local Postgres 17.12, fictitious data)

`bash scripts/catalog-tools/lwin-rehearsal.sh` checks every expectation and stops at the first that fails. Last run: **all held** (`results/lwin/rehearsal.log`).

1. A database marked `staging`, one fictitious CELLR wine.
2. The X-Wines-layout fixture: 5 records, 1 suggested link.
3. The LWIN fixture v1: 7 records from 9 rows (2 folded), `bottle_ml [750]`, `pack_size [12]`, 1 suggested link, to the same CELLR wine. 0 CELLR wines written.
4. The v2 update:
   - a dry run writes nothing;
   - without `--allow-shrink` the run is refused;
   - with it: 1 updated (new region and vintage), 4 unchanged, `9200006` (deleted) and `9200007` (gone) withdrawn;
   - the link is kept.
5. v2 again: 5 unchanged, 0 duplicates.
6. A signed-in person searching sees the CELLR wine only (both sources are in scope `off`).
7. The same rows offered as **real** LWIN data are refused (layout never verified). The real provider has 0 records.

## 5. Checklist for a real LWIN file (only after Liv-ex's written permission)

Do these in order. Stop at the first "no".

1. [ ] **Written permission** from Liv-ex covers storing, displaying, commercial use, and modification, in an app for consumers. The wording of the attribution is confirmed. File it in `SOURCE_RIGHTS_REGISTER.md`. Without this, nothing below happens.
2. [ ] The file was obtained **lawfully**, from Liv-ex's own download, by the owner. Record its SHA-256, size, date and URL. Never commit it to GitHub.
3. [ ] **Layout**: compare the real header with `LWIN_COLUMNS`:
   - [ ] column names, order and separator;
   - [ ] encoding (UTF-8? BOM?);
   - [ ] quoting.

   Any difference: write `lwin-v1` as a new adapter schema. Never change the assumed one in place.

4. [ ] **Codes**: confirm with real rows how the levels are laid out.
   - [ ] LWIN-16 = LWIN-11 + a 5-digit size: in **ml** (`00750`) or in cl?
   - [ ] LWIN-18 = LWIN-11 + a 2-digit pack + a 5-digit size, in that order?
   - [ ] the `1000` "no vintage" placeholder;
   - [ ] whether the file holds levels other than LWIN-7 at all.
5. [ ] **Status values**: the exact spelling of live and deleted (`Live`/`Deleted`?), and whether there are others (e.g. combined or merged codes, and where those point).
6. [ ] **Colour/type vocabulary**: list every distinct `COLOUR` and `TYPE`, and map each one deliberately. Unmapped values must stay `null` and be noted, never guessed.
7. [ ] **Countries**: every distinct `COUNTRY` is in the adapter's country map (`COUNTRY_CODES` in `packages/domain/src/catalog-providers.ts`), or deliberately left unmapped.
8. [ ] Run `quality.ts --file <real> --provider lwin` locally, plus `--against` the X-Wines file. Read:
   - [ ] conflicts and duplicates (0 fatal is required);
   - [ ] skipped rows by reason;
   - [ ] the `ambiguous` count;
   - [ ] a sample of `variant` and `uncertain` pairs.
9. [ ] Then, in a **reviewed commit**: set `ADAPTERS.lwin.layoutVerified = true`, with the evidence (hash, header, the checks above). Rights stay as they are.
10. [ ] Import into **staging** only, with `--pilot`. Follow `docs/sprints/sprint-004b/ACTIVATION_RUNBOOK.md`: staging check, backup, the import, a re-import (must be all `unchanged`), the benchmark, and the people's search unchanged.
11. [ ] The owner sets the rights in the logged admin step, quoting the written permission. Search scope stays `off` or `pilot` until production activation is approved separately.
12. [ ] The admin reviews the suggested links in batches. Only `verified` links change what people see.

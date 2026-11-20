# Sprint 004C: External wine database, full integration and production readiness

**Branch:** `claude/sprint-004c-integration`, stacked on PR #96 (`claude/sprint-004b-xwines-staging`). **Date:** 2026-11-20.

**Nothing is live.**

- No merge, no deployment, no production import and no public activation.
- No email was sent, no paid project was created, and no rights status was changed on the basis of my own reading of a licence.
- `vvelgyhbjfmjvxkzekyz` (production) and `dqwkbtsstvakcvlnwvwk` were not touched.
- Real X-Wines data was used only on the permitted evaluation route: locally, in a throwaway Postgres 17.12, deleted after each run. Only aggregates were committed.

## 1. Status per item

Legend:

- **I** = implemented
- **L** = locally tested
- **S** = staging verified
- **P** = production deployed
- **U** = user activated

| Item                                                                                             | I                        | L                   | S             | P   | U                          | Evidence                         |
| ------------------------------------------------------------------------------------------------ | ------------------------ | ------------------- | ------------- | --- | -------------------------- | -------------------------------- |
| PR #96 (004B) ready for squash merge: CI green, no conflicts                                     | ✓                        | ✓                   | —             | —   | —                          | §2                               |
| R-27: a wine added from a record keeps its origin                                                | ✓                        | ✓                   | ✗             | ✗   | ✗                          | §3; pgTAP 1661/0 on PG 16 and 17 |
| Scan UX: "Could be this wine" → form → confirm → wine → credit                                   | ✓                        | ✓                   | ✗             | ✗   | ✗                          | §4; `e2e/scan-records.spec.ts`   |
| Never "found" for another bottling or colour of an own wine (review fix)                         | ✓                        | ✓                   | ✗             | ✗   | ✗                          | §8 P2-1                          |
| Full credit on the suggestion card                                                               | ✓                        | ✓                   | ✗             | ✗   | ✗                          | §8 P2-2/5                        |
| Staging preparation (config, env, migrations, identity, security, backup, import, cost)          | ✓ (docs, check)          | ✓ (rehearsal)       | ✗: no project | —   | —                          | `STAGING_PREP.md`                |
| LWIN technically complete (levels, pack, anomalies, conflicts, withdrawal, update, cross-source) | ✓                        | ✓ (fictitious only) | ✗             | ✗   | ✗                          | `LWIN.md`; `results/lwin/`       |
| Data quality and performance on the full X-Wines set                                             | ✓                        | ✓ (PG 17.12)        | ✗             | —   | —                          | §6; `results/xwines/`            |
| E-mails to the X-Wines authors and Liv-ex                                                        | ✓ (final, ready to send) | —                   | —             | —   | **not sent**               | `emails/`                        |
| E2E chain tests (phone and desktop, NL/EN, network, session, a11y, …)                            | ✓                        | ✓                   | ✗             | —   | —                          | §5                               |
| Physical iPhone checklist                                                                        | ✓                        | — (needs a device)  | ✗             | —   | —                          | `IPHONE_CHECKLIST.md`            |
| Independent review, fixes, re-runs                                                               | ✓                        | ✓                   | —             | —   | —                          | §8                               |
| Production activation plan (12 steps)                                                            | ✓                        | —                   | —             | —   | —                          | `ACTIVATION_PLAN.md`             |
| X-Wines / LWIN shown to people                                                                   | —                        | —                   | —             | —   | **no**: rights not cleared | `SOURCE_RIGHTS_REGISTER.md`      |

## 2. PR #96 (Sprint 004B)

- **E2E fix:** `e2e/scan-resolver.spec.ts` had asserted since 004B that a scan never names a public source. The 004B record suggestions made that untrue, and CI only runs e2e on `main`, so nobody saw it. The spec now asserts the actual rule: never a match, never verified, and the source named. The fix is on the 004B branch (9ff247b).
- **Producer-only fix** (f5d4be7 on 004B): with no wine name read, a producer one letter off is no longer offered as "Only the producer matches". On the full X-Wines evaluation, recall is unchanged: producer-only readings rank the right record first in 24/90 and in the top 3 in 44/90, the same as before.
- **CI** on #96's head: all ten checks green. The e2e jobs are skipped on PRs by design.
- **Ready for a squash merge.** Not merged: that needs your explicit go-ahead.

## 3. R-27: where a household's wine came from (owner decision: YES)

Migration `20261128000050_r27_wine_record_origins.sql` is additive and applied nowhere but local test databases.

**The table, `public.wine_record_origins`:**

- One row per household, wine and record.
- It holds a **snapshot**: provider, external id, dataset version, retrieval date, licence, credit, and the record's producer, name and type.
- `matches_record` is false when the household changed the details before confirming.
- RLS: members of the household can read their own rows. People cannot write it directly.

**`record_wine_origin`** is called by the server as the signed-in person, only for a wine **this call created**. It writes only when all of these hold:

- the wine is the household's own provisional wine;
- the record is active;
- its source is public, verified, `may_display` and `commercial_use`.

Every refusal answers alike (`not_yours` / `unavailable`), so it reveals nothing.

**Unlinking and switching off:**

- `unlink_wine_origin` keeps the row as history.
- `wine_origin_notices` credits the source only while it is shown to people. Switch the source off and the credit goes; the wine, its bottles and the origin row stay.

**Merging and deleting:**

- `merge_wines` is replaced. Its body is identical to before, plus one block that carries origins over per household.
- Deleting a household deletes its origins.

**Where it shows:**

- **Wine page:** "The details were taken from this source when the wine was added; your household confirmed them", or the "changed some of them" variant, with the full credit.
- **App:** `CreateWineSchema.sourceRecordId` carries the choice. A failing origin step never stops the person adding the wine.

**Tests** (pgTAP `99_r27_wine_record_origins.test.sql`):

- creation, reuse, a corrected wine;
- refusals: another household, a catalogue wine, a pilot source, an unknown record, direct writes, an outsider, anon;
- a withdrawn record; unlinking and relinking; a source switched off;
- a merge moves the origin and the bottle;
- two households merging into one catalogue wine each keep their own origin;
- household delete.

Unit tests cover the service, the sources endpoint and the domain view.

## 4. Scan UX

When no CELLR wine is the exact match, records of **public** sources appear under **"Could be this wine" / "Mogelijk deze wijn"**, on the "A new wine" screen and under "Is it one of these?".

**Each card shows:**

- producer, name, colour, country and region;
- why it is offered (same name, similar name, other cuvée, producer only, vintage listed or not);
- the source's own attribution, the licence (linked), "modified by CELLR" when that applies, "not verified by CELLR", and that the source does not endorse CELLR.

**"Use these details"** fills the new-wine form. A notice names the source as not verified, and every field stays editable. The person confirms, and the bottle's year stays the one read off the label.

**Built with:** the existing design system (`rounded-card`, `ring-hairline`, `Button`), mobile first, and next-intl NL/EN. Each button is described by its wine, and the heading level fits where it sits.

**Today no source is public**, so nobody sees this.

## 5. End-to-end tests (local stack, Chromium; phone and desktop projects)

`apps/web/e2e/scan-records.spec.ts`, with fictitious sources only. Four tests, each run on phone and desktop:

1. **The chain:**
   - scan, suggestion, use, form filled in with the notice, confirm, bottle;
   - an origin row with a snapshot; the catalogue untouched; no record link; the wine page credit;
   - the source switched off: the credit gone, the wine and bottle kept;
   - axe audit, screenshots.
2. **Never offered:** a source not shown to people, a contradicting colour, a wine the household has. A Reserva or white label of an own wine is a **choice**. The API with a switched-off or unknown record: wine created, no origin.
3. **Dutch, network and session:** a dropped connection is said so, nothing is created, and the retry gives one wine and one origin. An expired session creates nothing. The suggestion shows under "Is het een van deze?". The licence link.
4. **Untrusted readings:** not a wine label, producer only, an unknown producer, and a record withdrawn while on screen (the wine is made, credited to no one, and not suggested again).

**Related specs re-run with the final build** (16 spec files, including scan, scan-api, scan-resolver, wine-search, sources, cellar, detail, catalog, purchase-intel, admin-sources, households, language, acceptance and cellar3d; 3 workers): **156 passed, 3 skipped, 3 failed.**

- `detail.spec.ts:81` (phone) passes when re-run serially: load timing.
- `cellar3d.spec.ts:171`, on phone and desktop, fails identically on `origin/main` (6ab4350) in this container, so it predates this work. It is a canvas click in headless Chromium, in code 004B and 004C do not touch. It is not fixed here.

**Earlier in the sprint:**

- 211 of 226 targeted tests passed and 9 were skipped. All 6 failures passed when re-run serially: 5 load-timing tests in bottle removal, moving, the wine page and scan errors, plus 1 race in my own spec, which I fixed by waiting for the language switch.
- The full suite was stopped at test 74 of 1,162 (2 workers would take hours). Its one failure, a 3D canvas click (`cellar3d.spec.ts:171`), is in code this sprint does not touch; see §9.

## 6. Data quality and performance (full X-Wines file, local Postgres 17.12)

Measured with the 004C code, by `staging-rehearsal.sh`. Aggregates are in `results/xwines/`.

| Measure                                        | Result                                                                                                                                                                           |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Import                                         | 100,646 / 100,646 in 63 s, 0 invalid. Second run: 100,646 unchanged                                                                                                              |
| Interrupted import                             | `kill -9` mid-run, then a re-run: 1,525 + 3,508 = 5,033 changed records, exact. 0 duplicates, 1 run marked abandoned                                                             |
| Memory                                         | Peak RSS 1.10 GB for a 34 MB file (the tool holds parsed records in memory)                                                                                                      |
| Database size                                  | 221 MB in total (records 121 MB, search index 79 MB)                                                                                                                             |
| Search benchmark (004A set)                    | Right record 1st in 77/95, top 3 in 84/95, top 8 in 92/95. All positive queries: 129 / 139 / 147 of 151                                                                          |
| False positives                                | 0 provider rows marked verified; 0 rows contradicting a filter; near twins: the sibling is never offered first (10/10); 0 adversarial errors                                     |
| Recognition, clean labels                      | Right record 1st in 85/90, top 3 in 86/90                                                                                                                                        |
| Recognition, misread (OCR) labels              | 50/90 first, 51/90 top 3, 39 with no suggestion                                                                                                                                  |
| Recognition, producer only                     | 24/90 first, 44/90 top 3                                                                                                                                                         |
| Wrong automatic identities                     | **0**. 0 safety violations; no reading made "found" by a record                                                                                                                  |
| Pilot separation                               | People's search: 0 provider rows. Pilot search: 20. A signed-in person calling the pilot search: permission denied                                                               |
| Latency, evaluation search                     | p95 29 / 65 / 122 ms at 1 / 8 / 16 clients; about 300 queries/s from 8 clients                                                                                                   |
| Effect on people's search                      | p95 78 ms at 8 clients with 100k hidden records. Before the data: 113 ms, a cold-cache baseline also seen in 004B. **No degradation**                                            |
| Data-quality findings (reported, never merged) | 30,161 producers; 155 identical-identity groups (320 records); 28 producer spelling variants; 500 producer groups that differ only by estate words; 97 records listing only N.V. |

**Is streaming needed?** Not for X-Wines: 1.1 GB peak is fine on an owner's machine and in CI-sized containers.

For a file several times larger (a full LWIN file could hold 200k+ wines at several levels), the estimate is 2–3 GB+ at the same rate. Streaming the parse and the batches would then be worth it. No refactor was done without a measured need; this is the measured threshold.

**No more aggressive auto-recognition.** The one change to recognition is stricter (§8 P2-1).

## 7. LWIN, staging, e-mails, activation

- **LWIN** (`LWIN.md`):
  - LWIN-7/11/16/18; pack kept as `details.pack_size`;
  - conflicts and duplicate codes are fatal; anomalies are skipped with a reason;
  - a deleted LWIN-7 withdraws every level; updates and shrink guard; idempotent;
  - cross-source report LWIN ↔ X-Wines through CELLR's own identity rules (no second engine);
  - canonical links stay suggestions.
  - `lwin-rehearsal.sh`: every expectation held on PG 17.12.
  - A 12-step checklist for a real file. The real provider stays refused.
- **Staging** (`STAGING_PREP.md`):
  - no project exists. Option A, a new Micro project, costs about **+$10/month** (Supabase pricing, read 2026-11-20) and needs your approval;
  - environment variables, migrations, the owner-only identity marker, `staging-check.ts` (now including an R-27 check), backup/restore, and the import procedure.
- **E-mails** (`emails/`): final and ready to send. They are honest that CELLR is commercial, and describe exactly the credit the app shows. The Liv-ex e-mail adds the database-right question and the code-layout questions. **Not sent.**
- **Activation** (`ACTIVATION_PLAN.md`): 12 ordered steps with gates and undo. Rights in writing come first, `sources_panel` before any source is shown, and the pending 0047 (your decision D4) is named.

## 8. Independent review (a separate agent; no P1)

| Finding                                                                                                                   | Fix                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2-1: an own wine was "found" for a Reserva or another colour, one tap from the wrong wine, and that hid matching records | `matchLabelSafely`: an own wine is "found" only without a contradiction (other bottling, colour, country). Used by the resolver and the fallback. Unit and e2e tests |
| P2-2/P2-5: the card lacked the licence link, attribution and non-endorsement, and the e-mails described them              | All on the card; the e-mails match; `sources_panel` first in the plan                                                                                                |
| P2-3: 0047 is also pending                                                                                                | Plan step 3 states it, with the partial-release route                                                                                                                |
| P2-4: the Liv-ex e-mail did not ask about database rights (L6)                                                            | Question 11 added                                                                                                                                                    |
| P3: merge across households                                                                                               | The index and the merge carry-over are per household; pgTAP fails on the old version                                                                                 |
| P3: an origin on an existing wine; "Also listed in" wording; changed details                                              | Origin only for a created wine; "Filled in from …"; the "changed" wording                                                                                            |
| P3: licence name from the snapshot, link from the provider                                                                | Both from the provider                                                                                                                                               |
| P3: doc references, field list, truncation, pgTAP bottle check, accessibility                                             | All fixed                                                                                                                                                            |

## 9. Checks (final)

`format:check`, `lint` (one existing warning), `typecheck`, `build` and the bundle secret scan all pass. So do `db:types:check`, `migrations:check` and the architecture inventory (no diff).

| Suite          | Result                                         |
| -------------- | ---------------------------------------------- |
| web            | 1328 (+12 skipped)                             |
| domain         | 998                                            |
| catalog-tools  | 100                                            |
| scan-eval      | 83                                             |
| storage-backup | 75                                             |
| `db:test`      | **1661 / 0** on Postgres 16 and on Postgres 17 |

E2E: see §5. The only consistent failure, the 3D canvas click, fails the same way on `main`.

## 10. Needs your decision

1. **Merge:** squash-merge #96, then this PR after a rebase onto `main`.
2. **Send** the two e-mails (fill in name and address). Nothing can be shown before the answers.
3. **Staging:** approve about $10/month for a new project, or confirm in writing that `dqwkbtsstvakcvlnwvwk` may be wiped and used.
4. **D4:** whether 0047 goes with 0050, or 0050 alone.
5. **Results policy:** 004B committed per-query result files containing some X-Wines names. 004C commits aggregates only. Should 004B's files be reduced the same way before #96 merges?

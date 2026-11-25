# Wine Catalogue & Community Ratings: sprint report

**Nothing is live.** No merge, production migration, import or activation was done. Four pull requests are ready for
the owner's decision, each one stacked on the one before:

| PR                                                     | Title                                                | Status                |
| ------------------------------------------------------ | ---------------------------------------------------- | --------------------- |
| [#137](https://github.com/Blockionaire/CELLR/pull/137) | Ratings data model, streaming aggregation and import | Review findings fixed |
| [#138](https://github.com/Blockionaire/CELLR/pull/138) | Community reviews and the weighted CELLR score       | Review findings fixed |
| [#139](https://github.com/Blockionaire/CELLR/pull/139) | Ratings block, record page, search and scan          | Review findings fixed |
| PR 4                                                   | Secured production import and controlled activation  | Security review       |

Design: `DESIGN.md`. Activation steps: `ACTIVATION.md`.

## 1. Acceptance results

### External ratings, on the real file

The run was on a throwaway local Postgres 17.12, with every migration applied; the results are in `results/`, counts only.

**The file**

- Checksum equal to the authors' published one.
- Header `RatingID,UserID,WineID,Vintage,Rating,Date`, verified.
- 21,013,536 rows, of which 0 invalid.

**Aggregation**

- 156,492 repeated ratings were dropped: same person, same wine and vintage, only the latest kept.
- Result: 1,008,593 units (wine × vintage, of which 2,382 NV), holding 20,857,044 ratings. All 100,646 wines have ratings.
- Bounded memory: 232 s and a peak of 507 MB.

**Import into the database**

- The import took 220 s.
- The database refuses to finish a run unless its totals add up, and this run's did.
- The second run left every unit unchanged.

**Correctness**

- A second, independent implementation recomputed 400 sample units from the raw file: 0 differences.

**Reads and storage**

| Measurement                 | Result                   |
| --------------------------- | ------------------------ |
| Read latency                | p50 0.14 ms, p95 0.26 ms |
| Storage after vacuum (live) | 241 MB                   |

### Database tests

`db:test`: **1803 passed, 0 failed**. The new tests cover:

| Area        | Tests |
| ----------- | ----- |
| Ratings     | 52    |
| Reviews     | 48    |
| Record page | 7     |

The regression tests the brief asked for are all among them:

- wrong vintages: NV is never a year, and a year is never NV;
- wrong wine matches: a renamed, retyped or merged wine gets no ratings; a suggested link gives none; an ambiguous one gives none;
- household privacy and RLS;
- duplicate reviews, including across a record and its canonical wine;
- rating manipulation:
  - repeated external ratings counted once;
  - one review per person;
  - rate limits;
  - reports from throwaway accounts that never hide a review;
  - moderation that cannot be undone by the author.

### Other checks

- **Unit tests:** domain 1983, web 1688, catalog-tools 141.
- **Weighted score:** tested at 0, 1, a few and thousands of ratings, with realistic examples.
- **End to end:** run on the local stack (phone) for the wine page, publishing, filters, the record page, the add flow and switching the source off. Screenshots were reviewed.

### Independent reviews

| PR  | Lenses                                                     | Findings   | Status     |
| --- | ---------------------------------------------------------- | ---------- | ---------- |
| 1   | Database security, rating integrity, privacy, performance  | 1 P1, 4 P2 | All fixed  |
| 2   | Database security, RLS, manipulation, privacy, performance | 1 P1, 4 P2 | All fixed  |
| 3   | UI, accessibility, privacy                                 | 1 P1, 5 P2 | All fixed  |
| 4   | Security of the production route                           | —          | See its PR |

## 2. Not done yet, and why

- **Staging with the real data and the new schema.** The staging workflow runs only from `main` (by design), so it
  can run only after the merges: ACTIVATION.md step 2.
- **People's search at 16 concurrent searches** over a populated public source (`sprint-004c/GO_LIVE.md` A3) is still
  open. It needs measuring before the source goes public (ACTIVATION.md step 8).
- **Search results show no rating badge.** A record chosen in search shows its ratings in the add flow; a "4,1★ · 128"
  badge on each hit would need a batched lookup, and is the next step.

## 3. Decisions for the owner

1. **The written permission:** record its exact terms in `SOURCE_RIGHTS_REGISTER.md` §1b. Until then the register
   says "owner-reported", and the rights stay unset in the database.
2. **The accepted risks** (DESIGN.md §3):
   - a few real accounts can dominate a thinly rated wine (weight 5);
   - coordinated real accounts can hide a review until a moderator restores it;
   - the link filter is simple.
3. **GO for merging** #137 → #138 → #139 → PR 4, in that order.
4. **The `cellr-production-catalog` environment:** required reviewer, `main` only, the `PRODUCTION_DB_URL` secret.
5. **The ACTIVATION.md steps 2–10**, each with its own GO.

## 4. Costs

- **Database:** about +0.25 GB in production for the rating aggregates; the records were already measured in 004B.
  This fits within the plan's included 8 GB.
- **No new paid service.**
- **Actions:** about 15 minutes per production run.
- **Staging:** about $10/month while it runs.

## 5. Privacy in one paragraph

No X-Wines user id or individual rating reaches any database; only counts, sums, distributions and months do. A CELLR
review is published only by its author's explicit consent. It never contains the private tasting note, and it shows
the author's display name only. Reviews and reports go with the account when it is deleted.

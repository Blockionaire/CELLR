# Wine Catalogue & Community Ratings: design

Scope: the X-Wines catalogue (100,646 records) searchable in one experience, historical ratings per exact wine and
vintage, and a CELLR community whose reviews weigh more. Four pull requests:

| PR  | What                                                | Production effect on merge                                                 |
| --- | --------------------------------------------------- | -------------------------------------------------------------------------- |
| 1   | Ratings data model, streaming aggregation, import   | Code only. Migration 0051 is applied separately; until then no ratings     |
| 2   | Community reviews and the weighted CELLR score      | Code only, behind `community_reviews`; migration applied separately        |
| 3   | Wine card, catalogue wine page, search and scan     | Behind `catalog_ratings` / `community_reviews`; off until named            |
| 4   | Secured production import and controlled activation | A workflow that only runs by hand, behind its own environment and reviewer |

Nothing becomes visible to people until the owner (a) applies the migrations, (b) imports into production through
PR 4's route, (c) records the rights in the database, and (d) names the feature switches.

## 1. Identity: what a rating belongs to

- **External ratings** belong to one **provider record** (`catalog_external_records`: X-Wines `WineID`) and one
  **vintage** (a year, or NV = `null`). The record is the cuvée: X-Wines gives every cuvée its own id, and nothing is
  ever grouped by name. The 155 groups of identical identities found in Sprint 004B stay separate units.
- **A wine in CELLR** gets a record's ratings only when exactly one record belongs to it:
  - a canonical wine: through the one **verified** link (`catalog_record_links`, an admin's decision);
  - a household's own wine: through its active R-27 origin (`wine_record_origins`), and only while the wine still
    **matches** the record's identity, checked live at every read (`private.record_matches_wine`: same normalised
    producer and name, no contradicting type), never from the origin's snapshot. A wine the household renamed,
    retyped or merged into another wine gets none.
  - Two or more candidates are ambiguous and give none. A suggested link gives none.
- **Vintages never mix.** 2019 ratings are shown for 2019. NV is its own vintage. A vintage the file cannot state
  as a year or as "N.V." is refused, and never turned into NV.

## 2. External ratings (PR 1)

**The real file**, verified on 2026-11-25:

- `XWines_Full_21M_ratings.csv`, SHA-256 equal to the authors' `INFO_Hashing.txt`.
- Header: `RatingID,UserID,WineID,Vintage,Rating,Date`.
- 21,013,536 rows, with no malformed line and no repeated `RatingID`; the ids strictly increase.
- Ratings in half stars, 1.0–5.0. Vintages are years 1950–2021 or `N.V.` (442,391 ratings).
- Every `WineID` is in the wines file, and every wine has ratings.
- 1,008,593 (wine, vintage) units.
- 143,932 rater–unit pairs were rated more than once, giving 156,492 extra ratings.

**The method `latest-per-rater-v1`:**

- One rating per rater per unit: the latest (by date, then by `RatingID`).
- Repeated ratings are counted and dropped. They never count twice, so one account cannot push a wine up by
  rating it again and again.

**Privacy.** No X-Wines user id reaches any database:

- `ratings.ts aggregate` streams the file on the importer's machine.
- It spills valid lines into partition files by wine id. The user id is replaced by a keyed hash (HMAC-SHA-256),
  whose random key exists only in memory, and only while the tool runs.
- Each partition is aggregated on its own (bounded memory), and the partition files are deleted, also after a
  failure.
- The database receives per unit only: the count, the sum in half stars, the distribution (10 half-star buckets),
  and the **month** of the first and last rating (never the day).
- A unit with one rating is necessarily that one rating's stars and month. The source is public, so this reveals
  nothing new, but CELLR shows the months only for units of at least 5 ratings.

**Integrity:**

- The file is checked against its checksum before a line is read. A different header is refused.
- Invalid lines are counted by reason and never used.
- The importer always runs a dry run first. It writes nothing when any unit is invalid or names a record the
  provider does not hold. A unit for a **withdrawn** record is skipped and counted, never fatal.
- A rating run declares its totals (units and ratings, without those of withdrawn records) when it starts. The
  database refuses to finish the run unless the stored aggregates add up exactly; the run then stays open, to be
  completed or abandoned.
- What an abandoned run wrote is not shown: a read takes only units of a finished or open run. A failed import
  never shows a mix of two files as one.
- Every unit is checked in the database. Every bucket must be a whole number given as a number. The distribution
  must add up to the count, and the sum must match the distribution. Months must be between 1990 and today.
- The units file is tied to its report by checksum.
- The same file again is `unchanged` (the values are compared), and is a HOT update (fillfactor 80, no index on
  the run).
- A complete file can remove units it no longer has, and only after the totals check passed.
- An independent second implementation (`ratings-verify.py`) recomputes sample units from the raw file.

**Rights:**

- Storing and showing ratings is its own per-use decision: `catalog_providers.may_display_ratings`, set only
  through the logged `admin_catalog_provider_rights` step, and only next to `may_display`.
- A non-pilot run needs verified rights plus that decision.
- People see ratings only for a public source with verified commercial rights and `may_display_ratings`.
- `admin_catalog_provider_disable` hides the ratings at once, and deletes nothing.

## 3. CELLR community reviews (PR 2)

Built on the existing tastings, with the score scale unchanged (`tastings.score`, 1–10 in tenths of a star;
stars = score / 2):

- **A private tasting stays private.** A public review is a separate row that a person creates explicitly (opt-in)
  from one of their own tastings that has a score.
- It holds the person's public text: optional, and **never** the private note. The score, the vintage and the
  tasting date come from the tasting.
- **Bound to the exact identity:** a review can only be published for a wine with a catalogue identity (§1): a
  canonical wine, or a household wine whose origin matches a record. Its subject and vintage are fixed at
  publication. A wine that exists only in one household cannot be reviewed publicly, because nobody else could
  ever see the same wine.
- **One review per person per subject and vintage** (unique index). A second tasting of the same wine and vintage
  updates the review; it is never a second vote.
- **Edit and delete:** the author only. Deleting the tasting deletes its review.
- **Against manipulation and spam:**
  - one review per person per subject and vintage;
  - a rate limit on publishing;
  - a length limit, and links refused in the text;
  - reports: one per person per review;
  - a review with enough open reports is hidden pending moderation;
  - admins can hide or restore, with the reason logged;
  - a hidden or removed review counts for nothing.
- **Profile:** the display name and avatar of `profiles`, never the household or the email.

**After the independent review of PR 2:**

- **Moderation cannot be undone by the author.** A hidden or removed review is never deleted by its author. The
  author's delete clears its text and detaches it from the tasting, and it stays as a tombstone. Publishing again
  (from the same or another tasting, or after clearing and restoring the score) answers `moderated`.
- **One per person across a record and its canonical wine.** Reads keep one review per person and vintage. A new
  publication replaces the person's other published review of the same wine and vintage.
- **Reports count only from people who use CELLR** (a household and a tasting of their own). A review a moderator
  restored is not hidden again by reports alone: it goes to the moderation queue, hidden reviews first.
- **Months, not days:** a review shows the month it was tasted.
- **A tasting that moves** to another vintage or wine (`merge_wines`) takes its published review down.

**Accepted risks (owner to confirm before activation):**

- **Few-account influence on thinly rated wines.** Weight 5 means one review is most of the score of a wine with
  three external ratings. Ten accounts with households and tastings outweigh any external set. Mitigations in place:
  one review per person, publish and report rate limits, moderation. Further options if needed: a minimum account
  age, or counting CELLR reviews only from the second one per wine.
- **Coordinated real accounts** can still hide a review until a moderator restores it. After a restore they cannot
  hide it again.
- **The link filter** stops `http(s)://` and `www.` only.

## 4. The weighted CELLR score (PR 2)

`packages/domain/src/rating-score.ts`, pure and tested.

- External: mean `E` (stars) over `n` ratings. **Weight `min(n, 50)`.**
- CELLR: per published review, stars `s_i = score_i / 2`. **Weight 5 each.**
- **Combined** = `(E · min(n, 50) + 5 · Σ s_i) / (min(n, 50) + 5 · m)`, where `m` is the number of reviews. There is
  no score when `n = m = 0`.
- **Shown:** the combined score (one decimal) next to the **real** counts `n` and `m` (never a weighted count), plus
  the external and CELLR averages separately.
- With 10 CELLR reviews (weight 50), the community weighs as much as any number of external ratings. With more, it
  leads.

## 5. Wine card and pages (PR 3)

- **The rating block:**
  - the prominent combined score;
  - the real counts;
  - the external and CELLR scores separately;
  - an interactive star distribution;
  - filters for vintage and review type;
  - CELLR's written reviews;
  - a clear empty state.
- **One central sources page** gives the X-Wines citation and the rating method. Wine cards don't name the source
  on every card, by the owner's permission (`SOURCE_RIGHTS_REGISTER.md` §1b). The rating block links to the page.
- **A catalogue record page** for a wine found in search that is not in the cellar: its identity, ratings and
  reviews, and "add to cellar".

## 6. Production (PR 4)

A separate manual workflow with its own environment (`cellr-production-catalog`) and a required reviewer, which
production-only tools need. It runs in this order:

1. backup check;
2. migration history check;
3. dry run;
4. import of records and then ratings, with the totals check;
5. verification.

Activation is the owner's, one step at a time, by `docs/sprints/ratings/ACTIVATION.md`. None of it runs without
the owner's separate GO.

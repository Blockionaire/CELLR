# Follow-up plan: stars and rating counts in search results

**Goal:** every search hit that has ratings shows a small line such as "★ 4,1 · 128 beoordelingen", so people
recognise good wines before they open them. The rules are the same as on the wine card: real counts, no invented
scores, no source named on the hit, and nothing for a wine without a catalogue identity.

## Design

1. **Database (one new migration).**
   - Add `public.catalog_search_ratings(p_household_id uuid, p_hits jsonb)`. It takes at most 20 hits, each a
     `{wineId}` or a `{recordId}`.
   - For each hit, it resolves the rating record exactly as `catalog_wine_ratings` does (`rating_record_of_wine`
     for a wine; the record itself for a public record). It then returns, all vintages pooled:
     - the external count and sum (only for a public source with `may_display_ratings`);
     - the CELLR review count and the scores (only while the community is open).
   - One call per search answer, never one per hit. It reads one index range per hit, so the cost is about 20
     single-row reads.
   - The gates are the same as for the wine card: membership, the public scope, rights, and the community gate.
2. **Domain.** `searchHitRating(ext, scores)` calls `ratingScore` and returns `{ combined, count }`, where `count`
   is the real number of ratings (external + CELLR) and `combined` is null when there are none.
3. **Server.**
   - `catalogSearch.search()` makes the ratings call after the search, but only with `catalog_ratings` on, and only
     when the search returned hits.
   - Failure tolerant: a failing call returns the hits without ratings.
   - The extra rows travel in the same response.
4. **UI** (`wine-search.tsx`, `record-suggestions.tsx`).
   - A secondary line on the hit: a 12-px star with the score to one decimal (app locale) and the count.
   - It stays inside the existing option, so it is no extra tab stop.
   - Its `aria-label` reads "4,1 van 5 sterren, 128 beoordelingen".
   - No line at all without ratings: the absence is not a zero.
5. **Performance budget.**
   - At most +10 ms server time per search at p95 under 16 concurrent searches, measured with the `perf16` mode
     (a `--with-ratings` flag on `perf.ts`).
   - The autocomplete debounce stays 250 ms.
6. **Tests.**
   - Database:
     - gates (pilot, off, no identity, a closed community);
     - pooling across vintages;
     - a foreign household gives nothing;
     - 20 hits at most.
   - Domain: the summary at 0, 1 and many ratings.
   - End to end: a hit shows the line, and a hit without ratings shows nothing.

## Size and order

- About one day.
- It ships behind `catalog_ratings`, after activation step 11 (source public), so it never shows anything before
  the wine cards do.
- It needs its own GO and its own independent review (performance and UI).

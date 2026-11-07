# Sprint Z — Koopcheck (purchase check)

"Should I buy this wine, given what I already own and what I like?" Standing in a shop, the person photographs a bottle,
confirms or corrects what was read, and gets advice from the household's real cellar and their own ratings.

## Journey

Sommelier → **Purchase Check / Koopcheck** → `/sommelier/purchase-check`:

1. **The bottle**: take or choose a photo, see it, remove it, or type the wine in instead.
2. **Check the wine**: producer, name, vintage (or non-vintage), kind, country, region, appellation, grapes and an
   optional asking price. Nothing the label does not show is filled in, except from the one CELLR catalogue wine the
   reading exactly is.
3. **The result**: the advice, then three sections: already in your cellar?, similar wines you already own, match
   with your taste. From there the person can correct the wine (compared again, no new photo read) or check another
   wine.

## Architecture

| Step      | Endpoint                                          | AI                                     | Writes                          |
| --------- | ------------------------------------------------- | -------------------------------------- | ------------------------------- |
| Recognise | `POST /api/v1/sommelier/purchase-check/recognize` | 0 (label text named a CELLR wine) or 1 | only the AI usage row of a call |
| Compare   | `POST /api/v1/sommelier/purchase-check/compare`   | none                                   | nothing                         |

- **Recognise** checks and cleans the photo in memory (`images.prepare`: size, type, metadata), never `images.save`. It
  first tries the phone's own OCR text against the database (`findByText` + `recognizeLabelText`, as the scanner
  does). Only otherwise does it make one vision call with the scanner's label prompt, recorded as task
  `purchase_check` (so scan metrics on `label_extraction` stay scans) and spent from the `scans` rate limit and the
  platform AI budget. No bottle image, no catalogue-learning read, no bottle.
- **Compare** reads the active household's cellar (`cellar.inventory()`), the signed-in person's own tastings and
  answers (`taste.evidence()`), the wines' appellation, curated grapes and verified aliases, and the household's wine
  profiles (grapes only when they rest on the exact wine). Everything is read as the person (RLS). It is limited to
  120 comparisons an hour.
- **Engine**: `packages/domain/src/purchase-check.ts`, pure and tested.

## Comparison rules

- **Same wine** only when it is verifiably the same catalogue wine (the cellar wine is it, or is linked to it), or the
  same producer and the same name or verified alias after normalising, with no colour or country contradicting it.
  The vintage then decides _exact_ or _other vintages_; an unknown vintage claims neither.
- **Possibly the same** (never counted as owned): a very similar name (scan score ≥ 0.85), or the same estate and
  colour when the label shows no wine name.
- **Similar**: the same kind of wine is required. Then: same producer +3, same appellation +3 (else same region +2),
  same grapes +3 (else shared grapes +2), same country +1. Comparable from 3 **and** with at least one place or grape
  finding (appellation, region, same or shared grapes): the same producer or country only ever adds to one of those, so
  a different wine of the same estate is not "similar" on its own. Strong from 5. At most three, one card per wine.
- **Taste** (own ratings only, always of the **same kind** as the wine in the shop): this wine's other vintage (1
  rated), the producer (2), appellation, region or grape (3). A producer's whites never decide about its red, and with
  the kind unknown the producer's ratings decide nothing. Liked means a mean of ≥ 3.5★, disliked ≤ 2.5★. A whole kind
  of wine, or what the person said ("mostly red"), is weak and never decides. The fit is positive, mismatch, mixed or
  insufficient.
- **Advice**: mismatch → probably skip. Redundant (≥ 3 bottles of the exact wine, ≥ 6 of the wine, ≥ 6 of strongly
  similar or ≥ 12 of similar wines) → depends if the taste fits, else probably skip. Taste fits → worth considering.
  Anything else → depends on your priorities. The price is shown, never judged. "Adds something new" is only said when
  the wine in the shop and every cellar wine of its kind have a place or grapes known; otherwise the result says no
  comparable wine was found while some wines lack the details to compare.

## Limitations and follow-ups

- Recognition accuracy has only been tested with the programmed fake model and synthetic labels, not with real
  photographs.
- The wine in the shop has no known structure (body, tannin and so on), so the person's scale preferences are not
  compared.
- Similarity uses only region, appellation, producer, grapes and country; a style match between regions is not seen.
- Possible next steps:
  - a follow-up question to the sommelier, with the server's own comparison as context;
  - adding the wine to the wishlist;
  - valuation-backed price context once a reliable source exists.

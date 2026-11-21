# Unified Scan & Bottle Intelligence — code audit

Written before the sprint's changes, against `main` at the merge of PR #91. It records how a scan becomes bottles
today, what is reused, and what the three PRs of this sprint change. Nothing here is a database change.

## 1. The scan flow before this sprint

`apps/web/src/features/scan/scan-screen.tsx` ran a scan in up to three steps after the photo:

| Step          | What it showed                                                                                    | What it cost                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `review`      | The photo and the answer: one wine ("Yes, add bottles" / "Not this one"), candidates, or the form | An extra confirm tap even for a certain match; the vintage was not shown with a new wine         |
| new-wine form | `NewWineForm` (producer, name, kind, country, region) with its own "Continue"                     | A wine was **created** before the bottles were even described; a separate screen                 |
| `details`     | `BottleDetails` (vintage, how many, where, price, more) keyed by `image.id + wine.id`             | "Change" went back a screen, and the form remounted: vintage, quantity and place typed were lost |

A batch photo the app was sure of skipped `review` and opened `details` directly.

## 2. What stays exactly as it was

- **Recognition**: `POST /api/v1/scans` (vision model, on-device OCR `fromText`, photo cache `remembered`, the
  WI-03 resolver and its `reasons`), and `current()`, which matches a batch photo again against the wines as they
  are when it is opened. No prompt, score, threshold or matcher is changed.
- **Saving**: `useAddBottles` → `POST /bottles` with the photo (`imageId`) and the rack spot (`slot`), the extras
  PUT per bottle afterwards, and the `saving` ref that ignores a double tap.
- **Wine identity**: `POST /wines` → `createWine`, which returns the household's existing wine for the same
  producer, name and kind (`findWinesByIdentity` + `pickExistingWine`) instead of a duplicate, and keeps the R-27
  `sourceRecordId` only for a newly created own wine.
- **Back label** (`BackLabelPicker`, `backChoice`, `attachBackLabel`, retries in a series), **wishlist**
  ("Not buying it? Save to wishlist"), **spot** (`PreferredSpot`, conflict → "Another spot"), **batch** (`handled`,
  `next`, `skip`, tray), **same wine** (quantity starts at 2), **errors** (`describe`, unread reasons).

## 3. Findings that shaped the PRs

1. Losing typed input on a wine change came only from the `key` on `BottleDetails`. Keying the review on the photo
   alone keeps everything typed while the wine is changed.
2. The form for a new wine and the bottle form can live on one screen if the wine is created **when "Add" is
   tapped**, not before. Server-side dedupe already prevents a second wine for the same identity; a client ref also
   keeps a retry after a failed add (spot taken, offline) from creating the wine twice.
3. A wine that exists (the household's own or a catalogue wine) must not be edited from a scan: that would rewrite
   a shared record or the household's record without review. A wrong wine is corrected by choosing another one.
4. Bottle art (2D pictures) is keyed by wine, not by bottle: deleting bottles never touches it (see PR 3).
5. The analytics allow-list can take a new event name without a migration (the table checks only its shape).
6. No open PR touched the scan screen (open at the time: Sommelier, 3D and staging work, #94–#106).

## 4. The three PRs

| PR  | What                                         | Depends on |
| --- | -------------------------------------------- | ---------- |
| 1   | Unified scan review (one screen)             | `main`     |
| 2   | Verified database autofill, source per field | PR 1       |
| 3   | 2D photo invite in the review, art reuse     | PR 2       |

## 5. PR 1 — what the review screen is now

`apps/web/src/features/scan/scan-review.tsx`, one screen per photo (single, same wine and batch alike):

- the label photo and what the scan found (found / remembered / from the label text / several candidates / new /
  unreadable);
- **The wine**: the found wine, the candidates to choose from (none preselected when there are several: two cuvées
  of one producer look alike), or the fields for a new wine (`WineFields`, shared with the manual add flow).
  "Not this one", "None of these", "Use … after all" and "Search your wines" (with the catalogue search where it is
  on) all change the wine **on this screen**;
- the bottles: vintage (visible at once, NV included, empty when not read), how many, where (and the rack spot),
  price and the optional purchase details — `BottleDetails`, embedded;
- one primary button, "Add N bottles", and "Save to wishlist" under it.

Nothing is created before "Add": with several candidates and none chosen, or a new wine without its kind, the
review says so beside the wine and nothing is sent.

Measured by `scan_review_completed` (see `docs/METRICS.md`).

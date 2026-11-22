# 2D bottle pictures: reuse and lifetime

How a wine's 2D bottle picture (the "bottle library") is kept, shared and removed. Written for the Unified Scan
sprint (PR 3) after reading the schema and the code; **nothing here changes the database**. The behaviour below is
covered by `apps/web/e2e/bottle-art-reuse.spec.ts` and `apps/web/e2e/scan-photo-invite.spec.ts`.

## Where a picture lives

| Thing                         | Table / place                                                     | Belongs to                       |
| ----------------------------- | ----------------------------------------------------------------- | -------------------------------- |
| A physical bottle             | `public.bottles` (status `in_cellar`, `opened`, `removed`, …)     | a household and a wine vintage   |
| A wine                        | `public.wines` (`canonical` catalogue wine, or a household's own) | the catalogue, or one household  |
| A 2D picture (illustration)   | `public.wine_bottle_art` (+ the file in the `bottle-art` bucket)  | **a wine** (`vintage_id` unused) |
| Photos sent to make a picture | `public.bottle_photo_submissions` + `bottle_photo_images`         | the person who sent them         |

A picture is shown through `public.wine_bottle_art_for(wine_ids)`: the published picture of a catalogue wine (to
everyone), of the household's own wine (to that household only), or, for a household's provisional wine, the picture
of the catalogue wine it is **verifiably** mapped to (`private.bottle_art_mapping`: an admin link or a verified
match, never a similar name).

## Three different deletions

1. **Removing (or opening) a bottle** changes that bottle's status. Nothing else: not the wine, not its vintages, not
   its picture, not the photos sent for it. When the same wine is added again — by this household or any other that
   may see it — its picture is shown at once. There is no endpoint that hard-deletes a bottle row; a bottle never
   owns a picture.
2. **Deleting a wine record** happens only in three places, all existing: merging a household's duplicate wine into
   another (`merge_wines`, 20261015000012), folding a provisional wine into the one it was created from (R-27,
   20261128000050), and an account/household purge (the household's own wines go with it). A wine's pictures go
   with the wine (`on delete cascade`), and each picture's file is queued for removal
   (`wine_bottle_art_file_gone` → `bottle_art_orphans`). A catalogue wine is never deleted by a household.
3. **Unpublishing or replacing an illustration** is an admin action: `admin_publish_bottle_art` takes the earlier
   picture off when a new one is published, `admin_unpublish_bottle_art` takes one off and keeps it, and
   `admin_remove_bottle_art` deletes it (its file is then queued for removal). While a wine has no published picture,
   it shows the drawn bottle (the existing safe fallback).

Sent photos are never shown in the app; they are kept for the CELLR team and deleted with the account of the person
who sent them, as before.

## What the scan's invitation adds (PR 3)

- The invitation is not shown when the wine found already has a published picture (`ScanResult.art`), or when the
  person's status for the wine is `submitted` or `published` (`/bottle-photos/status`), or when they were rewarded
  for it before (`contributionView(...).invite`).
- Photos are chosen and agreed to on the review, but **sent only after the bottles are saved**, to the vintage just
  added, through the existing `/bottle-photos` endpoint (the same rules, points and storage as the wine page). Just
  before sending, the status is read again: a wine that turned out to have a picture, or photos already sent, gets
  nothing. A failed send leaves the bottles added and the photos on the device, with "Try again".
- Nothing is published automatically and no picture is generated: an admin still reviews every contribution.
- A private wine's picture is never shown to another household; it becomes shared only through the existing,
  verified catalogue link, never through a similar name.

## Checked, and left as is

- `wine_bottle_art.vintage_id` cascades on vintage deletion, but vintages are not deleted when bottles are removed
  and no picture uses `vintage_id` today.
- A merge that deletes a household's own wine also deletes that wine's own picture (if it had one). Merges are
  explicit, rare and household-scoped; the target wine keeps its own picture. Changing this would need a migration
  and is outside this sprint.

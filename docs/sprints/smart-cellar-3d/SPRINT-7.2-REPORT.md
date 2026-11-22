# Smart Cellar 3D — Sprint 7.2: Quick Add UX polish

Sprint 7 (PR #118) added 3D Quick Add. Sprint 7.2 makes it easier to find, to understand and to use on a phone. Only
the presentation changes: the same free spots (the domain's eligibility), the same state machine, the same writes
(the Sprint 4 move, the existing add flow), the same API. No migration, no new gate, no new endpoint.

## 1. What changed

| Area                        | Before (sprint 7)                                                                   | Now (sprint 7.2)                                                                                                                                                                                                                                                                                       |
| --------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A. Free spots in the picture | A gold disc in front of each free spot                                              | A see-through placeholder bottle on each free spot, in exactly the pose a bottle put there would have, pale and flat-coloured (it never reads as a real bottle), with a small gold plus. The chosen spot (and, with a mouse, the one under the pointer) is drawn a little larger and warmer. Tapped directly. |
| B. "Add bottle"             | A small button under the picture, next to "Place a bottle"                          | The primary button of the place, at the top, next to what the place holds (`smart-3d-top`). In add mode the same place shows the instruction "Tap an empty spot to add a bottle.", how many empty spots there are, "Choose from a list" and "Cancel", above the picture.                       |
| C. The sheet's words        | "A bottle without a place", "A bottle from another spot", "Add a new bottle by hand" | Title "Add a bottle here" / "Hier een fles toevoegen"; options "Choose a bottle without a spot", "Move an existing bottle", "Scan a new bottle", "Add a new bottle manually"; at the foot "Choose another spot" and **"Cancel"** (new: out of adding altogether). Dutch: see `messages/nl.json` › `quickAdd`. |
| D. Mobile                   | Options were one line each (`whitespace-nowrap`) and could be cut off on a narrow phone; the instruction was under the picture | Options wrap, are full-width rows with a chevron and a hint line (how many bottles wait for a spot); the instruction and Cancel are on the first screen on iPhone SE, iPhone 13 and Pixel 7 (checked by a test).                                                                                     |
| E. "Show empty spots" toggle | —                                                                                   | Not built, on purpose: add mode already shows the empty spots, and a second mode with the same picture but different taps would add a state without adding a use. Can be added later on the same placeholders if a use appears.                                                                     |

Dutch copy (the owner's words): "Fles toevoegen", "Tik op een lege plek om een fles toe te voegen.", "Annuleren",
"Hier een fles toevoegen", "Kies een fles zonder plek", "Verplaats een bestaande fles", "Scan een nieuwe fles",
"Voeg handmatig een nieuwe fles toe", "Kies een andere plek". "Free" became "empty" ("lege plek") everywhere in
Quick Add.

## 2. How the placeholders are drawn

- `buildGhostBottle(lie)` (`storage3d/resources.ts`): the outline of a Bordeaux bottle at a fixed low level of detail
  (16 segments around, every third ring of the profile) and a plus made of two thin boxes, **merged into one
  geometry** with a colour and an alpha per vertex (RGBA). Normals and texture coordinates are dropped (flat colour).
  Under 1,000 triangles (unit test).
- `SpotMarkers` / `GhostGroup` (`storage3d/template-scene.tsx`): one `InstancedMesh` per way of lying (in practice
  one per place), one `MeshBasicMaterial` with vertex colours, see-through, no depth write, front faces only: **one
  draw call for every placeholder of a place**, as the disc was. Each placeholder is posed with the bottles' own
  `poseMatrix`, so it is where a bottle put there will be. Instance colour and a 6 % lift mark the chosen spot (and
  hover with a mouse, never with a finger). Nothing is allocated per frame; nothing moves on its own; demand
  rendering is unchanged.
- The tap target is the placeholder itself (a bottle's silhouette), with the same rules as before: a tap that moved
  more than 8 px or ended a camera drag is not a tap; bottles cannot be taken out while spots are on offer.

## 3. Tests

RESULTS_TESTS

## 4. Performance

RESULTS_PERF

## 5. Screenshots

`screens/7.2-quick-add-*.jpg`: per size (desktop 1280×800, iPhone SE 375×667, iPhone 13 390×844, Pixel 7 412×915)
the place as it is, adding (instruction at the top, placeholders), the sheet of a chosen spot, and the chosen spot
held while a bottle is chosen for it.

## 6. Compatibility and regression

- Unchanged: the placement API and its retry protocol, `AddBottleFlow`, the scan and manual flows and their return to
  3D, the lost-answer checks, the household boundary, the gates (`CELLR_SMART_CELLAR*`), legacy places (list),
  places the picture cannot point into (list), no WebGL (flat picture and list), bottle inspection, advice, depth
  (off).
- "Place a bottle" (Sprint 4) stays where it was, under the picture; "Add bottle" moved to the top.
- Escape out of choosing a spot is now listened for as soon as that phase is committed (a layout effect), so an
  Escape right after the sheet closes is never lost on a slow phone.
- The browser tests now bring the picture on screen before tapping a spot (the instruction above it moved the picture
  down a little; a tap below the fold lands nowhere).

## 7. Release and rollback

No migration, no flag, no data. Shipping is the merge and the deploy; rollback is Vercel Instant Rollback to the
previous deployment (or `CELLR_SMART_CELLAR=read` to stop all placement writes, as for sprint 7).

## 8. Open points

RESULTS_OPEN

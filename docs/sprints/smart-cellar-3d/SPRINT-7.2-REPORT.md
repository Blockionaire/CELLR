# Smart Cellar 3D — Sprint 7.2: Quick Add UX polish

Sprint 7 (PR #118) added 3D Quick Add. Sprint 7.2 makes it easier to find, to understand and to use on a phone. Only
the presentation changes: the same free spots (the domain's eligibility), the same state machine, the same writes
(the Sprint 4 move, the existing add flow), the same API. No migration, no new gate, no new endpoint.

## 1. What changed

| Area                         | Before (sprint 7)                                                                                                              | Now (sprint 7.2)                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Free spots in the picture | A gold disc in front of each free spot                                                                                         | A see-through glass bottle on each free spot, in exactly the pose a bottle put there would have, lit by the scene so it sits in the furniture; **no plus, no icon**: the empty bottle itself is what is tapped. Resting pale; under a mouse warmer; chosen: gold, 5 % larger, with the existing target ring. Only while adding: the normal 3D view draws none. |
| B. "Add bottle"              | A small button under the picture, next to "Place a bottle"                                                                     | The primary button of the place, at the top, next to what the place holds (`smart-3d-top`). In add mode the same place shows the instruction "Tap an empty spot to add a bottle.", how many empty spots there are, "Choose from a list" and "Cancel", above the picture.                                                                                       |
| C. The sheet's words         | "A bottle without a place", "A bottle from another spot", "Add a new bottle by hand"                                           | Title "Add a bottle here" / "Hier een fles toevoegen"; options "Choose a bottle without a spot", "Move an existing bottle", "Scan a new bottle", "Add a new bottle manually"; at the foot "Choose another spot" and **"Cancel"** (new: out of adding altogether). Dutch: see `messages/nl.json` › `quickAdd`.                                                  |
| D. Mobile                    | Options were one line each (`whitespace-nowrap`) and could be cut off on a narrow phone; the instruction was under the picture | Options wrap, are full-width rows with a chevron and a hint line (how many bottles wait for a spot); the instruction and Cancel are on the first screen on iPhone SE, iPhone 13 and Pixel 7 (checked by a test).                                                                                                                                               |
| E. "Show empty spots" toggle | —                                                                                                                              | Not built, on purpose: add mode already shows the empty spots, and a second mode with the same picture but different taps would add a state without adding a use. Can be added later on the same placeholders if a use appears.                                                                                                                                |

Dutch copy (the owner's words): "Fles toevoegen", "Tik op een lege plek om een fles toe te voegen.", "Annuleren",
"Hier een fles toevoegen", "Kies een fles zonder plek", "Verplaats een bestaande fles", "Scan een nieuwe fles",
"Voeg handmatig een nieuwe fles toe", "Kies een andere plek". "Free" became "empty" ("lege plek") everywhere in
Quick Add.

## 2. How the placeholders are drawn

- `buildGhostBottle(radial)` (`storage3d/resources.ts`): the outline of a Bordeaux bottle and nothing else (the plus
  of an earlier draft of this sprint was removed at the owner's request: no boxes, no per-vertex colours, no second
  part). Modelled standing on y = 0 like every bottle, posed with the bottles' own `poseMatrix`. Normals kept (lit),
  texture coordinates dropped.
- **Detail adapts to the number on offer** (`ghostRadial`): 16 segments around up to 120 free spots, 12 up to 400,
  10 beyond, so a large rack's many small placeholders cost less while a small rack's few large ones stay smooth.
- `buildGhostMaterial()`: `MeshStandardMaterial`, white (each placeholder's tone is its instance colour), roughness
  0.18, 30 % opacity, no depth write, so the furniture and the bottles behind stay seen and the placeholder catches
  the scene's own light and reflections.
- `SpotMarkers` (`storage3d/template-scene.tsx`): **one `InstancedMesh`**, one geometry, one material: one draw call
  for every placeholder of a place. Instance colours: resting `#efe7d6`, hovered with a mouse or pen `#ffe6b3` (never
  with a finger), chosen `#e9b955` with a 5 % lift about its own middle, and the existing target ring. Nothing is
  allocated per frame; demand rendering unchanged; geometry and material are disposed when the placeholders go.
- The tap target is the whole placeholder bottle, with the rules as before: a tap that moved more than 8 px or ended a
  camera drag (or a pinch) is not a tap; bottles cannot be taken out while spots are on offer.

## 3. Tests

| Check                                                                                                                 | Result                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`                                                       | green: domain 1495, web 1596 (13 skipped), scripts 274; one existing lint warning (`playwright.webkit.config.ts`)                                                                                                                                                                                                                                                                                                                    |
| Translation keys                                                                                                      | `en.json` and `nl.json`: 2,354 keys each, none missing on either side                                                                                                                                                                                                                                                                                                                                                                |
| Unit tests for the placeholders (`storage3d/resources.test.ts`)                                                       | **no plus**: the geometry is exactly a bottle's lathe (same vertices and triangles), no per-vertex colours, no groups, nothing past the neck or beside the body; posed exactly where a bottle lies, towards the viewer and along a wall; plainer with hundreds on offer, under 400 triangles; see-through material, no depth write, white (tone per instance)                                                                        |
| Browser test "sprint 7.2" (phone and desktop)                                                                         | Add bottle above the picture, on the first screen; after Add: the instruction and Cancel in view and the whole picture on the first screen; **the placeholders drawn are one mesh of bottle-sized glass** (one object, one material, attributes `normal` + `position` only, length 3.4, width ≤ 0.9, < 400 triangles); the sheet's six labels; no option cut off; Cancel (sheet and bar) back to the cellar, **no placeholder left** |
| Browser test "two fingers zoom and choose nothing" (phone)                                                            | a pinch while adding moves the camera closer; no sheet, still choosing, all 10 placeholders still there                                                                                                                                                                                                                                                                                                                              |
| Screenshots test (`SHOTS72=1`)                                                                                        | iPhone SE, iPhone 13, Pixel 7, desktop: instruction, Cancel and three quarters of the picture in view while adding; dark and light furniture; a mouse hover                                                                                                                                                                                                                                                                          |
| Browser regression on the final build (`quick-add`, `smart-cellar-3d`, `placement`, `add-to-spot`; phone and desktop) | **141 passed, 0 failed**, 17 skipped (the other project's half of device-specific tests)                                                                                                                                                                                                                                                                                                                                             |
| Earlier on this sprint, same suites plus `advice`, `visual-placement`, `smart-cellar-3d-old-db`                       | 178 passed, 0 failed                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `e2e/admin-system.spec.ts` (failed on `main`'s CI after #114 and #118)                                                | passes locally on the integrated branch (with #120); see the CI on the PR                                                                                                                                                                                                                                                                                                                                                            |
| Architecture: inventory, impact, `vitest run src/server/system`                                                       | inventory matches `main`; "No structural change against `origin/main`. The register itself changed." (version only); 27 passed; register 1.4.1, reviewed 2026-11-22                                                                                                                                                                                                                                                                  |

All 15 scenarios of the sprint 7 brief stay covered by `e2e/quick-add.spec.ts`: a tap
opens the right sheet; dragging the camera chooses nothing; closing the sheet goes back to choosing; Cancel removes
every placeholder; scan and manual add keep the chosen spot and come back to 3D; a spot taken meanwhile; lost answers
(never a bottle twice); another household; legacy places and places the picture cannot point into (list); no WebGL;
a lost graphics context; the keyboard with reduced motion (axe: no violations); bottle inspection unchanged.

## 4. Performance

The sprint 7 bench (`e2e/perf-quick-add.spec.ts`, `PERF_QUICK=1`): a real household, a `rack_classic` place half
full (every other spot taken, so as many placeholders as bottles), the product's 3D cellar on the preview server, three
rounds of Add bottle → tap a placeholder → sheet → close. **Software rendering (no GPU in this environment): these
numbers compare builds on one machine; they say nothing about a real phone's GPU.**

| Device  | Spots (free) | Draw calls (view → adding) | Triangles (view → adding) | Per placeholder | Idle frames in 3 s | Add → drawn | Tap → sheet (upper bound) | Geometries/textures/programs after 3 rounds | Builds | JS heap MB (before → after) |
| ------- | ------------ | -------------------------- | ------------------------- | --------------- | ------------------ | ----------- | ------------------------- | ------------------------------------------- | ------ | --------------------------- |
| phone   | 80 (40)      | 8 → 9                      | 33,662 → 49,022           | 384             | 0                  | 6 ms        | 361 ms                    | 22/7/32, same every round                   | 1      | 25.3 → 32.1                 |
| phone   | 400 (200)    | 6 → 7                      | 82,188 → 139,788          | 288             | 0                  | 7 ms        | 405 ms                    | 20/4/29, same                               | 1      | 36.0 → 47.2                 |
| phone   | 900 (450)    | 6 → 7                      | 181,268 → 289,268         | 240             | 0                  | 11 ms       | 589 ms                    | 20/4/29, same                               | 1      | 58.3 → 42.0                 |
| desktop | 80 (40)      | 8 → 9                      | 33,662 → 49,022           | 384             | 0                  | 7 ms        | 335 ms                    | 22/7/32, same                               | 1      | 32.9 → 36.4                 |
| desktop | 400 (200)    | 6 → 7                      | 82,188 → 139,788          | 288             | 0                  | 7 ms        | 520 ms                    | 20/4/29, same                               | 1      | 41.7 → 32.4                 |
| desktop | 900 (450)    | 6 → 7                      | 181,268 → 289,268         | 240             | 0                  | 12 ms       | 731 ms                    | 20/4/29, same                               | 1      | 66.1 → 45.5                 |

- **Draw calls:** +1 while adding, however many spots (as sprint 7's discs). **Idle:** nothing drawn while nothing
  moves. **Cleanup:** the same geometries, textures and programs after every round (nothing left behind by entering
  and leaving); the scene is built once; the heap moves with the collector, it does not grow round after round.
- **Triangles:** removing the plus and the adaptive detail took the placeholder from 408 triangles (the draft with the
  plus) to 384 / 288 / 240; a 30×30 rack half full goes to 289k while adding instead of 365k (−21 %). That is still
  more than sprint 7's flat discs (28 each): the price of a bottle silhouette. It only applies while adding, and the
  largest case stays below what the same rack full of real bottles draws.
- Tap → sheet stays within the spread measured for sprint 7 on this machine class (316–680 ms there).

## 5. Screenshots

`screens/7.2-quick-add-{desktop,iphone-se,iphone-13,pixel-7}.jpg`: per size (desktop 1280×800, iPhone SE 375×667,
iPhone 13 390×844, Pixel 7 412×915) the normal 3D view (no placeholders), adding (glass bottles on the empty spots, no
plus, the instruction above the furniture), the Quick Add sheet, and the selected position (gold, ringed) while a
bottle is chosen for it. `screens/7.2-quick-add-furniture.jpg`: the placeholders on dark (ebony) and light (white
lacquer) furniture, a mouse hover, and light furniture on an iPhone SE. The earlier screenshots with a plus are
replaced.

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

- **A real phone.** The bench uses software rendering; real-device GPU performance is not verified. Large racks
  (hundreds of free spots) are the case to look at on a mid-range phone after deploy. Already in place: plainer
  placeholders above 120 and 400 spots (`ghostRadial`).
- **Light furniture.** On white lacquer the placeholders are deliberately faint (pale glass on a pale surface); they
  stay visible through the scene's shading. If the owner wants them stronger there, the opacity is one constant
  (`GHOST_OPACITY`).
- **"Show empty spots" toggle** (E): not built, on purpose (see section 1).
- Merge and deploy are the owner's.

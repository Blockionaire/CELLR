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
| Architecture: inventory, impact, `vitest run src/server/system`                                                       | inventory matches `main`; "No structural change against `origin/main`. The register itself changed." (version only); 27 passed; register 1.4.1 at the time, reviewed 2026-11-22 (1.5.2 after the merge with `main`, 1.5.3 with the completion, section 9)                                                                                                                                                                            |

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

## 9. Completion (after the merge with `main`, 2026-11-23)

PR #121 was merged with the current `main` (b13cf26; the only conflict was the register's version line). This section
is what was revalidated and changed on top of it, and Quick Add on places from before templates.

### 9.1 Revalidated on the merged branch

Before any change, `e2e/quick-add.spec.ts` on a fresh build of the merged branch (71aa349): **37 passed, 0 failed, 5
skipped** (phone + desktop; the skips are the other project's half of device-specific tests and the opt-in
screenshots). Nothing of sprint 7.2 was broken by `main`. What was not asserted before, and now is:

| Requirement                                                               | New assertion (`e2e/quick-add.spec.ts`)                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add bottle above the furniture on an iPhone SE, also as the installed app | "iPhone SE (375 × 667)" and "…, as the installed app": on the first screen, above the picture, **above the tab bar**, for a template place and a place from before templates; the installed app is emulated (`display-mode: standalone`, the status-bar and home-indicator insets given to `pt-safe` / `pb-safe`: Chromium cannot emulate safe areas) |
| Placement mode usable on iPhone SE                                        | same tests: instruction and Cancel in view, a placeholder tapped on that screen opens its sheet, the chosen spot stays marked while a bottle is chosen, **no sideways page scroll** at any step                                                                                                                                                       |
| No plus anywhere                                                          | in the bar and over the picture: no icon (`svg`) and no "+" glyph; the placeholders are one mesh of bottle-shaped glass (both views)                                                                                                                                                                                                                  |
| Scan and manual add return to the selected 3D position                    | after coming back: the place that was chosen is open (`data-unit`), the new bottle is the selected one (`data-selected`) and is drawn there                                                                                                                                                                                                           |
| Entering and leaving leaks nothing                                        | "entering and leaving adding again and again leaves nothing behind (both views)": four rounds each, the same geometries / textures / shader programs after every round, no placeholder left; the bench (`PERF_QUICK=1`) now also fails on a difference between rounds or a rebuilt furniture                                                          |

### 9.2 Words

One term for one thing across the bar, the sheet, the list and the toasts, matching the rest of the cellar: a bottle
that is in no storage is "without a place" (as `placement.unplacedTitle` under the picture says), so the sheet's option
is now **"Choose a bottle without a place"** and its hint "# bottles are waiting for a place" (it said "spot"). Dutch
already said "zonder plek" everywhere; no Dutch change. `en.json` and `nl.json` keep the same keys. Not changed (not
this workstream's files; see the hand-offs): the add flow shows the chosen spot as "Oak rack · Shelf 3 · Position 3"
(`addBottle` / rack wording) where the sheet and the toast say "Oak rack · shelf 3 · spot 3" (`placement.where.spot`).

### 9.3 Quick Add on places from before templates

A place without a template is still drawn by the existing 3D view (`cellar-3d-view.tsx`, `three/scene.tsx`) and is
never given a template (README rules 5, 11, 17). That view puts the bottle of spot (row, col) at a fixed, pinned place
(`slotPosition` / `rackMatrix`, `three/legacy-parity.test.ts`). Where that is exactly the spot the server would use,
its free spots are now drawn in that view and tapped there; the same state machine, bar, list, sheet, panel and writes
(the Sprint 4 move, the exact-spot add) as everywhere else. No new write path, route, setting or migration.

- **Who gets it** (`quick-add/legacy-spots.ts`, `legacyPointing`): a place the domain reads as from before templates
  (`resolved.legacy`: no template, one bottle per cell), read without any fallback, each spot one place
  (`placementMeaning` "single"), its layout a whole rows × cols grid of one-bottle cells, and the two reads agreeing
  (the existing view draws the racks read; the free spots come from the Smart Cellar read: same size, same kind, no
  drawn bottle on a spot called free). That is every kind the app knows (rack, cabinet, shelving, fridge, wall,
  other): the existing view draws all six as the same grid, the kind only chooses materials.
- **Who does not** (the list, and the bar says "This place can't be pointed at in 3D"): a stored kind the app does not
  know, a size or capacity outside the limits, any other fallback; a place without a template holding more than one
  bottle per cell (a pile or bin from before templates: the domain does not say where in the cell a bottle lies, so
  it is not `legacy` and is drawn by the neutral picture); reads that disagree; any spot outside the grid or past
  index 1 (the whole place then, never one spot dropped); no WebGL; a lost graphics context (until drawn again).
  Today's database cannot hold most of these (no template means no index meaning, so one bottle per cell
  (`cellar_locations_template_with_semantics`, `…_capacity_needs_semantics`), and the kind is an enum): the
  refusals are the guard for a read that is not what was stored, unit-tested case by case, and tested in the browser
  on a read that reports the `unknown_kind` fallback.
- **Drawing** (`three/scene.tsx` › `GhostSpots`, `three/ghost-bottle.ts`): one instanced mesh, one geometry, one
  material (one draw call), each placeholder in exactly the matrix a bottle on that spot has; resting pale, warmer under
  a mouse (never a finger), chosen gold and 5 % larger; demand rendering; disposed when the spots go. The geometry and
  material are built in `three/` from the existing view's own bottle profile, the same recipe as
  `storage3d/resources.ts`, so the existing view downloads nothing of the new view (rule 17).
- **Taps**: a tap that moved more than 8 px, or ended a turn, slide or pinch of the rack, is not a tap. While spots are
  on offer no bottle is taken out, and a tap that lands on a bottle is a tap on that bottle (nothing), never on a
  placeholder hidden behind it. Outside adding, a tap on a bottle takes it out exactly as before.
- **Eligibility** is the domain's (`freeSpots`: `cellChoices`, index 1, depth off), the same source as everywhere.

### 9.4 Tests

| Check                                                        | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `quick-add/legacy-spots.test.ts` (new)                       | every one of the six kinds: exactly the domain's free spots, none taken, index 1, each at the middle of the bottle `rackMatrix` draws there; bounds (1 × 1, 30 × 30 corners, empty, full); refusals: a template, more than one per cell, unknown kind, size out of limits, the racks read naming an unknown kind, another size / kind, a drawn bottle on a "free" spot, a spot outside the grid, index 2, a holed layout, capacity 2 cells, arrangement unknown                                                                                                                                                                                                                                                 |
| `three/ghost-bottle.test.ts` (new)                           | only `normal` + `position`, no groups or colours, a bottle's length, no wider than a Bordeaux bottle, < 400 triangles, plainer with more spots; see-through, no depth write, white; posed on its spot, neck towards the viewer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `vitest run src/features/cellar`                             | 21 files, 396 tests passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `e2e/quick-add.spec.ts` on the final build (phone + desktop) | **59 passed, 0 failed, 7 skipped** (device-specific halves and the opt-in screenshots). New: 9 tests for places from before templates (placeholders exactly on the free spots, one mesh, no plus, tap → that spot's sheet, Cancel leaves none; a bottle without a place lands on exactly the tapped spot by one Sprint 4 move with `from: null` and is drawn there; a drag is not a tap and a tap on a bottle takes nothing out; taken meanwhile refused, nothing placed; by hand and back, drawn there; inspection outside adding as before; a read with a fallback → the list; no WebGL → the list and the sheet; a lost context → the list, then the placeholders again), the leak test, two iPhone SE tests |
| Other browser specs on the same build                        | see the completion report of the workstream (`add-to-spot`, `placement`, `smart-cellar-3d`, `smart-cellar-3d-old-db`, `cellar3d`, `three-view`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

### 9.5 Limitations

- **No real device.** Everything above ran in Chromium with software rendering (phone = an emulated iPhone 13 with
  touch, resized to 375 × 667 for the SE tests). Safari/WebKit, a real iPhone's GPU and the real installed app
  (safe areas, `display-mode`) are not verified.
- On a phone the Quick Add sheet is a bottom sheet over the picture: while it is open it covers the lower part of the
  picture, and with it the chosen spot when that spot is low. The sheet names the spot ("Old rack · shelf 3 · spot 4"),
  and once a bottle is being chosen the panel sits under the picture and the chosen placeholder is marked again.
- A place from before templates shows no target ring (the existing view never had one): the chosen spot is the gold,
  larger placeholder.
- After scanning or adding by hand into a place from before templates, the cellar comes back on that place, says where
  the bottle went and draws it there; the existing view has no "selected bottle", so it is not highlighted.

### 9.6 Release and rollback

No migration, no new setting, no data change. Quick Add stays behind the same gates as sprint 7 (the renderer gate
and `CELLR_SMART_CELLAR*`). Shipping is the merge and the deploy (the owner's); rollback is the previous deployment
(or `CELLR_SMART_CELLAR=read`, which stops every placement write, as for sprint 7).

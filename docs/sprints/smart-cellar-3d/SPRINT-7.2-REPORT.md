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
  with a finger), chosen `#e9b955` plus a 5 % lift about its own middle, and the existing target ring. Nothing is
  allocated per frame; demand rendering unchanged; geometry and material are disposed when the placeholders go.
- The tap target is the whole placeholder bottle, with the rules as before: a tap that moved more than 8 px or ended a
  camera drag (or a pinch) is not a tap; bottles cannot be taken out while spots are on offer.

## 3. Tests

| Check                                                                                                                                                                         | Result                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`                                                                                                               | green (web 1593 passed, domain 1495 passed; one existing lint warning in `playwright.webkit.config.ts`)                                                                                                                             |
| New unit tests (`storage3d/resources.test.ts`)                                                                                                                                | 4: one geometry with RGBA per vertex and only two alphas; posed exactly where a bottle lies, the plus in front of the neck; along a wall, the plus on the front; < 1,000 triangles                                                  |
| New browser test "sprint 7.2" (phone and desktop)                                                                                                                             | Add bottle above the picture and on the first screen; after Add, the instruction and Cancel in view and the whole picture on the first screen; the sheet's six labels; no option cut off; Cancel (sheet and bar) back to the cellar |
| Screenshots test (`SHOTS72=1`): iPhone SE, iPhone 13, Pixel 7, desktop                                                                                                        | instruction, Cancel and three quarters of the picture on screen while adding, on every size                                                                                                                                         |
| Browser regression on the final build: `quick-add`, `smart-cellar-3d`, `placement`, `advice`, `visual-placement`, `smart-cellar-3d-old-db`, `add-to-spot` (phone and desktop) | **178 passed, 0 failed**, 22 skipped (the other project's half of device-specific tests, and the opt-in suites `VISUAL_PLACEMENT=1` and `OLD_DB=1`)                                                                                 |
| Architecture: `architecture:inventory`, `architecture:impact`, `vitest run src/server/system`                                                                                 | inventory unchanged; "No structural change against `origin/main`"; 27 passed; register 1.3.2                                                                                                                                        |

All 15 scenarios of the sprint 7 brief stay covered by `e2e/quick-add.spec.ts` (now 18 tests per project), including the
scan and manual return to 3D, a spot taken meanwhile, lost answers (never a bottle twice), another household, legacy
places, no WebGL, a lost graphics context, the keyboard with reduced motion (axe: no violations).

## 4. Performance

The sprint 7 bench (`e2e/perf-quick-add.spec.ts`, `PERF_QUICK=1`): a real household, a `rack_classic` place half
full (every other spot taken, so as many placeholders as bottles), the product's 3D cellar on the preview server, three
rounds of Add bottle → tap a placeholder → sheet → close. Software rendering (no GPU here): these numbers compare
builds on one machine; they are not a phone's.

| Device  | Spots (free) | Draw calls (view → adding) | Triangles (view → adding) | Idle frames in 3 s | Add → placeholders drawn | Tap → sheet (upper bound) | Geometries/textures/programs after 3 rounds | Builds | JS heap MB (before → after) |
| ------- | ------------ | -------------------------- | ------------------------- | ------------------ | ------------------------ | ------------------------- | ------------------------------------------- | ------ | --------------------------- |
| phone   | 80 (40)      | 8 → 9                      | 33,662 → 49,982           | 0                  | 6 ms                     | 334 ms                    | 22/7/32 (unchanged each round)              | 1      | 25.4 → 28.3                 |
| phone   | 400 (200)    | 6 → 7                      | 82,188 → 163,788          | 0                  | 11 ms                    | 385 ms                    | 20/4/29 (unchanged)                         | 1      | 36.2 → 32.6                 |
| phone   | 900 (450)    | 6 → 7                      | 181,268 → 364,868         | 0                  | 19 ms                    | 593 ms                    | 20/4/29 (unchanged)                         | 1      | 60.2 → 63.9                 |
| desktop | 80 (40)      | 8 → 9                      | 33,662 → 49,982           | 0                  | 17 ms                    | 285 ms                    | 22/7/32 (unchanged)                         | 1      | 33.2 → 35.4                 |
| desktop | 400 (200)    | 6 → 7                      | 82,188 → 163,788          | 0                  | 10 ms                    | 471 ms                    | 20/4/29 (unchanged)                         | 1      | 69.5 → 35.5                 |
| desktop | 900 (450)    | 6 → 7                      | 181,268 → 364,868         | 0                  | 25 ms                    | 650 ms                    | 20/4/29 (unchanged)                         | 1      | 59.8 → 57.1                 |

Compared with sprint 7 (gold discs):

- **Draw calls: unchanged** (+1 while adding, however many spots). **Idle: unchanged** (nothing drawn while nothing
  moves). **Leaks: none** (the same geometries, textures and programs after every round; the scene is built once;
  the heap does not grow round after round).
- **Triangles: higher.** A placeholder is 408 triangles (a disc was 28). Adding in a half-full place now costs about
  what the same place full of real bottles costs (the placeholders are as detailed as the real bottles at the lower
  levels of detail): 30×30 half full goes from 181k to 365k triangles while adding. That is the price of a bottle
  silhouette; it only applies while adding, and the largest case is within what a full place already draws. Should a
  real device show a problem on very large places, the placeholder's ring count can be halved without changing
  anything else (one constant, `GHOST_RADIAL`).
- Tap → sheet is within the spread of sprint 7 (316–680 ms there, 285–650 ms here, same machine class).

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

- **A real phone.** The bench uses software rendering; the triangle cost of the placeholders on very large places
  (30×30) is best confirmed on a real mid-range phone after deploy. The fallback is one constant (`GHOST_RADIAL`).
- **"Show empty spots" toggle** (E) not built, on purpose (see section 1).
- **Pre-existing, not this sprint:** `e2e/admin-system.spec.ts:67` fails on `main` too (from PR #114); public docs
  that still carry production observations are a separate clean-up.
- Merge and deploy are the owner's.

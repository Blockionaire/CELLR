# Smart Cellar 3D — Sprint 7: 3D Quick Add and interactive placement

In the 3D cellar, **Add bottle** marks every free spot of the place in the picture. A tap on one opens what can go
there:

- a bottle without a place;
- a bottle from another spot (any place of the household, searchable);
- a new bottle, scanned or added by hand. These are the existing flows, which keep the spot and come back to the 3D
  cellar.

Every write is the existing one: the Sprint 4 move (one conditional statement), or the existing add with an exact
spot. Nothing new is written in the database: **no migration, no new route, no new setting**.

**Verdict (§12): GO for production**, behind the existing gates, with the owner's phone check right after the deploy
and the rollback of §11 ready.

## 1. What a person does

1. Cellar → 3D → **Add bottle**. The free spots of the place on screen get a gold disc. Bottles stay visible, the
   camera still turns and zooms, and a drag is never a tap. While choosing, no bottle is taken out by a tap.
2. A tap on a disc opens the sheet with the place and the spot ("Walnut rack · shelf 4 · spot 3") and four choices:
   - **A bottle without a place** (with how many are waiting): the Sprint 4 panel opens with that spot chosen; pick
     the bottle and confirm.
   - **A bottle from another spot**: the same panel, listing every placed bottle of the household with where it is
     now, searchable by wine, producer, vintage or place.
   - **Scan a new bottle**: the scanner with the spot (`/scan?place=…&row=…&col=…&from=3d`).
   - **Add a new bottle by hand**: the add flow with the spot.
   - Or **Choose another spot**.
3. The chosen spot stays marked in the picture while the bottle is chosen, and follows a change of spot in the panel.
4. After a move: the toast (with **Undo** where it is safe), the bottle drawn on its spot from the server's own answer,
   and chosen. After a scan or manual add: **See it in the 3D cellar** goes back to that place, which shows the new
   bottle and says where it went. The bottle is named only once the server's own read of the place has it there.
5. Escape or **Done** stops choosing. Escape or ✕ in the sheet goes back to choosing.

Where the picture cannot point at a spot exactly, the **accessible 2D spot list** (Sprint 4's picker, free spots
only) is used instead. That covers bins of several bottles, a place whose arrangement is unknown, a place from before
templates, no WebGL, and a lost graphics context. For the keyboard and screen readers the list is always one button
away (**Choose from a list**).

## 2. Reused and new

| Reused, unchanged in behaviour                                                                                       | New                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cellChoices` / `placementProblem` (domain eligibility); `poseOf` / `pileOf` (the pose of a bottle on a spot)        | `quick-add/spots.ts`: free spots (index 1, depth off) and their markers; `null` when the picture has no exact place for a spot                                                        |
| Sprint 4 move API, `PlacementPanel` (reconciliation of a lost answer, conflict catch-up, Undo), `SpotPicker`         | `quick-add/machine.ts`: the explicit state machine (§3)                                                                                                                               |
| `TemplateScene` instancing, demand rendering, quality steps, the tap-vs-drag rule (`TAP_SLOP`, `dragged`)            | `SpotMarkers` in `template-scene.tsx`: one instanced mesh of discs, one draw call                                                                                                     |
| `AddBottleFlow`, `ScanScreen`, `BottleDetails` with the exact-spot add (`slot`, refused when taken: never elsewhere) | `quick-add/quick-add-ui.tsx`: the placing bar, the free-spot list, the sheet (existing `Sheet`, `Button`, `SpotPicker`)                                                               |
| `spotFromParams` (only the household's own places), `useRacks`, `useSmartPlacements`, `useRefreshCellar`             | `PlacementPanel`: `spotFirst`, `candidates: "placed"` with search, an in-flight guard, `onPhase`. `BottleDetails`: the lost-answer check (§4). `add-spot.ts`: `from=3d`, `back3dHref` |

## 3. Interaction state machine

`view → placing → spot → action → saving → success`, plus `conflict` (recoverable), `leaving` (to Scan or the add
flow) and `cancelled`. A pure reducer with unit tests:

- One write at a time: `submit` only from `action` or `conflict`.
- Nothing is picked, chosen or cancelled while saving.
- `success` only from `saving`, i.e. after the server, or a fresh read after a lost answer, confirmed the write.
- Spots are picked only while offered.

The panel's own in-flight guard covers two taps that land before the next render. The browser test double-clicks
Confirm and counts one request.

## 4. Security and data integrity

- **Authorization unchanged.** Every write goes through the existing routes: the session, the household from the
  server, RLS. Another household's bottle or place answers 404, tested.
- **The URL is never trusted:**
  - the spot in `/cellar/add` and `/scan` is used only when it is one of the household's own places (server-side);
  - `from=3d` is a fixed value, never a URL;
  - the way back (`/cellar?unit=…&added=…`) is only a hint: the place opens only when the server lists it, the bottle
    is named only when the server's fresh read of that place has it, and the hint leaves the address bar at once.
- **A spot taken meanwhile is refused, never swapped:**
  - the move is one conditional statement (Sprint 4); the add with an exact spot answers "That spot was just taken";
  - the panel says so and reads the bottle again, and nothing is placed elsewhere; tested for both paths.
- **Lost answers:**
  - a move is decided by a fresh read (Sprint 4's reconciliation): "now at …" without Undo, or "didn't move";
  - **new:** a create with an exact spot whose answer is lost is **never repeated blindly**. Saving again is not
    offered; **Check the spot** reads who is on it. A bottle of this wine and vintage means it was saved: nothing more
    is saved and the cellar refreshes. An empty spot means it was not, and saving is offered again. Another bottle
    means the spot went to someone else.
- **Concurrent placing:** the database's whole-spot unique index decides (Sprint 1B); the concurrency suite
  (`db-placement-concurrency.sh`: 6 sessions for one free spot, races of moves, swaps and resizes) passes unchanged.
- **Depth stays off.** Only index 1 is ever offered, and the domain refuses anything else.

## 5. Tests

| Check                                                                                                                                                                           | Result                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`, `pnpm typecheck`, `pnpm migrations:check`                                                                                                                  | passed                                                                                                                      |
| `pnpm lint`                                                                                                                                                                     | passed (the one warning that is on `main` too)                                                                              |
| `pnpm test`                                                                                                                                                                     | web 1,589 (+13 skipped), domain 1,495, scripts 274: passed; new `quick-add/spots.test.ts` (12) and `machine.test.ts` (8)    |
| `scripts/db-test.sh`, `scripts/db-placement-concurrency.sh`                                                                                                                     | 1,681 passed; concurrency safe                                                                                              |
| `scripts/check-bundle-secrets.sh`, production build                                                                                                                             | passed                                                                                                                      |
| Architecture register (`CLAUDE.md`)                                                                                                                                             | inventory regenerated (unchanged), `architecture:impact`: **no structural change**, register tests 27 passed, version 1.3.1 |
| **`e2e/quick-add.spec.ts`**, desktop and phone                                                                                                                                  | **34 / 34 passed** (17 tests × 2)                                                                                           |
| Regression (`placement`, `advice`, `rack-builder`, `smart-cellar-3d` (+ old DB), `smart-cellar-api`, `cellar3d`, `racks`, `flows`, `smoke`, `drag-swap`, `add-to-spot`, `scan`) | **386 passed**, 5 failed, 51 skipped (the other project's): all 5 in tests that fail the same way on `main` (§7)            |

`quick-add.spec.ts` covers the brief's list:

1. **Spot derivation:** exactly the free spots (unit-tested on every template, and in the browser against the
   database).
2. **Exact selection:** a tap on a disc opens that spot's sheet.
3. **A drag is no tap:** the camera turns, nothing is chosen, and no bottle is taken out.
4. **A bottle without a place** lands on exactly the tapped spot, with Undo.
5. **A bottle from another place:** searched, one request from the exact source to the exact destination, source
   freed.
6. **Scan and by hand:** the spot travels to the flow and back; the bottle lands on it and is shown in 3D.
7. **Taken before the save:** for the move and for the manual add; nothing elsewhere, no bottle added.
8. **Duplicate tap and lost answers:** a double tap sends one move. A lost answer to a move is decided by a fresh read.
   A lost answer to a create is checked and never saved twice, and a request that never arrived can be saved again.
9. **Other household:** nothing of theirs offered; their bottle can't be moved onto my spot (404); a URL hint to their
   place is ignored; their place gives no spot in the add flow.
10. **Cache and refresh:** the new bottle is drawn without a reload, with the server's answer as the source.
11. **Persistence:** after a page reload the bottle is still on its spot.
12. **Fallbacks:** a place from before templates, an unknown arrangement, no WebGL.
13. **Lost graphics context while choosing:** said, the list stands in, the markers come back.
14. **Keyboard and reduced motion:** in, a spot from the list, the sheet, Escape out, no axe violations.
15. **No regression:** taking a bottle out as before, plus the regression run above.

## 6. Browser and mobile acceptance

Headless Chromium, software rendering, real local stack.

| Size                     | Screens                                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop 1440 × 900       | [`screens/7-quick-add-desktop.jpg`](./screens/7-quick-add-desktop.jpg): 3D view, free spots marked, the sheet, the chosen spot marked |
| iPhone SE 375 × 667 (2×) | [`screens/7-quick-add-iphone-se.jpg`](./screens/7-quick-add-iphone-se.jpg): the same, plus the panel                                  |
| iPhone 13 390 × 844 (2×) | [`screens/7-quick-add-iphone-13.jpg`](./screens/7-quick-add-iphone-13.jpg)                                                            |
| Pixel 7 412 × 915 (2×)   | [`screens/7-quick-add-pixel-7.jpg`](./screens/7-quick-add-pixel-7.jpg)                                                                |

Looked at on purpose:

- **Mobile:**
  - the sheet is a bottom sheet with 56 px rows;
  - the placing bar sits under the picture, above the tab bar;
  - the hint under the picture says "Tap a free spot" while choosing;
  - the page does not scroll sideways (the spot list scrolls inside itself for wide racks).
- **Bottle inspection:** off while choosing (tested); unchanged otherwise (tested, plus the regression suites).
- **The scan return flow:** tested end to end with the local fake model. Also tested: the toast and the bottle drawn
  in 3D after coming back, and nothing claimed for a place or bottle the server doesn't confirm.
- **Concurrent placing:** §4.

**Not done:** a real iPhone or Android device.

## 7. Regression findings (compared with the current `main`)

| Test                                       | This branch                                              | Current `main` (`835a68c`), same machine |
| ------------------------------------------ | -------------------------------------------------------- | ---------------------------------------- |
| `cellar3d.spec.ts:171` (desktop and phone) | fails every run                                          | fails (desktop and phone)                |
| `cellar3d.spec.ts:293`                     | fails intermittently                                     | fails (desktop)                          |
| `racks.spec.ts:371` (contrast, dark/light) | fails intermittently                                     | fails (desktop)                          |
| `smart-cellar-3d.spec.ts:466` (phone)      | failed once in the full run, then passed 4/4 when re-run | passed                                   |

The first three are in the existing 3D view and the racks view, which Sprint 7 does not change. They fail on `main`
the same way, and have been reported since sprints 2B.3/4. The fourth is the known load-time flake. **No regression
found.**

## 8. Performance

`e2e/perf-quick-add.spec.ts` (`PERF_QUICK=1`):

- a rack half full (a checkerboard: as many free spots as bottles, the most markers for its size);
- three rounds of Add bottle → tap a spot → sheet → close;
- headless Chromium with SwiftShader **software rendering**, 4 cores. These numbers compare builds on one machine;
  **no frame rate on a real device is claimed**.

| Spots (free), desktop / phone                                       | 80 (40)                   | 400 (200)                 | 900 (450)                 |
| ------------------------------------------------------------------- | ------------------------- | ------------------------- | ------------------------- |
| Draw calls at rest → with markers                                   | 8 → 9 / 8 → 9             | 6 → 7 / 6 → 7             | 6 → 7 / 6 → 7             |
| Triangles added                                                     | +1,120 (28 per disc)      | +5,600                    | +12,600                   |
| Pictures in 3 s at rest, markers shown                              | 0 / 0                     | 0 / 0                     | 0 / 0                     |
| Add bottle → first picture with every marker                        | 9 / 10 ms                 | 12 / 10 ms                | 10 / 10 ms                |
| Tap → sheet visible (incl. Playwright's own wait)                   | 316 / 393 ms              | 519 / 378 ms              | 680 / 562 ms              |
| Geometries / textures / programs after each of 3 enter/close rounds | 22/7/32 ×3                | 20/4/29 ×3                | 20/4/29 ×3                |
| Furniture built                                                     | 1 → 1                     | 1 → 1                     | 1 → 1                     |
| JS heap before → after 3 rounds (MB), desktop / phone               | 34.0 → 35.3 / 25.3 → 39.5 | 56.8 → 33.8 / 53.0 → 37.4 | 65.2 → 61.4 / 64.1 → 46.6 |

- **One draw call for all markers**, at every size: one instanced mesh, one shared geometry, one material. The first
  run measured two: three.js draws a transparent two-sided material in two passes. `forceSinglePass` fixed it, and
  the disc can still be tapped from either side.
- One shader program is added while markers are shown and released after. The counts are identical after every
  round, so nothing accumulates.
- The jump in programs on first use (8 → 29–32) is the existing warm-up of the bottle inspection (sprint 2B.3: 31 at
  40 bottles), not the markers.
- Nothing is drawn at rest. No per-frame allocation: the marker matrices are written once when the spots change. The
  level-of-detail steps are unchanged.
- The heap does not grow across rounds, with one exception: the phone at 80 spots ended 14 MB higher after three
  rounds, in a single measurement, while the GPU resources stayed constant. Most likely garbage-collection timing;
  worth a look in the device check.

## 9. Bugs found and fixed during the sprint

1. Without WebGL, starting Add bottle hid the flat picture (its condition knew only "move"). Fixed; tested.
2. Escape in the sheet closed all of Quick Add, because the sheet's Escape and the page's Escape both fired. Now the
   sheet goes back to the spots, and a second Escape leaves.
3. Markers cost two draw calls (§8). Fixed.
4. The chosen spot was hard to see behind the panel: Sprint 4's thin ring, dark on dark wood. The chosen spot now
   keeps its gold disc and follows a change of spot in the panel; tested.
5. The hint under the picture said "tap a bottle" while choosing a spot. Fixed.

## 10. Remaining limitations

- **Real devices not tested** (iPhone Safari, Android Chrome): tap accuracy on small spots, the sheet over the
  keyboard, heat and battery. To check on the owner's phone after the deploy (§11).
- **Tap targets shrink with the place:** each disc is a bottle's end. On a 30 × 30 rack on a phone that is small; the
  spot list (**Choose from a list**) is the precise way there.
- **The spot list scrolls sideways inside the panel** for wide racks on a phone (Sprint 4's picker); the page itself
  does not.
- **Several bottles at once:** only the first goes on the chosen spot; the others take the next free spots, and the
  add flow says so ("The first bottle goes here; the other 2 take the next free spots").
- **Bins of several bottles and unknown arrangements** are chosen from the list only (no exact place in the picture).
  Depth stays off.
- **The lost-create check** recognises "saved" by the wine and vintage now on the spot. Someone else adding the same
  wine and vintage to that exact spot in the same seconds would be taken for the person's own save: then nothing is
  added twice, which is the safe side.
- **"A bottle from another spot"** lists places from the racks read model (index 1 assumed while depth is off). A
  stale index would be refused by the server and read again (Sprint 4), never moved wrongly.
- Quick Add appears only where placement writes (`canWrite`): a read-only deployment shows the 3D view without it.

## 11. Release and rollback

- **No new setting.** Quick Add rides on the existing Smart Cellar gates: it shows where `CELLR_SMART_CELLAR_PLACEMENT`
  is open and writes are allowed (`CELLR_SMART_CELLAR=write`, and in production the authorized release). Where Smart
  Cellar is already switched on in production, merging and deploying this PR makes Quick Add live for every user.
- **No migration**: nothing to run in the database.
- **Release:**
  1. merge the PR (CI green);
  2. the production deployment builds from `main`;
  3. on the phone, in the installed PWA: Cellar → 3D → Add bottle → tap a spot → "A bottle without a place" → confirm
     → the bottle on its spot → Undo;
  4. a tap on a spot → "Add a new bottle by hand" → save → **See it in the 3D cellar** shows it;
  5. close and reopen the app: still there;
  6. a camera drag across the discs chooses nothing;
  7. no new errors in the runtime logs.
- **Rollback**, fastest first:
  - **Vercel Instant Rollback** to the previous production deployment (the previous app, no database change);
  - `CELLR_SMART_CELLAR=read` and redeploy: the 3D view stays and every write, Quick Add included, is closed;
  - `CELLR_SMART_CELLAR=off` and redeploy: all of Smart Cellar off, the existing views.
- Bottles placed or added meanwhile stay where they are: ordinary rows, shown by every view. There is no database
  change to undo.

## 12. GO / NO-GO

**GO for production.** No blocking issue found:

- authorization, RLS and the atomic writes are the existing ones;
- conflicts and lost answers never place a bottle elsewhere or add it twice;
- no regression against `main`;
- the measured cost is one draw call and nothing at rest.

Two conditions:

1. merge only with CI green on the final commit;
2. the owner's phone check of §11 right after the deploy. If it shows a problem, roll back with §11; nothing in the
   database has to be undone.

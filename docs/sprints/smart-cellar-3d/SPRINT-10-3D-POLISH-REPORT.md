# Smart Cellar 3D — Sprint 10: final 3D polish

Smart Cellar 3D is live. This sprint audits the renderer (`features/cellar/storage3d/**`) for what a person notices
and for reliability, fixes what was real, and leaves the look as it is (ADR-004). No migration, no setting, no new
dependency, no API change for the screens that mount the view (only internal additions, listed in §4).

**Every number here was measured in headless Chromium with SwiftShader software rendering on a shared 4-core
container.** Such numbers compare one build with another on one machine; they say nothing about a phone's frame rate,
and none is claimed (rule 15). What needs a real phone is in §8.

## 1. Method

- **Before** = the base commit `71aa349` (main + Sprint 7.2), built in a separate checkout; **after** = this branch;
  both served by `next start` as a Vercel preview (the template gallery `/design/cellar-3d`), both measured by the same
  script on the same machine, in desktop (1280 × 800 @1), iPhone SE (375 × 667 @2), iPhone 13 (390 × 844 @3) and
  Pixel 7 (412 × 915 @2.625) emulation.
- Counted from the view's own readout (`data-*` on its canvas, written from `gl.info` after each frame): draw calls,
  triangles, geometries, textures, shader programs, first frame after the context was made, frames drawn in 2 s at
  rest; the page's own `layout-shift` entries; the screen distance between two neighbouring bottles; the cost of a
  pointer move over the picture (R3F hit-tests on every move); five forced context losses (`WEBGL_lose_context`) and
  eight rounds of switching templates, with geometries/textures/programs/canvases/heap after each.
- Pure questions (where the camera can go, contrast of the rings against every finish) were answered by computing them
  for every template at its smallest, default and largest size, and are now unit tests.

## 2. Audit: what was real, what was not

| Candidate (owner's list)                  | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Verdict                                    |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Touch targets on dense racks              | Neighbouring spots on a 30 × 30 rack are **7.6 px apart on an iPhone SE**, 9.3 px on an iPhone 13, 9.9 px on a Pixel 7 (13.5 px on desktop). A fingertip covers several; which one a tap takes is chance. A bigger invisible hit proxy cannot help: a placeholder already covers 88 % of its cell (bottle 0.92 in a pitch of 1.04), so a proxy could only add the corners.                                                                                                        | **real → fixed** (aim help, §3.3)          |
| Camera ends inside furniture              | At the closest zoom (a quarter of the start distance) the camera stood **past the front of the place in 29 of 168 cases** (14 templates × smallest/default/largest × 4 screen shapes; 37 within the 0.3 clearance), on a desktop every rack, the open shelves, the closed cabinet, the single cooler, cubes and crates at their smallest, and the closed cabinet at its default size; turned to the side or below, further cases reached into the box (the unit test finds them). | **real → fixed** (§3.1)                    |
| Selected-position feedback                | The wine-red target ring (`#8c2b3a`) is under 3:1 (WCAG) against **oak, walnut (1.2:1), mahogany, ebony, black, graphite, brass, sage, navy and the dark studio**; the gold chosen-bottle ring against **oak, pine (1.05:1), stainless, brass, white lacquer, sage and the light studio**. The two rings differ by hue only (red vs gold): not safe for colour-blind people.                                                                                                      | **real → fixed** (§3.2)                    |
| WebGL loss and recovery                   | Five forced losses per run (desktop and iPhone SE): the notice each time, the flat picture complete meanwhile, one canvas, **identical geometries/textures/programs after every recovery** (27/7/11), heap flat (15–16 MB). The host remounts the view; nothing leaks. No test held the repetition.                                                                                                                                                                               | **not reproduced**; repeat test added      |
| Resource leaks across switches            | Eight rounds of four templates: 28/10/32 every round, heap 16–18 MB. Already held by `storage-gallery` ("changing template gives back…").                                                                                                                                                                                                                                                                                                                                         | not reproduced                             |
| Large racks (900 spots)                   | 12 draw calls, 356k triangles full / 188k half full at the `low` step, 25 geometries, 4 textures, 8 programs, first frame 165–210 ms after the context, **0 frames at rest**; a pointer move over the picture costs 0.3–0.8 ms of hit-testing (900 bottles; a node bench: 0.35 ms per ray for bottles, 0.16 ms for 450 placeholders).                                                                                                                                             | fine; nothing to gain that would show      |
| Ghost placeholders                        | One draw call, 240 triangles each at 450 on offer, no depth write, no per-frame allocation (Sprint 7.2's own bench). Pale on white lacquer by design (Sprint 7.2 §8).                                                                                                                                                                                                                                                                                                             | fine; unchanged                            |
| DPR / antialiasing                        | DPR capped by step (2 / 1.5 / 1.25; seen: 1.25 at 900 bottles, 1.5 at 24 on the phones); MSAA on. Nothing to change without a device.                                                                                                                                                                                                                                                                                                                                             | fine                                       |
| Layout shift (storage3d's own containers) | Gallery load: CLS 0 on the phones, ≤ 0.0011 on desktop (text, not the stage). The view fills its host's box; the panel below the picture appears only on a tap (input-driven). The product's page-level skeleton does shift (handoff, §7).                                                                                                                                                                                                                                        | not reproduced in storage3d; handoff for A |
| Reduced motion                            | Damping off, no fly-throughs, showcase instant (existing). Found: changing the setting while the view is up rebuilt the controls and **put the camera back to its start**.                                                                                                                                                                                                                                                                                                        | small, real → fixed                        |
| Lighting/materials, wall pegs             | Looked at the pegs and rails on both studios (screens in §5). The brass back board of pegs is still the heavy gold slab Sprint 6 noted (#1); changing a part's material is a look decision for the owner, not a polish (rule 13 untouched).                                                                                                                                                                                                                                       | judgement; not changed, proposal in §6     |

## 3. What changed

### 3.1 The camera stays out of the furniture

- `frameFor` returns `closest`: a quarter of the start distance as before, but never past the front of the place plus a
  0.3 clearance (`CAMERA_CLEARANCE`, beyond the 0.1 near plane). For large places it is exactly what it was.
- `keepOutside(bounds, camera, target, farthest, out)` (pure, allocation-free): if the camera is inside the place's box
  (the furniture and every spot, grown by the clearance), it is moved straight back along its line of sight to the
  box's surface — direction kept, never past the farthest zoom. `Rig` runs it after every controls update.
- Unit tests: every template × size × four screen shapes, straight on; every allowed angle at the closest zoom (some
  did reach in; after: none); untouched when outside. Browser test (desktop): wheel in 14 times straight on and at a
  slant on a 1 × 1 rack, the default closed cabinet and a 1 × 1 crate: the camera is outside each time.

### 3.2 Rings that are seen on every finish, and told apart without colour

- The target ring (where a bottle is about to go) and the chosen-bottle ring each get a **keyline of the opposite
  lightness**: wine red in a pale keyline, gold in a dark keyline (`RING`, `buildKeylineRing`, `buildRingPaint` in
  `resources.ts`). One merged geometry with vertex colours, one material that writes no depth (the core's triangles come
  last, so it is drawn over its keyline from every side, also edge-on round a bottle on a wall): **one draw call each,
  as before**. The bottle showcase prewarms the new paint, so taking a bottle out still compiles no shader.
- Unit tests: the cores alone were under 3:1 on some finish (both); with the keyline each ring is ≥ 3:1 against every
  tone of both looks, every tone shaded as deep in a compartment, and both studios; the two differ in lightness
  pattern (pale-round-dark vs dark-round-light), not only in hue.

### 3.3 Aim help for a finger on a dense rack

- A **touch** tap on a free spot whose nearest other target (spot or bottle) is closer than `MIN_AIM_PX` = 24 CSS px on
  the screen chooses nothing; the view glides (260 ms; at once under reduced motion) closer round that spot until the
  targets are about `AIM_PX` = 44 px apart, as far as the zoom allows. The next tap is clear and chooses. Where the
  camera cannot come closer the tap is taken, so no one is stuck; the spot list stays the precise way.
- Mouse and pen taps are taken at their word. A spot with room round it (the default 5 × 8 rack: 25–33 px apart on
  the phones measured in the gallery's 286–378 px wide stage; the product's stage is wider, about 335 px on an
  iPhone SE) is chosen at the first tap, exactly as before. The iPhone SE with a default rack is the closest case to
  the line: if the device check finds a first-tap zoom there annoying, `MIN_AIM_PX` is one constant.
- The gap is measured once, at the tap, from the camera as it is (one pass over the targets); nothing per frame.
- `aimZoom(gap, distance, closest)` is pure and unit-tested; `e2e/storage-touch-aim.spec.ts` (phone): a 30 × 30 rack,
  the first tap zooms and chooses nothing (897 spots still on offer, no sheet), the camera is not inside the furniture,
  the second tap opens the sheet for exactly that spot.

### 3.4 Smaller fixes

- A change of `prefers-reduced-motion` while the view is up only switches damping; it no longer rebuilds the controls
  and throws the camera back to its start.
- `webglcontextrestored` asks for a new picture (`invalidate`): a host that keeps the view mounted through a loss
  (none does today) would otherwise show a blank canvas until the next touch. The canvas is marked
  `data-context-lost` meanwhile.

## 4. API additions (all additive; nothing changed or removed)

- `model.ts`: `Framing.closest` (new field of `frameFor`'s result), `CAMERA_CLEARANCE`, `keepOutside`, `MIN_AIM_PX`,
  `AIM_PX`, `aimZoom`.
- `resources.ts`: `RING`, `buildKeylineRing`, `buildRingPaint`; `BottleKit` gains `targetRing`, `markerRing`,
  `ringPaint` (the old `ring`, `marker`, `target` are still built and owned).
- Test readout (`debug` only): `__cellrStorage3d.camera()` → `{ position, inside }`.
- `TemplateSceneProps` / `InspectableStorageProps`: **unchanged**. Behaviour change inside the existing `spots` /
  `onSpot` contract: a touch tap on a too-dense spot does not call `onSpot` (it zooms).

## 5. Measurements, before → after

Same machine, same script, base build vs this branch (gallery, `quality=auto`). Software rendering: compare columns,
promise nothing.

| Device    | Place         | Step     | Draw calls | Triangles         | Geom / tex / programs | First frame after context (ms) | Frames in 2 s at rest | Pointer-move hit test (ms, mean) | CLS             |
| --------- | ------------- | -------- | ---------- | ----------------- | --------------------- | ------------------------------ | --------------------- | -------------------------------- | --------------- |
| desktop   | 30 × 30 full  | low      | 12 → 12    | 355,868 → 355,868 | 25/4/8 → same         | 208 → 174                      | 0 → 0                 | 0.38 → 0.36                      | 0.0001 → 0.0001 |
| desktop   | 30 × 30 half  | low      | 12 → 12    | 188,252 → same    | 25/4/8 → same         | 165 → 163                      | 0 → 0                 | 0.33 → 0.32                      | 0.0001 → 0.0001 |
| desktop   | 5 × 8 default | balanced | 16 → 16    | 20,130 → same     | 27/7/11 → same        | 302 → 279                      | 0 → 0                 | 0.44 → 0.35                      | 0.0011 → 0.0001 |
| desktop   | wall pegs     | balanced | 16 → 16    | 34,018 → same     | 27/6/12 → same        | 355 → 416                      | 0 → 0                 | 0.20 → 0.15                      | 0.0001 → 0.0001 |
| iPhone SE | 30 × 30 full  | low      | 12 → 12    | 355,868 → same    | 25/4/8 → same         | 182 → 162                      | 0 → 0                 | 0.46 → 0.38                      | 0 → 0           |
| iPhone SE | 5 × 8 default | balanced | 16 → 16    | 20,130 → same     | 27/7/11 → same        | 339 → 316                      | 0 → 0                 | 0.32 → 0.20                      | 0 → 0           |
| iPhone 13 | 30 × 30 full  | low      | 12 → 12    | 355,868 → same    | 25/4/8 → same         | 168 → 170                      | 0 → 0                 | 0.40 → 0.39                      | 0 → 0           |
| iPhone 13 | 5 × 8 default | balanced | 16 → 16    | 20,130 → same     | 27/7/11 → same        | 393 → 347                      | 0 → 0                 | 0.39 → 0.29                      | 0 → 0           |
| Pixel 7   | 30 × 30 full  | low      | 12 → 12    | 355,868 → same    | 25/4/8 → same         | 165 → 156                      | 0 → 0                 | 0.80 → 0.37                      | 0 → 0           |
| Pixel 7   | 5 × 8 default | balanced | 16 → 16    | 20,130 → same     | 27/7/11 → same        | 403 → 268                      | 0 → 0                 | 0.26 → 0.22                      | 0 → 0           |

- **Cost of the changes: none measurable.** Draw calls, triangles and held resources are identical in every case (the
  rings replace the old ones one for one and only exist while something is chosen). First-frame and hit-test times
  move both ways by tens of percent between single runs on a shared machine: that is noise, not an effect, and is
  not claimed as one.
- Screen distance between neighbouring spots (unchanged by design, the input to §3.3): 30 × 30 — desktop 13.5 px,
  iPhone SE 7.6, iPhone 13 9.3, Pixel 7 9.9; default 5 × 8 — 63.5 / 25.5 / 31.3 / 33.0 px.
- Context loss, 6 forced losses each (desktop, iPhone SE): before and after, every recovery holds 27 geometries,
  7 textures, 11 programs, 1 canvas. JS heap after GC creeps ~0.3 MB a cycle (15.2 → 16.5 MB before, 15.5 → 17.5 MB
  after) in both builds; the GPU counts do not move. Probably collector timing; worth a look on a device (row 5 of §8).
- Template switching, 8 rounds of 4 templates: 28/10/32 every round, before and after; heap 16–18 MB.
- Camera inside the furniture at the closest zoom, straight on: 29 of 168 cases → 0 (unit test). Rings at ≥ 3:1 on
  every finish: target ring under 3:1 on 10 of 14 base surfaces → none; marker ring on 7 of 14 → none (unit test). Picture:
  [`screens/10-rings-before-after.jpg`](./screens/10-rings-before-after.jpg) (top: white lacquer, bottom: ebony in the
  dark studio; left before, right after).

## 6. Not done, on purpose

- **No invisible hit proxy / nearest-spot snapping**: a placeholder covers 88 % of its cell already; snapping a tap
  that missed every target to the nearest spot would choose spots people did not clearly aim at.
- **No change of the pegs' back board** (Sprint 6 UX #1): a neutral or wood board behind brass pegs is a look decision.
  Proposal for the owner: board role `frame` → the place's wood tone for metal pegs, pegs stay brass. One line in
  `families.ts` plus the classic/premium parity test; no spot moves.
- **No automatic re-mount after a context loss**: the hosts (product screen, gallery) own the notice and the retry
  button; an automatic retry loop could thrash a phone that is short of memory.
- **No new quality step, DPR or triangle change**: 900 bottles are already at the `low` step with nothing drawn at
  rest; software rendering cannot say whether a device needs more.
- Relief stays off (ADR-004 §7), shading unchanged, every spot and pose unchanged (`premium-look.test.ts` green).

## 7. Handoff (files not owned by this workstream; for the second run after Agent A has landed)

| #   | File (owner)                                                                                                                   | Now                                                                                                                                                                                                                                                                                                                        | Wanted                                                               | Suggested change                                                                                                                                           | Test to add                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| H1  | `features/cellar/smart-cellar-3d.tsx` (A), lines with `<Skeleton className="h-[26rem]" />` (loading the place, ~305 and ~1069) | While a place loads, a 26rem (416 px) skeleton stands where the stage will be; the stage is then `clamp(20rem, (100vw-2.5rem)*rows/cols+3rem, min(68vh,34rem))` (e.g. 320 px for a 3 × 4 rack on an iPhone 13): everything below jumps up ~96 px (by reading the code; not measured on the product, which needs the stack) | No shift: the skeleton has the stage's own height                    | Give the skeleton the stage's classes and `--unit-ratio` of the listed unit (rows/cols are known from the list before the layout arrives)                  | Phone project: sum of `layout-shift` entries between choosing a place and `data-frames` ≥ 1 is < 0.01            |
| H2  | same file, the place chips (`smart-3d-units`, `Chip` = `h-9`)                                                                  | Chips are 36 px tall; the strip scrolls sideways with no cue (Sprint 6 UX #3)                                                                                                                                                                                                                                              | ≥ 44 px touch height; an edge fade when more chips are off-screen    | `className="min-h-11"` on these chips (or a padded wrapper), a `mask-image` fade on the scroll edge when `scrollWidth > clientWidth`                       | Phone: each chip's box ≥ 44 px tall; the strip has the fade class when it overflows                              |
| H3  | same file, the hint under the picture while adding (`tq("placingShort")`)                                                      | After a too-dense tap the view zooms in silently                                                                                                                                                                                                                                                                           | Optional: say why once ("Zoomed in — tap the spot again")            | Read `data-aimed` (not added; would need an `onAim` callback prop on `TemplateScene`/`InspectableStorage`, additive) or keep silent. Owner's copy decision | —                                                                                                                |
| H4  | `features/cellar/three/scene.tsx`, `cellar-3d-view.tsx` (A, legacy view)                                                       | Context loss: same pattern as the new view (notice + retry remount); no repeat test                                                                                                                                                                                                                                        | Same guarantee as §3/§9: five loss cycles, identical resource counts | Nothing to change found by reading; add the test                                                                                                           | Copy `storage-gallery` "lost and given back five times over" to the legacy view (`sample=legacy` in the gallery) |
| H5  | `features/cellar/three/**` (A, legacy view)                                                                                    | Rings and tap targets of the legacy view were not audited here                                                                                                                                                                                                                                                             | —                                                                    | Out of scope while A changes it                                                                                                                            | —                                                                                                                |

## 8. Needs a physical device (owner's phone checklist)

On the owner's phone (iPhone with Safari, and an Android phone with Chrome if available), on a preview deployment
with Smart Cellar 3D open. Record model, OS and browser version, pass/fail, a screenshot of any failure.

1. **Dense rack, aim help**: a 30 × 30 rack (Rack Builder), Add bottle. Tap one spot with a thumb: the view glides
   closer round it and nothing opens. Tap the same spot again: the sheet names exactly that shelf and spot. 20 tries:
   no wrong spot, no stuck state. Then the same on a default 5 × 8 rack: the first tap opens the sheet (no zoom). Note
   whether the SE-sized case zooms first.
2. **Reduced motion** (iOS Settings › Accessibility › Motion › Reduce Motion): the dense-rack tap jumps closer at once,
   no glide. Toggle the setting with the view open: the camera stays where it is.
3. **Zoom limit**: pinch in as far as it goes on a 1 × 1 rack and on a closed cabinet, straight on and turned to the
   side: the camera never goes through the front, no bottles clipped by the screen edge plane.
4. **Rings**: on ebony and on white lacquer, in a light and a dark room: the chosen spot's ring (wine red in a pale
   keyline) and the chosen bottle's ring (gold in a dark keyline) are both seen at arm's length. Ask someone with a
   colour-vision deficiency, if possible, whether they can tell the two apart.
5. **Context loss**: open 10–12 apps, come back to the 3D cellar: the notice and "Show again" (never a blank box);
   after it, the place and its bottles are back and taps work. Repeat three times.
6. **Heat and battery** (rule 15): 10 minutes on a 30 × 30 rack with placeholders on offer; note battery drop and
   warmth; at rest nothing is drawn (Safari Web Inspector › Timelines shows no frames while idle).
7. **Frame rate** only from the device's own tools (Safari Web Inspector, `chrome://inspect`), never from this report.

## 9. Tests run

| Command                                                                                                                                                                                                                                                                     | Result                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test` (branch at `c21bc96`)                                                                                                                                                                                       | green; one existing lint warning (`playwright.webkit.config.ts`); domain 1503, web 1621 passed (13 skipped), scripts 117 + 83 + 44 + 75         |
| `vitest run src/features/cellar`                                                                                                                                                                                                                                            | 20 files, 400 tests passed (new: camera closest/keepOutside ×5, aimZoom ×4, rings ×4)                                                           |
| `pnpm architecture:inventory` / `architecture:impact` / `vitest run src/server/system`                                                                                                                                                                                      | inventory unchanged; "No structural change against `origin/main`. The register itself changed."; 27 passed; register 1.5.3, reviewed 2026-11-23 |
| Under the e2e lock, one build: `playwright test storage-gallery storage-showcase storage-premium storage-touch-aim smart-cellar-3d quick-add rack-builder --workers=2 --trace off` (phone + desktop; the filter also matched `perf-quick-add` and `smart-cellar-3d-old-db`) | **314 passed, 0 failed, 26 skipped** (32.0 min). Skips are the other project's half of device-specific tests and the opt-in benches             |
| New in that run                                                                                                                                                                                                                                                             | gallery: camera stays out of the furniture ×3 (desktop), five loss cycles (phone, desktop); `storage-touch-aim` (phone): passed                 |
| Audit bench (scratch script, not committed), before vs after                                                                                                                                                                                                                | §5                                                                                                                                              |

Not run: the full e2e suite (CI runs it), the perf specs' own benches (`PERF_*`), WebKit, any physical device.

## 10. Release and rollback

No migration, no setting, no flag, no data. Shipping is the merge and the deploy; rollback is Vercel Instant Rollback
to the previous deployment. Nothing here is gated separately: the renderer gate (`CELLR_SMART_CELLAR_3D`) and Quick
Add's gates are unchanged.

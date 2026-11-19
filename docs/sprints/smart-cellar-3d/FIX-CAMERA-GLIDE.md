# Fix: the camera's glide lasted seventy frames, not a second (CI shard 8 timeouts)

2026-11-19. `storage-showcase.spec.ts:82` ("it stands at the same place on the screen whatever the place and however
it was turned", desktop) timed out (120 s) on `main` and on every pull request run that reached shard 8, and its
retry did too. Shard 8 also came close to, and once reached, the job's 30-minute limit.

## Cause

Both 3D views turn the camera with three.js `OrbitControls` and `dampingFactor = 0.09`. OrbitControls damps **per
frame**: each frame it applies 9 % of what is left of a turn and keeps the rest. A turn therefore coasts on for a
fixed number of frames (about seventy until the controls stop reporting a change), whatever those frames cost. At
60 frames a second that is the intended soft second. On the CI runners WebGL is software (SwiftShader, 4 shared
cores, two Playwright workers): a frame of a full rack takes 0.4 s alone and 1–2 s with the other worker drawing,
so one drag kept the page drawing for 25 s to 2 minutes.

While it draws, the renderer's main thread is busy, and every Playwright call that goes through the page waits for
it. The trace of the failing test shows nothing that hangs; it shows everything slow: `getAttribute` 2.6–3.8 s,
`scrollIntoViewIfNeeded` 12.7 s, `boundingBox` 9.2 s, `waitForTimeout(800)` 2.2 s. The test turns three places
and takes a bottle out of each; three glides did not fit in 120 s. It also read the bottle's position on the screen
800 ms after letting go, while the camera was still moving, so the tap could land beside the bottle it aimed for.

Measured locally on the same kind of machine (4 cores, headless shell, one worker), rack_classic, a drag of 140 px:

|                          | frames drawn after the mouse was let go | until the view stood still |
| ------------------------ | --------------------------------------- | -------------------------- |
| before (per frame)       | 66                                      | 26 s                       |
| after (per unit of time) | 0                                       | at once (during the drag)  |

The camera ends where it ended before (azimuth −0.916 in both). Before, the long tail of slow frames also made the
view step its level of detail down (`Pace`: 20 slow frames in a row), which recompiles shaders and cost more time.

## What was ruled out

- **An attribute that never settles under SwiftShader.** The engine reports its frames there (`data-frames` is 1
  right after the place is shown, `data-prewarmed` is written). The retry's "element(s) not found" came from the
  test's time running out during a navigation, not from a missing canvas.
- **WebGL contexts left by earlier tests** (e.g. "looking at bottles does not cost more each time"). Every test has
  its own browser context, closed at its end. In the failing CI run that test started only after the failing one
  had finished on both workers, and within the failing test the second and third places were not slower than the
  first.

## Change

- `src/features/cellar/three/damping.ts`: `dampingFor(seconds, per60)`, the share of the glide for a frame of that
  length, `1 − (1 − 0.09)^(60·seconds)`. Exactly 0.09 at 60 frames a second; the same coast in time at any frame
  rate (also a 120 Hz screen no longer glides half as long). Unit-tested.
- Both views (`storage3d/template-scene.tsx`, `three/scene.tsx`) set `dampingFactor` from the frame's delta before
  `controls.update()`. On a slow phone a turn now comes to rest in a few frames instead of seventy: less battery,
  and no stretch of slow frames that lowers the level of detail.
- `e2e/storage3d.ts`: `atRest(page)` waits until the view has stopped drawing; the test uses it after turning the
  place instead of a fixed 800 ms, so the bottle is read from a camera that stands still.

No timeout was raised and nothing was skipped.

## Verified

- Unit: `three/damping.test.ts` (the share at 60 Hz is unchanged; the same coast in time at 3–120 frames a second;
  at most four frames to rest at 0.4 s a frame).
- Locally, 4 cores, headless shell, two workers, the gallery, premium and showcase specs (desktop): all pass; the
  failing test takes 1.0 min (on CI before: over 2.0 min, timed out on both tries).
- CI, the whole suite by hand (workflow_dispatch, features off):
  - run 44515104310: shard 8 **green**, 17.8 min of tests (23.2 min before the fix); the test 1.2 min.
  - run 44518254813: shard 8's tests all passed (124 of 136, none failed) when the job hit its 30-minute limit:
    `playwright install --with-deps` took 11.5 min of it (32 MB of fonts at 52 kB/s). Its re-run failed in that
    same step, before any test, on `503 Service Unavailable` from security.ubuntu.com.

## Still open: the setup, not the tests

The same 32 MB of apt packages took from 3 s to 10 min on the runners of one run, on four of its eight shards; that
day's nightly run on `main` (without this fix) lost shard 8 to the job limit the same way. With 18 min of tests a
shard has 12 min left for setup, and that is not always enough.

More shards do little: Playwright splits by count, in order, and the heavy 3D specs sit together. Measured
per-test times of a whole run, split as Playwright does, give the slowest shard 18.9 min (8 shards), 17.9 (9),
17.0 (10), 15.9 (11). Heaviest tests: `cellar3d-precision.spec.ts:252` 4.7 min, `storage-showcase.spec.ts:673`
4.3 min, `cellar3d-precision.spec.ts:157` 3.4 min (desktop).

Options, for a decision: make the install independent of the Ubuntu mirrors (e.g. cache the `.deb`s of
`playwright install-deps`, or run the job in the Playwright image of the same version), or keep the 30-minute
guard on the test step and give the job room for setup (`timeout-minutes` on the step, more on the job).

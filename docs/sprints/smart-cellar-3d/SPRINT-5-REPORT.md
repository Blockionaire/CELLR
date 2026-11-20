# Sprint 5 — Smart Placement Intelligence

Status: done (2026-11-20), in review. Branch `claude/adoring-cori-jn7num`, from `main` after sprint 4 (PR #92, merge
`6ab4350`). Decisions: [`ADR-009-smart-placement-intelligence.md`](./ADR-009-smart-placement-intelligence.md).
Nothing is merged, deployed or switched on. No migration; production was not contacted. **Production activation: not
yet approved.**

## 1. Executive summary

- **"Where should I store this bottle, and why?"** answered for one real bottle in the household's real cellar: up to
  three recommendations (plus up to five alternatives), each with the whole spot `(locationId,row,col,index)`, a
  qualitative class (strong match based on known facts / reasonable option / limited information), its reasons and
  caveats, and how many other free spots are just as suitable. When the bottle already has a place and nothing is
  clearly better, the answer is that its current position is already suitable.
- **A pure, deterministic engine** (`packages/domain/src/storage-advice.ts`). Hard eligibility is exactly Sprint 4's
  (`cellChoices`, then `placementProblem` on every returned spot): nothing occupied, outside the layout, in an unknown
  arrangement, in a full compartment, behind a taken front or past index 1 while depth is off is ever advised. Ranking
  uses fixed, documented weights: the declared zone purpose against the person's explicit intent (Keep / Serve soon),
  then grouping with the same vintage, wine, producer or type by **stable ids**, nearby first. Ties are broken by the
  places' own order and the full slot.
- **Evidence, not invention.** Every reason and caveat is a code with the fact that produced it (a count, a zone, a
  target). Configured temperatures are described as settings, **never scored and never called measurements**; the
  estimated drinking window (built partly from price and label words) is **not used**, only mentioned. Unit tests
  delete each supporting fact and show its explanation disappears.
- **A read-only API** `GET /api/v1/smart-cellar/bottles/:id/recommendations?intent=store|serve`: every fact read on the
  server as the person (RLS), six database requests whatever the cellar's size (seven past 1,000 placed bottles: one more page), nothing stored. A gate of its own,
  `CELLR_SMART_CELLAR_ADVICE`, off by default, closed on production, only where the placement gate is open, granting
  no write.
- **Inside the existing placement panel.** "Show" selects the recommended place and spot in the Sprint 4 picker and
  rings it in 3D (also across places); "Place here" confirms that exact spot through the Sprint 4 move. Nothing moves
  on its own; any free spot can still be chosen by hand. A recommendation taken meanwhile is refused by the server,
  said, and the advice is fetched again; nothing is substituted.
- **Tests**: 26 engine tests, 3 gate tests, 4 service tests; 17 real-stack browser/API scenarios (on desktop and
  phone: gates, owner/member/anonymous/other household, a bottle whose wine is hidden by RLS, consistency with the
  database, UI flows, an option in another place, a stale option, failure and retry, no WebGL, keyboard + axe,
  phone); 22 of 22 mutants killed (13 of them new for advice). An independent adversarial review found 9 issues; all
  resolved with tests (§17).

- **Cost**: the engine takes 0.5–10 ms for 40–1,200 bottles (after replacing a first, quadratic version: 58–85 ms at
  900–1,200); the API answers in 66–109 ms with six database requests at every size (seven past 1,000 placed bottles); showing an option rings it in
  17–55 ms without asking the server again, rebuilding the furniture or drawing at rest.

## 2. Product workflows

| Entry point                                                                 | What happens                                                                                                                                                              |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A bottle without a place ("Bottles without a place" → **Place**)            | The placement panel opens with "Where it fits best" at the top, intent **Keep** by default.                                                                               |
| A placed bottle in 3D (tap → **Move**) or in the flat picture without WebGL | The same panel, with its current spot; when no free spot is clearly better: "Its current position is already suitable, based on what CELLR knows. You can still move it." |
| The movement panel itself                                                   | Advice and the manual picker side by side: advice is advisory ("Advice, not a rule: you can also choose any free spot yourself below.").                                  |

In the advice: **Keep / Serve soon** (explicit intent, changes the advice for stated reasons), three cards (spot,
class, reasons, caveats, equivalents), **Show** and **Place here**, "More options" (folded alternatives), and general
caveats (no zone for this intent anywhere, estimated window not used, no vintage recorded). Without places: "You have
no places for bottles yet" with **Design a place** where the Rack Builder is open. Nothing free: "There is no free
position for this bottle right now", with how many spots were left out because depth is off or a place's arrangement
is unknown — never an invented alternative.

Example journey (browser-tested): a bottle without a place → Place → option 1 "Wine cooler · shelf 3 · spot 1",
"Zone 2 is set aside for keeping wine.", "Zone 2 is set to 12.0 °C. That is a setting in CELLR, not a measured
temperature."; option 2 "Oak rack · shelf 2 · spot 1", "2 bottles of the same vintage nearby (within one shelf or spot)." → Show
(the rack is shown, spot 2·1 chosen and ringed) → Show option 1 (the cooler is shown, 3·1 chosen and ringed) → Place
here → "… is now at Wine cooler · shelf 3 · spot 1", with the Sprint 4 Undo.

## 3. Architecture and data flow

```
browser (placement panel)                    server (as the person, RLS)                       domain (pure)
 useAdvice(bottle, intent) ── GET …/recommendations ──▶ gate: advice ∧ placement open
   key: smart-cellar/storage/advice/…                    adviceBottle   (1 request)
   (refreshed with every move/swap,                      listPlaces     (3 requests: places, zones, counts)
    cleared on household switch)                         adviceOccupants (1 paged request, ≤ 2 pages at 1,200)
                                                         resolveStorage per place ─────────────▶ adviseStorage()
 Show → picker choice + 3D ring (Sprint 4)  ◀── ranked, explained answer + canPlace ◀──────────  eligibility (Sprint 4)
 Place here → POST …/move (Sprint 4) ── conditional UPDATE                                      ranking + reasons
```

No second copy of anything: places come from `listPlaces` and `resolveStorage`, free spots from `cellChoices`, the
final check from `placementProblem`, the 3D ring from the Sprint 4 target, the write from the Sprint 4 move. The
answer is recomputed on every request and never stored.

## 4. Wine and storage facts used

| Fact                                                                           | Kind                                                   | Use                                                                          |
| ------------------------------------------------------------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Bottle id, status, whole spot                                                  | verified database fact                                 | eligibility, current spot                                                    |
| Vintage, wine, producer ids                                                    | verified database facts (stable ids, no name matching) | grouping                                                                     |
| Wine type                                                                      | catalogue fact                                         | grouping (category, weakest)                                                 |
| Year                                                                           | catalogue fact                                         | caveat "no vintage recorded"                                                 |
| Region, country                                                                | catalogue fact                                         | **not used**: nothing links a region to a spot in someone's cellar           |
| Places, template, capacity, index meaning                                      | user configuration via `resolveStorage`                | eligibility                                                                  |
| Zone purpose (storage / serving)                                               | user configuration                                     | the strongest signal, against the explicit intent                            |
| Zone target °C                                                                 | user configuration — a setting                         | described ("a setting in CELLR, not a measured temperature"), never scored   |
| Drinking window                                                                | calculated estimate (partly price and label words)     | not used; a caveat says so                                                   |
| Measured temperature, humidity, light, vibration, shelf height, door clearance | unknown — CELLR records none                           | never scored; "no zone here: CELLR doesn't know the conditions at this spot" |

## 5. Ranking signals and weights

| Signal                                            | Points           | Rationale                                                    |
| ------------------------------------------------- | ---------------- | ------------------------------------------------------------ |
| Zone purpose matches the intent                   | +40              | the only environmental intent the person declared            |
| Zone purpose is the other one                     | −20              | keeps serving space for serving, keeping space for keeping   |
| Same vintage: next cell / same shelf / same place | +30 / +20 / +12  | identical bottles together (organisation, not preservation)  |
| Same wine, another vintage                        | +18 / +12 / +8   |                                                              |
| Same producer                                     | +10 / +6 / +4    |                                                              |
| Same type                                         | +4 / +3 / +2     |                                                              |
| Only the strongest grouping counts                | —                | evidence isn't stacked                                       |
| Front of a depth cell                             | 0 (reason only)  | true of every live spot while depth is off; said, not scored |
| Moving away from the current spot                 | must win by > 10 | no move without a clear advantage                            |

Ties: score, then the number of related bottles the grouping reason counts, then the places' order, row, column,
index. Classes: **strong** = purpose match, or the same vintage/wine next to it or on its shelf (and no purpose
conflict); **reasonable** = any positive evidence; **limited** = free, nothing more known. Equivalent spots (same
place, same score, same reasons) are counted on the option shown ("15 other free spots are just as suitable").

Not used, on purpose: temperature numbers (no measurement; no general guidance turned into false precision),
purchase price, names, region/country, the drinking-window estimate, shelf height or "convenience" CELLR has no data
for.

## 6. Hard constraints

Eligibility is Sprint 4's: a candidate is a spot `cellChoices` marks `free` (single, depth) or a compartment's `next`
counter (ordinal), with the bottle as `movingId` and the live depth switch; each spot that is returned also passes
`placementProblem(...) === null` with the same options. Never returned: occupied, outside the layout, unknown
arrangement (whole place left out and counted), full compartment (counted), behind a taken front (counted), past
index 1 while depth is off (counted), another household's place (the server gives only the household's own; the
engine only looks at the places given). Ordinal counters are described as compartments ("that isn't a position at
the front or back"). The API proves it against the database: every returned spot is free there, and the first one is
placed through the Sprint 4 move.

## 7. Explanation codes and evidence guarantees

Reasons: `purpose_match {purpose, zone}`, `group {tier, proximity, count, type?}`, `front_reachable`, `zone_target
{zone, targetTempC}`, `free_now`, `current_spot`. Caveats: `purpose_mismatch`, `temperature_not_measured`,
`zone_no_target`, `no_zone`, `compartment_counter`, `no_matching_zone`, `estimated_window_not_used`,
`vintage_unknown`, `no_grouping_evidence`. Each is emitted only by the branch that used its fact; en/nl translations in
`messages/{en,nl}.json` (`advice.*`). Tests remove the zone, the target, the matching bottle, the estimated window and
the year, and show the corresponding explanation disappears; numbers in reasons are only those of the input; mutants
that emit a reason without its fact are killed.

## 8. API contract

`GET /api/v1/smart-cellar/bottles/:id/recommendations?intent=store|serve` → 200 `SmartAdviceView`:
`{ bottleId, status: ok|not_in_cellar|no_places|no_eligible, intent, stay, recommendations[≤3], alternatives[≤5],
eligible, excluded{occupied, depthOff, behind, fullCompartments, unknownPlaces}, caveats, canPlace }`; each option
`{ spot, placeLabel, meaning, zone, reasons, caveats, suitability, actionable: true, score, equivalent, rank }`.
404: advice or placement gate closed, not a uuid, another household's bottle or none. 422: intent missing or
unknown. 401: signed out. A database without the Smart Cellar step: the Smart Cellar API's own "not set up" answer
(from `listPlaces`), never an empty cellar. Read-only; the caller sends only the bottle and the intent.

## 9. Screenshots

Contact sheets (software rendering, local stack, made with `VISUAL_ADVICE=1 SHOTS_DIR=… pnpm exec playwright test
visual-advice`): [`screens/5-advice-desktop.jpg`](./screens/5-advice-desktop.jpg),
[`screens/5-advice-phone.jpg`](./screens/5-advice-phone.jpg).

| Picture                    | What was checked, and fixed                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep: three options        | The class chip, reasons in plain sentences, caveats smaller, equivalents counted. _Fixed after the first look_: the spot's own text repeated the zone the reasons already gave (now the plain spot); "Free now." was on every card (true of every recommendation: kept in the data, not on screen); with equal points the spot with fewer related bottles came first (the count is now the next tie-break). |
| Option 2 shown             | The rack is shown, spot 2·1 chosen in the picker below, ringed in 3D, the card marked "Shown"; nothing moved.                                                                                                                                                                                                                                                                                               |
| Serve soon, option 1 shown | The serving zone of the cooler first, the cooler shown with its ring and zone legend; "set to 8.0 °C … not a measured temperature".                                                                                                                                                                                                                                                                         |
| Phone                      | Cards stack, buttons stay large, nothing scrolls sideways (browser-tested).                                                                                                                                                                                                                                                                                                                                 |

## 10. Performance benchmarks

Same machine as sprints 2B.3–4 (4 cores, SwiftShader software rendering, headless Chromium, production build, local
stack). Half-full cellars, every other spot taken: as many free spots as bottles, the hardest case for ranking
(40 in an 8 × 10 rack, 200 in 20 × 20, 900 in two 30 × 30, 1,200 in three). **No frame rate on a real device is
claimed.**

**The engine alone** (`BENCH_ADVICE=1 pnpm exec vitest run src/server/smart-cellar/advice-engine.bench.test.ts` in
`apps/web`, median of 25):

| Bottles (free spots) | Eligibility (`cellChoices`) | Ranking + explanations | Whole engine | First version (measured in `packages/domain`'s Node environment) |
| -------------------- | --------------------------- | ---------------------- | ------------ | ---------------------------------------------------------------- |
| 40 (40)              | 0.07 ms                     | 0.4 ms                 | 0.48 ms      | 0.76 ms                                                          |
| 200 (200)            | 0.29 ms                     | 1.3 ms                 | 1.56 ms      | 6.1 ms                                                           |
| 900 (900)            | 0.59 ms                     | 5.6 ms                 | 6.2 ms       | 58 ms                                                            |
| 1,200 (1,500)        | 0.95 ms                     | 9.1 ms                 | 10.0 ms      | 85 ms                                                            |

The first version compared every free spot with every bottle (grouping) and ran `placementProblem`, which reads every
bottle of the place, for every free spot: quadratic. Now grouping uses one index per place (counts per cell and shelf,
per tier) and `placementProblem` runs for each spot that is returned (at most 8, in ranking order; a refused one is
skipped, never returned). The guarantee is unchanged and mutation-checked.

**In the product** (`PERF_ADVICE=1 … perf-advice --workers=1`):

|                                                                                                    | 40 desktop / phone   | 200                  | 900                 | 1,200                              |
| -------------------------------------------------------------------------------------------------- | -------------------- | -------------------- | ------------------- | ---------------------------------- |
| API, Node → server → database → JSON, median of 7                                                  | 72 / 66 ms           | 70 / 70 ms           | 68 / 85 ms          | 100 / 109 ms                       |
| Database requests per answer (active household, the bottle, places, zones, counts, placed bottles) | 6                    | 6                    | 6                   | 7 (the placed bottles are 2 pages) |
| Response size                                                                                      | 1.7 kB               | 1.7 kB               | 2.4 kB              | 3.1 kB                             |
| Place tapped → advice on screen, median of 3                                                       | 683 / 450 ms         | 746 / 662 ms         | 565 / 908 ms        | 565 / 553 ms                       |
| Show tapped → the picture with the ring (same place)                                               | 17 / 19 ms           | 20 / 24 ms           | 36 / 40 ms          | 55 / 43 ms                         |
| Advice requests while showing options (9 taps)                                                     | 0                    | 0                    | 0                   | 0                                  |
| Furniture models built, before → after 9 taps                                                      | 1 → 1                | 1 → 1                | 1 → 1               | 1 → 1                              |
| Pictures in 3 s at rest, advice open / after                                                       | 0 / 0                | 0 / 0                | 0 / 0               | 0 / 0                              |
| Canvases                                                                                           | 1                    | 1                    | 1                   | 1                                  |
| Geometries / textures / programs, before → after each round                                        | 27/7/31 → 28/7/32 ×3 | 25/4/28 → 26/4/29 ×3 | 25/4/28 → 26/4/9 ×3 | 25/4/28 → 26/4/9 ×3                |

- Measured before the review corrections (§17). Those changed the two advice reads from inner to left joins and some
  wording; the number of requests and the response shape are unchanged. The product bench was not run again.
- Data retrieval dominates the API time (the engine is 0.5–10 ms of it); the rest is authentication and the six reads
  through PostgREST, the same as the Sprint 4 placement reads.
- The ring is the Sprint 4 target: one geometry and one program more, once (the first time a spot is shown), never
  again over three rounds. Showing an option never asks the server again and never rebuilds the furniture; nothing is
  drawn at rest.
- At 900 and 1,200 some options lie in another rack. Showing one shows that place, which is its own scene (one scene
  per place, as since sprint 2B.3): the old scene is released, which is why the program count drops (28 → 9) and the
  JS heap moves with garbage collection (desktop 42 → 51 MB at 900, 67 → 80 MB at 1,200; phone 43 → 81 MB, 62 → 92 MB
  after nine switches between places). The counts are identical after every round, so nothing accumulates; a
  physical-device check of repeated switching is in the checklist (§18).

## 11. Domain and unit tests

| Suite                                                       | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Result                                                                            |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `packages/domain/src/storage-advice.test.ts`                | Eligibility: never occupied, every option passes `placementProblem` with the same options, unknown arrangements left out, depth-off and behind counted never offered (also with depth on), ordinal next counter / filled compartment needs depth / full compartment excluded, only the places given, no places / nothing free / not in the cellar. Ranking: deterministic and stable ties, intent changes ranking via the declared zone, grouping next to the same vintage beats an empty shelf and tiers don't stack, no evidence → limited, stay without a clear advantage, move when clearly better, bounded distinct output. Explanations: remove the zone, the target, the matching bottle, the estimated window or the year and the explanation goes; "no zone for this intent" said once; `front_reachable` only for the front of a depth cell; numbers only from the input. | 26 passed (20 + 6 from the review)                                                |
| `apps/web/src/lib/smart-cellar-advice-gate.test.ts`         | off by default and exactly "1"; closed on production and unknown deployments; needs placement open; read-only placement is enough                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 3 passed                                                                          |
| `apps/web/src/server/smart-cellar/service.test.ts` (advice) | closed unless both gates are open, nothing read; facts only from the repository; `canPlace` false where placement or the API doesn't write; another household's bottle 404                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 4 passed (with "not set up" for a database without the Smart Cellar step)         |
| `scripts/mutation-placement.sh`                             | 13 new advice mutants: both eligibility checks removed together, the depth switch ignored, a purpose match claimed without one, a target described that isn't set, grouping without matching bottles, a window mentioned that doesn't exist, never advising a move, a poor current spot called suitable, depth-limited compartments counted as full, the advice gate opened outside previews or without placement, the service advising with the gate closed; plus Sprint 4's 9                                                                                                                                                                                                                                                                                                                                                                                                     | 22 of 22 killed (control run first)                                               |
| Whole repository                                            | `pnpm test`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | domain 1,001 passed (+1 skipped: the bench), web 1,345 passed, scripts 244 passed |

The two eligibility checks are deliberately redundant (`cellChoices` state and `placementProblem`): a mutant that
removes only one of them survives by design, so the mutant removes both, as one protection.

## 12. Real-stack integration tests

`e2e/advice.spec.ts`, against the local stack (real Postgres, real PostgREST, RLS), API part:

| Scenario                                                                                                                                                                                                                                                                                                                    | Result |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Ranked and explained from the database's facts: a keeping zone first (`purpose_match`, `zone_target`), then next to two twins (`group vintage neighbour 2`); every option is free in the database; nothing was written; the same question gives the same answer; the first option is placed through the Sprint 4 move (200) | passed |
| Serve soon puts the serving zone first; a bottle next to its twin is told to stay (`current_spot`)                                                                                                                                                                                                                          | passed |
| Refusals: unknown / missing intent 422; not a uuid and unknown bottle 404; signed out 401; another household's bottle 404; our answer contains only our places (checked against `cellar_locations`)                                                                                                                         | passed |
| A bottle of ours whose wine is another household's provisional wine (hidden by `wines_select`) occupies its spot: never advised, and the move API agrees (409)                                                                                                                                                              | passed |
| A household member (invited, joined, active) gets exactly the owner's answer                                                                                                                                                                                                                                                | passed |
| No places → `no_places`; one full place → `no_eligible` with nothing invented; an opened bottle → `not_in_cellar`                                                                                                                                                                                                           | passed |
| Gate: default server 404; unmarked production build with the setting 404                                                                                                                                                                                                                                                    | passed |

## 13. Browser-test results

Production build (`next start`, Next.js 16.4.6), the three Sprint 4 servers (3100 nothing set; 3101 an unmarked
production build with `CELLR_SMART_CELLAR_PLACEMENT=1` and `CELLR_SMART_CELLAR_ADVICE=1`, which must stay closed;
3102 a Vercel preview with both, writes and the local database), the local stack, Chromium, desktop and phone.

| Run                                                                                                                                           | Result                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `e2e/advice.spec.ts` (new, 17 scenarios × 2 devices)                                                                                          | 32 passed, 2 skipped (keyboard desktop-only, phone phone-only), 0 failed                                                                                                                                                                                                   |
| `e2e/placement.spec.ts` (Sprint 4, with advice now on in the same panel)                                                                      | 52 passed, 2 skipped, 0 failed                                                                                                                                                                                                                                             |
| Related suites: smart-cellar-3d, smart-cellar-api, rack-builder, racks, drag-swap, cellar, three-view, detail, add-to-spot, smoke (260 tests) | 225 passed, 33 skipped, 2 failed: `smart-cellar-3d.spec.ts:466` (phone) passes when run alone (the load-related flake recorded in sprint 4); `racks.spec.ts:371` (light, desktop) is the colour-contrast failure also seen on `main` (the racks screen isn't touched here) |
| Visual photographer (`visual-advice`)                                                                                                         | 2 passed; pictures in §9                                                                                                                                                                                                                                                   |
| Bench (`perf-advice`, 2 devices × 4 sizes)                                                                                                    | passed; §10                                                                                                                                                                                                                                                                |

UI scenarios covered: a bottle without a place (three options, explained, Show in the rack and in the cooler, Place
here only on click); intent change and manual override of every option; "Place here" on an option in another place;
an option taken meanwhile (409 said, advice fetched again, nothing substituted, one bottle on the spot); cancel;
advice that can't be loaded (said, the panel still works by hand, Try again); nothing free (said, no option); no
WebGL (flat picture, advice and Place here work); keyboard (Show by Enter, `aria-pressed`) with an axe audit; phone
with reduced motion (no sideways scrolling, buttons ≥ 32 px high). Household switch: the switcher clears the whole
query cache, advice included (existing code, not separately browser-tested).

## 14. Authorization tests

| Case                                                             | Result                                                                         |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Household owner                                                  | 200, ranked answer                                                             |
| Household member (invited, joined, active)                       | 200, identical to the owner's                                                  |
| Signed out                                                       | 401                                                                            |
| Another household's bottle                                       | 404                                                                            |
| A uuid that is no bottle / not a uuid                            | 404                                                                            |
| Missing or unknown intent                                        | 422                                                                            |
| Another household's places                                       | never in our answer (every spot's place is ours, checked against the database) |
| Gate closed (default server) / production build with the setting | 404 / 404                                                                      |
| Read-only placement (or an API that doesn't write)               | advice answered, `canPlace: false`, no "Place here" (service tests)            |

## 15. Feature-flag behaviour

`adviceOpenIn(env, placement)`: open only when `CELLR_SMART_CELLAR_ADVICE` is exactly `1` **and** the deployment is an
internal preview (`next dev`, Vercel Preview; never production, never an unknown deployment) **and** the placement gate
is open. It grants nothing: the service checks both the advice gate and placement before reading; acting on advice is
the Sprint 4 move with its own gate and verified non-production write target, so a preview on the production database
can at most show advice. No model calls, no keys, nothing shared with the AI Sommelier. With it off, the existing
experience is unchanged (the 2B.3/Sprint 4 suites pass with it off on the default server).

## 16. Limitations of environmental information

CELLR records no measured temperature, humidity, light, vibration, shelf height or door clearance. A zone's target is
what someone typed; advice says so every time it mentions one and never ranks on it. Places without zones are said to
have unknown conditions. Grouping is an organisational preference and is described as such (no preservation or
ageing claims). The drinking window is an estimate and is not used.

## 17. Adversarial review findings

An independent review of the whole diff (code only, not this report) after the first complete version. Every finding
was verified and resolved with a test, or is stated here.

| #   | Finding                                                                                                                                                                                                                                                                      | Severity   | Resolution                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | "Its current position is already suitable" was said whenever no free spot was clearly better, also for a bottle in a zone for the other purpose with nothing free: a false suitability claim.                                                                                | Medium     | `stayKind`: "suitable" only with positive evidence and no conflict; otherwise "No free spot is clearly better than where it is now." Test + mutant.                                                                                                                                                                                                                                                              |
| 2   | A compartment closed only because depth is off (one bottle in it) was counted as "full".                                                                                                                                                                                     | Medium     | Counted under depth (`cell.free > 0`), said as depth; test + mutant.                                                                                                                                                                                                                                                                                                                                             |
| 3   | Occupancy for advice came through `!inner` catalogue joins: a bottle whose wine this person can't read (another household's provisional wine, RLS) dropped out, so its spot looked free (the move API, which reads the bottles table alone, would refuse it).                | Medium     | Left joins: every bottle occupies its spot; unreadable catalogue ids are null and never "related". Unit test, and a real-stack test that inserts such a bottle and shows the spot is never advised and the move agrees (409).                                                                                                                                                                                    |
| 4   | "Place here" on an option in another place switched the place on screen while the request was on its way (a lost answer could then be judged against the wrong place); a place missing from a stale list left a pending choice behind.                                       | Low/medium | "Place here" no longer switches places (it confirms exactly that spot); the compartment check after a lost answer uses the target's own place; an unlisted place switches nothing and keeps nothing. Browser test.                                                                                                                                                                                               |
| 5   | The window caveat was computed from an estimate call that ignored stored AI windows and read name/region needlessly.                                                                                                                                                         | Low        | No estimate call: a vintage wine's window is an estimate either way (table or AI); the caveat says it wasn't used.                                                                                                                                                                                                                                                                                               |
| 6   | Equivalents and `eligible` could count the bottle's own compartment (refused as "same spot").                                                                                                                                                                                | Low        | The own compartment's next counter is not a destination; test.                                                                                                                                                                                                                                                                                                                                                   |
| 7   | Wording: "behind the front" said "depth isn't switched on" even with depth on; "right next to it" for a 3 × 3 window; a target in a zone for the other purpose listed as a reason; a zone in a place of unknown arrangement counted for "no zone for this intent".           | Low        | Separate "behind" sentence; "nearby (within one shelf or spot)"; the target there is a fact (caveat), not a reason; unknown places don't count. Tests.                                                                                                                                                                                                                                                           |
| 8   | Accessibility: the live region wrapped every card (re-announced on refetch); `aria-label` on each card hid its content; `not_in_cellar` rendered nothing.                                                                                                                    | Low        | One short polite status sentence; the rank as visually hidden text inside the card; a sentence for a bottle no longer in the cellar.                                                                                                                                                                                                                                                                             |
| 9   | Claims without proof: missing schema for advice untested; household switch relies on `queryClient.clear()`; the `placementProblem` re-check only mutated together with the state filter; the request count stated two ways; "Place here" skips the panel's summary sentence. | Low        | Service test: missing schema says "not set up", distinct from a closed gate. Household switch: the switcher clears the whole query cache (unchanged code; not separately browser-tested). The two checks are one protection by design (§11). Request count corrected everywhere (six; seven past 1,000 placed bottles). "Place here" is an explicit click on a card that names the spot, with the Sprint 4 Undo. |

The review confirmed as sound: eligibility only from `cellChoices` + `placementProblem` with the same options; the
whole slot kept to the move; deterministic ordering ending in a unique spot key; the grouping index (exclusive tiers,
the moving bottle excluded); reasons emitted only by the branch that used their fact; temperatures described, never
scored, always as settings; no price or names in ranking; the API (authenticated, household from the server, RLS,
validation, `no-store`, bounded, no N+1, nothing written); the gate; stale handling (refetch, alert, no substitution);
the flat fallback; well-formed plurals.

## 18. Production activation checklist (not done; each needs the owner)

1. Sprint 4's list first (device validation, the decision to allow writes on production, depth decisions).
2. Review the weights (ADR-009 §3) with real cellars on a preview; any change is a code change with tests.
3. Set `CELLR_SMART_CELLAR_ADVICE=1` on a preview; production stays closed by code until a reviewed change allows it.
4. Device check: the advice cards on iPhone and Android (lengths in Dutch, tap targets, VoiceOver/TalkBack reading the
   reasons in order), Show switching places with the 3D picture.

## 19. Remaining Smart Cellar 3D work

- Production activation of sprints 2B.3–5 (owner decisions above).
- Depth: the gated index drop, `move_bottle_v2`, the switch — then advice can offer back spots (the engine already
  takes `depthEnabled`).
- Measured conditions, if CELLR ever records them: a new reason code with its evidence, not a change of meaning.
- A user-owned drinking window ("own"), which advice could mention reliably.

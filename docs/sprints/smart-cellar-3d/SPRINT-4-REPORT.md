# Sprint 4 — Intelligent bottle placement, depth-aware movement and temperature zones

Status: done (2026-11-19), in review. Branch `claude/adoring-cori-jn7num`, from `main` after sprint 3 (PR #87).
Decisions: [`ADR-008-index-aware-movement-and-zones.md`](./ADR-008-index-aware-movement-and-zones.md).
Nothing is merged, deployed or switched on. No migration in `supabase/migrations`; production was not contacted.

## 1. Executive summary

- **Placing, moving, taking off and swapping real bottles** in the new 3D cellar: tap a bottle (or "Place a
  bottle", or a bottle without a place), choose a place, choose a spot in a flat picker, read one sentence saying
  what will happen, confirm. The target is ringed in 3D; **nothing moves on screen until the server has answered**.
  Undo is offered after every success and is itself conditional.
- **Two new versioned endpoints**, next to the old ones: `POST /api/v1/smart-cellar/bottles/:id/move` and
  `/swap`, with the whole spot the caller saw (`{ locationId, row, col, index }`) on both sides. A move is **one
  conditional `UPDATE`** (atomic, as the person, RLS, the database's unique indexes and bounds trigger decide); a
  swap is the existing `swap_bottles_v2`. A stale source, a target taken meanwhile, another household's bottle or
  place: refused, nothing changed. A repeat after a lost answer is safe (`already_there`).
- **Depth is built but stays blocked live.** The app refuses index > 1 (`DEPTH_PLACEMENT_ENABLED = false`), and so
  does the database (cell capacity 1 and the old one-bottle-per-cell index). The index-aware move that depth needs
  (`move_bottle_v2`) is a separately reviewable proposal in `supabase/gated-migrations/`, tested only inside a
  rolled-back transaction together with the gated index drop.
- **Temperature zones in daily use**: a legend for places with zones (shelves, purpose, the temperature it is
  **set to**, bottles per zone), tinted shelf numbers in the picker, the zone in the target sentence and in a
  bottle's details; "Set temperatures are settings, not readings". Editing opens the Rack Builder at its zones.
  Places without zones show nothing about temperature.
- **A separate server gate** `CELLR_SMART_CELLAR_PLACEMENT`: off by default, closed on production builds whatever
  is set, and writing only where the Smart Cellar API writes (a database verified not to be production). A preview
  on the production database can at most show the picker read-only.
- **Tests**: 15 domain, 5 gate, 9 service and 6 recovery unit tests for placement; 27 browser/API scenarios (on desktop and phone) against
  the real local Postgres/PostgREST (gates, moves, refusals, direct PostgREST writes, concurrency, swaps, Undo,
  authorization, legacy paths, UI flows, network loss, zones, no-WebGL, keyboard + axe, phone); the SQL suite
  (1,611 assertions) with the move proposal, including **mutation checks**; and a mutation script for the app's
  protections (10 of 10 mutants killed).

## 2. Workflows

| Entry point                                       | What happens                                                                                                   |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| A bottle in the 3D picture (or its flat fallback) | Tap → it is taken out (sprint 2B) → **Move** → the placement panel opens with the bottle and its current spot. |
| "Place a bottle"                                  | The panel opens without a bottle: choose a spot first, then which bottle (a list of bottles without a place).  |
| "Bottles without a place" list                    | **Place** next to a bottle → the panel with that bottle, "Now: no place".                                      |
| Wine details                                      | Not added: the details sheet belongs to the old views, which keep their own move (see §15).                    |

In the panel: places (chips; a place whose arrangement CELLR does not know is not selectable), the **spot picker**,
a sentence ("It goes to Oak rack · shelf 3 · spot 4." / "It swaps places with … at …"), and **Move here / Place
here / Swap**, **Take it off its place**, **Cancel**. Choosing another spot before confirming just changes the
choice; Cancel changes nothing. After success: a toast with Undo, every query that shows a bottle's place is
refreshed, the panel closes. A refusal stays in the panel as a sentence (`placement-problem`) and no success toast
appears. Drag is not offered; nothing requires turning the 3D picture.

## 3. Domain model

One slot identity: `{ locationId, row, col, index }` (`SlotAddress` within a place; `null` = no place), the
helpers of sprint 1A reused (`slotKey`, `checkSlot`, `cellOccupancy`, `firstFreeInCell`, `zoneOfRow`,
`resolveStorage`). New in `packages/domain/src/storage-placement.ts` (pure, tested):

| Meaning (`placementMeaning`) | When                                               | What the picker offers                                                                                                                                         |
| ---------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `single`                     | one bottle per cell                                | each cell is one spot                                                                                                                                          |
| `depth`                      | several per cell, index 1 = front                  | the front as a full target; the places behind as narrow marks, unavailable while depth is off; a spot behind a taken front is "behind"                         |
| `ordinal`                    | bins, crates: counters, no physical order          | one button per compartment with `used/capacity`; the server picks the next free counter (`landingSpot`); counters are never renumbered; no front/back is drawn |
| `unknown`                    | arrangement not known (`arrangementKnown = false`) | nothing: the place is not selectable, and the server refuses it                                                                                                |

`cellChoices`, `placementProblem` (unknown_arrangement, out_of_bounds, depth_not_enabled, occupied, behind_taken,
compartment_full, same_spot), `swapProblem` (same_bottle, unknown_arrangement, depth_not_enabled,
same_compartment), `zoneSummaries`; the strict request schemas `SmartSpotSchema`, `SmartMoveSchema`,
`SmartSwapSchema` (unknown keys, such as a `householdId`, are refused).

## 4. API contracts

Both need sign-in, the placement gate, and the Smart Cellar API's write level; otherwise 404 (gate closed: "no such
thing here") or 403 ("Moving bottles here isn't switched on yet."). The gate is checked before the body is read.

`POST /api/v1/smart-cellar/bottles/:id/move` `{ from: Spot | null, to: Spot | null }` → 200
`{ bottleId, outcome: "moved" | "already_there", from, to }`.

`GET /api/v1/smart-cellar/bottles/:id` (read-only, added in the final review) → 200
`{ bottleId, inCellar, spot: Spot | null }`: where one bottle is now, from the database, as the person. `spot` null
means in the cellar without a place (or, with `inCellar` false, no longer in the cellar). 404 where placement is
closed, and for another household's bottle or none; open also where placement is read-only.

`POST /api/v1/smart-cellar/bottles/:id/swap` `{ with, expected: { self: Spot, other: Spot } }` → 200
`{ self: { bottleId, spot }, other: { bottleId, spot } }`.

| Refusal                                               | Status         | Message (en; nl in `messages/nl.json`)                                                                                    |
| ----------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| bottle not where the caller saw it                    | 409            | That bottle was moved by someone else. Nothing was changed.                                                               |
| target taken (checked, or by the unique index)        | 409, retryable | That spot was just taken. Pick another.                                                                                   |
| index > 1 while depth is off                          | 409            | More than one bottle per position isn't switched on yet.                                                                  |
| behind a taken front / compartment full               | 409            | Another bottle is in front of that spot. / That compartment is full.                                                      |
| unknown arrangement                                   | 409            | CELLR doesn't know how that place is arranged, so it can't put a bottle there.                                            |
| outside the place (checked, or by the bounds trigger) | 422            | That spot doesn't exist in this place.                                                                                    |
| carrying an index > 1 to another cell (trigger)       | 409            | This bottle lies behind another one. It can be moved once moving at depth is switched on.                                 |
| bottle drunk/removed meanwhile                        | 409            | That bottle is no longer in the cellar.                                                                                   |
| another household's bottle / place, or none           | 404            | We couldn't find that bottle. / We couldn't find that place.                                                              |
| swap with itself / inside one compartment             | 422            | A bottle can't trade places with itself. / Two bottles in one compartment can't trade places: a compartment has no order. |
| swap: one moved meanwhile / no longer placed          | 409            | One of these bottles was just moved by someone else. … / … is no longer in the cellar or has no place. …                  |
| signed out                                            | 401            | (the API's usual answer)                                                                                                  |

Every sentence is a known message with a Dutch translation (`lib/known-messages.ts`, `errors.known.*`).

## 5. Transaction guarantees and retry protocol

- **Move**: one statement — `UPDATE bottles SET location_id, loc_row, loc_col, loc_index WHERE id = :id AND
household_id = :active AND status = 'in_cellar' AND <the whole observed source>` — as the signed-in person (RLS).
  It applies whole or not at all. Two concurrent moves of one bottle: the second finds no row matching its source
  (stale). Two bottles for one spot: the unique index lets exactly one in (taken). Bounds are checked by the 0043
  trigger under a share lock on the place (no race with a resize). No other statement is part of a move.
- **When nothing matched**, one read says why: not found (another household or none) → 404, not in the cellar →
  409 gone, **already on the target** → 200 `already_there`, otherwise stale → 409. So a client that lost the answer
  can safely send the same request again. A request whose source and target are the same spot is also sent to the
  database (never answered without it): a match is `already_there`.
- **Depth is checked on the final index**: after a compartment's next counter is chosen, not only on the index the
  caller named.
- **Swap**: `swap_bottles_v2` (0045): both bottles locked in id order, both expected spots checked, out then in, in
  one transaction; 'stale' / 'gone' / 'not_found' / 'invalid' mapped as above.
- **The client never asserts an uncertain outcome** (final review correction). A network failure or a 5xx on a
  move, a swap **or a take-off** may or may not have applied. The panel then reads where the bottle is now with
  `GET /api/v1/smart-cellar/bottles/:id` (§4): one row from the database, as the person (RLS), every API answer
  `no-store`, and deliberately not a query, so no cached answer can stand in as proof. The same repository read is
  the fallback of the move itself (one copy, not a second inventory). One pure function (`placement/reconcile.ts`,
  `judgeMove` / `judgeSwap`) turns that read into what is said:

  | The read says                                                                              | Said                                                                                                                                                                                                            | Undo                                                                      | Panel                                                  |
  | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------ |
  | on the target (a take-off: in the cellar, no place; a swap: **both** on each other's spot) | done ("… is now at …", "… has no place now.", "… swapped places")                                                                                                                                               | **never**: it can't be told whether this request or another member did it | closes                                                 |
  | still exactly on the source that was seen                                                  | "The bottle didn't move: …"                                                                                                                                                                                     | —                                                                         | stays, with the choice: trying again is safe           |
  | in the cellar somewhere neither seen nor asked for                                         | "This bottle is now at …: it was moved meanwhile." — or, with no place, "This bottle has no place now: it was taken off meanwhile." (a confirmed unplaced bottle is told apart from one moved to another place) | —                                                                         | the new spot becomes the source; the choice is cleared |
  | no longer in the cellar                                                                    | "This bottle is no longer in the cellar."                                                                                                                                                                       | —                                                                         | stays                                                  |
  | the read fails too                                                                         | "We couldn't reach CELLR to check whether the bottle moved. Nothing is shown as moved." (outcome unknown)                                                                                                       | —                                                                         | stays, with the choice                                 |

  A bottle is never said not to have moved because it was missing from some places that were looked at: the read
  is of the bottle itself, wherever it is. If another member moves it while the panel is reading, the read sees that
  move and says so ("moved meanwhile"); nothing of the earlier request is claimed.

- **Repeating after an uncertain outcome** is the same request again, and the server's checks make it safe: if the
  first one applied, the bottle is no longer on the source the request names, the conditional update matches
  nothing, and the read answers `already_there` (a move: "… was already at …", a take-off: "… already had no
  place"); if it did not apply, it applies now; if someone moved the bottle meanwhile, it is a 409 and the panel
  catches up. Nothing is applied twice and nothing moves that wasn't asked for (browser tests: retry after an unknown
  move and after an unknown take-off; bottle counts unchanged).
- **After a conflict** (409) the panel reads the bottle the same way and takes its current spot (or no place) as the
  new source, so a second try is not stale again.
- **`already_there`** is said as such ("… was already at …. Nothing was changed.") and offers no Undo.
- **Undo** is the same conditional move from the confirmed new spot back to the old one (or the reverse swap from
  the two confirmed spots): refused, and said, when someone has moved either bottle since. It never overwrites a
  later action.

## 6. Single-capacity operations (what works today)

Every place with one bottle per cell (all templates at their default size, every place from before templates once it
has a template): place, move within and across places, take off, swap within and across places, Undo. Old places
without a template are not shown in the new picker (their arrangement is unknown); they keep the existing views.

## 7. Depth, implemented in isolation

- The domain models depth fully (front = index 1, behind a taken front, ordinal counters) and the picker shows it.
- The server refuses index > 1 before asking the database, and the database refuses it independently.
- `supabase/gated-migrations/smart_cellar_move_bottle_v2.sql`: `move_bottle_v2(...)` (SECURITY INVOKER, locks the
  bottle, checks the whole observed source, handles carrying a back bottle to another cell by un-placing it first,
  inside one transaction, maps unique/bounds violations to `taken` / `out_of_bounds`; granted to `authenticated`
  only). **Not a migration.** Exercised by `supabase/tests/99_smart_cellar_move_proposal.test.sql` together with the
  gated index drop and `depth_placement = true`, all inside the suite's rolled-back transaction: back positions,
  already there, stale, taken, out of bounds, a back bottle across cells, across places, off a place, bins counters,
  member allowed, other household not found, invoker/grants.
- The app does **not** call `move_bottle_v2`. **Live depth writes are blocked**; no production capability is claimed
  for them.

## 8. Database / RPC proposals

| Proposal                                       | File                                                                  | Needs                                                                                            |
| ---------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Drop the one-bottle-per-cell index (sprint 1B) | `supabase/gated-migrations/smart_cellar_drop_legacy_slot_index.sql`   | owner decision; compatibility audit of row/col-only clients (§15)                                |
| `move_bottle_v2` (this sprint)                 | `supabase/gated-migrations/smart_cellar_move_bottle_v2.sql`           | the index drop; review; promotion into a numbered migration; then the app calls it for index > 1 |
| Switch depth on                                | `private.cellar_settings.depth_placement` + `DEPTH_PLACEMENT_ENABLED` | both of the above, device validation, owner decision                                             |

No destructive SQL was added to `supabase/migrations`.

## 9. Temperature zones in daily use

- Shown where the placement gate is open (like the rest of this sprint); where it is closed the 3D view shows no
  temperature, as in sprint 2B.3.
- **Unit view**: a legend under the place's facts, one card per zone: "Zone 1 · Serving zone · shelves 1–2",
  "set to 8.0 °C · 6 bottles" (or "no temperature set"), and "Set temperatures are settings, not readings." with
  **Edit zones** (only where the Rack Builder is open) → `/cellar/builder/:id?section=zones`, which scrolls the
  builder to its zones.
- **Picker**: shelf numbers tinted by zone purpose, with the purpose as a title; the panel says "Coloured shelf
  numbers show the temperature zones. A temperature is what the cooler is set to, not a reading."
- **Target sentence / bottle details**: "… shelf 1 · spot 2 · Serving zone (set to 8.0 °C)".
- No zone writes outside the builder's atomic layout save; no sensors, measurements, alerts or advice implied.
- One, two and three zones, a missing temperature and places without zones are covered by domain tests; the browser
  test checks a two-zone cooler, a missing temperature, the details line, the builder link and no legend on a rack.

## 10. Gates

`placementAccessIn(env, api)` (`apps/web/src/lib/smart-cellar-placement-gate.ts`), evaluated on the server:

| Condition                                                                                                                                                                  | Result                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `CELLR_SMART_CELLAR_PLACEMENT` not `1`                                                                                                                                     | closed (default)                                                                                     |
| not an internal preview (`next dev` or Vercel Preview)                                                                                                                     | closed — production builds stay closed whatever is set (tested on an unmarked production build: 404) |
| the Smart Cellar API does not read                                                                                                                                         | closed                                                                                               |
| the API reads but does not write                                                                                                                                           | open read-only: the picker shows, Confirm is absent, writes 403                                      |
| the API writes (`CELLR_SMART_CELLAR=write` + a database verified not to be production: loopback or exactly `CELLR_SMART_CELLAR_WRITE_DATABASE`, never the production host) | open and writing                                                                                     |
| depth                                                                                                                                                                      | only if it writes **and** `DEPTH_PLACEMENT_ENABLED` (false)                                          |

The gate never implies write permission on its own; the service checks both the gate and the API's write level on
every write. No other security setting was changed.

## 11. Screenshots

Contact sheets (desktop and phone, software rendering, local stack):
[`screens/4-placement-desktop.jpg`](./screens/4-placement-desktop.jpg),
[`screens/4-placement-phone.jpg`](./screens/4-placement-phone.jpg),
[`screens/4-kinds.jpg`](./screens/4-kinds.jpg). Made with `VISUAL_PLACEMENT=1 SHOTS_DIR=… pnpm exec playwright test
visual-placement`.

| Required picture                         | Where                                            | What was checked, and fixed                                                                                                                                                                                                                                                                          |
| ---------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Empty storage with selectable cells      | `4-placement-desktop.jpg` (Empty storage)        | every spot a free, labelled target                                                                                                                                                                                                                                                                   |
| Occupied storage                         | both sheets (Occupied)                           | taken spots wine-red; the bottle being moved gold, marked "This bottle"                                                                                                                                                                                                                              |
| A bottle selected                        | both sheets (Bottle selected)                    | the details panel with **Move** next to the wine's page                                                                                                                                                                                                                                              |
| A destination selected                   | both sheets (Destination)                        | the spot ringed in the picker, the **wine-red target ring** in 3D on the same spot, the sentence "It goes to …"; nothing moved yet. _Fixed_: the first tap on a spot was lost because focus jumped back into the stage after the details closed (layout shift); focus now stays where the person is. |
| A swap confirmation                      | both sheets (Swap)                               | "It swaps places with … at …", the button says **Swap**                                                                                                                                                                                                                                              |
| A full compartment / ordinal storage     | `4-kinds.jpg` (Bins)                             | one button per compartment with `used/capacity`; no front/back drawn. _Fixed_: a compartment with one bottle was labelled "full" while it was only unavailable (its next counter needs depth); it now says so and the legend shows "Not available".                                                  |
| A multi-depth rack in isolated test mode | `4-kinds.jpg` (Two-deep rack)                    | made on the local disposable stack only (depth switched on in that database just to write the place, then off again; the app's switch stays off): back spots drawn as narrow hatched marks beside each front, not offered                                                                            |
| A dual-zone cooler                       | both sheets (Zones)                              | two cards, "set to 8.0 °C", "set to 12.0 °C", bottles per zone, "Set temperatures are settings, not readings.", Edit zones                                                                                                                                                                           |
| The mobile placement flow                | `4-placement-phone.jpg`                          | _Fixed_: the 6th column was cut off at 390 px; the picker is tighter on small screens and a 6-column rack fits without sideways scrolling (the browser test checks the page never scrolls sideways and targets are ≥ 40 px)                                                                          |
| The 2D fallback                          | `4-kinds.jpg` (No WebGL), phone sheet (No WebGL) | without WebGL: the flat picture of the place; a bottle chosen there can be moved with the same panel                                                                                                                                                                                                 |

## 12. Unit, integration and database tests

| Suite                                                          | What                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Result                                        |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `packages/domain/src/storage-placement.test.ts`                | the four meanings; depth with and without depth; behind a taken front; ordinal counters, full compartments, no renumbering, a filled compartment refused while depth is off; unknown arrangements; swaps; zones (boundaries, 1/2/3 zones, missing temperature, none); strict contracts (a `householdId` in the body is refused)                                                                                                                                  | 15 passed                                     |
| `apps/web/src/lib/smart-cellar-placement-gate.test.ts`         | off by default; production, unknown and production-database deployments closed; read-only vs writing; depth never on                                                                                                                                                                                                                                                                                                                                             | 5 passed                                      |
| `apps/web/src/server/smart-cellar/service.test.ts` (placement) | closed 404 / read-only 403 before anything is written; refusals before the database is asked (taken, past the cell, outside, unknown arrangement, no such place); every repository outcome mapped (stale, taken retryable, out of bounds, ambiguous, gone, not found); `already_there`, also for from = to (asked of the database); depth on the final index (a filled compartment); swaps; the bottle read (placed, no place, gone, read-only, closed, unknown) | 9 passed (45 in the directory)                |
| `apps/web/src/features/cellar/placement/reconcile.test.ts`     | after a lost answer: done / unchanged / elsewhere (a third place, or confirmed without a place) / gone / unknown, for moves, take-offs, placements and swaps; the whole spot except a compartment counter                                                                                                                                                                                                                                                        | 6 passed                                      |
| `supabase/tests/99_smart_cellar_move_proposal.test.sql`        | `move_bottle_v2` with the gated index drop and depth on, inside the rolled-back transaction (§7); the app's conditional UPDATE: applies once, a stale source matches nothing, a taken spot is a unique violation; **mutation check**: with `bottles_slot_index_unique` dropped (in a savepoint) two bottles do end up on one spot, so the test that says they can't would fail without the index                                                                 | part of the SQL suite: 1,611 passed, 0 failed |
| `scripts/mutation-placement.sh`                                | removes each app-level protection in turn and runs the tests that guard it: the gate's preview rule, its read requirement, depth in the gate; the service's write-level check, its depth checks; the domain's depth, taken-spot, filled-compartment, same-compartment and swap-depth rules. A control run first proves the tests pass unmutated.                                                                                                                 | 10 of 10 mutants killed                       |
| Whole repository                                               | `pnpm test` (all packages)                                                                                                                                                                                                                                                                                                                                                                                                                                       | see §13 for the final run                     |

What the unit tests do **not** prove: the service tests use an in-memory repository. The real repository (the
PostgREST filter chain, the mapping of `23505`, `slot_out_of_bounds`, `slot_index_ambiguous`, the read after a
non-matching update) is proven by the browser/API spec against real PostgREST (§13), and the SQL suite checks the
same UPDATE written by hand.

## 13. Browser results

Production build (`next start`), three servers (3100 nothing set, 3101 an unmarked production build with
`CELLR_SMART_CELLAR_PLACEMENT=1`, 3102 a Vercel-preview build with placement, writes and the local database), the
local stack (real Postgres + PostgREST), Chromium, desktop (1280 × 800) and phone emulation.

| Run                                                                                                                                                                                                                                                                | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `e2e/placement.spec.ts` (new, 27 scenarios × 2 devices)                                                                                                                                                                                                            | 52 passed, 2 skipped (keyboard is desktop-only, the phone check phone-only), 0 failed                                                                                                                                                                                                                                                                                                                                                                                            |
| Regression: placement, smart-cellar-3d, smart-cellar-api, rack-builder, cellar3d(-precision, -premium), racks, drag-swap, cellar, three-view, storage-showcase, storage-premium, premium, detail, drink, add-to-spot, smoke, rack-fill, sheet-overflow (484 tests) | first run: 408 passed, 11 failed, 12 not run (the run stops after 10 failures); every failure re-run below                                                                                                                                                                                                                                                                                                                                                                       |
| `smart-cellar-3d.spec.ts:891` (cooler)                                                                                                                                                                                                                             | **changed on purpose**: it required that no "°" appear in the 3D view; with placement on, the zone legend now shows each zone's _set_ temperature. The test now requires the temperatures to appear only in the legend, as "set to …", with the "settings, not readings" note. Passes.                                                                                                                                                                                           |
| `smart-cellar-3d.spec.ts:466`, `:701`, `:743`, `smart-cellar-api.spec.ts:654`, `storage-showcase.spec.ts:82`, `:672`, `three-view.spec.ts:146`                                                                                                                     | failed only in the long runs (1.2 h and 0.5 h, two workers); passed in every targeted re-run: `:466` alone 6 of 6 (both devices, `--repeat-each 3`), the whole `smart-cellar-3d` file on both devices in parallel, `placement` followed by `smart-cellar-3d` in one run (82 passed; the preview server's memory flat at ~360 MB), and the remaining files (127 passed). Classified as timing under load (5 s waits while two software-rendering browsers run); not reproducible. |
| `cellar3d.spec.ts:171` (desktop and phone)                                                                                                                                                                                                                         | fails, as on `main` (reported since sprint 2B.3; not touched here)                                                                                                                                                                                                                                                                                                                                                                                                               |
| Visual photographer (`visual-placement`, 3 runs × 2 devices)                                                                                                                                                                                                       | 6 passed; pictures in §11                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Bench (`perf-placement`, 2 devices × 4 sizes, 80 timed moves)                                                                                                                                                                                                      | passed; §14                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

Accessibility: the keyboard scenario runs an axe audit with the placement panel open (no violations); the picker is a
`group` of buttons with full spoken labels ("Shelf 3, spot 4: free", "Shelf 1, spot 2: Pavillon Rouge 2015. Choose to swap"), a roving tab
stop and arrow keys; the panel's heading takes focus when it opens and focus returns to "Place a bottle" when it
closes; touch targets 40 px and more; reduced motion is honoured (the phone scenario runs with it).

## 14. Performance

Bench: `e2e/perf-placement.spec.ts` (`PERF_PLACEMENT=1 PERF_OUT=… pnpm exec playwright test perf-placement
--workers=1`). One household per size, a `rack_classic` place full but for one free spot, **ten confirmed moves**
per size (five rounds of there and back, each: take the bottle out → Move → choose the spot → confirm). Same machine
as sprints 2B.3 and 3: 4 cores, **SwiftShader software rendering**, Chromium headless, production build, local stack.
These numbers compare builds on one machine. **They are not a phone's and no frame rate on a real device is claimed.**

"1,200" is 900 bottles in the measured place plus 300 in a second place: one place cannot hold 1,200 single bottles
(30 × 30 is the largest grid and more than one bottle per cell needs depth, which is off). It shows what a bigger
household adds: nothing to the picture.

| Desktop (1280 × 800)                                         | 40          | 200         | 900          | 1,200 (899 + 300) |
| ------------------------------------------------------------ | ----------- | ----------- | ------------ | ----------------- |
| Bottles in the picture                                       | 39          | 199         | 899          | 899               |
| Draw calls / triangles at rest                               | 16 / 32,310 | 12 / 79,592 | 12 / 355,480 | 12 / 355,480      |
| Navigation → first picture with all bottles (ms)             | 6,674       | 6,301       | 6,422        | 6,459             |
| Pictures in 3 s at rest / with the panel open                | 0 / 0       | 0 / 4       | 0 / 2        | 0 / 2             |
| Bottle out (Enter → details open), median (ms)               | 767         | 960         | 1,223        | 1,232             |
| Move → panel with the picker, median (ms)                    | 2,363       | 3,197       | 4,098        | 4,754             |
| Destination chosen → the picture with the target ring (ms)   | 20          | 30          | 56           | 56                |
| Confirm → answer, refresh, bottle drawn on its new spot (ms) | 2,654       | 2,875       | 4,488        | 3,570             |
| API requests per confirmed move (the move + refreshes)       | 5           | 5           | 5            | 5                 |
| Geometries / textures / programs after each of 5 rounds      | 35/8/32 ×5  | 32/6/29 ×5  | 32/6/29 ×5   | 32/6/29 ×5        |
| Furniture models built (start → after 10 moves)              | 1 → 1       | 1 → 1       | 1 → 1        | 1 → 1             |
| Pictures in 3 s at rest after 10 moves                       | 0           | 0           | 0            | 0                 |
| JS heap before → after 10 moves (MB)                         | 31.2 → 30.9 | 53.6 → 27.4 | 35.6 → 25.1  | 25.9 → 37.4       |
| Canvases                                                     | 1           | 1           | 1            | 1                 |

| Phone (Pixel-class emulation)                              | 40          | 200         | 900          | 1,200 (899 + 300) |
| ---------------------------------------------------------- | ----------- | ----------- | ------------ | ----------------- |
| Draw calls / triangles at rest                             | 16 / 32,310 | 12 / 79,592 | 12 / 355,480 | 12 / 355,480      |
| Navigation → first picture with all bottles (ms)           | 6,234       | 5,019       | 6,275        | 6,523             |
| Pictures in 3 s at rest / with the panel open              | 0 / 0       | 0 / 0       | 0 / 2        | 0 / 2             |
| Bottle out, median (ms)                                    | 423         | 455         | 1,271        | 1,155             |
| Move → panel with the picker, median (ms)                  | 1,266       | 1,269       | 4,081        | 4,237             |
| Destination chosen → the picture with the target ring (ms) | 18          | 23          | 49           | 61                |
| Confirm → bottle drawn on its new spot, median (ms)        | 5,224       | 5,657       | 3,618        | 4,264             |
| Geometries / textures / programs after each of 5 rounds    | 35/8/32 ×5  | 32/6/29 ×5  | 32/6/29 ×5   | 32/6/29 ×5        |
| Furniture models built (start → after 10 moves)            | 1 → 1       | 1 → 1       | 1 → 1        | 1 → 1             |
| JS heap before → after 10 moves (MB)                       | 24.8 → 27.3 | 54.3 → 27.6 | 59.3 → 29.9  | 35.8 → 30.6       |

**Compared with sprints 2B.3 and 3 (same machine, same kind of build):**

- **The picture costs what it cost.** Draw calls at rest 16 / 12 / 12 and triangles 33,122 / 79,980 / 355,868 in
  2B.3 for 40 / 200 / 900 bottles; here one bottle fewer per size (a free spot is needed to move), and the
  triangles differ by exactly one bottle. The 2B.3 bench itself, run on this branch's build, gives the same 16 calls
  and 33,122 triangles at 40.
- **One shader program more, once.** 2B.3 held 35/8/31 (40) and 32/6/28 (200, 900) after an inspection; here
  35/8/32 and 32/6/29: the target ring's material. It is compiled the first time a destination is chosen and never
  again (the counts are identical after every round). Geometry: none added (the ring reuses the existing ring).
- **Moving never rebuilds the furniture** (one model from start to finish), draws nothing at rest before or after,
  keeps one canvas, and the heap does not grow over ten moves (it ends lower or within a few MB, which is garbage
  collection timing).
- **Navigation → picture** is measured differently from the sprint 3 table (here: from `goto` until the canvas
  reports every bottle; sprint 3: until the first picture), so the 5.0–6.7 s here and the 4.2–4.9 s there are not a
  regression claim either way.

**What the numbers say about the interaction:**

- Choosing a destination is cheap: the ring is in the next picture 18–61 ms after the tap (the time until that
  picture is handed to the renderer; in software rendering the pixels follow at the rasteriser's pace).
- Move → panel (1.3–4.8 s) and confirm → bottle drawn (2.7–5.7 s) are dominated by **pictures**: the put-back
  animation of the bottle that was out, and the picture with the bottle on its new spot, at about a second per
  picture at 900 bottles in software rendering (2B.3: 883 ms between pictures while turning 900). The data part is
  small: one move and four refresh requests against the local stack (2B.3 measured the bottles read at ~80 ms).
  On a GPU these are a few frames; **that is to be confirmed on real phones** (§18).
- No tap was lost in 80 timed moves (`lostTaps: 0`); an earlier run lost one Move tap at 200 bottles on desktop
  while the details were still opening, which the bench now waits for (the product: a tap during the opening
  transition can be ignored; noted in §17).

## 15. Legacy compatibility audit

| Path                                              | Result                                                                                                                                                                             |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PATCH /api/v1/bottles/:id` move / swap           | unchanged code; covered by the placement spec ("existing ways of moving", the old swap after a Smart Cellar swap) and by the existing suites (`drag-swap`, `racks`, `add-to-spot`) |
| Racks grid, legacy drag and drop, storage editing | unchanged; suites re-run (§13)                                                                                                                                                     |
| Wine details, open / remove / restore             | unchanged; a moved bottle shows its new place there after the refresh                                                                                                              |
| 2D/3D navigation, export v1                       | unchanged                                                                                                                                                                          |
| Friends' cellars                                  | the new endpoints only ever act on the active household; another household's bottle and place are 404                                                                              |
| Clients that know only row/col                    | index 1 is what they read and write; the new endpoints never write index > 1; a bottle at index > 1 cannot exist live (old unique index)                                           |
| Multi-bottle cells                                | **not activated**; needs the compatibility audit and the gated proposals (§8)                                                                                                      |

## 16. Concurrency and retry

Covered against the real database: six bottles sent to one free spot at the same moment (exactly one 200, five
409, one bottle on the spot); one bottle sent to two spots at once (one 200, one 409, it is on one of them); no
bottle lost or doubled. A stale source and a taken target change nothing. A repeat after a lost answer:
`already_there`. In the UI: a request that never arrives → "The bottle didn't move"; one that arrives but whose
answer is lost → a fresh read finds the bottle on its target → reported as moved. Undo after another member's move:
refused, the later move stands. Swap concurrency (10 sessions on one pair, opposite orders, no deadlock) is the 1B
script `scripts/db-placement-concurrency.sh`.

## 17. Risks

### Final review corrections (after the PR was opened)

| #   | Finding                                                                                                                                                                              | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | CI failed in `src/server/system/registry.test.ts` (from `main`, PR #85): the architecture inventory did not list the new routes.                                                     | `main` merged into the branch (no rebase); `pnpm architecture:inventory` regenerated `inventory.generated.json` (move, swap and the new read); the routes and the `CELLR_SMART_CELLAR_PLACEMENT` gate registered under the Smart Cellar component. The inventory test is unchanged.                                                                                                                                                                                                                                                                                                                                    |
| 2   | A take-off whose answer was lost was not reconciled; moves and swaps looked for the bottle only in the two places involved, so a bottle moved elsewhere could be called "not moved". | One authoritative read of the bottle (`GET /smart-cellar/bottles/:id`, additive, read-only) and one pure judgement (`reconcile.ts`) for moves, swaps and take-offs; a confirmed unplaced bottle is told apart from one moved elsewhere; a failed read is "unknown"; no Undo for anything established by reading afterwards; retry is safe (§5). Tests on the real stack: a take-off that never arrives, one whose answer is lost, a concurrent move to a third place, a bottle confirmed without a place, a failed check, retries of a move and of a take-off without duplication, no Undo after an uncertain outcome. |

### Adversarial review (phase F)

An independent review of the whole change (code only, not this report) found the following; each was verified and
resolved before the PR, with a test where one was missing.

| #   | Finding                                                                                                                                                                                                                        | Severity   | Resolution                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The service's depth check ran before a compartment's landing counter was chosen: a bins place with one bottle in a compartment would have been written at counter 2 with depth off (only the database's old index stopped it). | Medium     | Depth is now checked on the final index, after the counter is chosen; the domain rule refuses it too (`placementProblem` → `depth_not_enabled`). Service and domain tests added; both protections are mutation-checked. |
| 2   | `already_there` was shown as "is now at …" with an Undo; if someone else had put the bottle there, that Undo would have overwritten their move.                                                                                | Medium     | `already_there` says "… was already at …. Nothing was changed." with no Undo.                                                                                                                                           |
| 3   | A move with `from` = `to` was answered 200 without asking the database (also for a bottle that doesn't exist).                                                                                                                 | Medium     | Every move goes to the database; a no-op that matches is `already_there`, anything else is decided by the fresh read (404, 409). Test changed accordingly.                                                              |
| 4   | The lost-answer check compared place, shelf and position but not the index.                                                                                                                                                    | Medium     | The whole spot is compared, except in a compartment of counters (where the server chooses the counter). A move or swap established only by reading afterwards offers no Undo.                                           |
| 5   | After a refusal the panel kept the old source, so every retry was stale again.                                                                                                                                                 | Low/medium | After a conflict the panel reads where the bottle is now, makes that its source and clears the choice (browser test).                                                                                                   |
| 6   | A swap retried by hand after a lost answer says "just moved by someone else".                                                                                                                                                  | Low        | Kept (safe: nothing is applied twice); the automatic check after a lost answer reports the swap correctly (browser test).                                                                                               |
| 7   | Index 2 on a one-bottle cell answered 409 "depth" instead of 422.                                                                                                                                                              | Low        | Bounds are checked before depth: 422 "That spot doesn't exist in this place."                                                                                                                                           |
| 8   | Dark-mode contrast of the zone-tinted shelf numbers and the current spot; focus lost when the panel closes; back spots not reachable with arrows; "8.0" in Dutch.                                                              | Low/medium | Dark text on the light tints; focus returns to "Place a bottle"; left/right step through a cell's spots first; temperatures formatted per locale ("8,0" in Dutch).                                                      |
| 9   | The service tests use a fake repository; the real filter chain and error mapping are proven only by the browser/API tests; the SQL suite checks a hand-written copy of the UPDATE.                                             | Note       | Stated here (§12). The browser/API spec runs the real repository against real PostgREST for every outcome.                                                                                                              |

The review also confirmed as sound: the gate (production, unknown deployments and a preview on the production
database cannot write; depth always false), household isolation, the atomic conditional UPDATE and its concurrency,
`swap_bottles_v2` locking and conditional Undo, no success shown before the server's answer, the zone wording, the
unchanged legacy endpoints, and the gated function's rollback of its two steps.

| Risk                                                       | Severity                         | Mitigation / what remains                                                                |
| ---------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------- |
| No physical-device validation of the placement flow        | High (before any production use) | Protocol below (§18); the 2B.3 and sprint 3 protocols still apply                        |
| Depth stays off; multi-bottle cells impossible live        | Known limitation                 | Gated proposals (§8) and an owner decision                                               |
| Undo is offered for a few seconds only (toast)             | Low                              | After that, the move is undone by moving again                                           |
| Old places without a template cannot be used in the picker | Low                              | They keep the existing views; giving them a template in the builder makes them placeable |

## 18. Production checklist (not done; each needs the owner)

1. Physical-device validation of the placement flow on iPhone and Android (below).
2. Decide on activating the Smart Cellar API writes for production; that is the sprint 1C / 3 checklist, unchanged:
   production keeps refusing writes until a separate, reviewed change allows its database.
3. Set `CELLR_SMART_CELLAR_PLACEMENT=1` only on a preview first; production stays closed by code.
4. Depth: the index drop, `move_bottle_v2`, the depth switch — each a reviewed migration and an owner decision.

**Device protocol (placement)**: on each phone, open the 3D cellar of a household with a rack and a dual-zone
cooler; (a) tap a bottle, Move, pick a free spot, confirm — the bottle appears there only after the toast; (b) Undo;
(c) swap two bottles; (d) place a bottle without a place, spot first; (e) airplane mode before confirming: "The
bottle didn't move", nothing moved; (f) with VoiceOver/TalkBack, move a bottle using only the picker; (g) the
cooler's legend reads "set to …" and Edit zones opens the builder at its zones; (h) rotate the phone with the panel
open: no horizontal scrolling, nothing hidden under the home indicator; (i) 30 moves in a row: no slowdown, no
blank picture; note the frame rate only from the device's own tools.

## 19. Sprint 5 dependencies

- The placement rules (`cellChoices`, `placementProblem`, `zoneSummaries`) are the inputs a suggestion engine
  needs: free spots, their zone and its set temperature, what a spot means.
- A suggestion must use the same move endpoint and confirm flow (nothing placed without confirmation).
- Depth-aware suggestions wait for the depth decisions of §8.

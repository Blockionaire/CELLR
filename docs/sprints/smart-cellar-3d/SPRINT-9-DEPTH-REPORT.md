# Smart Cellar 3D, sprint 9 — Depth Storage: compatibility, migrations and disabled-by-default implementation

Pull request: "Depth Storage: compatibility, migrations and disabled-by-default implementation". Branch
`claude/sc3d-depth-bqvck4`, on top of sprint 8 (`claude/sc3d-layout-cas-bqvck4`). The audit and the rollout design:
[`ADR-011`](ADR-011-depth-placement-rollout.md). **This is the backend half.** The UI half (index-aware picking in the
3D scene, the spot picker, Quick Add, Rack Builder depth configuration) is §8, for a later run.

**Nothing is switched on anywhere.** Production keeps `depth_placement = false`, `bottles_slot_unique`, and today's
behaviour byte for byte; the new gate `CELLR_SMART_CELLAR_DEPTH` cannot open on production by configuration.

## 1. What was built

| Area                        | What                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migration 0057 (additive)   | `public.move_bottle_v2` (the sprint 4 gated proposal, reviewed again, SQL unchanged); `public.smart_cellar_depth_status()` → `{depth_placement, legacy_cell_index, index_unique, move_v2}` (definer, read-only, no rows, authenticated only); `private.depth_occupancy_report()` (owner only).                                                                                        |
| Gated (no number)           | `smart_cellar_depth_switch_on.sql` (refuses unless the old index is gone, the new one valid and `move_bottle_v2` present), `smart_cellar_depth_switch_off.sql` (moves nothing), `smart_cellar_depth_collapse_to_front.sql` (the way back: lone back bottles to the front of their own cell; refuses, changing nothing, while a cell holds two). The index drop stays gated as it was. |
| Domain                      | `DepthDatabaseStatus`, `readDepthStatus` (strict), `depthBlockOf`; `SmartCellarCapabilities.depthPlacement: boolean` and optional `depth`; `layoutChangeProblem(…, { depthEnabled })`; `cellCapacitySavableWith` / `templateSavableWith` (separate functions: the one-argument versions are passed to `filter`); `reachable()` — the physical front rule.                             |
| Server gate                 | `lib/smart-cellar-depth-gate.ts`: `CELLR_SMART_CELLAR_DEPTH === "1"` AND `internalPreviewIn` (dev, Vercel preview) AND placement writes. **Not** the production release.                                                                                                                                                                                                              |
| Service                     | Depth decided per request: gate ∧ placement writes ∧ API writes ∧ database (`depthStatus`, asked once, only when the gate is open). Used for capabilities, layout saves, moves (`move_bottle_v2` where open), swaps, advice. New refusal `frontInTheWay` (a bottle behind another is not reachable).                                                                                  |
| Old routes (minimal)        | `server/db/errors.ts`: `slot_index_ambiguous` now says "This bottle lies behind another one, so it can't be moved from here." `server/cellar/repository.ts` + `service.ts`: the old swap's `stale` is told apart from "lies behind another one" (one read on that refusal only). Both can only fire with depth on.                                                                    |
| Wiring (minimal)            | `server/env.ts` `isDepthGateOpen()`, `server/services.ts` passes `depthGate`; `lib/known-messages.ts` + `errors.known` (en, nl): three sentences.                                                                                                                                                                                                                                     |
| Rack Builder (domain rules) | `assess(…, depthEnabled = false)`: deep templates savable only when the server says depth is open. The screen still passes nothing (false): wiring `caps.depthPlacement` is the UI half.                                                                                                                                                                                              |
| Opt-in depth stack          | `STACK_DEPTH=1` → `scripts/local-stack/up.sh` applies the gated drop + switch to its own throwaway cluster (refused for any other URL, and with `STACK_MIGRATIONS_BEFORE`), and `playwright.config.ts` opens the depth gate on the preview server only. Default off; CI never sets it.                                                                                                |

## 2. Decisions

- **The old index is not dropped by this work, and is not assumed droppable.** ADR-011 §1.1 says what it protects; §2–3
  what each legacy path does without it. Finding: every legacy WRITER is safe at the database level (refuses, or acts
  on the front); the legacy READERS are not (the racks grid, the legacy 3D view, export v1, sommelier copy, friend racks
  draw or name one bottle per cell). So the drop (phase C) needs the UI half and those readers first — and phase C
  alone is reversible as long as the switch stays off.
- **The database decides "on", the app only narrows.** The capability is read through one definer function rather
  than by exposing `private`. Anything the app cannot read is "off".
- **Reachability is a server rule, not a constraint.** "Behind a taken front" is a valid end state; the order of
  physical operations cannot be a row constraint. Enforced on targets (existing `behind_taken`) and now on sources
  (`frontInTheWay`) where depth is open.
- **Old paths refuse or use the front, never a guessed index** (README rule 7). Undo (restore) into a place more
  than one deep restores the bottle WITHOUT a place (opening reset its index; the old depth cannot be known), one-deep
  places as before (review finding L2).
- **Switching off is a kill switch** (review finding L5): 0057's `bottles_location_depth` refuses any new bottle on an
  index above 1 while the switch is off, also in places that are already deep; back bottles may stay, be opened or
  come forward. Mapped to the existing "isn't switched on" refusal on the new move path only (the old mapping of
  `depth_not_enabled` stays VALIDATION, as pinned).
- **Rejected:** a DB trigger making legacy writes refuse whenever depth is on (it would break every old client of
  one-deep places, which are all places); a second `swap_bottles_v3` with the front rule in SQL (the end state is
  valid; the rule is about order, and `swap_bottles_v2` stays the one swap).

## 3. Tests — real results

| Command                                     | Result                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bash scripts/db-test.sh`                   | final: 1,765 passed, 0 failed, 0 errors (sprint 8 tip: 1,723; the existing suites unchanged with 0057 present). New `99_smart_cellar_depth.test.sql`: 42 checks, incl. the kill switch (status as deployed / after drop / after switch; three bottles in one cell; moves and swaps across depths; every OLD writer against depth storage; the report; switch off moves nothing).                            |
| `bash scripts/db-placement-concurrency.sh`  | green, new step 13: 18 concurrent `move_bottle_v2` into the 3 indexes of one cell → 3 moved (one per index), 15 taken; 10 concurrent moves of one back bottle → 1 moved, 9 stale; front-vs-back of one cell × 30 → front + back every round; old index-less move vs `move_bottle_v2` of the same back bottle × 20 → the old one refused as ambiguous every round. 59 s.                                     |
| `bash scripts/db-smart-cellar-upgrade.sh`   | green: all later migrations (0055, 0057) on a filled database leave every row identical (ctid, xmin); status says off/old index; new step 7 (throwaway only): switch refuses with the old index, switches on without it; switch off moves nothing; collapse refuses with a crowded cell (nothing changed), works after the household moved one; one deep again; old index recreated; cellar rows identical. |
| `bash scripts/db-layout-cas-concurrency.sh` | green (sprint 8 numbers, unchanged).                                                                                                                                                                                                                                                                                                                                                                        |
| domain `storage-depth.test.ts`              | 42 tests: every template with `cellCapacity.max > 1` (the 12 deep-capable ones), depth off and on; status parsing.                                                                                                                                                                                                                                                                                          |
| web unit                                    | service depth: 10 tests (gate closed: database never asked and capabilities have exactly the old keys; every block reason; all open; v2 moves; reachability); gate: 3; old-swap `behind`: 2; builder: 2.                                                                                                                                                                                                    |
| e2e                                         | desktop, local stack, after `pnpm build`: `playwright test rack-builder smart-cellar-api -g "…sprint 8 tests…                                                                                                                                                                                                                                                                                               | depth | the switch | writing a layout | reading"`: 23 passed, 2 skipped (the opt-in depth tests); after the L1 fix: `-g "old API | depth fixture | the switch | refused, and nothing changed | If-Match | two sessions"`13 passed. **Opt-in**`STACK_DEPTH=1 … smart-cellar-api -g "depth on"`: first run 1 passed, 1 FAILED — it found that the old move turned `slot_index_ambiguous`into "That spot was just taken" (fixed in`382daba`); re-run **2 passed**. The kill switch and the Undo change came after these runs and are covered by the SQL suite and unit tests, not re-run in e2e. |

## 4. Production activation sequence (each step its own owner approval)

1. **Phase A** — merge; apply 0057 by `docs/MIGRATIONS.md` §2. Check: `select public.smart_cellar_depth_status()` →
   switch false, `legacy_cell_index` true. Nothing visible changes.
2. **Phase B** — the UI half (§8) and the legacy readers of ADR-011 §3; the opt-in depth e2e green.
3. **Phase C** — release `smart_cellar_drop_legacy_slot_index.sql` as a numbered migration in a PR of its own.
   Reversible while the switch is off (ADR-011 §6).
4. **Backup**, then **phase D** — release `smart_cellar_depth_switch_on.sql` likewise.
5. **The reviewed code change** in `lib/smart-cellar-depth-gate.ts` that lets the authorized production release open
   the gate, plus `CELLR_SMART_CELLAR_DEPTH=1` in production. Until then production offers nothing of depth whatever
   the database says.
6. Device checks of depth placement and of the three deep templates.

## 5. Rollback limits

- **Point of no return: the first cell holding two bottles**, not the index drop (with the switch off the drop can be
  undone). Check: `select count(*) from private.depth_occupancy_report() where bottles > 1` = 0.

- A: drop the functions in a new migration (nothing calls them on production). B: app rollback.
- C: re-create the old index (cannot fail while the switch is off: every place is one deep).
- D: the switch off moves nothing. Once any cell holds two bottles, the old index cannot come back until each such cell
  is emptied to one bottle **by its household**; `private.depth_occupancy_report()` lists them, the collapse file
  refuses until then and never picks a cell. Old clients meanwhile see one bottle per cell (§3 of the ADR). No path
  deletes or moves a bottle on its own. Rehearsed in `db-smart-cellar-upgrade.sh` step 7.

## 6. Not built, not proven, risky

- No UI: nothing in the 3D scene, spot picker, Quick Add or the Builder offers depth yet (§8).
- The legacy readers (ADR-011 §3) still assume one bottle per cell. They are the blocker for phase C/D, not this branch.
- Friend racks (`friend_racks`, 0015) would show two bottles at one position: workstream B / a later migration.
- Exports v1 lose the index (v2 keeps it). Not changed.
- The depth e2e is opt-in and only runs on a local throwaway stack; CI never runs it.
- `move_bottle_v2` was promoted in the same branch as other work; the gated README asks for a PR of its own (it is its
  own commit).

## 7. Contract for other workstreams

- `public.smart_cellar_depth_status()` is the one supported way for an API role to read the depth switch. Meaning of
  the switch unchanged (the database's `private.cellar_settings.depth_placement`).
- A server should treat depth as open only with `depthBlockOf(readDepthStatus(…)) === null` AND its own gate;
  anything unreadable is off.
- `CELLR_SMART_CELLAR_DEPTH` is the one app gate; do not add another for depth.

## 8. UI handoff (the contract the UI half implements)

**Capability.** `GET /api/v1/smart-cellar` → `depthPlacement: boolean` (the only field to branch on) and, only where
the gate is open, `depth: { gate: true, database, open, blockedBy }` (for diagnostics; never shown as a reason to a
person beyond "not available here"). With `depthPlacement` false the UI must be exactly today's.

**Payloads** (unchanged shapes, ADR-008): `POST /smart-cellar/bottles/:id/move { from: SmartSpot | null, to:
SmartSpot | null }`, `POST /smart-cellar/bottles/:id/swap { with, expected: { self, other } }`, every spot whole
`{ locationId, row, col, index }`. New refusals (409): `"Another bottle is in front of this one. Move that one
first."` (source not reachable), existing `"Another bottle is in front of that spot."` (target behind a taken front),
`"More than one bottle per position isn't switched on yet."` (index > 1 with depth closed). Old routes may now answer
`"This bottle lies behind another one, so it can't be moved from here."` and `"One of these bottles lies behind another
one, so they can't trade places from here. Nothing was changed."` (all in `errors.known`).

**Addressing front/back in the 3D scene, per family** (poses: `storage3d/families.ts`, owned by D):

| Family / semantics                                        | Pose source                                              | What a tap/aim selects                                                                                                                                                                                                                                     |
| --------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| grid, `depth` (racks, coolers, cabinets, shelving, rails) | `poseOf(row, col, index)` (z steps back per index)       | A bottle: the frontmost bottle of the cell is pickable; one behind a taken front is shown, marked "behind", **not** pickable as a move source (`reachable()` false). A target: `cellChoices(...).spots` states — only `free` is offerable; `behind` never. |
| bins / cubes, `ordinal`                                   | `pileOf(row, col, rank)` (rank = how many already in it) | The compartment as a whole: target `cellChoices(...).next` (the server picks the counter, `landingSpot`); never show or accept a counter as a place (README rule 2). Every bottle in it is reachable.                                                      |
| wall pegs, `single`                                       | `poseOf(row, col, 1)`                                    | As today.                                                                                                                                                                                                                                                  |
| unknown arrangement                                       | neutral                                                  | Nothing offered as a target; bottles may leave.                                                                                                                                                                                                            |

**Spot picker** (`placement/`, A): pass `depthEnabled: caps.depthPlacement` to `cellChoices`/`placementProblem`; show
per cell `used/capacity`; in depth places list spots front first with their state; offer only `free`; for bins offer
the compartment with "n of m". Refuse with the server's sentence, never pre-guess an index.

**Quick Add** (A): with depth open, a chosen spot is a whole `SmartSpot` through the new move API (index included);
the old `POST /bottles` slot stays index 1 (and refuses a cell that holds any bottle).

**Rack Builder** (builder, C): pass `caps.depthPlacement` as `assess(…, depthEnabled)` and to the cell-capacity stepper
(`cellCapacitySavableWith`); the three deep templates then lose "Preview only". Never let a save make a place shallower
than a back bottle (the domain already refuses: `in_use`), never change semantics under bottles
(`semantics_change`).

**Blocking preconditions of the switch (phase D)**, every one listed with its file in ADR-011 §3: `rack-grid.tsx:96`
and `racks-view.tsx:72` (Map keyed row:col, last wins), `use-rack-drag.ts` (drags the wrong bottle), `where-sheet.tsx:13`
and `friend-screen.tsx:492` (duplicate keys), `three/scene.tsx:998` (two bottles at one transform),
`storage3d/template-scene.tsx` `SpotMarkers` (`active` compares row and col only: every free index of a cell drawn as
chosen — Agent D), legacy capacity `rows × cols` (`server/cellar/service.ts:75`, stats, sommelier `cellar-facts`),
`occupiedSlots`/`updateBottle` (`server/cellar/repository.ts`), export v1 (no index), `friend_racks` (0015), and the
shared-rack functions (B, 0056), which must take the same front/back rule inside their transaction.

**Legacy readers** (phase B blockers, unowned): racks grid and legacy 3D view must show "+n behind" per cell or route
deep places to the new view; sommelier/tonight copy should say "behind" for index > 1; export v1 should either refuse
deep places or say it is lossy.

## 9. Wave 2: review follow-up and the UI half

**Review (Agent E) follow-up**, commit `eb6b672`: `move_bottle_v2` answers `'depth_not_enabled'` (switch off, back
target) instead of raising; the gated collapse prints which households and places it records at the front, and ADR-011
makes telling them a step; ADR-011 §1.3 says the Undo fix is app-side only; the shared-rack writers
(`shared_rack_place`/`shared_rack_move`, 0056) are a write path and their kill-switch refusal a phase-D precondition.

**UI, all behind `capabilities.depthPlacement`** (`features/cellar/depth.ts`, `useDepthOpen()`; false wherever the gate
is closed, so nothing changes there):

| Area                                         | Done                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2D spot picker (`placement/spot-picker.tsx`) | Spots past index 1 offered only with depth open (`cellChoices(…, { depthEnabled })`); "place n from the front" only where the index is a position (never for an unknown arrangement); a taken bottle behind another is not offered as a swap partner and says "move the front one first". The panel's wording was already index-aware. |
| 3D template renderer                         | Already drew real bottles at their index (`poseOf(row, col, index)`, piles by count: D's work) and compares markers by whole spot. A tap reaches the front bottle (geometry); a back bottle is reached through the 2D list, which is always the precise way.                                                                           |
| Rack Builder                                 | `assess(…, depth)`, the bottles-per-spot stepper and the catalogue cards: the three deep templates savable only with depth open; closed, exactly today's "preview only" with the reason.                                                                                                                                               |
| Racks grid (`rack-grid.tsx`)                 | Draws a cell's FRONT bottle (`cellsOfBottles`, never "last one wins"), says "+n behind … move those from the 3D view", marks a lone bottle at the back, never starts a drag from such a cell. The racks answer carries an index only when above 1 (byte-identical while depth is off).                                                 |
| Friend screen                                | Unique synthetic ids when a cell holds two bottles.                                                                                                                                                                                                                                                                                    |
| Legacy 3D view                               | Pinned in SQL: a place without a template can never be more than one deep, also with depth on.                                                                                                                                                                                                                                         |
| Quick Add                                    | **Not changed**: it adds through `POST /bottles` with a slot, which names no index, so it stays at index 1 (and refuses a cell that holds any bottle). Index-aware Quick Add needs the add route to take an index, or Quick Add to add unplaced then move.                                                                             |

**CI:** new job `e2e-depth` (not on pull requests, like `e2e`; desktop only): `STACK_DEPTH=1 … e2e depth-ui
smart-cellar-api -g "depth on"`, counted in `e2e-result`.

### 9.1 Preconditions of switching depth on (phase D): state after wave 2

| Precondition (ADR-011 §3)                                                       | State                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Spot picker / placement panel index-aware, front rule                           | **Met**                                                                                                                                                                                                                                          |
| Rack Builder depth configuration, validation against back bottles               | **Met**                                                                                                                                                                                                                                          |
| Racks grid never loses a bottle; drag never moves the wrong one                 | **Met** (racks view's small slot preview colours a cell once: cosmetic)                                                                                                                                                                          |
| Friend screen unique keys                                                       | **Met**; but `friend_racks` (0015) names no index: which of two is the front is unknown there — **not met** (needs a migration)                                                                                                                  |
| Legacy 3D view                                                                  | **Met for places without a template** (pinned). A templated deep place drawn by the legacy view (renderer gate closed while the depth gate is open) would overlap two bottles: **precondition**: open depth only where `CELLR_SMART_CELLAR_3D=1` |
| `SpotMarkers` whole-spot compare                                                | **Met** (D)                                                                                                                                                                                                                                      |
| Quick Add at depth                                                              | **Not met** (stays index 1, safe)                                                                                                                                                                                                                |
| Legacy capacity `rows × cols` (cellar service, stats, sommelier `cellar-facts`) | **Not met**: needs `cell_capacity` read in the old storage queries (and a guard for databases before 0043)                                                                                                                                       |
| `occupiedSlots` (a free front before a back bottle counts as taken)             | **Not met** (conservative: refuses, never misplaces)                                                                                                                                                                                             |
| Export v1 (no index)                                                            | **Not met**: document/refuse; v2 carries the index                                                                                                                                                                                               |
| Shared racks kill switch + front rule in the transaction                        | **Not met** (Agent B)                                                                                                                                                                                                                            |
| Depth e2e green in CI                                                           | **Job added**; first CI run pending                                                                                                                                                                                                              |

### 9.2 Results

Local stack, desktop, CI's headless shell, one build at `0598351`:

- **Depth on** (`STACK_DEPTH=1 … depth-ui smart-cellar-api -g "depth on"`): **5 passed** (31 s): a back spot offered,
  placed into and named in the list; the back of a cell with a taken front not offered; the racks view's two-bottle
  cell ("+1 behind", front bottle, no drag); the Builder saving a double-depth rack and refusing a smaller layout that
  strands a back bottle; old endpoints against depth storage; the capability only on the preview.
- **Depth closed** (`rack-builder placement racks friends drag-swap add-to-spot depth-ui`): **65 passed, 10 skipped**
  (the opt-in depth tests and existing mobile skips), 0 failed (8.4 min).
- On the way, the closed run found a regression of the compare-and-swap follow-up 613af32 (`rack-builder.spec.ts:593`:
  after a save whose refresh fails, the cached place from before the save read as news and disabled Save). Fixed here
  in `0598351` and on the compare-and-swap branch in `e663b12` (`revisionIsNews`, unit-tested).
- A first depth run with `-g "depth"` failed 2 tests because it also ran the depth-OFF "depth fixture" test, which
  turns the stack's switch off; the CI job filters `-g "depth on"`.
- Not re-run after these: the phone project for the depth specs, the 3D suites (`quick-add`, `storage-*`).

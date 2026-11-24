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
| Migration 0054 (additive)   | `public.move_bottle_v2` (the sprint 4 gated proposal, reviewed again, SQL unchanged); `public.smart_cellar_depth_status()` → `{depth_placement, legacy_cell_index, index_unique, move_v2}` (definer, read-only, no rows, authenticated only); `private.depth_occupancy_report()` (owner only).                                                                                        |
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
- **Old paths refuse or use the front, never a guessed index** (README rule 7). Restore (Undo) of a back bottle comes
  back at the front when free, else without a place — the old writer never named an index.
- **Rejected:** a DB trigger making legacy writes refuse whenever depth is on (it would break every old client of
  one-deep places, which are all places); a second `swap_bottles_v3` with the front rule in SQL (the end state is
  valid; the rule is about order, and `swap_bottles_v2` stays the one swap).

## 3. Tests — real results

| Command                                     | Result                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bash scripts/db-test.sh`                   | 1,754 passed, 0 failed, 0 errors. With 0054 present and before the new file: 1,717 (= sprint 8): the existing suites unchanged. New `99_smart_cellar_depth.test.sql`: 37 checks (status as deployed / after drop / after switch; three bottles in one cell; moves and swaps across depths; every OLD writer against depth storage; the report; switch off moves nothing).                                   |
| `bash scripts/db-placement-concurrency.sh`  | green, new step 13: 18 concurrent `move_bottle_v2` into the 3 indexes of one cell → 3 moved (one per index), 15 taken; 10 concurrent moves of one back bottle → 1 moved, 9 stale; front-vs-back of one cell × 30 → front + back every round; old index-less move vs `move_bottle_v2` of the same back bottle × 20 → the old one refused as ambiguous every round. 59 s.                                     |
| `bash scripts/db-smart-cellar-upgrade.sh`   | green: all later migrations (0051, 0054) on a filled database leave every row identical (ctid, xmin); status says off/old index; new step 7 (throwaway only): switch refuses with the old index, switches on without it; switch off moves nothing; collapse refuses with a crowded cell (nothing changed), works after the household moved one; one deep again; old index recreated; cellar rows identical. |
| `bash scripts/db-layout-cas-concurrency.sh` | green (sprint 8 numbers, unchanged).                                                                                                                                                                                                                                                                                                                                                                        |
| domain `storage-depth.test.ts`              | 42 tests: every template with `cellCapacity.max > 1` (the 12 deep-capable ones), depth off and on; status parsing.                                                                                                                                                                                                                                                                                          |
| web unit                                    | service depth: 10 tests (gate closed: database never asked and capabilities have exactly the old keys; every block reason; all open; v2 moves; reachability); gate: 3; old-swap `behind`: 2; builder: 2.                                                                                                                                                                                                    |
| e2e                                         | RESULTS_E2E                                                                                                                                                                                                                                                                                                                                                                                                 |

## 4. Production activation sequence (each step its own owner approval)

1. **Phase A** — merge; apply 0054 by `docs/MIGRATIONS.md` §2. Check: `select public.smart_cellar_depth_status()` →
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

**Legacy readers** (phase B blockers, unowned): racks grid and legacy 3D view must show "+n behind" per cell or route
deep places to the new view; sommelier/tonight copy should say "behind" for index > 1; export v1 should either refuse
deep places or say it is lossy.

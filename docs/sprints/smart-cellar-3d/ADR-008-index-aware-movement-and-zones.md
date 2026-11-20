# ADR-008 — Index-aware placement, movement and swaps; temperature zones in daily use

Status: accepted (sprint 4, 2026-11-19). Builds on ADR-001 (slot identity), ADR-005 (API), ADR-006 (product view),
ADR-007 (builder). One proposal for the database workstream; no migration in `supabase/migrations`.

## 1. What exists, and what is missing

| Today                                                                                | Limitation for the new cellar                                                                                                               |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `PATCH /api/v1/bottles/:id {action:"move", to:{locationId,row,col}}`                 | No expected source: a move can overwrite where someone else just put the bottle; no index; its Undo moves back unconditionally.             |
| `{action:"swap", expected:{self,other}}` → `swap_bottles` (0027, re-made in 0045)    | Two coordinates only; a bottle at index > 1 is "stale" to it, by design.                                                                    |
| `swap_bottles_v2` (0045)                                                             | Full spots, expected positions, atomic, refuses ordinal swaps inside one compartment. Not used by the app yet.                              |
| `private.check_bottle_location` (0043)                                               | Bounds against the place's size and cell capacity; refuses a move that would carry an index > 1 into another cell (`slot_index_ambiguous`). |
| `bottles_slot_unique` (0004) + `bottles_slot_index_unique` (0043)                    | One bottle per cell AND per whole spot. With the first in place, a cell can never hold two.                                                 |
| `DEPTH_PLACEMENT_ENABLED = false`, `private.cellar_settings.depth_placement = false` | Depth is off in the app and in the database.                                                                                                |

## 2. Decisions

1. **One slot identity, the domain's.** A spot is `{ locationId, row, col, index }`; within a place `SlotAddress`
   (`slotKey`, `checkSlot`, `compareSlots`, `cellOccupancy`, `firstFreeInCell`). Unplaced is `null`. No new
   representation. `packages/domain/src/storage-placement.ts` adds the pure rules: what each spot of a place is to a
   person placing a bottle (free, taken, behind a taken front, beyond what this version stores, a compartment's next
   counter), and why a target is refused, by the four meanings of an index (single, depth, ordinal, unknown).
2. **A versioned Smart Cellar contract, not a new meaning for the old one.**
   `POST /api/v1/smart-cellar/bottles/:id/move { from, to }` and
   `POST /api/v1/smart-cellar/bottles/:id/swap { with, expected: { self, other } }`, full spots on both sides. The
   old `/api/v1/bottles` actions are unchanged.
3. **A move is one conditional statement.** `UPDATE bottles SET location_id, loc_row, loc_col, loc_index WHERE id
AND household_id AND status = 'in_cellar' AND <the whole observed source>`. Atomic by itself; RLS applies (as
   the person); the unique indexes decide a taken target (409); the 0043 trigger decides bounds (422). Stale source:
   nothing matched → 409. **Retry protocol**: a request whose bottle already stands on its target and no longer on
   its source answers `already_there` (a repeat after a lost answer is safe); anything else stale is a conflict.
4. **A swap is `swap_bottles_v2`**, unchanged: full expected spots, both locked in id order, out then in, refused
   inside one ordinal compartment.
5. **Depth stays off, in three places.** The app refuses any spot with index > 1 while `DEPTH_PLACEMENT_ENABLED` is
   false (before the database is asked), the database refuses it (cell capacity 1, the old unique index). A move
   that must carry an index > 1 into another cell cannot be one statement (the trigger refuses it as ambiguous):
   it needs `move_bottle_v2`, proposed in `supabase/gated-migrations/` and exercised by the SQL suite inside a
   rolled-back transaction together with the gated index drop. **Live depth writes are blocked** until the owner
   approves the index drop, the RPC and the switch.
6. **A gate of its own for placement.** `CELLR_SMART_CELLAR_PLACEMENT=1`: the renderer gate's deployment rule
   (dev and previews only), and the new endpoints need the API's `write` level, which since sprint 3 needs a
   database known not to be production. A preview on the production database cannot place.
7. **Tap, choose, confirm.** The primary interaction is a sheet: the bottle, a place, a 2D picker of its spots (the
   same for every device and without WebGL), the target marked in 3D, a sentence saying what will happen, Confirm.
   Nothing moves on screen until the server answers. No drag in this sprint.
8. **Undo is a conditional move back** (or the reverse swap) from the confirmed full spots: it fails, and says so,
   when someone has moved the bottle since. An uncertain outcome (network) is followed by a fresh read before
   anything else is offered. No Undo is offered where this screen can't know its own request did the change: an
   `already_there` answer, or an outcome established only by that fresh read. The fresh read is of the bottle itself
   (`GET /smart-cellar/bottles/:id`, from the database, never the cache): a bottle missing from the places looked
   at is never taken as "not moved", and a confirmed unplaced bottle is told apart from one moved elsewhere.
9. **Zones are read, not written, in daily use.** The place's zones (from the API) are shown on the stage (a legend), in the
   picker (tinted shelf numbers), on the target sentence and in a bottle's details ("set to 12 °C", never a reading). Editing opens
   the Rack Builder at its zones section; its one atomic layout save stays the only writer.

## 3. Safety invariants (tested)

- No write path accepts a household from the client; every write runs as the person.
- No new endpoint writes where `smartCellarAccessIn(...).writes` is false (production, unknown deployment,
  production database, undeclared database).
- No spot with index > 1 is written while depth is off; the database refuses it independently.
- A move that matches nothing changes nothing; a target taken meanwhile changes nothing.
- An old client cannot move a bottle at index > 1 to another cell (0043 trigger), unchanged.

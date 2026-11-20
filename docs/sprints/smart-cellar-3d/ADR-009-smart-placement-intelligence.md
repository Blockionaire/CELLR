# ADR-009 — Smart Placement Intelligence

Status: accepted (sprint 5, 2026-11-20). Builds on ADR-001 (slot identity), ADR-005 (API), ADR-008 (placement and
zones). No migration.

## 1. What CELLR actually knows (audit)

| Fact                                                                           | Where                                                                                                              | Kind                                                            | Used for advice                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bottle id, status, whole spot `(locationId,row,col,index)`                     | `bottles`                                                                                                          | verified database fact                                          | eligibility, current spot                                                                                                                                                                                                                                                                      |
| Vintage id, wine id, producer id                                               | `bottles → wine_vintages → wines → producers`                                                                      | verified database fact (stable ids)                             | grouping                                                                                                                                                                                                                                                                                       |
| Wine type (red, white, …)                                                      | `wines.wine_type`, not null                                                                                        | catalogue fact (entered or matched)                             | grouping (category)                                                                                                                                                                                                                                                                            |
| Year (null: non-vintage or unknown)                                            | `wine_vintages.year`                                                                                               | catalogue fact                                                  | caveat only                                                                                                                                                                                                                                                                                    |
| Region, country                                                                | `wines.region`, `country_code` (both nullable)                                                                     | catalogue fact                                                  | not used: nothing links a region to a spot in someone's cellar                                                                                                                                                                                                                                 |
| Places, template, size, cell capacity, index meaning                           | `cellar_locations` via `resolveStorage`                                                                            | user configuration                                              | eligibility (the Sprint 4 rules)                                                                                                                                                                                                                                                               |
| Zones: shelves, purpose (storage / serving), target °C (nullable)              | `cellar_location_zones`                                                                                            | **user configuration**: a target someone typed, never a reading | purpose match; the target is only described                                                                                                                                                                                                                                                    |
| Drinking window                                                                | the cellar's own reads: a table estimate (which also weighs purchase price and label words) or a stored AI insight | **calculated estimate**, provenance decided outside advice      | **not used**: not for ranking (the brief forbids price and name as proxies), and the API sets no source (a known year proves neither a window nor where it came from), so no caveat is emitted. The engine's `estimated_window_not_used` caveat is only for a caller that knows the provenance |
| Measured temperature, humidity, light, vibration, shelf height, door clearance | —                                                                                                                  | **unknown**: CELLR records none                                 | never scored; caveats say so                                                                                                                                                                                                                                                                   |

## 2. Decisions

1. **One engine, pure, in the domain**: `packages/domain/src/storage-advice.ts`, `adviseStorage(input)`. Explicit
   immutable input, deterministic output, no React, database or model.
2. **Eligibility is Sprint 4's, not a second copy.** A candidate is exactly a spot `cellChoices` marks `free` (single,
   depth) or a compartment's `next` counter (ordinal), and it must also pass `placementProblem(...) === null` with the
   same `movingId` and `depthEnabled`. Unknown arrangements, occupied spots, spots behind a taken front, spots past
   index 1 while depth is off, full compartments and spots outside the layout are therefore never candidates. Every
   recommendation carries the whole slot `(locationId,row,col,index)` the move API takes.
3. **Intent is explicit.** "Store" or "Serve soon", chosen by the person (default Store). A drinking-window estimate
   never decides it.
4. **Signals (soft, after the hard filter), with fixed weights** (§3). The strongest is a declared zone purpose that
   matches the intent; then grouping with the same vintage / wine / producer / type by stable id, nearby first.
   Temperature targets are **described, never scored**: they are settings, CELLR measures nothing, and no general
   storage guidance is turned into a number here.
5. **Staying put is an answer.** When the bottle has a place and no free spot beats it by a clear margin, no move is
   advised. It is called "already suitable" only when the spot itself has positive evidence and no conflict;
   otherwise "no free spot is clearly better than where it is now". Moving remains possible.
6. **Explanations are structured codes with their evidence** (counts, zone, target), each emitted only by the branch
   that used that fact; translated in `messages/{en,nl}.json`. No model writes them.
7. **Qualitative classes, not percentages**: strong (purpose match, or the same vintage/wine nearby), reasonable (some
   positive evidence), limited (free, nothing more is known). Equivalent spots are counted and said.
8. **Read-only API** `GET /api/v1/smart-cellar/bottles/:id/recommendations?intent=store|serve`, as the person (RLS),
   six database requests whatever the cellar's size (one page more per 1,000 placed bottles), nothing stored. Gate `CELLR_SMART_CELLAR_ADVICE=1`:
   internal previews only, and only where the placement gate is open; it grants no write.
9. **Advice feeds the existing placement panel**: choosing a recommendation selects that place and spot in the Sprint
   4 picker and rings it in 3D; confirming is the Sprint 4 move. A stale choice is refused by the server, said, and the
   advice is fetched again; nothing is substituted.

## 3. Weights

| Signal                                            | Points                   | Why                                                               |
| ------------------------------------------------- | ------------------------ | ----------------------------------------------------------------- |
| Zone purpose matches intent                       | +40                      | the only environmental intent the person declared                 |
| Zone purpose is the other one                     | −20                      | keeps serving space for serving and keeping space for keeping     |
| Same vintage: next cell / same shelf / same place | +30 / +20 / +12          | keeps identical bottles together (organisation, not preservation) |
| Same wine, other vintage                          | +18 / +12 / +8           |                                                                   |
| Same producer                                     | +10 / +6 / +4            |                                                                   |
| Same type                                         | +4 / +3 / +2             | weakest: a category                                               |
| Only the strongest grouping counts                | —                        | evidence is not stacked                                           |
| Moving away from the current spot                 | needs > +10 over staying | no move without a clear advantage                                 |

Ties: score, then the number of related bottles the grouping reason counts (more first), then the places' own order, then row, column, index. Same input, same order.

## 4. Consequences

- Without zones, grouping evidence or a known type of storage, advice still works and says it is "limited".
- Depth spots are not candidates while depth is off; they are counted, never offered.
- A future signal (measured conditions, a reliable own drinking window) is added as a new code with its evidence, not as a
  change of meaning of an existing one.

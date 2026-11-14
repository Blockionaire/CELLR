# ADR-001 — Storage templates, the logical layout and a spot's identity

Status: accepted (sprint 1A, 2026-11-14) · Applies to: every sprint of Smart Cellar 3D

## Context

A place for bottles is, today, a kind (one of six) and a grid: `cellar_locations.kind / grid_rows / grid_cols`. A
bottle in it is at `(location_id, loc_row, loc_col)`, one bottle per spot (`bottles_slot_unique`). The 3D view, the
racks view, the API contracts, the swap RPC, the export and the Wijnkelder import are all written against that pair
of coordinates.

Smart Cellar 3D needs more kinds of places (double-depth racks, cubes, diamond bins, crates, wall pegs and rails,
coolers with zones) and a look that can be chosen. Sprint 1A builds the domain foundation for that **without a
database change and without touching the renderer or any service**.

## Decision

### 1. `kind` stays; a template is the finer choice next to it

`public.location_kind` is not extended. A template (`packages/domain/src/storage-templates.ts`) has a stable text id
and maps to exactly one existing kind. Templates are data: 14 entries over three layout families (`grid`, `bins`,
`wall`). A new template is a new entry in the catalogue, never a new rendering system and never a migration.

Rules for the catalogue:

- An id, once released, keeps its kind, family and slot semantics for ever (it is stored with a place). The table of
  all four is pinned in `storage-templates.test.ts`.
- A template may gain options. It never loses one a stored place could be using.
- The template a place from before templates is read as (`DEFAULT_TEMPLATE_FOR_KIND`) accepts every size the database
  allows today (1..30 by 1..30, one bottle per cell), so no existing place is ever "out of range".

### 2. A spot is `(row, col, index)`; what `index` means belongs to the layout

- `(row, col)` names the **cell**. It is the pair the app has always stored, and it keeps its meaning.
- `index` (from 1) is the position **within** the cell. A spot without an index is index 1: every bottle placed
  before this sprint is exactly there.
- What an index means is the layout's `semantics`, and it is never the same thing everywhere:

  | Semantics | Used by                                       | What `index` is                                             |
  | --------- | --------------------------------------------- | ----------------------------------------------------------- |
  | `depth`   | racks, shelves, cabinets, coolers, wall rails | a physical depth position: 1 is the front, 2 lies behind it |
  | `ordinal` | cubes, diamond bins, crates                   | a counter within a compartment and nothing more             |
  | `single`  | wall pegs                                     | always 1                                                    |

  Bottles in a bin shift when one is taken out, so "the 4th bottle of bin B2" is not a place anyone can point at.
  For an `ordinal` layout the truth there is to tell is the compartment and how full it is
  (`cellOccupancy`, `firstFreeInCell`). **No screen may present an ordinal as a position.**

- The stable key of a spot within a place is `row:col:index`, always all three (`slotKey`). The older two-part key
  reads back as index 1 (`parseSlotKey`).
- The field is named `index`, not `depth`, in the domain on purpose: naming it after one of its meanings would be
  wrong for the other.

### 3. A layout is a list of cells, each with its own capacity

`LogicalLayout` holds `cells: { row, col, capacity }[]`. Every function of the engine works on that list, so nothing
assumes two cells are alike. The 14 templates of this sprint are all uniform (`rows` x `cols` cells of one capacity),
which keeps their structure three whole numbers; `createLayout` and its tests cover cells that differ (gaps, mixed
capacities), for when a template needs that.

There is **one order** spots are listed in everywhere (`compareSlots`): shelf by shelf from the top, left to right,
and within a cell index 1 first. For a place with one bottle per cell this is exactly the order `nextFreeSlots` has
always filled racks in.

### 4. Structure and appearance are separate, and both are small

- **Structure** (`StorageStructureSchema`): template, rows, cols, cell capacity, temperature zones. It decides which
  spots exist. Only whole numbers and named choices, so every rule can be a database constraint.
- **Appearance** (`StorageAppearanceSchema`, version 1): material, colour, lighting, door. Four names from a fixed
  vocabulary. No hex colours, no textures, no meshes, no URLs, nothing that is run. The renderer owns the tones.

Hard ceilings for any place (`STORAGE_LIMITS`): 30 rows, 30 cols, 16 bottles per cell, 1200 bottles in all, 3 zones.

### 5. Writing is strict, reading is forgiving

- **Write** (the Zod schemas): unknown template, size outside the template's limits, more than its capacity, zones it
  does not have or that do not split its shelves, a look it does not offer, any extra key: refused.
- **Read** (`resolveStorage`, `readAppearance`): never throws.
  1. What decides which spots exist is what the database enforces (grid size, and later the stored cell capacity).
     It is never narrowed to a template's limits, so a bottle's spot is never read away.
  2. Everything else is a hint. An unknown template falls back to the kind's own; zones that do not add up are left
     out whole; a look of another version becomes the template's default whole; a look of this version with one
     choice the template lacks has that choice replaced. What was replaced is listed in `fallbacks`.

### 6. Temperature is a setting

A zone has `targetTempC` (°C, half degrees, 3 to 22, or null). It is what the owner says the zone is set to. The zone
schema is strict: a field for a measured value would be refused, not stored. Measurements, if they ever come, are a
separate thing with their own table and their own source.

### 7. The existing code is not rewritten; an adapter sits beside it

`packages/domain/src/placement.ts`, the storage schemas in `cellar.ts`, the services and the 3D view are unchanged.
`storage-compat.ts` says what today's places and spots are in the new terms (`resolveStorage`, `legacyGridLayout`,
`fromLegacySlot`, `toLegacySlot`). Tests prove the two agree:

- `nextFreeAddresses` on a legacy layout equals `nextFreeSlots` (every grid up to 3 x 3 with every occupancy and
  count: 7552 cases; 2000 random grids up to 30 x 30);
- `addressesFor` equals `slotsFor` (3000 random cases, including taken and out-of-grid spots);
- the 3D view's `slotPosition` and `rackMatrix` are pinned in numbers worked out independently
  (`apps/web/src/features/cellar/three/legacy-parity.test.ts`).

## Consequences

- Sprint 1B can add the database columns behind these structures without changing what any of this means: see
  `SPRINT-1B-DATABASE-REQUIREMENTS.md`.
- Sprint 2 (renderer) reads a `ResolvedStorage`. While `legacy` is true it must draw exactly what it draws today; the
  pinned geometry test is the gate.
- A new layout family is a real change (engine, renderer, 2D). A new template within a family is a catalogue entry.

## Rejected

- **Extending the `location_kind` enum per template.** A migration per template, and the enum would mix a coarse
  category (used for the glyph, the label, the friends view, the export) with a product catalogue.
- **A slot table.** Only occupied spots exist today (`bottles` rows). A table of every spot of every place would have
  to be kept in step with every resize, for no query that needs it.
- **Naming the third coordinate `depth` everywhere.** It is wrong for bins, and the wrong word ends up on screens.
- **Storing geometry or free-form style.** It would make stored data something the renderer has to trust.

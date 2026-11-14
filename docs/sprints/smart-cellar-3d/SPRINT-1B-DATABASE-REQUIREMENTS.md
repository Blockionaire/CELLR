# Smart Cellar 3D — what the database and the server must enforce (input for sprint 1B)

Written in sprint 1A (2026-11-14). **Nothing here has been built or applied.** Sprint 1A added no migration, no RPC
and no API field. This document says what sprint 1B has to add so that the domain model of sprint 1A
(`ADR-001-templates-and-slot-identity.md`) is true in the database as well, and what must not break on the way.

A principle for all of it: **a feature flag is not a guard.** `CELLR_FEATURES` decides what the app shows. Every
signed-in person can also talk to PostgREST directly with the publishable key, as themselves, under RLS (that is how
the API itself works: `apps/web/src/server/db/clients.ts`). So anything that must always hold is a constraint, a
trigger or a policy. A Zod schema is the friendly first check, never the only one.

## 0. Before anything is pushed

`docs/MIGRATIONS.md` (§1, §4) says production has no migration history yet and that `db push` must not be run until
the owner has done the bootstrap. That is a hard prerequisite for sprint 1B reaching production. It does not block
writing and testing the migration (`pnpm db:test`, the Supabase stack job).

## 1. The schema (additive; every default reproduces today)

Names are proposals; the meanings are the decision.

| Table                   | Column             | Type and default              | Constraint                                                      | Domain field              |
| ----------------------- | ------------------ | ----------------------------- | --------------------------------------------------------------- | ------------------------- |
| `cellar_locations`      | `template`         | `text null`                   | `template ~ '^[a-z][a-z0-9_]{0,39}$'`                           | `structure.template`      |
| `cellar_locations`      | `cell_capacity`    | `smallint not null default 1` | `between 1 and 16`                                              | `structure.cellCapacity`  |
| `cellar_locations`      | `appearance`       | `jsonb null`                  | `jsonb_typeof = 'object' and pg_column_size(appearance) < 1024` | `StorageAppearance`       |
| `cellar_locations`      | (table check)      |                               | `grid_rows * grid_cols * cell_capacity <= 1200`                 | `STORAGE_LIMITS.capacity` |
| `bottles`               | `loc_index`        | `smallint not null default 1` | `between 1 and 16`                                              | `SlotAddress.index`       |
| `cellar_location_zones` | new table (see §4) |                               |                                                                 | `structure.zones`         |

- `template null` is "a place from before templates" (`ResolvedStorage.legacy`). No backfill: existing rows stay
  exactly as they are, and the renderer keeps drawing them the old way.
- The column is `cell_capacity`, not `grid_depth`: for a bin it is not a depth (ADR-001 §2).
- The capacity check holds for every existing row: the largest possible today is 30 x 30 x 1 = 900.
- **The database does not know the catalogue.** It enforces the hard ceilings and which spots exist. The
  per-template limits (an undercounter cooler has at most 8 shelves) are a server check
  (`StorageStructureSchema`). Someone writing around the API can give their own household a place outside a
  template's limits but inside the ceilings; reading copes with that by design (`resolveStorage`, rule 1) and nobody
  else is affected. `kind` and `template` agreeing (`STORAGE_TEMPLATES[template].kind = kind`) is likewise a server
  check: the server sets `kind` from the template.

## 2. One bottle per spot, with an index

Today: `create unique index bottles_slot_unique on bottles (location_id, loc_row, loc_col) where status = 'in_cellar'
and location_id is not null`. It is the only hard guard on occupancy, and the app relies on its `23505`
(`repository.ts`, `isUniqueViolation`: by code, not by index name; verified).

Required:

1. Create the new unique index on `(location_id, loc_row, loc_col, loc_index)` with the same predicate. Every
   existing row has `loc_index = 1`, so it is valid the moment it exists.
2. Drop the old index **in the same migration, after the new one exists** (a migration is one transaction), or two
   bottles could never share a cell. This is the one destructive statement of the sprint. `docs/MIGRATIONS.md` rule 2
   asks for an explicit decision: **owner approval needed.**
3. `bottles_location_complete` stays as it is (place, row and col are all there or all absent). `loc_index` is not
   part of it: it is `not null default 1`, and the bounds trigger sets it back to 1 whenever a bottle has no place
   (see §3), so an unplaced bottle never carries an old index into its next place.

Historical clients (an old browser bundle, a rolled-back server) write `(location_id, loc_row, loc_col)` and no
index. They get index 1 by default and the same `23505` when that spot is taken. Nothing they do changes meaning.

## 3. Bounds, resizing and the race between them

Today (`20261010000004_cellars_bottles.sql`): `private.check_bottle_location()` checks a bottle's row and col against
the place; `private.check_location_resize()` refuses a shrink past a bottle. **Neither takes a lock** (verified), so a
shrink and a placement running at the same moment can both pass. Depth adds a third dimension to the same race.

Required (new migration, `create or replace` on both functions; the old migration file is not edited):

- `check_bottle_location`: read the place with `for share`, so it waits for a resize in flight and then sees the new
  size (a foreign-key check only takes `for key share`, which a plain `update` of the place does not conflict with:
  that is why the race exists). Check `loc_index <= cell_capacity` as well; raise the existing
  `slot_out_of_bounds` (`23514`), which `server/db/errors.ts` already maps. When the bottle has no place (or is not
  in the cellar), set `loc_index := 1` along with the fields it already clears.
- `check_location_resize`: fire on `update of grid_rows, grid_cols, cell_capacity`; refuse when any in-cellar bottle
  has `loc_row > grid_rows or loc_col > grid_cols or loc_index > cell_capacity`; raise the existing
  `location_in_use`.
- Changing `template` alone strands nothing: which spots exist is the three numbers, never the template (ADR-001 §5).

Server check on top (friendlier, not a replacement): before saving a new structure, ask
`occupancyOf(layoutOfStructure(next), occupied).stranded` and answer 409 with the bottles that would lose their spot.

Tests to add to `supabase/tests/30_cellar.test.sql`: index beyond the cell refused; two bottles in one cell at
different indexes allowed; the same index twice refused; shrinking `cell_capacity` past a bottle refused; an unplaced
bottle has index 1; and the concurrent shrink-and-place case (two sessions), like the existing concurrency scripts
(`scripts/db-*-concurrency.sh`).

## 4. Temperature zones

A table, not a JSON field: zones have rules of their own, belong to a household, and are what a later
sensor-readings table would point at.

`cellar_location_zones (id, location_id, household_id, position smallint, from_row smallint, to_row smallint,
purpose text, target_temp_c numeric(3,1) null, created_at, updated_at)` with:

- `foreign key (location_id, household_id) references cellar_locations (id, household_id) on delete cascade`: the
  composite key that makes a cross-household zone impossible by construction (the pattern of every household table);
- `unique (location_id, position)`, `check (position between 1 and 3)`, `check (from_row >= 1 and to_row >= from_row)`,
  `check (purpose in ('storage', 'serving'))`;
- `check (target_temp_c is null or (target_temp_c between 3 and 22 and target_temp_c * 2 = trunc(target_temp_c * 2)))`;
- `private.forbid_change('household_id')`, the `updated_at` trigger;
- RLS: select / insert / update for members of the household (`household_id = any (private.my_household_ids())`), the
  same as `cellar_locations`. **Delete: owner decision** (locations are owner-only to delete; a zone is part of
  editing a place, which members may do. Proposal: members).

The column is `target_temp_c` and its comment says it is a setting. **This table gets no column for a measured
temperature**, ever: a reading has a time and a source, and belongs in its own table.

The split rule (zones cover every shelf once, top to bottom: `checkZones`) spans rows, so it cannot be a row check:

- a `constraint trigger ... deferrable initially deferred` on the zones table and on `cellar_locations` (`update of
grid_rows`) that re-checks the place's zones at commit. It holds whichever way the rows were written;
- shrinking or growing the shelves therefore has to change the zones in the same transaction: see §5.

Whether a template has zones at all, and how many, is a server check (the catalogue).

## 5. Saving a layout in one go

A place's structure and its zones must change together or not at all, and PostgREST has no multi-statement
transaction. Required: one RPC, in the style of `swap_bottles`:

`public.save_storage_layout(p_household uuid, p_location uuid, p_template text, p_rows smallint, p_cols smallint,
p_cell_capacity smallint, p_appearance jsonb, p_zones jsonb) returns text`

- **`security invoker`**, `set search_path = ''`: every read and write goes through the caller's own RLS, and
  `p_household` narrows, it grants nothing (as in `20261104000027_swap_bottles.sql`);
- locks the place `for update` first (placements wait on it through §3's `for share`);
- updates the place (the resize trigger refuses a shrink past a bottle), replaces the zones, and lets the deferred
  constraint check the split at commit;
- returns `saved` / `not_found` / `in_use`; `execute` revoked from `public` and `anon`, granted to `authenticated`.

Creating a place with zones needs the same atomicity (insert the place, insert its zones): either the same function
with a null `p_location`, or a second one.

## 6. Swapping bottles

`public.swap_bottles(p_household, p_a, p_a_location, p_a_row, p_a_col, p_b, p_b_location, p_b_row, p_b_col)` exists,
is `security invoker`, and is called by today's clients. Its signature has no index.

- **Keep the signature working.** `create or replace` its body so it trades the whole spot `(location, row, col,
index)` of the two bottles. The `expected` check stays on `(location, row, col)`: a client that knows no index says
  where it saw the cells, which is all it can know.
- Left as it is, it would still be safe but could refuse: it moves `(location, row, col)` only, so two bottles at
  different indexes would both land on index 1 of each other's cell, and the unique index rejects that when a third
  bottle is there. The whole call rolls back; nothing is corrupted. It just fails where it need not.
- Add `swap_bottles_v2` with the index in the expected spots, for clients that show depth. A new name, not an
  overload: PostgREST picks overloads by argument names, and two functions a name apart is not worth the risk.
- Extend `supabase/tests/99_swap_bottles.test.sql`: front with back in one cell, across cells at different indexes,
  undo, stale.

## 7. Grants (per column, like everything else here)

`20261010000004_cellars_bottles.sql` grants insert and update **by column**. A new column without a grant cannot be
written by `authenticated`, and the failure looks like a permission error, not a missing feature.

- `cellar_locations`: add `template, cell_capacity, appearance` to the insert and the update grant.
- `bottles`: add `loc_index` to the insert and the update grant.
- `cellar_location_zones`: `select, delete`; insert `(location_id, household_id, position, from_row, to_row, purpose,
target_temp_c)`; update `(position, from_row, to_row, purpose, target_temp_c)`. Never `id`, `household_id` (after
  insert), timestamps.
- The RPCs: revoke from `public, anon`; grant execute to `authenticated`.
- `service_role` already has everything (`grant all on all tables`); a new table needs that statement again.

`pnpm db:types:check` will fail until `database.types.ts` is regenerated (`pnpm db:types`).

## 8. What friends see

`public.friend_racks(p_friend)` is **`security definer`** and returns `{label, kind, rows, cols, bottles: [{row, col,
type, producer, wine, year}]}`. It bypasses RLS on purpose, gated by `private.can_see(..., 'cellar')`.

- It must be replaced deliberately, listing each new field by name. Never widen it by selecting the row.
- It needs `index` per bottle and `cellCapacity` per place once a cell can hold two, or two bottles collapse into
  one: `friend-screen.tsx` builds a key from `label:row:col`.
- **Owner decision:** which of template, appearance and zones friends see. Proposal: template and cell capacity yes;
  zones and their temperatures no.

## 9. Export and import

- **Export** (`packages/domain/src/export.ts`, `EXPORT_VERSION = 1`): places are `{name, kind, shelves,
positionsPerShelf}`, bottles have `place, shelf, position`. Add fields, remove none: per place `template` and
  `bottlesPerPosition`; per bottle `index` (written only when it is not 1, or always: decide once); zones per place.
  That is `EXPORT_VERSION = 2`, and a version-1 reader still finds everything it knew.
- **Wijnkelder import** (`packages/domain/src/wijnkelder-import.ts`): creates `kind: "rack"` grids and places with
  `nextFreeSlots`. Unchanged and still right: it makes places without a template and bottles at index 1.
- A known issue found in sprint 0, not part of this epic: the import's rollback (`import-run.ts`) deletes places and
  bottles, which RLS allows owners only, so a rollback run by a member removes nothing.

## 10. API contracts (additive only)

- `CreateStorageSchema` / `UpdateStorageSchema` (`cellar.ts`) keep accepting exactly what they accept. New optional
  fields: `template`, `cellCapacity`, `zones`, `appearance`, validated as a whole by `StorageConfigSchema`. A request
  without them creates what it always created.
- A spot in a request (`AddBottlesSchema.slot`, `PlacementSchema`, `SpotSchema`, the `?place=&row=&col=` of
  `add-spot.ts`) gains an optional `index`, default 1.
- `StorageUnitView`, `BottleView`, `PlacedBottle` gain fields; `capacity` becomes `layout.capacity` (equal to
  `rows * cols` for every existing place). Old bundles ignore what they do not know.
- The server, not the flag, decides: with the feature off the API refuses the new fields (422). With it on, every
  write still goes through the schemas and the constraints above.

## 11. Rolling back

The migration is forward-only (`docs/MIGRATIONS.md`): roll back the app, not the schema. With the new schema in place
and the previous app running:

- every existing place and bottle reads and writes exactly as before (defaults: no template, capacity 1, index 1);
- a place that was given two bottles per cell while the new app ran is the one degraded case: the old racks view
  keys bottles by `row:col`, so it shows one of the two. No data is lost or changed; the bottle is still found
  through its wine. Moving the visible one works. This is why the new fields are refused while the feature is off,
  and why switching the feature on is a decision, not a deploy side effect;
- the old `swap_bottles` keeps working for every bottle at index 1 (see §6).

## 12. Open decisions for the owner (needed before or during sprint 1B)

1. Production migration bootstrap (§0): when.
2. Dropping `bottles_slot_unique` in favour of the four-column index (§2): explicit approval.
3. The ceilings: 16 bottles per cell, 1200 per place, 3 zones (ADR-001 §4).
4. Who may delete a zone: members (proposed) or owners only (§4).
5. What friends see of a template, a look and zones (§8).
6. Export: `index` always, or only when not 1 (§9).

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

| Table                   | Column             | Type and default                | Constraint                                                                    | Domain field              |
| ----------------------- | ------------------ | ------------------------------- | ----------------------------------------------------------------------------- | ------------------------- |
| `cellar_locations`      | `template`         | `text null`                     | `template ~ '^[a-z][a-z0-9_]{0,39}$'`                                         | `structure.template`      |
| `cellar_locations`      | `cell_capacity`    | `smallint not null default 1`   | `between 1 and 16`                                                            | `structure.cellCapacity`  |
| `cellar_locations`      | `appearance`       | `jsonb null`                    | `jsonb_typeof = 'object' and pg_column_size(appearance) < 1024`               | `StorageAppearance`       |
| `cellar_locations`      | (table check)      |                                 | `grid_rows * grid_cols * cell_capacity <= 1200`                               | `STORAGE_LIMITS.capacity` |
| `cellar_locations`      | `slot_semantics`   | `text not null default 'depth'` | `in ('depth', 'ordinal', 'single')`; `'single'` only with `cell_capacity = 1` | `LogicalLayout.semantics` |
| `bottles`               | `loc_index`        | `smallint not null default 1`   | `between 1 and 16`                                                            | `SlotAddress.index`       |
| `cellar_location_zones` | new table (see §6) |                                 |                                                                               | `structure.zones`         |

- `template null` is "a place from before templates" (`ResolvedStorage.legacy`). No backfill: existing rows stay
  exactly as they are, and the renderer keeps drawing them the old way.
- The column is `cell_capacity`, not `grid_depth`: for a bin it is not a depth (ADR-001 §2).
- The capacity check holds for every existing row: the largest possible today is 30 x 30 x 1 = 900.
- **The database does not know the catalogue.** It enforces the hard ceilings and which spots exist. The
  per-template limits (an undercounter cooler has at most 8 shelves) are a server check
  (`StorageStructureSchema`). Someone writing around the API can give their own household a place outside a
  template's limits but inside the ceilings; reading copes with that by design (`resolveStorage`, rule 1) and nobody
  else is affected. `kind` and `template` agreeing (`STORAGE_TEMPLATES[template].kind = kind`) is likewise a server
  check: the server sets `kind` from the template. A pair that disagrees all the same is not read as either one's
  furniture: `resolveStorage` reports `template_kind_mismatch`, keeps every cell and its capacity, and reads an index
  past 1 as a bare counter (`storage-compat.ts`, rule 3).
- **`slot_semantics` is the one thing from the catalogue the database is told**, because it has to protect it: what
  the index of a bottle in this place means (§5). The server writes it from the template. The default `'depth'` on
  every existing row claims nothing: with one bottle per cell there is no index to give a meaning to.

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
   part of it: it is `not null default 1`, and it is kept honest by the rules of §3, not by a default.

## 3. Writers that know no index

**A column default applies to an insert. It does nothing for an update that leaves the column out.** So "old clients
get index 1 by default" is true for a new bottle and false for a move: an `update bottles set location_id, loc_row,
loc_col` on a bottle that is at index 2 keeps the 2, and the bottle lands behind whatever is in the cell it is moved
to, or past the end of a cell that is one deep. Nobody asked for that spot.

Who writes without an index, now and for as long as the schema lives:

| Writer                                    | What it sends                                                                          |
| ----------------------------------------- | -------------------------------------------------------------------------------------- |
| Every version of the app before sprint 1B | `repository.updateBottle`: status, `location_id`, `loc_row`, `loc_col`. No index.      |
| The app after a rollback                  | The same.                                                                              |
| Anyone writing through PostgREST directly | Whatever they like, under RLS and the column grants.                                   |
| An old browser bundle                     | Nothing to the database: it calls `/api/v1`, and the server of the day does the write. |
| The existing `swap_bottles` function      | Its own updates of `location_id, loc_row, loc_col` (§8).                               |

None of them can be reached by a schema in the app or by a feature flag. The rule therefore lives in the database, in
the trigger every write to `bottles` goes through:

- **R1. A bottle with no place has index 1.** When `location_id` is null or the bottle is not in the cellar, the
  trigger sets `loc_index := 1` with the fields it already clears. An index never waits on an unplaced bottle for the
  next place it is put in.
- **R2. An update that moves a bottle to another cell and does not name the index puts it at index 1.** "Another
  cell" is `(location_id, loc_row, loc_col)` being distinct from before. This is ADR-001 §2 enforced: a spot written
  without an index IS index 1 of that cell.
- **R3. An update that names `loc_index` gets the index it names**, then the bounds check and the unique index.
- **R4. An update that neither moves the bottle nor names the index changes nothing about its spot** (a price, a
  note, a photo on a bottle that lies at the back).

After R2 the ordinary guards decide. If index 1 of the target cell is taken, the write fails with the same `23505`
that has always meant "that spot was just taken", which every version of the app already handles
(`service.ts`, move and restore). **The bottle is refused. It is never put somewhere the writer did not name.**

How the trigger knows whether the index was named (plpgsql cannot see a statement's SET list, a column trigger can):

1. `create trigger bottles_index_named before update of loc_index on public.bottles for each row`: PostgreSQL fires a
   column trigger exactly when the column is a target in the SET list, also when the value written equals the old
   one. Its function does one thing: `perform set_config('cellr.index_named', new.id::text, true)` (local to the
   transaction).
2. `bottles_location` (the existing trigger and name) runs after it: row triggers of one kind fire in name order, and
   `bottles_index_named` sorts before `bottles_location`. On an update it reads the setting, **clears it**, and
   applies R2 when the setting was not this row's id. Clearing matters: a later statement in the same transaction
   that moves the same bottle without an index must not inherit the earlier one's "named".

The setting carries no authority. It records a fact the database itself established about one statement; a caller who
could set it by hand would only be saying "I mean this index", which they may say anyway by naming the column, and
bounds, uniqueness and RLS apply either way.

If this mechanism does not hold up under test, the fallback is stricter, not looser: R2 applies to **every** update
that changes the cell, and only the versioned functions (`swap_bottles_v2`, `save_storage_layout`, a `move_bottle_v2`)
may place a bottle at an index above 1 in another cell.

What each writer then gets:

- **Old app, rolled-back app:** a move addresses a cell and gets its index 1, or a refusal. Opening, removing and
  restoring a bottle go through R1. Nothing it does can leave a bottle at an index it has never heard of.
- **Direct PostgREST:** the same rules, the same refusals. There is no request that sets a spot without passing
  through the trigger.
- **The app from sprint 1B on:** names `loc_index` in every write that places a bottle, insert or update, including
  when it is 1. It never leans on the default or on R2. A request body with `{row, col}` and no index is written as
  index 1, explicitly.

Tests this needs (`supabase/tests/30_cellar.test.sql`, and the real-stack job for the PostgREST shape):

- a bottle at index 2 moved by `(location, row, col)` alone arrives at index 1; with index 1 there taken it is
  refused (`23505`) and is still where it was, at index 2;
- the same move naming `loc_index = 2` arrives at index 2; naming the index it already has, in another cell, keeps it;
- two statements in one transaction on one bottle: the first names the index, the second does not, and the second
  gets R2;
- an update of an unrelated column leaves a back bottle at the back;
- opened, removed, gifted, unplaced: index 1; restored by an old-style update: index 1 or refused;
- a multi-row update, and an `insert ... on conflict do update`, row by row;
- the trigger order itself (dropping and recreating either trigger must not change it: assert on `pg_trigger`).

## 4. Bounds, resizing and the race between them

Today (`20261010000004_cellars_bottles.sql`): `private.check_bottle_location()` checks a bottle's row and col against
the place; `private.check_location_resize()` refuses a shrink past a bottle. **Neither takes a lock** (verified), so a
shrink and a placement running at the same moment can both pass. Depth adds a third dimension to the same race.

Required (new migration, `create or replace` on both functions; the old migration file is not edited):

- `check_bottle_location`: read the place with `for share`, so it waits for a resize in flight and then sees the new
  size (a foreign-key check only takes `for key share`, which a plain `update` of the place does not conflict with:
  that is why the race exists). Check `loc_index <= cell_capacity` as well; raise the existing
  `slot_out_of_bounds` (`23514`), which `server/db/errors.ts` already maps. The same function carries R1 and R2 of
  §3, applied BEFORE the bounds check, so what is checked is the spot the bottle will really have.
- `check_location_resize`: fire on `update of grid_rows, grid_cols, cell_capacity`; refuse when any in-cellar bottle
  has `loc_row > grid_rows or loc_col > grid_cols or loc_index > cell_capacity`; raise the existing
  `location_in_use`.
- Changing `template` alone strands nothing: which spots exist is the three numbers, never the template (ADR-001 §5).
  It can still change what an existing index MEANS, which is a different danger with its own rule: §5.

Server check on top (friendlier, not a replacement): before saving a new structure, ask
`occupancyOf(layoutOfStructure(next), occupied).stranded` and answer 409 with the bottles that would lose their spot.

Tests to add to `supabase/tests/30_cellar.test.sql`: index beyond the cell refused; two bottles in one cell at
different indexes allowed; the same index twice refused; shrinking `cell_capacity` past a bottle refused; an unplaced
bottle has index 1; and the concurrent shrink-and-place case (two sessions), like the existing concurrency scripts
(`scripts/db-*-concurrency.sh`).

## 5. Changing what an index means

A place that is two deep keeps a bottle at index 2 as "behind the front one". Turn that place into diamond bins of
the same size and the row is untouched, valid, and now says "the second bottle counted in this bin". The other way
round is worse: a bin's counter 3 would become "third deep", a position nobody ever put the bottle in. No spot is
stranded, so §4 sees nothing. The meaning changed under the data.

The database cannot derive this from `template` (it does not know the catalogue), which is why it stores
`slot_semantics` (§1) and guards it.

**When a change is allowed.** Old and new are the place before and after; "holds bottles" is: some in-cellar bottle
has this `location_id`.

| Case                                                            | Empty place | Place that holds bottles                                                |
| --------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------- |
| `slot_semantics` unchanged (any template, any family, any size) | allowed     | allowed, subject to §4 (no bottle stranded)                             |
| `slot_semantics` changes and the OLD `cell_capacity` is 1       | allowed     | allowed, subject to §4: every bottle is at index 1, which meant nothing |
| `slot_semantics` changes and the OLD `cell_capacity` is above 1 | allowed     | **rejected**                                                            |

- The second row is today's behaviour and stays: a rack can become a wall rack or a fridge with its bottles in it
  (`UpdateStorageSchema` lets the kind change), and from sprint 1B a one-deep rack can become bins. A bottle alone in
  a one-bottle cell has no depth to lose, and becoming index 1 of a larger cell is what growing a place already does.
- The third row is rejected even when every bottle happens to be at index 1. The database does not weigh which
  changes are "probably harmless"; an explicit migration (below) does the harmless ones in one step.

**Enforced in the database:** a trigger on `cellar_locations`, `before update of slot_semantics, cell_capacity`: when
`new.slot_semantics is distinct from old.slot_semantics and old.cell_capacity > 1` and the place holds bottles, raise
`layout_semantics_change` (`23514`). `server/db/errors.ts` needs the mapping (CONFLICT), as it has for
`location_in_use`. It reads the place's bottles under the lock of §4, so a placement cannot slip in beside it.

**A template changed without its semantics** (a direct write of `template` alone) cannot strengthen a claim either:
the stored `slot_semantics` no longer matches the template's, and reading takes the weaker one. This is the same
rule as a template of the wrong kind (`resolveStorage`, rule 3), and sprint 1B has to extend it: `StoredStorage`
gains `semantics`, and a stored value that disagrees with the template's gives `arrangementKnown: false` and a bare
counter. A server check refuses the write in the first place.

**Server check (friendlier, not a replacement):** compare the layout before and after
(`resolveStorage(...).layout.semantics`, `occupancyOf`) and answer 409 saying how many bottles are in the way and
what the choices are.

### An explicit migration of positions (later; sprint 1B only has to reject)

When a person really has replaced a rack by bins, the bottles are still theirs and still in that place. The
migration is a choice they make, never something a save does on its own. It belongs in `save_storage_layout` (§7) as
one more argument, `p_positions`:

| Mode             | What happens to the bottles of the place                                                                                                       | When it can be offered                              |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `keep` (default) | Nothing. The call fails with `semantics_change` if the table above rejects it.                                                                 | always                                              |
| `compact`        | Each bottle stays in its cell `(row, col)`. Within a cell they are renumbered 1..n in the order of their old index.                            | only INTO `ordinal`, and only if each cell's n fits |
| `assign`         | The caller sends `[{bottle, row, col, index}]` for **every** bottle of the place, each once, each a valid and distinct spot of the new layout. | any change; the only way from `ordinal` to `depth`  |
| `unplace`        | Every bottle of the place loses its place and waits under "no place yet". It stays in the cellar.                                              | always, on an explicit choice                       |

- `compact` forgets front and back. It cannot be undone from the data, so the screen says so before it is chosen.
- From a counter to a depth there is no automatic answer: a counter never said where the bottle lies. Only `assign`
  (the person says where each one is) or `unplace` (they put them back by hand).
- An assignment that misses a bottle, names one twice, names a bottle of another place or a spot that does not
  exist: refused whole, nothing changed.

How it stays atomic and passes the trigger above: inside the one function, the place is locked `for update`, its
bottles are locked in id order and their spots read, they are set to no place (R1), the place is updated (it holds no
bottles at that instant, so the semantics may change), and each bottle is put on its new spot with `loc_index` named.
Bounds and uniqueness check every one. Any failure rolls back all of it, and nobody else ever sees the in-between:
the pattern `swap_bottles` already uses. The function returns the spots as they were, so the app can offer an undo
while the person is still there.

**No bottle is deleted, opened or changed in any other way by any mode.** The only fields a migration touches are a
bottle's place and spot.

## 6. Temperature zones

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
- shrinking or growing the shelves therefore has to change the zones in the same transaction: see §7.

Whether a template has zones at all, and how many, is a server check (the catalogue).

## 7. Saving a layout in one go

A place's structure and its zones must change together or not at all, and PostgREST has no multi-statement
transaction. Required: one RPC, in the style of `swap_bottles`:

`public.save_storage_layout(p_household uuid, p_location uuid, p_template text, p_slot_semantics text, p_rows
smallint, p_cols smallint, p_cell_capacity smallint, p_appearance jsonb, p_zones jsonb, p_positions text default
'keep') returns text`

- **`security invoker`**, `set search_path = ''`: every read and write goes through the caller's own RLS, and
  `p_household` narrows, it grants nothing (as in `20261104000027_swap_bottles.sql`);
- locks the place `for update` first (placements wait on it through §4's `for share`);
- updates the place (the resize trigger refuses a shrink past a bottle), replaces the zones, and lets the deferred
  constraint check the split at commit;
- sets `slot_semantics` together with `template` (the server passes both; the function does not look anything up);
- takes `p_positions` (§5). Sprint 1B implements `keep` only, which is: change nothing about the bottles, and fail
  when the change of meaning is not allowed. The other modes are specified in §5 and can come when a screen needs
  them;
- returns `saved` / `not_found` / `in_use` / `semantics_change`; `execute` revoked from `public` and `anon`, granted
  to `authenticated`.

Creating a place with zones needs the same atomicity (insert the place, insert its zones): either the same function
with a null `p_location`, or a second one.

## 8. Swapping bottles

`public.swap_bottles(p_household, p_a, p_a_location, p_a_row, p_a_col, p_b, p_b_location, p_b_row, p_b_col)` exists,
is `security invoker`, and is what every app version so far calls. Its expected positions have no index, so it
cannot say WHICH bottle of a cell it means once a cell holds two: the caller's screen showed one bottle per cell.

### The existing function: conservative

**It must not swap a bottle whose full spot it cannot verify.** `create or replace` its body (same name, same nine
arguments, same return values) with one change in meaning and one in mechanics:

- **An expected position without an index is index 1** (ADR-001 §2), and the stale check compares the **whole**
  spot: `(a.location_id, a.loc_row, a.loc_col, a.loc_index) is distinct from (p_a_location, p_a_row, p_a_col, 1)`, and
  the same for b. A bottle at index 2 is, in the only terms this caller has, not at the spot it named. The function
  returns `stale` and changes nothing.
- So it swaps only two bottles that are both at index 1, and after the swap both are at index 1 of the other's cell.
  Its updates name `loc_index = 1`, so the result does not depend on R2 of §3.

`stale` is a value every caller already handles ("One of these bottles was just moved by someone else. Nothing was
changed.", `service.ts`). The wording is not exact for this case, but it is safe, it is true that nothing changed,
and the caller's next read shows the cellar as it is. A new return value would reach old servers as `not_found`
(`repository.ts` maps anything it does not know to that), which is worse. **Owner decision** if a distinct value is
preferred all the same.

Left unreplaced, the old body would compare `(location, row, col)` only and then move those three fields: with R2 it
would put a back bottle on the front of another cell on the word of a caller who never saw it. That is the behaviour
this section rules out, so replacing the body is part of the same migration as the index, not a later nicety.

### `swap_bottles_v2`: the whole spot, checked

`public.swap_bottles_v2(p_household uuid, p_a uuid, p_a_location uuid, p_a_row smallint, p_a_col smallint, p_a_index
smallint, p_b uuid, p_b_location uuid, p_b_row smallint, p_b_col smallint, p_b_index smallint) returns text`

- `security invoker`, `set search_path = ''`; `p_household` narrows and grants nothing;
- locks both bottles in id order (as today, so two swaps of one pair cannot deadlock); fewer than two rows:
  `not_found`;
- either not in the cellar or without a place: `gone`;
- **stale check on all four fields of both bottles** against what the caller saw; any difference: `stale`, nothing
  changed;
- the same bottle twice: `invalid`. Two bottles of ONE cell in a place whose `slot_semantics` is `ordinal`: `invalid`
  too (trading two counters of one bin moves nothing and means nothing);
- then: a to no place, b to a's spot, a to b's old spot, each update naming `loc_index`. The bounds trigger checks
  both; the unique index holds after every statement;
- undo is the same call with the two new spots as the expected ones.

A new name, not an overload: PostgREST resolves overloads by argument names, and one function a name apart is not
worth that risk.

The API's `swap` action gains an optional `index` in its expected spots (default 1). The server of sprint 1B calls
only `swap_bottles_v2`; an old bundle that sends no index is therefore checked against index 1, the same conservative
answer the old function gives.

Tests (`supabase/tests/99_swap_bottles.test.sql`, extended): the existing cases unchanged for bottles at index 1; the
old function refusing (`stale`, nothing changed) when either bottle is at index 2, including two bottles of one cell;
v2 front with back in one cell, across cells at different indexes, undo, stale on a changed index alone, the
`ordinal` same-cell case, cross-household, anon denied.

## 9. Grants (per column, like everything else here)

`20261010000004_cellars_bottles.sql` grants insert and update **by column**. A new column without a grant cannot be
written by `authenticated`, and the failure looks like a permission error, not a missing feature.

- `cellar_locations`: add `template, cell_capacity, slot_semantics, appearance` to the insert and the update grant.
- `bottles`: add `loc_index` to the insert and the update grant.
- `cellar_location_zones`: `select, delete`; insert `(location_id, household_id, position, from_row, to_row, purpose,
target_temp_c)`; update `(position, from_row, to_row, purpose, target_temp_c)`. Never `id`, `household_id` (after
  insert), timestamps.
- The RPCs: revoke from `public, anon`; grant execute to `authenticated`.
- `service_role` already has everything (`grant all on all tables`); a new table needs that statement again.

`pnpm db:types:check` will fail until `database.types.ts` is regenerated (`pnpm db:types`).

## 10. What friends see

`public.friend_racks(p_friend)` is **`security definer`** and returns `{label, kind, rows, cols, bottles: [{row, col,
type, producer, wine, year}]}`. It bypasses RLS on purpose, gated by `private.can_see(..., 'cellar')`.

- It must be replaced deliberately, listing each new field by name. Never widen it by selecting the row.
- It needs `index` per bottle and `cellCapacity` per place once a cell can hold two, or two bottles collapse into
  one: `friend-screen.tsx` builds a key from `label:row:col`.
- **Owner decision:** which of template, appearance and zones friends see. Proposal: template and cell capacity yes;
  zones and their temperatures no.

## 11. Export and import

- **Export** (`packages/domain/src/export.ts`, `EXPORT_VERSION = 1`): places are `{name, kind, shelves,
positionsPerShelf}`, bottles have `place, shelf, position`. Add fields, remove none: per place `template` and
  `bottlesPerPosition`; per bottle `index` (written only when it is not 1, or always: decide once); zones per place.
  That is `EXPORT_VERSION = 2`, and a version-1 reader still finds everything it knew.
- **Wijnkelder import** (`packages/domain/src/wijnkelder-import.ts`): creates `kind: "rack"` grids and places with
  `nextFreeSlots`. Unchanged and still right: it makes places without a template and bottles at index 1.
- A known issue found in sprint 0, not part of this epic: the import's rollback (`import-run.ts`) deletes places and
  bottles, which RLS allows owners only, so a rollback run by a member removes nothing.

## 12. API contracts (additive only)

- `CreateStorageSchema` / `UpdateStorageSchema` (`cellar.ts`) keep accepting exactly what they accept. New optional
  fields: `template`, `cellCapacity`, `zones`, `appearance`, validated as a whole by `StorageConfigSchema`. A request
  without them creates what it always created.
- A spot in a request (`AddBottlesSchema.slot`, `PlacementSchema`, `SpotSchema`, the `?place=&row=&col=` of
  `add-spot.ts`) gains an optional `index`, default 1.
- `StorageUnitView`, `BottleView`, `PlacedBottle` gain fields; `capacity` becomes `layout.capacity` (equal to
  `rows * cols` for every existing place). Old bundles ignore what they do not know.
- The server, not the flag, decides: with the feature off the API refuses the new fields (422). With it on, every
  write still goes through the schemas and the constraints above.

## 13. Rolling back

The migration is forward-only (`docs/MIGRATIONS.md`): roll back the app, not the schema. With the new schema in place
and the previous app running:

- every existing place and bottle reads and writes exactly as before (no template, capacity 1, index 1);
- **the old app's moves stay safe by the database's own rules, not by its code** (§3): a move it makes addresses a
  cell and gets index 1 or a refusal; a bottle it opens, removes or restores is at index 1; it can never carry an
  index above 1 into another cell;
- **the old `swap_bottles` refuses what it cannot verify** (§8): a bottle at an index above 1 gives `stale` and
  nothing changes. For bottles at index 1 it works as it always has;
- the old app cannot change what an index means: it writes `kind`, never `slot_semantics`, and a change of
  semantics on a place that is more than one deep and holds bottles is rejected for every writer (§5);
- a place that was given two bottles per cell while the new app ran is the one degraded case, and it is a matter of
  display: the old racks view keys bottles by `row:col`, so it shows one of the two. No data is lost or changed; the
  other bottle is still found through its wine, and the rules above decide what a move or a swap of the visible one
  does. This is why the new fields are refused while the feature is off, and why switching the feature on is a
  decision, not a side effect of a deploy.

## 14. Open decisions for the owner (needed before or during sprint 1B)

1. Production migration bootstrap (§0): when.
2. Dropping `bottles_slot_unique` in favour of the four-column index (§2): explicit approval.
3. The ceilings: 16 bottles per cell, 1200 per place, 3 zones (ADR-001 §4).
4. Who may delete a zone: members (proposed) or owners only (§6).
5. What friends see of a template, a look and zones (§10).
6. Export: `index` always, or only when not 1 (§11).
7. The old `swap_bottles` answering `stale` for a bottle at an index above 1, or a new distinct value (§8).
8. Which position migrations to build, and when: `compact`, `assign`, `unplace` (§5). Sprint 1B only rejects.

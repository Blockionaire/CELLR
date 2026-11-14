# Smart Cellar 3D — what the database and the server must enforce (input for sprint 1B)

Written in sprint 1A (2026-11-14) as the baseline for sprint 1B. **Sprint 1B has now built it** (migrations
`20261120000043` to `20261123000046`): what was built, tested and found is in
[`SPRINT-1B-REPORT.md`](./SPRINT-1B-REPORT.md). This document stays the reasoning behind the rules.

Three things in it were **corrected while building**, because the first proposal did not hold up against real
PostgreSQL or against the requirement to expand first:

1. **§3, how a writer that knows no index is handled.** The proposed mechanism (a column trigger leaving a note in a
   transaction setting) was tested before anything was built and fails silently in ordinary situations. It was not
   built. The rule now uses only the values of the row and **refuses** the one case it cannot decide.
2. **§2, the old unique index** is dropped in a migration of its own (0046), after the new one is proven to be there,
   not in the same migration as the rest.
3. **§1, more than one bottle per cell is switched off in the database** (`private.cellar_settings`) until the app can
   show it. This was not in the first version of this document at all.

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
| `cellar_locations`      | `slot_semantics`   | `text null`, no default       | see "The semantics column" below                                | `LogicalLayout.semantics` |
| `bottles`               | `loc_index`        | `smallint not null default 1` | `between 1 and 16`                                              | `SlotAddress.index`       |
| `cellar_location_zones` | new table (see §6) |                               |                                                                 | `structure.zones`         |

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
  the index of a bottle in this place means (§5). The server writes it from the template, together with the
  template.

### More than one bottle per cell is off until the app can show it

Today's app draws one bottle per `(row, col)`. A second bottle in a cell would simply not be seen. So
`cell_capacity > 1` is refused by the database (`depth_not_enabled`) for every writer until
`private.cellar_settings.depth_placement` is true. That table has one row, no grant to any API role (not the service
role either) and is changed only by the database owner in a later migration, when the API and the screens for depth
exist. With every place one bottle per cell, the bounds check keeps every bottle at index 1. A feature flag in the
app is not involved and could not do this: a signed-in person can write through PostgREST directly.

### The semantics column: no default, and nothing said about a place that has no template

An earlier draft of this document proposed `slot_semantics text not null default 'depth'`. **That default is
withdrawn.** It would have written `'depth'` on every existing row, including every wall rack, and the template an
existing wall rack is read as (`wall_pegs`) is `single`. The moment the adapter compares the stored semantics with
the template's (§5), every wall rack that exists today would disagree with itself and stop being a known
arrangement. A default must not be able to do that to data nobody touched.

So:

- `slot_semantics text null`, **no default, no backfill**. After the migration every existing row has `null`, which
  means "not stated". It is not a claim, so it cannot be a wrong one.
- `check (slot_semantics is null or slot_semantics in ('depth', 'ordinal', 'single'))`.
- `check ((template is null) = (slot_semantics is null))`: a template and its semantics are stated together or not at
  all. The old app writes neither, so every write it makes still passes.
- `check (cell_capacity = 1 or slot_semantics is not null)`: more than one bottle per cell needs a stated meaning.
- `check (slot_semantics is distinct from 'single' or cell_capacity = 1)`.

Should a later decision prefer a non-null column with a placeholder value all the same, the first rule below still
holds and is what keeps existing places safe: **for a place without a template the adapter does not read this column,
whatever it contains.**

### How the adapter must read these columns (`resolveStorage`, sprint 1B)

`StoredStorage` gains `semantics` (the stored `slot_semantics`). The rules, in the order they are applied:

| Stored                                                                  | Read as                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `template` null, `cell_capacity` 1 (**every place that exists today**)  | A place from before templates: `legacy: true`, `arrangementKnown: true`, no fallbacks. Template and semantics come from the **kind** (`DEFAULT_TEMPLATE_FOR_KIND`), as in sprint 1A. `slot_semantics` is **not read**: null, `'depth'` or anything else gives the same result.                         |
| The same, `kind = 'wall'` (**existing wall storage**)                   | The row above, spelled out: `wall_pegs`, semantics `single`, one position per peg, a `rows` x `cols` layout. Not `depth`, and not a mismatch, because nothing stored is compared with anything.                                                                                                        |
| `template` null, `cell_capacity` above 1                                | Cannot be stored (the third check). Met all the same: every cell and its capacity kept, `capacity_not_in_template`, `arrangementKnown: false`, `legacy: false`, the index a bare counter. Already so in sprint 1A.                                                                                     |
| A template, `cell_capacity` 1, stored semantics equal to the template's | The template's own arrangement, known. With one bottle per cell there is no index beyond 1 to misread, whichever semantics it is.                                                                                                                                                                      |
| A template, more per cell than the template describes                   | Sprint 1A already: `capacity_not_in_template`, not known, every spot kept (wall pegs with two per peg; a one-deep rack stored three deep).                                                                                                                                                             |
| **A template whose stored semantics differ from the template's**        | New in sprint 1B: fallback `semantics_mismatch`, `arrangementKnown: false`. Every cell and its capacity kept. With more than one bottle per cell the layout's semantics is `ordinal`: neither the stored meaning nor the template's is claimed, least of all the stronger one. Reported, never thrown. |
| A template with stored semantics null                                   | Cannot be stored (the second check). Met all the same: treated as the row above.                                                                                                                                                                                                                       |

`semantics_mismatch` joins `unknown_template`, `template_kind_mismatch` and `capacity_not_in_template` as the reasons
an arrangement is not known, and the invariant sprint 1A tests keeps holding: **known, or exactly one of those
reasons; when known, the layout's family and semantics are the template's own.** The catalogue rule that a released
template never changes its semantics (ADR-001 §1) means a mismatch can only come from a write around the server or a
defect, never from an upgrade of the app.

**What a place from before templates keeps, exactly:**

- **Appearance.** While `legacy` is true the 3D view draws the place from its kind, rows and columns as it does today
  (`STORAGE_LOOK[kind]`, `slotPosition`, `rackMatrix`). `ResolvedStorage.appearance` is then only the kind's default
  look as a stand-in: it is not a stored fact and must not replace today's drawing. A place stops being legacy when
  its owner gives it a template, and not before. `apps/web/src/features/cellar/three/legacy-parity.test.ts` pins the
  drawing.
- **Slot ordering.** The same cells in the same order as `nextFreeSlots` has always filled them
  (`storage-compat.test.ts`: every kind at every size, and the exhaustive parity cases).
- **Behaviour.** Its bottles are at index 1 and stay there (§3). Its kind can still be changed with bottles in it,
  as today: the row is one bottle per cell, so §5 allows it, and `slot_semantics` stays null through it. A legacy
  wall rack that becomes a rack is then read through `rack_classic`; nothing stored changed and no bottle moved.
- **No write on its behalf.** The migration does not set `template`, `slot_semantics` or `appearance` on any existing
  row, and neither does the app when it merely reads a place.

## 2. One bottle per spot, with an index

Today: `create unique index bottles_slot_unique on bottles (location_id, loc_row, loc_col) where status = 'in_cellar'
and location_id is not null`. It is the only hard guard on occupancy, and the app relies on its `23505`
(`repository.ts`, `isUniqueViolation`: by code, not by index name; verified).

Required:

1. Create the new unique index on `(location_id, loc_row, loc_col, loc_index)` with the same predicate. Every
   existing row has `loc_index = 1`, so it is valid the moment it exists.
2. Drop the old index **in a migration of its own (0046), after the new one exists and has been checked** (that it is
   there, unique, valid, on these four columns with this predicate); 0046 stops and leaves the old index when the
   check fails. While both exist a cell still holds one bottle, so the time between the two migrations is safe.
   This is the one destructive statement of the sprint. `docs/MIGRATIONS.md` rule 2 asks for an explicit decision:
   **owner approval needed.**
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
the trigger every write to `bottles` goes through (`private.check_bottle_location`, migration 0043).

### What was proposed first, and why it was not built

The first version of this section had the trigger find out whether the UPDATE **named** `loc_index`: a column
trigger (`before update of loc_index`) would leave a note in a transaction setting, and the bounds trigger would read
it and put a bottle at index 1 when it was moved without the index being named.

It was run against PostgreSQL 16 before anything was built:
[`experiments/index-named-trigger.sql`](./experiments/index-named-trigger.sql). In the ordinary cases it works
(single and multi-row updates, several statements in one transaction, a rollback to a savepoint). It goes wrong,
**each time without any error**, when something outside the two triggers changes:

| What changes                                                                     | What happens, silently                                               |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Another BEFORE trigger, sorted between the two, skips a row                      | the note stays; the next move without an index keeps the old index   |
| One of the two triggers is renamed so the order flips                            | a move that names index 2 is put at index 1                          |
| The setting is written by hand (any SQL session can)                             | a move without an index keeps index 2                                |
| One of the two triggers is disabled (maintenance, a restore, a replication role) | named moves are reset to 1                                           |
| A writer sends the whole row back (PUT, an upsert, a table editor)               | it "names" an index it only read earlier, and that is taken as meant |

So whether the rule holds would depend on the names of two triggers, on every other trigger on the table, on a
session setting, and on how each client builds its UPDATE. When one of them is off, a bottle lands on a spot nobody
asked for and nothing says so. That is the one outcome this section exists to rule out.

### What is built: only the values of the row, and a refusal where they cannot tell

- **R1. A bottle with no place has index 1.** When `location_id` is null or the bottle is not in the cellar, the
  trigger sets `loc_index := 1` with the fields it already clears. An index never waits on an unplaced bottle.
- **R2. A bottle that was at index 1 (or had no place) and is moved to another cell gets the index that is
  written.** Left out, that is still 1: the front of the cell, which is what a writer without an index means, and
  what ADR-001 §2 says a spot without an index is.
- **R3. A bottle moved to another cell with a DIFFERENT index than it had gets that index.** It cannot differ by
  being left out, so it was meant.
- **R4. A bottle at an index above 1, moved to another cell with the SAME index, is refused:**
  `slot_index_ambiguous` (`23514`). Either the writer left the index out, or it wants that very index again. The row
  looks the same both ways, and one of the two readings puts the bottle where nobody asked. Nothing is guessed.
- **R5. Within one cell, a changed index is taken as written. Nothing changed about the spot: nothing is checked,
  and the place is not locked.**

How a writer that DOES know the index moves a back bottle to the back of another cell: take it out of its place
first (R1 puts it at index 1), then put it where it goes (R2 or R3). `swap_bottles_v2` does exactly that inside one
transaction; a `move` function for the app's own move will do the same when the API for depth is built.

What each writer gets:

- **Old app, rolled-back app:** every move of a front bottle works exactly as before (index 1). A move of a back
  bottle is refused; the app shows its general "that can't be done" and nothing changed. Opening, removing and
  restoring go through R1. Such bottles only exist once depth has been switched on.
- **Direct PostgREST:** the same rules and the same refusals: there is no request that sets a spot without passing
  through the trigger. Verified through PostgREST itself (`scripts/real-stack-smoke.mjs`), including one request
  that moves several bottles at once.
- **The app from the depth API on:** names `loc_index` in every write that places a bottle, and moves a back bottle
  through a function.

The price of refusing: an app that knows the index cannot move a back bottle to the same depth elsewhere with one
plain UPDATE. That is a small cost paid by new code, in exchange for no silent misplacement by any code.

Tests: `supabase/tests/99_smart_cellar_structure.test.sql` (every row of the list above, a multi-row update, opened
and restored bottles), `scripts/real-stack-smoke.mjs` (through PostgREST), `scripts/db-placement-concurrency.sh`
(the old-style move against a resize).

## 4. Bounds, resizing and the race between them

Today (`20261010000004_cellars_bottles.sql`): `private.check_bottle_location()` checks a bottle's row and col against
the place; `private.check_location_resize()` refuses a shrink past a bottle. **Neither takes a lock** (verified), so a
shrink and a placement running at the same moment can both pass. Depth adds a third dimension to the same race.

Required (new migration, `create or replace` on both functions; the old migration file is not edited):

- `check_bottle_location`: read the place with `for share`, so it waits for a resize in flight and then sees the new
  size (a foreign-key check only takes `for key share`, which a plain `update` of the place does not conflict with:
  that is why the race exists). Check `loc_index <= cell_capacity` as well; raise the existing
  `slot_out_of_bounds` (`23514`), which `server/db/errors.ts` already maps. The same function carries the rules of §3,
  applied BEFORE the bounds check, so what is checked is the spot the bottle will really have. An update that
  changes nothing about a bottle's spot is not checked again and does not lock the place.
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
| `slot_semantics` was null (a place from before templates)       | allowed     | allowed, subject to §4: the same case, its `cell_capacity` is always 1  |
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
the stored `slot_semantics` no longer matches the template's, and reading takes neither (`semantics_mismatch`, §1
"How the adapter must read these columns"). A server check refuses the write in the first place.

**Server check (friendlier, not a replacement):** compare the layout before and after
(`resolveStorage(...).layout.semantics`, `occupancyOf`) and answer 409 saying how many bottles are in the way and
what the choices are.

### An explicit migration of positions (later; sprint 1B only rejects, and built none of this)

When a person really has replaced a rack by bins, the bottles are still theirs and still in that place. The
migration is a choice they make, never something a save does on its own. `save_storage_layout` as built has NO such
argument and answers `semantics_change`. When a screen needs it, a new function (or version) takes one more
argument, `p_positions`:

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

`public.save_storage_layout(p_household uuid, p_location uuid, p_kind location_kind, p_template text,
p_slot_semantics text, p_rows smallint, p_cols smallint, p_cell_capacity smallint, p_appearance jsonb, p_zones jsonb)
returns text` (as built, migration 0045)

- **`security invoker`**, `set search_path = ''`: every read and write goes through the caller's own RLS, and
  `p_household` narrows, it grants nothing (as in `20261104000027_swap_bottles.sql`);
- locks the place `for no key update` first (placements wait on it through §4's `for share`; so do zone writers, §6);
- sets `kind`, `template` and `slot_semantics` together (the server passes all three from the catalogue; the
  function looks nothing up), the size and the look; replaces the zones when `p_zones` is an array (`[]` removes
  them, NULL leaves them);
- asks for the deferred zone check before it returns, so a layout that does not hold is undone inside the call;
- returns `saved` / `not_found` / `in_use` / `semantics_change` / `invalid_zones` / `depth_not_enabled`; in every case
  but `saved` nothing at all changed. `execute` revoked from `public` and `anon`, granted to `authenticated`.

One writer of a place's zones at a time: a row trigger on the zones table takes the same row lock on the place before
any zone is written, also for a direct write. Without it two transactions could each commit a set of zones that is
sound alone and broken together (`scripts/db-placement-concurrency.sh`, steps 5 and 6).

Creating a place WITH zones in one go is not built: the place is inserted first (a plain insert, as today) and its
zones are saved with this function. If the second step fails the place exists without zones, which is a valid
state. A create-with-zones function can come with the builder if that turns out not to be enough.

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
  Its updates name `loc_index = 1`.

(As built, 0045.) `stale` is a value every caller already handles ("One of these bottles was just moved by someone else. Nothing was
changed.", `service.ts`). The wording is not exact for this case, but it is safe, it is true that nothing changed,
and the caller's next read shows the cellar as it is. A new return value would reach old servers as `not_found`
(`repository.ts` maps anything it does not know to that), which is worse. **Owner decision** if a distinct value is
preferred all the same.

Left unreplaced, the old body would compare `(location, row, col)` only and then move those three fields: it could
put a back bottle on the front of another cell on the word of a caller who never saw it (or be stopped half-way by
§3 R4, depending on where the two bottles are). That is the behaviour this section rules out, so replacing the body
is part of the same set of migrations as the index, not a later nicety.

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
- then: BOTH to no place (which puts both at index 1, §3 R1), b to a's old spot, a to b's old spot, each naming
  `loc_index`. Taking both out first is what keeps every step unambiguous under §3 R4, also when two back bottles
  of different cells trade places. The bounds trigger checks both; the unique index holds after every statement;
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
- **the old app's moves stay safe by the database's own rules, not by its code** (§3): a move of a front bottle
  addresses a cell and gets index 1, as always; a move of a back bottle is refused and changes nothing; a bottle it
  opens, removes or restores is at index 1; it can never carry an index above 1 into another cell;
- **the old `swap_bottles` refuses what it cannot verify** (§8): a bottle at an index above 1 gives `stale` and
  nothing changes. For bottles at index 1 it works as it always has;
- the old app cannot change what an index means: it writes `kind`, never `template` or `slot_semantics` (so the
  check that pairs them always passes for it), and a change of
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

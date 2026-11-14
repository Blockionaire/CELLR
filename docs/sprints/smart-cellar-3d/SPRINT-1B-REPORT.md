# Smart Cellar 3D — sprint 1B: the database foundation

2026-11-14. Three forward-only, additive migrations, one gated file that is deliberately **not** a migration, their
tests, and the corrections to the specification that building and reviewing them brought. **Nothing was applied to
production, nothing was deployed, nothing was merged.** Every database this sprint touched was a throwaway: a
temporary Postgres 16 cluster, and a local Supabase stack in Docker.

What a person sees does not change: the app does not call any of the new things yet, and more than one bottle per
cell is switched off in the database.

Read with: [`ADR-001`](./ADR-001-templates-and-slot-identity.md) (what the terms mean) and
[`SPRINT-1B-DATABASE-REQUIREMENTS.md`](./SPRINT-1B-DATABASE-REQUIREMENTS.md) (why each rule exists).

## 1. The migrations

| File                                        | What it does                                                                                                                                                                                                                                | Kind                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `20261120000043_smart_cellar_structure.sql` | Places: `template`, `cell_capacity`, `slot_semantics`, `appearance`, their limits. Bottles: `loc_index`. A second unique index on the whole spot. The bounds check (replaced, same name) with the index rules and a lock. The depth switch. | additive; one function replaced in place |
| `20261121000044_smart_cellar_zones.sql`     | `cellar_location_zones`: table, checks, triggers, row level security, column grants.                                                                                                                                                        | additive                                 |
| `20261122000045_smart_cellar_rpcs.sql`      | `swap_bottles` made conservative (same signature), `swap_bottles_v2`, `save_storage_layout`.                                                                                                                                                | additive; one function replaced in place |

**None of them drops anything.** They are complete, independently deployable and safe with the old unique index
`bottles_slot_unique` in force, for as long as it stays.

### The destructive statement is not a migration

`drop index public.bottles_slot_unique` is destructive and the owner has not authorised it. It is in
`supabase/gated-migrations/smart_cellar_drop_legacy_slot_index.sql`:

- **`supabase db push` cannot run it.** The CLI, `supabase start`, `supabase db reset` and `scripts/db-test.sh` read
  only `supabase/migrations`. The file is not there.
- **It has no version number.** A version is a place in the order, and `db push` refuses a migration older than the
  newest one a database has recorded. Numbered today it would be too old on the day it is released. It gets its
  number then, in a pull request of its own, later than everything on `main` at that moment
  (`supabase/gated-migrations/README.md`).
- **A tripwire.** `supabase/tests/99_smart_cellar_as_deployed.test.sql` asserts, after all migrations, that
  `bottles_slot_unique` still exists. Moving the file into `supabase/migrations` turns CI red until that test is
  changed, which is the review it is meant to force.
- **It is still tested, as it is.** The tests that need two bottles in one cell run this exact file first, inside
  their own transaction, and roll it back (`99_smart_cellar_structure.test.sql`, `99_smart_cellar_rpcs.test.sql`).
  `scripts/db-smart-cellar-upgrade.sh` checks that it stops when the replacement index is missing or wrong, and
  `scripts/db-placement-concurrency.sh` runs it for its last step. So what is released later is what was tested.
- **Two locks on one door.** With the old index in force a cell holds one bottle even if the depth switch were
  turned on (tested). Depth needs both: the switch, and the gated file.

No migration updates, moves or deletes a row of `cellar_locations` or `bottles`. `scripts/db-smart-cellar-upgrade.sh`
proves it on a database built before 0043 and filled with 8 places and 923 bottles: after the migrations every one
of those rows has the same values, the same physical position in its table (`ctid`) and the same last-writing
transaction (`xmin`).

## 2. What the database now guarantees

Each of these is a constraint, an index, a trigger or a policy. None depends on the app, on Zod or on a feature flag.

| Guarantee                                                       | How                                                                                                                         |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| One bottle per whole spot `(place, row, col, index)`            | unique index `bottles_slot_index_unique`; and one bottle per CELL while `bottles_slot_unique` stays                         |
| At most 30 shelves and 30 cells a shelf                         | the existing checks, unchanged                                                                                              |
| At most 16 bottles per cell; an index is 1 to 16                | checks on `cell_capacity` and `loc_index`                                                                                   |
| At most 1200 bottles per place                                  | check `grid_rows * grid_cols * cell_capacity <= 1200`                                                                       |
| At most 3 zones per place                                       | `zone_index between 1 and 3`, unique per place                                                                              |
| A bottle's spot exists in its place                             | `private.check_bottle_location` (row, col, index), reading the place `for share`                                            |
| No resize strands a bottle (shelves, cells, bottles per cell)   | `locations_resize` (as it was) and `locations_cells` (new), behind the row lock of the place                                |
| A placement and a resize cannot both pass                       | the share lock above against the row lock of the update; before 0043 they could (see §5, the control)                       |
| Zones are an ordered split of the shelves: no gap, no overlap   | a deferred constraint trigger, checked at commit, on the zones and on the place's number of shelves                         |
| Zones and layout cannot be changed past each other, or deadlock | every zone write takes the row lock of its place; a direct update or delete never WAITS for it (§5a)                        |
| What an index means never changes under bottles it matters to   | `locations_cells`: `layout_semantics_change` when `slot_semantics` changes on a place more than one deep that holds bottles |
| A template and its semantics are stated together or not at all  | check; and more than one bottle per cell needs stated semantics                                                             |
| A bottle is never put on an index the writer did not mean       | value-only rules in `private.check_bottle_location`; the undecidable case is refused (§4)                                   |
| A zone carries a setting, never a reading                       | the table has `target_temp_c` and no other temperature column; a test pins the exact column list                            |
| More than one bottle per cell is off                            | `private.cellar_settings.depth_placement`, writable by no API role                                                          |

## 3. What changed against the specification, and why

**a. Writers that know no index: the proposed trigger pair was not built.** The specification proposed detecting
whether an UPDATE named `loc_index` with a column trigger and a transaction setting. It was run against PostgreSQL
16 first: [`experiments/index-named-trigger.sql`](./experiments/index-named-trigger.sql). It handles multi-row
updates, several updates in one transaction and a rollback to a savepoint correctly. It fails, without any error,
when another BEFORE trigger skips a row, when a trigger is renamed, when the setting is written by hand, when one
trigger is disabled, and when a client sends the whole row back. Each of those puts a bottle on an index nobody
asked for. The built rule uses only the row's values and refuses the one case it cannot decide. See §4.

**b. The old unique index is not dropped by any migration.** The specification had it dropped together with the
rest; the first version of this sprint moved it to a migration of its own; after review it is not a migration at
all (§1). While both indexes exist a cell holds one bottle.

**c. Depth is switched off in the database.** Not in the specification at all. Without it a signed-in person could
create a place two deep through PostgREST today, and the app would show one of the two bottles.

**d. `slot_semantics` has no default** (decided in the review of sprint 1A) and `resolveStorage` now reads it:
`semantics_mismatch`, and never for a place without a template.

**e. Direct writes of zone rows never wait for the place.** Found in review: as first written they could deadlock
against `save_storage_layout`. See §5a.

**f. Not built, on purpose:** the position-migration modes (`compact`, `assign`, `unplace`), a create-with-zones
function, a `move` function for back bottles, any change to `friend_racks`, any API field.

## 4. Old clients, old app versions, direct access

A column default applies to an INSERT. An UPDATE that leaves `loc_index` out keeps what is there. The rule, in
`private.check_bottle_location`:

| A write                                                              | Result                                                    |
| -------------------------------------------------------------------- | --------------------------------------------------------- |
| A new bottle, no index                                               | index 1                                                   |
| No place, or opened / removed / gifted                               | index 1, whatever was written                             |
| A front bottle moved to another cell, no index (every app version)   | index 1 of that cell, or the usual "spot taken" (`23505`) |
| A front bottle moved with an index                                   | that index                                                |
| A back bottle moved to another cell with a different index           | that index                                                |
| **A back bottle moved to another cell with the same index, or none** | **refused: `slot_index_ambiguous`. Nothing changes.**     |
| Within one cell, another index                                       | that index                                                |
| Anything else about the bottle (price, note, photo)                  | the spot is untouched and not re-checked                  |

- **Today's app on the new schema:** every place is one bottle per cell, every bottle at index 1. Every row of the
  table above that it can reach is unchanged behaviour. Verified: the whole existing SQL suite passes untouched
  (1327 tests), `99_smart_cellar_as_deployed.test.sql` runs the app's actions on exactly what is deployed, and
  `scripts/db-smart-cellar-upgrade.sh` does the same on a database that already held a cellar.
- **`swap_bottles` (the existing function):** takes its positions as index 1 and compares the whole spot. Two front
  bottles swap as before. A bottle at an index above 1 gives `stale`; nothing changes.
- **Direct PostgREST:** the same triggers. Verified through PostgREST and Kong on a real Supabase stack
  (`scripts/real-stack-smoke.mjs`, 19 new checks), including one request that moves several bottles.
- **A rolled-back app after depth was switched on and used:** it moves, opens and swaps front bottles as before. It
  cannot move or swap a back bottle (refused, nothing changes) and its racks view shows one bottle per cell. No data
  is lost or changed.

## 5. Concurrency

`bash scripts/db-placement-concurrency.sh` (`pnpm db:test:placement`): separate sessions as signed-in members,
real commits. Steps 1 to 11 run **as deployed** (the old index in force); only the last one runs the gated file.
Result of the run on 2026-11-14:

| Step                                                                                     | Result                                              |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Control, schema before 0043: a bottle placed on a shelf that is being removed            | both succeed; the bottle is outside its place       |
| 20 sessions on one whole spot; 20 on one cell of an old rack                             | 1 placed, 19 refused, each time                     |
| 20 sessions on the front of a cell whose back is taken (depth switch on, old index)      | all 20 refused by the old index                     |
| Placement against resize, each made to wait for the other, both orders, three dimensions | the second is always refused                        |
| 40 placements racing 40 resizes, nothing held back                                       | one winner each time, never both                    |
| Zones against the number of shelves, both orders                                         | the second is always refused at commit              |
| 12 simultaneous `save_storage_layout` calls with different zones                         | all saved in turn; the result is one caller's whole |
| 10 sessions swapping one pair (`swap_bottles_v2`, and `swap_bottles`)                    | 1 swapped, 9 stale                                  |
| The same pair named in opposite order by two sessions, 15 times                          | 1 swapped, 1 stale; no deadlock                     |
| 20 old-style moves onto a shelf racing its removal                                       | one winner each time, never both                    |
| 20 saves of a shallower layout racing a placement at the back                            | never an index past the cell                        |
| Direct zone UPDATE and DELETE against a layout save (§5a)                                | no deadlock; see below                              |
| With the gated file run: 16 sessions into a bin of 8; 20 behind a front bottle           | 8 placed, one per index; 1 placed, 19 refused       |
| At the end                                                                               | no bottle outside its place, no deadlock            |

All of this holds at READ COMMITTED, which is what PostgREST and the app use and what the existing `swap_bottles`
already relies on. This script and the upgrade rehearsal now run in CI, in the database job.

### 5a. A direct write of a zone row against a layout save

**The question from review:** `save_storage_layout` locks the place and then replaces its zones. A direct `UPDATE` or
`DELETE` of an existing zone row holds that row's lock before its BEFORE trigger runs, and the trigger then locks
the place. Opposite orders: can they deadlock?

**Yes, as first written.** Reproduced with two sessions on PostgreSQL 16: the save holds the place and has not
reached the zones; the direct write takes the zone and waits for the place; the save then waits for the zone.
PostgreSQL ends the direct write after one second with `deadlock detected`, for the update and for the delete. No
data was harmed (the save completed, the split held), but a statement died in a way the caller could not predict.

**Why the order cannot simply be turned round.** Deleting a place locks the place and then deletes its zones by
cascade: the same order as the save, fixed by how a foreign key works. So the order has to be "the place, then its
zones" everywhere, and the one writer that comes the other way must not wait.

**The mitigation (0044, `private.lock_zone_location`).** A direct update or delete of a zone takes the place's lock
if it is free and is otherwise refused **at once** with `zone_place_busy` (`55P03`), having changed nothing. It
never waits while holding a zone, so no cycle can form. An insert holds no row yet and still waits its turn. Inside
`save_storage_layout` and inside a delete of the place the lock is the transaction's own and nothing is refused.
RLS, the constraints, the household match in the trigger and the split check are unchanged.

**The retry strategy.** `zone_place_busy` means "try again": `server/db/errors.ts` maps it to a retryable conflict.
The intended way to change zones is `save_storage_layout`, which waits in the right order and is never refused for
this reason. The cost: a direct write can also be refused while a bottle is being placed in that place at that
instant (the placement holds a share lock on the place for its short transaction).

**Results** (steps 9 to 11 of the script):

| Case                                                                | Result                                                                    |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| The save holds the place; then a direct UPDATE of a zone            | refused in 37 ms with `zone_place_busy`; the save is `saved`; no deadlock |
| The save holds the place; then a direct DELETE of the zones         | refused in 53 ms with `zone_place_busy`; the save is `saved`; no deadlock |
| A direct UPDATE (or DELETE) first, held open; then the save         | the save waits, then `saved`                                              |
| 40 direct writes racing 40 saves, nothing held back                 | 40 saves through; 36 direct writes through, 4 refused; no deadlock        |
| A writer that retries after `zone_place_busy`                       | through on the third try                                                  |
| Deleting the place against a direct update of its zone, both orders | both finish; no deadlock                                                  |
| **Control:** the trigger put back as first written (it waits)       | the same two sessions deadlock, update and delete: the test can see it    |

(The times and the split between "through" and "refused" differ a little from run to run; the absence of a deadlock
does not.)

## 6. Security

- **Household isolation.** `cellar_location_zones` carries `household_id` and the composite foreign key
  `(location_id, household_id)` of every household table, so a zone cannot belong to another household than its
  place by construction. RLS: select, insert, update and delete for members of the household.
- **Column grants.** New columns are granted one by one. Clients cannot set a zone's `id` or timestamps, nor move a
  zone to another place or household. `private.cellar_settings` has no grant at all, not even for the service role.
- **The three functions are `security invoker`** with a pinned empty `search_path`: they can do nothing the caller
  could not do with plain statements. `p_household` narrows; a place or bottle of another household is `not_found`.
  Executable by `authenticated` only. The trigger functions are `security definer` (they must read and lock the
  place whatever the caller's RLS), pinned the same way, and match on the household.
- **Friends.** `friend_racks` and `friend_cellar` are untouched and do not read the zones table. A test asserts that
  what a friend gets contains exactly the five fields it always had and no zone, temperature or purpose, and that a
  friend cannot select zones directly.
- **Tests:** another household reads nothing, changes nothing (0 rows), cannot add a zone as "ours" or as "theirs",
  cannot place a bottle in our place at any index, and gets `not_found` from every function, also when naming our
  household. Anonymous cannot read or call anything. The hygiene suite (every table has RLS, anon holds nothing,
  every definer function pins its search path) passes with the new objects.

## 7. Checks run

All on throwaway databases.

| Check                                                          | Result                                                   |
| -------------------------------------------------------------- | -------------------------------------------------------- |
| `pnpm db:test` (Postgres 16, shim)                             | 1513 passed (1327 existing, all untouched, plus 186 new) |
| The same suite on a real local Supabase stack (Postgres 17.11) | 1514 passed                                              |
| `scripts/real-stack-smoke.mjs` on that stack (PostgREST, Kong) | all passed, 19 of them new                               |
| `pnpm db:test:placement`                                       | passed (§5, §5a)                                         |
| `pnpm db:test:upgrade`                                         | passed (§1)                                              |
| `pnpm db:test:imports`                                         | passed (the existing import flow, unchanged)             |
| `pnpm db:types:check`, `pnpm migrations:check`                 | see the pull request                                     |
| format, lint, typecheck, unit tests, build                     | see the pull request                                     |

## 8. Production: what is not known, and what must not be assumed

**`docs/MIGRATIONS.md` describes 36 migrations. `main` had 42 before this sprint and has 46 with it.**

- `MIGRATIONS.md` §3 and §4 (verified read-only on 2026-11-02) say production was built by pasting migrations
  `0001`-`0036` into the SQL Editor, has **no migration history**, and that `db push` must not be run until the
  owner has done the bootstrap.
- `20261114000037` came with PR #65 and `20261115000038`-`20261119000042` with the Wine Intelligence epic (PR #68).
  `docs/sprints/wine-intelligence-mega/RELEASE_CHECKLIST.md` says it is not known from the repository whether `0037`
  was run in production, and gives the steps to find out.
- **This sprint did not look at production and does not know** which of `0037`-`0042` are applied there, nor whether
  the bootstrap has been done since. Nothing here assumes either.

What follows for whoever deploys:

1. **The bootstrap command in `MIGRATIONS.md` §4 step 3 must not be run as written any more.** It records _every
   file in `supabase/migrations`_ as applied. Today that would mark `0037`-`0045` as applied without running them,
   and their objects would be missing with a history that says otherwise.
2. **Before any repair or push: a read-only inventory** of production's schema (`compare.sh`, `inventory.sh`) and of
   its migration history, and a written decision by the owner of which versions are recorded and which are run.
3. **0043-0045 depend only on objects of `0004` and `0027`** (`cellar_locations`, `bottles`, `swap_bottles`,
   `private.set_updated_at`, `private.forbid_change`, `private.my_household_ids`). They do not need `0037`-`0042`.
   But `db push` applies pending migrations in order, so they cannot go before those are sorted out.
4. **The gated file is not part of any of this.** It is not a migration and is not to be run.

`docs/MIGRATIONS.md` now opens with a STOP notice saying exactly this, and marks the two commands in §4 as outdated.
It gives no replacement command: which versions may be recorded depends on what production holds, and nobody has
looked.

## 9. Decisions for the owner

**Destructive, needs an explicit yes, and is NOT in this release:**

1. `drop index public.bottles_slot_unique` (`supabase/gated-migrations/`). Not a migration, cannot be pushed, has no
   version. Releasing it is a pull request of its own with the owner's written approval (§1). Nothing in this
   release depends on it.

**Replaced in place (not destructive, but they change existing objects):**

2. `private.check_bottle_location` (0043): now also checks the index, applies the rules of §4 and locks the place.
3. `public.swap_bottles` (0045): the same for front bottles; `stale` for a bottle at an index above 1.

**Open:**

4. Who may delete a zone: built as _members_ (replacing zones is part of editing a place). Owners only would mean
   members cannot change zones at all.
5. The old swap answering `stale` for a back bottle, or a new distinct value.
6. The limits: 16 per cell, 1200 per place, 3 zones.
7. When to switch depth on: it needs BOTH the gated file released (item 1) and a later migration that sets
   `private.cellar_settings.depth_placement`, together with the API and screens that can show two bottles in a cell
   and a `friend_racks` that returns the index.
8. The production bootstrap and the state of `0037`-`0042` (§8).

## 10. Risks that remain

- **Not run against production data.** The upgrade rehearsal uses a built cellar, not a copy of production. The
  migrations take brief exclusive locks on `cellar_locations` and `bottles` (adding columns, building one index). On the sizes this app has that is moments; it was not timed on production.
- **`for share` on the place for every placement.** A place being edited makes placements in it wait, and the
  reverse. A transaction that places a bottle and then resizes the same place, twice at once, can deadlock (Postgres
  ends one of them). The app does not do that; the functions lock the place first.
- **Isolation level.** The guarantees of §5 are for READ COMMITTED. A session that sets REPEATABLE READ itself could
  pass a resize check against a stale picture. PostgREST clients cannot choose their isolation level.
- **An old app cannot change the number of shelves of a place that has zones** (refused at commit: the zones would
  not fit). Zones only exist once something new writes them.
- **A back bottle cannot be moved by one plain UPDATE to the same depth elsewhere.** New code needs a function for
  that move; it is not built yet (§3e).
- **The catalogue is not in the database.** That a template exists, belongs to the kind and comes in a size is a
  server check, to be added with the API. A write around the server can store a pair that disagrees; reading then
  refuses to treat the place as known (`resolveStorage`), and nobody else's data is involved.
- **A direct write of a zone row can be refused with `zone_place_busy`** while its place is being saved or a bottle
  is being placed in it (§5a). It is safe and retryable; the app's own path will be `save_storage_layout`.
- **A database whose replacement index was dropped by hand** would let the gated file's check stop it, as designed;
  nothing else guards the old index except that no migration drops it and the tripwire test says so.

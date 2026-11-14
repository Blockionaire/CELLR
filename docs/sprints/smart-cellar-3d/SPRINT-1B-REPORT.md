# Smart Cellar 3D — sprint 1B: the database foundation

2026-11-14. Four forward-only migrations, their tests, and the corrections to the specification that building them
brought. **Nothing was applied to production, nothing was deployed, nothing was merged.** Every database this sprint
touched was a throwaway: a temporary Postgres 16 cluster, and a local Supabase stack in Docker.

What a person sees does not change: the app does not call any of the new things yet, and more than one bottle per
cell is switched off in the database.

Read with: [`ADR-001`](./ADR-001-templates-and-slot-identity.md) (what the terms mean) and
[`SPRINT-1B-DATABASE-REQUIREMENTS.md`](./SPRINT-1B-DATABASE-REQUIREMENTS.md) (why each rule exists).

## 1. The migrations

| File                                                     | What it does                                                                                                                                                                                                                                | Kind                                                              |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `20261120000043_smart_cellar_structure.sql`              | Places: `template`, `cell_capacity`, `slot_semantics`, `appearance`, their limits. Bottles: `loc_index`. A second unique index on the whole spot. The bounds check (replaced, same name) with the index rules and a lock. The depth switch. | additive; one function replaced in place                          |
| `20261121000044_smart_cellar_zones.sql`                  | `cellar_location_zones`: table, checks, triggers, row level security, column grants.                                                                                                                                                        | additive                                                          |
| `20261122000045_smart_cellar_rpcs.sql`                   | `swap_bottles` made conservative (same signature), `swap_bottles_v2`, `save_storage_layout`.                                                                                                                                                | additive; one function replaced in place                          |
| `20261123000046_smart_cellar_drop_legacy_slot_index.sql` | Checks that the new unique index is there and right, then drops `bottles_slot_unique`.                                                                                                                                                      | **DESTRUCTIVE: drops an index. Needs the owner's decision (§9).** |

No migration updates, moves or deletes a row of `cellar_locations` or `bottles`. `scripts/db-smart-cellar-upgrade.sh`
proves it on a database built before 0043 and filled with 8 places and 923 bottles: after the migrations every one
of those rows has the same values, the same physical position in its table (`ctid`) and the same last-writing
transaction (`xmin`).

## 2. What the database now guarantees

Each of these is a constraint, an index, a trigger or a policy. None depends on the app, on Zod or on a feature flag.

| Guarantee                                                      | How                                                                                                                         |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| One bottle per whole spot `(place, row, col, index)`           | unique index `bottles_slot_index_unique`                                                                                    |
| At most 30 shelves and 30 cells a shelf                        | the existing checks, unchanged                                                                                              |
| At most 16 bottles per cell; an index is 1 to 16               | checks on `cell_capacity` and `loc_index`                                                                                   |
| At most 1200 bottles per place                                 | check `grid_rows * grid_cols * cell_capacity <= 1200`                                                                       |
| At most 3 zones per place                                      | `zone_index between 1 and 3`, unique per place                                                                              |
| A bottle's spot exists in its place                            | `private.check_bottle_location` (row, col, index), reading the place `for share`                                            |
| No resize strands a bottle (shelves, cells, bottles per cell)  | `locations_resize` (as it was) and `locations_cells` (new), behind the row lock of the place                                |
| A placement and a resize cannot both pass                      | the share lock above against the row lock of the update; before 0043 they could (see §5, the control)                       |
| Zones are an ordered split of the shelves: no gap, no overlap  | a deferred constraint trigger, checked at commit, on the zones and on the place's number of shelves                         |
| Zones and layout cannot be changed past each other             | every zone write takes the row lock of its place first                                                                      |
| What an index means never changes under bottles it matters to  | `locations_cells`: `layout_semantics_change` when `slot_semantics` changes on a place more than one deep that holds bottles |
| A template and its semantics are stated together or not at all | check; and more than one bottle per cell needs stated semantics                                                             |
| A bottle is never put on an index the writer did not mean      | value-only rules in `private.check_bottle_location`; the undecidable case is refused (§4)                                   |
| A zone carries a setting, never a reading                      | the table has `target_temp_c` and no other temperature column; a test pins the exact column list                            |
| More than one bottle per cell is off                           | `private.cellar_settings.depth_placement`, writable by no API role                                                          |

## 3. What changed against the specification, and why

**a. Writers that know no index: the proposed trigger pair was not built.** The specification proposed detecting
whether an UPDATE named `loc_index` with a column trigger and a transaction setting. It was run against PostgreSQL
16 first: [`experiments/index-named-trigger.sql`](./experiments/index-named-trigger.sql). It handles multi-row
updates, several updates in one transaction and a rollback to a savepoint correctly. It fails, without any error,
when another BEFORE trigger skips a row, when a trigger is renamed, when the setting is written by hand, when one
trigger is disabled, and when a client sends the whole row back. Each of those puts a bottle on an index nobody
asked for. The built rule uses only the row's values and refuses the one case it cannot decide. See §4.

**b. The old unique index is dropped in its own migration**, after the new one is checked, instead of in the same
migration. While both exist a cell still holds one bottle, so a deploy that stops between them is in a safe state.

**c. Depth is switched off in the database.** Not in the specification at all. Without it a signed-in person could
create a place two deep through PostgREST today, and the app would show one of the two bottles.

**d. `slot_semantics` has no default** (decided in the review of sprint 1A) and `resolveStorage` now reads it:
`semantics_mismatch`, and never for a place without a template.

**e. Not built, on purpose:** the position-migration modes (`compact`, `assign`, `unplace`), a create-with-zones
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
  (1327 tests), and `scripts/db-smart-cellar-upgrade.sh` runs the app's own actions between 0045 and 0046 and after.
- **`swap_bottles` (the existing function):** takes its positions as index 1 and compares the whole spot. Two front
  bottles swap as before. A bottle at an index above 1 gives `stale`; nothing changes.
- **Direct PostgREST:** the same triggers. Verified through PostgREST and Kong on a real Supabase stack
  (`scripts/real-stack-smoke.mjs`, 19 new checks), including one request that moves several bottles.
- **A rolled-back app after depth was switched on and used:** it moves, opens and swaps front bottles as before. It
  cannot move or swap a back bottle (refused, nothing changes) and its racks view shows one bottle per cell. No data
  is lost or changed.

## 5. Concurrency

`bash scripts/db-placement-concurrency.sh` (`pnpm db:test:placement`): separate sessions as signed-in members,
real commits. Result of the run on 2026-11-14:

| Step                                                                                     | Result                                              |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Control, schema before 0043: a bottle placed on a shelf that is being removed            | both succeed; the bottle is outside its place       |
| 20 sessions on one whole spot; 20 on one cell of an old rack                             | 1 placed, 19 refused, each time                     |
| 16 sessions into a bin of 8                                                              | 8 placed, one per index                             |
| Placement against resize, each made to wait for the other, both orders, three dimensions | the second is always refused                        |
| 40 placements racing 40 resizes, nothing held back                                       | one winner each time, never both                    |
| Zones against the number of shelves, both orders                                         | the second is always refused at commit              |
| 12 simultaneous `save_storage_layout` calls with different zones                         | all saved in turn; the result is one caller's whole |
| 10 sessions swapping one pair (`swap_bottles_v2`, and `swap_bottles`)                    | 1 swapped, 9 stale                                  |
| The same pair named in opposite order by two sessions, 15 times                          | 1 swapped, 1 stale; no deadlock                     |
| 20 old-style moves onto a shelf racing its removal                                       | one winner each time, never both                    |
| 20 saves of a shallower layout racing a placement at the back                            | never an index past the cell                        |
| At the end                                                                               | no bottle outside its place, no deadlock            |

All of this holds at READ COMMITTED, which is what PostgREST and the app use and what the existing `swap_bottles`
already relies on. The scripts are run by hand, like the three existing concurrency scripts; they are not in CI.

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
| `pnpm db:test` (Postgres 16, shim)                             | 1491 passed (1327 existing, all untouched, plus 164 new) |
| The same suite on a real local Supabase stack (Postgres 17.11) | 1492 passed                                              |
| `scripts/real-stack-smoke.mjs` on that stack (PostgREST, Kong) | all passed, 19 of them new                               |
| `pnpm db:test:placement`                                       | passed (§5)                                              |
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
   file in `supabase/migrations`_ as applied. With 46 files that would mark `0037`-`0046` as applied without running
   them, and their objects would be missing with a history that says otherwise. Only versions whose objects were
   verified in production may be recorded (the Wine Intelligence checklist filters with `awk '$1 <= ...'`).
2. **0043-0046 depend only on objects of `0004` and `0027`** (`cellar_locations`, `bottles`, `swap_bottles`,
   `private.set_updated_at`, `private.forbid_change`, `private.my_household_ids`). They do not need `0037`-`0042`.
   But `db push` applies pending migrations in order, so they cannot go before those are sorted out.
3. **`0046` checks before it drops.** If the new index is not there, valid, unique and on the right columns, it
   stops and leaves the old one.
4. `compare.sh` against the repository will report the objects of every migration not yet applied; that is expected
   and is how to see where production stands.

`docs/MIGRATIONS.md` itself was not edited: it is the owner's document of record, and what it should say depends on
what production turns out to hold.

## 9. Decisions for the owner

**Destructive, needs an explicit yes:**

1. `drop index public.bottles_slot_unique` (migration 0046). The replacement is created in 0043 and checked in 0046
   first. To hold it back, leave 0046 out of the release: everything else works without it, and depth stays
   impossible while the old index exists.

**Replaced in place (not destructive, but they change existing objects):**

2. `private.check_bottle_location` (0043): now also checks the index, applies the rules of §4 and locks the place.
3. `public.swap_bottles` (0045): the same for front bottles; `stale` for a bottle at an index above 1.

**Open:**

4. Who may delete a zone: built as _members_ (replacing zones is part of editing a place). Owners only would mean
   members cannot change zones at all.
5. The old swap answering `stale` for a back bottle, or a new distinct value.
6. The limits: 16 per cell, 1200 per place, 3 zones.
7. When to switch depth on: a later migration that sets `private.cellar_settings.depth_placement`, together with
   the API and screens that can show two bottles in a cell and a `friend_racks` that returns the index.
8. The production bootstrap and the state of `0037`-`0042` (§8).

## 10. Risks that remain

- **Not run against production data.** The upgrade rehearsal uses a built cellar, not a copy of production. The
  migrations take brief exclusive locks on `cellar_locations` and `bottles` (adding columns, building one index,
  dropping one). On the sizes this app has that is moments; it was not timed on production.
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
- **The concurrency and upgrade scripts are not in CI.**

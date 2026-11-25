# Gated migrations

SQL that is written, reviewed and tested, and **must not run yet**. Nothing in this folder is a migration:
`supabase db push`, `supabase start`, `supabase db reset` and `scripts/db-test.sh` only read `supabase/migrations`, so
a file here cannot reach any database by an ordinary deploy. That is the point of the folder.

A file is here when it is **destructive** (it drops or rewrites something) or otherwise needs a decision that has not
been taken. `docs/MIGRATIONS.md` rule 2: no destructive change without a separate, explicit decision.

## What is here

The depth rollout these files belong to, its phases and their order: `docs/sprints/smart-cellar-3d/ADR-011-depth-placement-rollout.md`.

| File                                       | What it does                                                                                                                                                                                                                                              | Waiting for                                                                                             |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `smart_cellar_drop_legacy_slot_index.sql`  | Checks that `bottles_slot_index_unique` is in place, then **drops `public.bottles_slot_unique`**. (ADR-011 phase C.) Reversible only while depth is still off.                                                                                            | The owner's explicit approval, after phases A and B (ADR-011 §6). Not before.                           |
| `smart_cellar_depth_switch_on.sql`         | Checks that the old index is gone, the new one valid and `move_bottle_v2` (0054) there, then sets `private.cellar_settings.depth_placement = true`. (Phase D.) Opens nothing in the app: the app's depth gate never opens on production by configuration. | The owner's explicit approval, after phase C and a backup.                                              |
| `smart_cellar_depth_switch_off.sql`        | `depth_placement = false`. Moves no bottle; deep places stay as they are. The brake, not the way back.                                                                                                                                                    | Only if depth has to be stopped.                                                                        |
| `smart_cellar_depth_collapse_to_front.sql` | The way back, step 2: puts every LONE back bottle at index 1 of its own cell; **refuses, changing nothing**, while any cell holds two or more bottles (it never picks a cell). Never a migration: it writes bottles.                                      | Only after the switch is off, with the owner, and `private.depth_occupancy_report()` (0054) read first. |

Released from here: `smart_cellar_move_bottle_v2.sql` (sprint 4) became migration `20261202000054_smart_cellar_depth_additive.sql` in sprint 9, promoted unchanged (verified byte for byte by the independent review); the review then added one answer, `'depth_not_enabled'` (a back target while the switch is off) instead of raising, in 0054 itself; `supabase/tests/99_smart_cellar_move_proposal.test.sql` no longer runs it by path. (README step 1 asks for a pull request with nothing else in it: the sprint 9 branch keeps it in a commit of its own, so the lead can split it out.)

## Why the files have no version number

A migration's version is its place in the order. `supabase db push` refuses a migration older than the newest one a
database has recorded (and `--include-all`, which would force it, is forbidden by `docs/MIGRATIONS.md` §2). A file
numbered today would be "too old" on the day it is released, after other migrations have gone out. So a gated file
gets its number **when it is released**, later than everything on `main` at that moment.

## Releasing one (only with the owner's written approval)

1. In a pull request of its own, with nothing else in it: copy the file to
   `supabase/migrations/<yyyymmddhhmmss>_<name>.sql`, with a version **later than every file in
   `supabase/migrations` on `main` at that moment**, and remove it from this folder. Do not change its SQL; if it
   must change, that is a review of its own.
2. In the same pull request, update what expects the gate to be closed (it will fail until you do, which is how the
   gate is noticed): `supabase/tests/99_smart_cellar_as_deployed.test.sql` asserts that `bottles_slot_unique` still
   exists; and the tests and scripts that run this file by its path here (`grep -rn gated-migrations`).
3. Link the approval in the pull request. Then `docs/MIGRATIONS.md` §2, like any migration.

Never apply a file from this folder to a real database by hand.

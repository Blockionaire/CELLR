# Gated migrations

SQL that is written, reviewed and tested, and **must not run yet**. Nothing in this folder is a migration:
`supabase db push`, `supabase start`, `supabase db reset` and `scripts/db-test.sh` only read `supabase/migrations`, so
a file here cannot reach any database by an ordinary deploy. That is the point of the folder.

A file is here when it is **destructive** (it drops or rewrites something) or otherwise needs a decision that has not
been taken. `docs/MIGRATIONS.md` rule 2: no destructive change without a separate, explicit decision.

## What is here

| File                                      | What it does                                                                                      | Waiting for                                                                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `smart_cellar_drop_legacy_slot_index.sql` | Checks that `bottles_slot_index_unique` is in place, then **drops `public.bottles_slot_unique`**. | The owner's explicit approval, and the release that switches on more than one bottle per cell (Smart Cellar 3D). Not before either. |

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

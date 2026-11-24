# Database migrations: rules, deployment and recovery

This is the one place that says how the database changes. `SETUP.md`, `BETA-OPERATIONS.md` and the checklists point
here. Backups (database and Storage files) and restores are in `BACKUP-RECOVERY.md`.

> ## Current state (2026-11-18): all 46 migrations applied and recorded (0001–0046)
>
> **Verified read-only on 2026-11-18** (Supabase MCP, `SELECT` only; nothing was written):
>
> - **History:** `supabase_migrations.schema_migrations` holds **exactly the 46 files of `supabase/migrations`**,
>   `20261010000001` … `20261123000046`, under the same names. Nothing after 0046 is recorded. The owner's
>   `supabase migration list` / `db push --dry-run` reports "Remote database is up to date".
> - **Schema:** production equals the repository at 0046, object by object: 473 object groups identical, and the 13
>   accepted deviations of `production-accepted.txt` at their pinned hashes (the file did not change). `compare.sh`:
>   `RESULT: equivalent` (§3).
> - **Two separate releases** took production from 0036 to 0046:
>   1. **0037–0042** (Wine Intelligence), by
>      [`RELEASE_RUNBOOK_0042.md`](sprints/wine-intelligence-mega/RELEASE_RUNBOOK_0042.md). It ran after the check of
>      2026-11-17 (history 0001–0036) and before the read-only check of 2026-11-18 that found 42 versions.
>   2. **0043–0046** (Smart Cellar 3D sprint 1B, Sommelier V1), by
>      [`sommelier-v1/RELEASE.md`](sprints/sommelier-v1/RELEASE.md). It ran on 2026-11-18 at about 20:15 UTC: that is
>      when 0043 wrote `private.cellar_settings`.
> - **Plan and backups:** the organisation is on **Pro**, with **daily physical backups** for 7 days (Supabase →
>   Database → Backups). PITR is not enabled. A restore brings the whole project back to the backup's moment.
>
> **From now on every database change is a new migration, forward-only, through §2.** Nothing is pending: a dry run
> from `main` must say "Remote database is up to date" until a new migration is merged.
>
> - A new migration's version must be later than `20261123000046`. The CLI refuses an older one, and `--include-all`
>   is forbidden.
> - The bootstrap (§4) and the split-release checkouts (`248206a`) are history; never use them again.
>
> **Still open after 0046** (none of it blocks the database; each item is a separate decision):
>
> | Item                           | State on 2026-11-18                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
> | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | Storage files backup           | **Not done yet.** The first production Storage backup is planned for **Saturday 21 November 2026**, by [`BACKUP-RECOVERY.md`](BACKUP-RECOVERY.md) §9. Until then the photos are covered by nothing: database backups hold their rows, not the files                                                                                                                                                                                                                                                                                                                                                                                                                                       |
> | 3D depth placement             | **Off:** `private.cellar_settings.depth_placement = false` (0043's default). Switching it on takes a new migration, the gated index drop below, and the screens for it, each by owner decision (`smart-cellar-3d/SPRINT-1B-REPORT.md` §9 item 7)                                                                                                                                                                                                                                                                                                                                                                                                                                          |
> | Old unique index on bottles    | **Kept:** `public.bottles_slot_unique` still exists, next to 0043's `bottles_slot_index_unique`. Dropping it is `supabase/gated-migrations/smart_cellar_drop_legacy_slot_index.sql`: only with the owner's separate, explicit approval, as its own PR (the README there). Never by hand                                                                                                                                                                                                                                                                                                                                                                                                   |
> | Feature switches               | **The migrations switched nothing on.** Wine Intelligence stays behind `CELLR_FEATURES`; Smart Cellar API writes stay closed on Production by code (`CELLR_SMART_CELLAR`, `lib/smart-cellar-gate.ts`); no external source is shown (`search_scope` off, 0 providers). What 0037–0042 and 0046 make live without a switch: below                                                                                                                                                                                                                                                                                                                                                           |
> | Production smoke test          | **To be confirmed by the owner:** the smoke tests of both runbooks (`RELEASE_RUNBOOK_0042.md` V5, `sommelier-v1/RELEASE.md` step 7). Read-only, one kept Sommelier conversation with a rating exists since 20:18 UTC; that shows the path works, it is not the smoke test                                                                                                                                                                                                                                                                                                                                                                                                                 |
> | Migration 0047 (system health) | **Not applied, by decision (D4).** Added by System Intelligence sprint 2 (PR, awaiting approval): two `private` tables, eight service-role functions and the pg_cron job `health-samples-purge`. Apply only by §2, as [`sprints/system-health/OPERATIONS.md`](sprints/system-health/OPERATIONS.md) §2 describes. Until then the app shows health as "not installed" and nothing else changes                                                                                                                                                                                                                                                                                              |
> | Migration 0051 (layout CAS)    | **Not applied to production.** `20261129000051_smart_cellar_layout_cas.sql` (Smart Cellar 3D sprint 8, PR awaiting approval): additive, one new function `public.save_storage_layout_v2` (a layout save that compares the draft's revision under the place's row lock) and one trigger that keeps `cellar_locations.updated_at` strictly increasing. Nothing is dropped or replaced; 0045's `save_storage_layout` is unchanged. Until it is applied the app saves layouts exactly as before (its own revision check, then 0045). Apply only by §2; app and migration may go in either order ([`SPRINT-8-LAYOUT-CAS-REPORT.md`](sprints/smart-cellar-3d/SPRINT-8-LAYOUT-CAS-REPORT.md) §5) |
> | End-to-end failures            | Tracked separately, not caused by these releases: issue #78 (OCR vintage, `sprint-s.spec.ts:104`), issue #79 (`storage-showcase` timeout, storage-gallery flake), issue #77 (shard 8 capacity), issue #76 (simultaneous duplicate question ids)                                                                                                                                                                                                                                                                                                                                                                                                                                           |
>
> Live without any switch since the releases:
>
> - from 0037–0042: Admin → External sources, the research claim for shared wine profiles, the catalogue search API
>   (signed in, rate-limited, under RLS, no external records), and the search index that follows `wines`, `producers`
>   and `wine_aliases` (`RELEASE_RUNBOOK_0042.md` §1);
> - from 0046: the Sommelier keeps conversations for 7 days and takes ratings. The pg_cron job
>   `sommelier-conversations-purge` (hourly at :41) runs next to `catalog-scan-reads-purge` (every 15 minutes); both
>   are active, and the new job's first run (2026-11-18 20:41 UTC) succeeded;
> - from 0043–0045: nothing visible. The Smart Cellar columns, zones and functions are there; the new 3D view is in
>   no product screen yet.
>
> `supabase/gated-migrations/` holds SQL that is deliberately **not** a migration: it drops an index and is not
> authorised. `db push` cannot run it. Do not run it by hand; see the README in that folder.
>
> _History of this notice:_
>
> - _2026-11-14: a STOP notice said §3–§4 were outdated and that production's history and state were unknown. The
>   audit of 2026-11-15 settled both._
> - _2026-11-17: the history held exactly 0001–0036 (bootstrap done) and 0037–0046 were not applied. The next release
>   was to be 0037–0042 alone, from a checkout of `248206a`, with no `db push` from `main` until then._
> - _2026-11-18: both releases done; this notice._

## 1. Rules

1. **A migration on `main` is never edited, removed or renamed.** It may already have run in production. A change,
   a fix or an undo goes into a **new** migration (`supabase/migrations/<yyyymmddhhmmss>_<what>.sql`). CI enforces
   this in **Migration integrity · applied migrations are never changed** (`scripts/check-migration-immutability.sh`).
   A new migration may still be edited freely until its PR is merged.
2. **Additive and forward-only.** No destructive change without a separate, explicit decision. Migrations are not
   rolled back in a hurry; roll back the app instead (`BETA-OPERATIONS.md` §5).
3. **Every migration passes CI before it reaches production:** the permission suite (`pnpm db:test`) on Postgres 16,
   the same suite on a real Supabase stack, and the generated types (`pnpm db:types:check`).
4. **Production changes only through the workflow below.** No SQL Editor paste and no ad-hoc `db push`.

## 2. Deploying a migration (the one workflow)

Prerequisite: the production database has a migration history (`supabase_migrations.schema_migrations`) **that has
been checked against the schema**. Production has it: since 2026-11-18 exactly 0001–0046, checked object by object
(see the notice at the top). Without a correct history `db push` would try to run every migration again, from the
first; see §5.

**Only migrations the release has decided on may be pending in the checkout you push from.** `db push` runs every
pending file in order and cannot stop after a given version. A partial release runs from a checkout holding only the
files up to its last migration, as `RELEASE_RUNBOOK_0042.md` did for 0037–0042 (2026-11-17/18). With nothing
pending on production, a release from `main` lists exactly the migrations merged since the last one.

On a laptop with the repository at the merged `main`, and the database password at hand:

```bash
pnpm exec supabase link --project-ref <project-ref>
```

```bash
pnpm exec supabase migration list --linked
```

Every version must show on both sides (local = remote) except the new migration(s) of this release.

```bash
pnpm exec supabase db push --linked --dry-run --skip-vault
```

It must list exactly the new migration(s) and nothing else. Anything else listed: **stop**, see §5.

```bash
pnpm exec supabase db push --linked --skip-vault
```

`--skip-vault`: without it the CLI first writes the Vault secrets of `supabase/config.toml` (there are none). A
migration release writes nothing but its migrations.

Then check: `migration list` shows every version on both sides, and the schema matches the repository:

```bash
bash scripts/migration-audit/compare.sh --target "$DATABASE_URL" --accept scripts/migration-audit/production-accepted.txt
```

The result must be `equivalent`. `DATABASE_URL` is the session pooler or direct connection string (Supabase →
Connect); the comparison only reads, in a session forced read-only.

Order of a release: the migration first, then merge or deploy the app that needs it. The app leaves a feature off
while its database step is missing.

Never use `db push --include-all` (it would run migrations older than the newest recorded one) or `migration repair`
outside §4 and §5.

## 3. Production inventory (verified read-only, 2026-11-02; re-verified 2026-11-17 and 2026-11-18)

Production (the project listed as protected in `scripts/storage-backup/src/config.ts`) was built up to 0036 by pasting every migration into the
SQL Editor. 0037–0046 were the first migrations it got through `db push`. Its schema was compared with the repository
object by object, read-only, each time:

| Date       | History                     | Compared with        | Result                                                            |
| ---------- | --------------------------- | -------------------- | ----------------------------------------------------------------- |
| 2026-11-02 | none                        | the repository, 0036 | 380 object groups identical, 13 explained deviations, no drift    |
| 2026-11-17 | 0001–0036 (bootstrap, §4)   | the repository, 0036 | the same 380 identical, the 13 deviations at their pinned hashes  |
| 2026-11-18 | **0001–0046**, the 46 files | the repository, 0046 | **473 identical, the same 13 at their pinned hashes: equivalent** |

The comparison covers:

- tables, columns, defaults, identity, RLS flags and grants, column grants;
- constraints, indexes and triggers (also on `auth.users`);
- functions: source, signature, security, `search_path` and grants;
- RLS policies (also on `storage.objects`), storage buckets, enum types, extensions, default privileges and the pg_cron
  job.

Tools: `scripts/migration-audit/` (fingerprint, comparison, per-migration inventory). The fingerprint of 2026-11-02 is
`production-fingerprint-2026-11-02.txt`; the accepted deviations are in `production-accepted.txt`. On 2026-11-18
`fingerprint.sql` was run through the Supabase MCP (one `SELECT`) and its 486 lines compared with
`compare.sh --target-file`, which builds the reference from the 46 migrations.

**Result on 2026-11-18: 473 object groups identical to the repository at 0046, 13 explained deviations, no drift.**
None of the 13 belongs to 0037–0046.

| Migration                 | Production                                                                                                                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0001` foundation         | applied (only host-level differences: default privileges, `extensions` schema grants)                                                                                              |
| `0002`–`0012`             | applied, every object identical                                                                                                                                                    |
| `0013` push reminders     | **never run**; its objects were created by repair `0036` and are identical (tables, policies, grants)                                                                              |
| `0014`–`0019`             | applied, every object identical                                                                                                                                                    |
| `0020` beta feedback      | applied; `admin_beta_feedback` was reformatted on paste (same code, checked token by token)                                                                                        |
| `0021` recognition cache  | applied; `admin_recognition_cache` and `recall_confirmed_scan` were reformatted on paste (same code)                                                                               |
| `0022`–`0023`             | applied, every object identical                                                                                                                                                    |
| `0024` catalogue learning | applied; the pg_cron job `catalog-scan-reads-purge` (every 15 minutes) is present and active                                                                                       |
| `0025`–`0027`             | applied, every object identical                                                                                                                                                    |
| `0028` bottle library     | its **first** version was run, then repair `0032`. Final state identical, except one leftover unused overload `admin_wine_visuals(text, text, int)` (0032 keeps it on purpose)     |
| `0029`–`0031`, `0033`     | applied, every object identical                                                                                                                                                    |
| `0032` repair             | applied; its definitions match                                                                                                                                                     |
| `0034` admin workflow     | its **earlier** version was run, then repair `0035`. Final state identical                                                                                                         |
| `0035`, `0036` repairs    | applied; their definitions match                                                                                                                                                   |
| `0037`–`0042`             | applied by `db push`, the first release with a history (Wine Intelligence, `RELEASE_RUNBOOK_0042.md`); every object identical                                                      |
| `0043`–`0045`             | applied by `db push` on 2026-11-18 (Smart Cellar 3D 1B); every object identical. Depth placement off; `bottles_slot_unique` kept (gated drop not run)                              |
| `0046` sommelier          | applied by `db push` on 2026-11-18 together with 0043–0045; every object identical; the pg_cron job `sommelier-conversations-purge` (hourly at :41) is active; first run succeeded |

Deviations that are not migrations' doing:

- On 2026-11-02, 143 of 149 function bodies were stored with CRLF line ends (pasting); the code is the same.
  Functions that 0037–0046 created or replaced came through `db push` and have none: on 2026-11-18, 141 of 192.
- Hosted Supabase platform objects: the `ensure_rls` event trigger and its function `public.rls_auto_enable`, `anon`
  USAGE on the `extensions` schema, explicit default privileges, and pg_cron installed in `pg_catalog`.

## 4. Bootstrapping production's migration history (DONE: 0001–0036 recorded, verified 2026-11-17)

> **⛔ DONE. DO NOT RUN THE COMMANDS IN THIS SECTION AGAIN.** The bootstrap recorded 0001–0036 (verified 2026-11-17);
> 0037–0046 were then applied properly by `db push`, so production's history holds 0001–0046 (see the notice at the
> top). This section is kept as the record of what was rehearsed and of the order of the steps (backup, read-only
> preflight, record, verify, rollback). Its step 3 and step 5 commands take their list of versions from the files in
> `supabase/migrations`. Run now, step 3 would record every migration merged after 0046 as applied without running it,
> and step 5 would revert **all 46** history rows (and any later one), after which `db push` would try to run
> everything again from 0001.

Recording the 36 migrations as applied **changes only the history table**, never the schema or data. It was rehearsed
end to end on a throwaway database built the way production was (`bash scripts/migration-audit/rehearse-bootstrap.sh`):

- **The production-like build:** CRLF paste, `0013` skipped, the first `0028` and `0034` followed by their repairs.
- **Preflight:** `equivalent`. Before the bootstrap, `db push --dry-run` would run all 36; after it, "Remote database
  is up to date".
- **Schema:** the fingerprint was unchanged throughout.
- **Rollback:** it returned to 0 history rows.

Do it only with the owner's go-ahead, in one sitting, at a quiet moment.

1. **Backup.** Confirm a recent backup in Supabase → Database → Backups. Optionally keep a schema-only dump too:
   `pnpm exec supabase db dump --linked -f prebootstrap-schema.sql` (read-only). A schema-only dump is a reference,
   not a backup, and neither contains the Storage files: see `BACKUP-RECOVERY.md` §6 and §9.
2. **Preflight (read-only).** Each of these must hold, or stop:

   ```bash
   bash scripts/migration-audit/compare.sh --target "$DATABASE_URL" --accept scripts/migration-audit/production-accepted.txt
   ```

   This must print `RESULT: equivalent`.

   ```bash
   psql "$DATABASE_URL" -Atc "select to_regclass('supabase_migrations.schema_migrations')"
   ```

   This must print an empty line (no history table yet). `pnpm exec supabase migration list --linked` must show 36
   local and 0 remote.

3. **Record the history.** ⛔ **OUTDATED, DO NOT RUN:** when this was written the versions were exactly the 36
   files on `main` (0001–0036). That is no longer true, and this command would record every later migration as
   applied without running it:

   ```bash
   pnpm exec supabase migration repair --linked --status applied $(ls supabase/migrations/*.sql | xargs -n1 basename | cut -c1-14)
   ```

   `20261018000013` is included on purpose. Its objects exist, identical, through `0036`, which the preflight
   verified. If the preflight ever fails for an object of `0013`, leave it out and fix that first (§5).

4. **Verify.**
   - `pnpm exec supabase migration list --linked` shows 36 local = 36 remote.
   - `pnpm exec supabase db push --linked --dry-run` says "Remote database is up to date".
   - `compare.sh` (step 2) is still `equivalent`.
5. **Rollback, if anything looks wrong.** Revert exactly the history entries step 3 recorded, and nothing else. The
   schema was never touched, so there is nothing else to undo. This applies only because step 2 verified the starting
   state: no history at all, 0 remote. ⛔ **OUTDATED, DO NOT RUN** (the same list of files as step 3, so it would
   also revert versions that were applied properly afterwards). As written, it reverted the same 36 versions:

   ```bash
   pnpm exec supabase migration repair --linked --status reverted $(ls supabase/migrations/*.sql | xargs -n1 basename | cut -c1-14)
   ```

   Then check: `pnpm exec supabase migration list --linked` shows 36 local and 0 remote again (the starting state),
   and `compare.sh` (step 2) is still `equivalent`. Leave the `supabase_migrations` schema and its (now empty)
   history table in place: the CLI uses them, and an empty history changes nothing. Never drop that schema or any
   other schema as part of a rollback.

From then on, §2 is the only way migrations reach production.

## 5. Recovery: an environment without (or with a wrong) migration history

Signs:

- `migration list` shows local versions missing on the remote side although their objects exist;
- `db push --dry-run` lists migrations that already ran;
- or there is no `supabase_migrations` schema at all.

1. **Never** run `db push` to "catch up", and never mark a migration applied because one of its objects exists.
2. Compare the schema with the repository, read-only:

   ```bash
   bash scripts/migration-audit/compare.sh --target "$DATABASE_URL"
   ```

   No password at hand? Run `scripts/migration-audit/fingerprint.sql` in the SQL Editor, save the `line` column as a
   file, then run `compare.sh --target-file <file>`.

3. Attribute each difference to its migration: `bash scripts/migration-audit/inventory.sh` lists, per migration, the
   object groups it creates or changes.
4. Per migration:
   - **Every object matches:** it may be recorded as applied (`migration repair --status applied <version>`).
   - **An object differs because it was run in an earlier version:** add a repair migration that re-creates the final
     definitions (like `0032`, `0035`, `0036`), apply it through §2, compare again, then record both.
   - **Its objects are missing:** it was never run. Apply it (or a repair that creates its objects) through §2.
   - **A deviation is harmless and intended** (a platform object, a reformatted body you have checked by hand): add
     it to the accept file with the exact hash and the reason. An accepted hash that changes fails again.
5. Finish with §4's verification: `migration list` matching, `db push --dry-run` "up to date", `compare.sh`
   `equivalent`.

## 6. A new environment (staging, a fresh project)

On an **empty** project the CLI builds everything and records the history at the same time:

```bash
pnpm exec supabase link --project-ref <project-ref>
```

```bash
pnpm exec supabase db push --linked --dry-run
```

The dry run must list all migrations; on an empty project nothing has been recorded yet.

```bash
pnpm exec supabase db push --linked --include-seed
```

If the project already has tables, it is not empty: use §5 instead.

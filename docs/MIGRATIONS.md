# Database migrations: rules, deployment and recovery

This is the one place that says how the database changes. `SETUP.md`, `BETA-OPERATIONS.md` and the checklists point
here.

> ## ⛔ STOP: the bootstrap procedure in §4 is OUTDATED. Do not run its commands.
>
> **Added 2026-11-14 (Smart Cellar 3D, sprint 1B). Nobody connected to production to write this.**
>
> - §3 and §4 were written on 2026-11-02 for **36** migrations (`0001`-`0036`). The repository has moved on:
>   `main` had **42** migration files before sprint 1B (`…000037` with PR #65, `…000038`-`…000042` with PR #68), and
>   sprint 1B adds `…000043`-`…000045`.
> - **Whether `0037`-`0042` have been applied in production is not established anywhere in this repository**, and
>   neither is whether the bootstrap below was ever carried out. The inventory in §3 is from before all of them.
> - The command in §4 step 3 records as applied **every file that is in `supabase/migrations` at the moment it
>   is run**. Run today it would mark `0037` and everything after it as applied **without running them**: their
>   tables and functions would be missing, and the history would say they are there. The matching rollback command
>   in step 5 has the same flaw the other way round.
> - **There is no corrected command here, on purpose.** Which versions may be recorded depends on what production
>   actually holds, and that has not been looked at. A command written without that knowledge would be a guess.
>
> **Before any `migration repair` or any `db push` against production, this must happen first, read-only:**
>
> 1. **A schema inventory.** Compare production with the repository object by object
>    (`bash scripts/migration-audit/compare.sh --target "$DATABASE_URL"`, in a session forced read-only; or
>    `scripts/migration-audit/fingerprint.sql` in the SQL Editor and `compare.sh --target-file`). Attribute every
>    difference to its migration with `bash scripts/migration-audit/inventory.sh`. The result is a list, per
>    migration from `0037` on, of "all its objects are there and identical", "some are", or "none are".
> 2. **A migration-history inventory.** Does `supabase_migrations.schema_migrations` exist, and which versions does
>    it hold (`pnpm exec supabase migration list --linked`, which only reads)?
> 3. **A written decision by the owner**, from those two lists, of exactly which versions are recorded as applied and
>    which are still to be run, following §5 migration by migration. Only then a repair, and only then a push.
>
> Until that is done: **no `migration repair`, no `db push`, no SQL Editor paste.** `db push --dry-run` is safe to
> look at and must list exactly what the decision says is still to be run, nothing else.
>
> Also: `supabase/gated-migrations/` holds SQL that is deliberately **not** a migration (it drops an index and is not
> authorised). `db push` cannot run it. Do not run it by hand. See the README in that folder.

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
been checked against the schema** (see the STOP notice at the top). On 2026-11-02 it had none: without a correct
history `db push` would try to run every migration again, from the first. Do not run it; see §5.

On a laptop with the repository at the merged `main`, and the database password at hand:

```bash
pnpm exec supabase link --project-ref <project-ref>
```

```bash
pnpm exec supabase migration list --linked
```

Every version must show on both sides (local = remote) except the new migration(s) of this release.

```bash
pnpm exec supabase db push --linked --dry-run
```

It must list exactly the new migration(s) and nothing else. Anything else listed: **stop**, see §5.

```bash
pnpm exec supabase db push --linked
```

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

## 3. Production inventory (verified read-only, 2026-11-02)

Production (project `vvelgyhbjfmjvxkzekyz`) was built by pasting every migration into the SQL Editor; it has **no
migration history**. Its schema was compared with the repository object by object, read-only. The comparison covers:

- tables, columns, defaults, identity, RLS flags and grants, column grants;
- constraints, indexes and triggers (also on `auth.users`);
- functions: source, signature, security, `search_path` and grants;
- RLS policies (also on `storage.objects`), storage buckets, enum types, extensions, default privileges and the pg_cron
  job.

Tools: `scripts/migration-audit/` (fingerprint, comparison, per-migration inventory). The fingerprint is
`production-fingerprint-2026-11-02.txt` and its accepted deviations are in `production-accepted.txt`.

**Result: 380 object groups identical to the repository, 13 explained deviations, no drift.**

| Migration                 | Production                                                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `0001` foundation         | applied (only host-level differences: default privileges, `extensions` schema grants)                                                                                          |
| `0002`–`0012`             | applied, every object identical                                                                                                                                                |
| `0013` push reminders     | **never run**; its objects were created by repair `0036` and are identical (tables, policies, grants)                                                                          |
| `0014`–`0019`             | applied, every object identical                                                                                                                                                |
| `0020` beta feedback      | applied; `admin_beta_feedback` was reformatted on paste (same code, checked token by token)                                                                                    |
| `0021` recognition cache  | applied; `admin_recognition_cache` and `recall_confirmed_scan` were reformatted on paste (same code)                                                                           |
| `0022`–`0023`             | applied, every object identical                                                                                                                                                |
| `0024` catalogue learning | applied; the pg_cron job `catalog-scan-reads-purge` (every 15 minutes) is present and active                                                                                   |
| `0025`–`0027`             | applied, every object identical                                                                                                                                                |
| `0028` bottle library     | its **first** version was run, then repair `0032`. Final state identical, except one leftover unused overload `admin_wine_visuals(text, text, int)` (0032 keeps it on purpose) |
| `0029`–`0031`, `0033`     | applied, every object identical                                                                                                                                                |
| `0032` repair             | applied; its definitions match                                                                                                                                                 |
| `0034` admin workflow     | its **earlier** version was run, then repair `0035`. Final state identical                                                                                                     |
| `0035`, `0036` repairs    | applied; their definitions match                                                                                                                                               |

Deviations that are not migrations' doing:

- 143 of 149 function bodies are stored with CRLF line ends (pasting); the code is the same.
- Hosted Supabase platform objects: the `ensure_rls` event trigger and its function `public.rls_auto_enable`, `anon`
  USAGE on the `extensions` schema, explicit default privileges, and pg_cron installed in `pg_catalog`.

## 4. Bootstrapping production's migration history (owner action, not yet done)

> **⛔ OUTDATED: DO NOT RUN THE COMMANDS IN THIS SECTION AS WRITTEN.** See the STOP notice at the top of this
> document. This section describes the bootstrap as it was rehearsed for 36 migrations on 2026-11-02. It is kept as
> the record of what was rehearsed and of the order of the steps (backup, read-only preflight, record, verify,
> rollback). Its step 3 and step 5 commands take their list of versions from the files in `supabase/migrations`,
> which are no longer the 36 this section is about. The read-only steps (1, 2 and the `compare.sh` check) are still
> right and are where to start.

Recording the 36 migrations as applied **changes only the history table**, never the schema or data. It was rehearsed
end to end on a throwaway database built the way production was (`bash scripts/migration-audit/rehearse-bootstrap.sh`):

- **The production-like build:** CRLF paste, `0013` skipped, the first `0028` and `0034` followed by their repairs.
- **Preflight:** `equivalent`. Before the bootstrap, `db push --dry-run` would run all 36; after it, "Remote database
  is up to date".
- **Schema:** the fingerprint was unchanged throughout.
- **Rollback:** it returned to 0 history rows.

Do it only with the owner's go-ahead, in one sitting, at a quiet moment.

1. **Backup.** Confirm a recent backup in Supabase → Database → Backups. Optionally keep a schema-only dump too:
   `pnpm exec supabase db dump --linked -f prebootstrap-schema.sql` (read-only).
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

# Database migrations: rules, deployment and recovery

This is the one place that says how the database changes. `SETUP.md`, `BETA-OPERATIONS.md` and the checklists point
here.

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

Prerequisite: the production database has a migration history (`supabase_migrations.schema_migrations`). **Today it
has none**: until the owner has done the bootstrap in §4, `db push` would try to run all 36 migrations again. Do not
run it; see §5.

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

3. **Record the history.** The versions are exactly the 36 files on `main` (0001–0036), so a mistyped version is
   impossible:

   ```bash
   pnpm exec supabase migration repair --linked --status applied $(ls supabase/migrations/*.sql | xargs -n1 basename | cut -c1-14)
   ```

   `20261018000013` is included on purpose. Its objects exist, identical, through `0036`, which the preflight
   verified. If the preflight ever fails for an object of `0013`, leave it out and fix that first (§5).

4. **Verify.**
   - `pnpm exec supabase migration list --linked` shows 36 local = 36 remote.
   - `pnpm exec supabase db push --linked --dry-run` says "Remote database is up to date".
   - `compare.sh` (step 2) is still `equivalent`.
5. **Rollback, if anything looks wrong.** This removes only the history rows; the schema was never touched:

   ```bash
   pnpm exec supabase migration repair --linked --status reverted $(ls supabase/migrations/*.sql | xargs -n1 basename | cut -c1-14)
   ```

   After that, `migration list` is back to 0 remote. If you want the table gone as well:
   `drop schema supabase_migrations cascade;` in the SQL Editor (it only holds the history).

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

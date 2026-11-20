# Staging: everything prepared, nothing created (Sprint 004C)

**State on 2026-11-20:** there is **no** CELLR staging project.

- `approved-targets.json` lists none.
- `vvelgyhbjfmjvxkzekyz` is production: always refused by the tools, never used.
- `dqwkbtsstvakcvlnwvwk` was not opened, changed or repurposed. Doing so needs your explicit permission.
- Until a project exists, every staging step is rehearsed on a throwaway **local Postgres 17.12**: `staging-rehearsal.sh` for X-Wines and `lwin-rehearsal.sh` for LWIN.

This document builds on `docs/sprints/sprint-004b/STAGING.md` (owner steps S1–S8) and makes each step concrete.

## 0. The one decision that is yours (cost)

| Option                                                          | Monthly cost (Supabase pricing page, read 2026-11-20)                                                                                                                   | Note                                                                                                                                                               |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A. New project `cellr-staging`, Micro compute** (recommended) | **+ about $10/month.** "Additional projects add their full compute cost": Micro is $10/month ($0.01344/h). The Pro plan's $10 compute credit already goes to production | 8 GB disk included. The full X-Wines pilot measured **235 MB** in total (`sprint-004b/results/sizes.txt`). Egress 250 GB included. No overage expected             |
| B. Use `dqwkbtsstvakcvlnwvwk`                                   | $0 extra if it already runs                                                                                                                                             | Only with your written confirmation that it may be **wiped** and used as CELLR staging. It is in eu-central-1 on Postgres 17, but nothing identifies it as CELLR's |
| C. Supabase Branching on production                             | $0.01344 per branch per hour (about $10/month if always on), not covered by credits                                                                                     | **Not recommended:** a branch belongs to the production project, and the tools refuse production by its ref                                                        |
| D. Stay local                                                   | $0                                                                                                                                                                      | What this sprint does. It lacks Supabase's own roles, PostgREST and network latency                                                                                |

Pausing a staging project between uses stops the compute charge. Delete it when it is no longer needed.

## 1. Project configuration (option A)

| Setting              | Value                                                                                                           | Why                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Name / region        | `cellr-staging` / `eu-central-1` (production's region)                                                          | Same latency profile                                                      |
| Postgres             | 17 (production's major version)                                                                                 | Rehearsed on 17.12                                                        |
| Compute              | Micro                                                                                                           | Measured: search p95 under 105 ms at 8 clients with 100k records, locally |
| Auth                 | **Sign-ups disabled**; email provider only for the test accounts you create; site URL = the staging preview URL | No real users, ever                                                       |
| Data                 | **Never** a copy of production, its users, photos or households                                                 | Privacy; staging holds fictitious accounts and source data only           |
| PITR                 | Off                                                                                                             | Staging is rebuildable (§6)                                               |
| Network restrictions | Optional: allow only your IP for direct connections                                                             | The import tools connect directly                                         |

## 2. Environment variables

**App (Vercel).** Use a separate environment, e.g. a Custom Environment `staging` or Preview scoped to a `staging` branch. **Never** production's values.

| Variable                               | Staging value                                           | Note                                                                               |
| -------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | `https://<staging-ref>.supabase.co`                     | From the staging project                                                           |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | staging's publishable key                               |                                                                                    |
| `SUPABASE_SERVICE_ROLE_KEY`            | staging's service-role key                              | Server only; never in the browser bundle (`bundle secret scan` in CI)              |
| `OPENAI_API_KEY`                       | a **separate** key, or production's with its own budget | Pair it with `AI_BUDGET_DAILY_USD` / `AI_BUDGET_MONTHLY_USD` set low (e.g. 2 / 20) |
| `CELLR_FEATURES`                       | `wine_search,scan_resolver,sources_panel`               | The catalogue and scan flags; others as needed                                     |
| `CELLR_ADMIN_USER_IDS`                 | the staging admin's user id                             | For the sources admin page                                                         |
| `CRON_SECRET`, `CELLR_HEALTH_*`        | new random values                                       | Never reuse production's secrets                                                   |

**Import tools (only in the owner's shell, never committed):**

| Variable      | Value                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------ |
| `STAGING_URL` | The staging project's **direct** or **session-pooler** connection string, as the `postgres` user |

## 3. Migrations (`docs/MIGRATIONS.md` §6, on the empty project)

```bash
pnpm exec supabase link --project-ref <staging-ref>
```

```bash
pnpm exec supabase db push --linked --dry-run
```

The dry run must list **every** migration, up to and including `20261128000050_r27_wine_record_origins.sql`. Then:

```bash
pnpm exec supabase db push --linked --include-seed
```

Verify that the remote history equals the repository's:

```bash
pnpm exec supabase migration list --linked
```

## 4. Identity: the database must say it is staging (owner only)

1. In the staging project's SQL editor, as the owner:

   ```sql
   insert into private.catalog_settings (environment, project_ref, set_by) values ('staging', '<staging-ref>', '<your name>');
   ```

   The API roles cannot write this table, not even the service role.

2. Add `<staging-ref>` to `scripts/catalog-tools/approved-targets.json` **in a reviewed PR**. Production's ref can never be added; a unit test enforces this.
3. The tools then accept the target only when **all** of these hold:
   - the ref is approved;
   - the connection URL names that ref;
   - the database's own marker says `staging` with the same ref;
   - the ref is not production's.

## 5. Security checks before any import

```bash
pnpm --filter @cellr/catalog-tools exec tsx staging-check.ts --db "$STAGING_URL" --expect staging --staging-project <staging-ref> --out staging-check-before.json
```

It must print `"ok": true`. It checks, read-only:

- identity and marker;
- the schema;
- that people (anon or authenticated) cannot run the pilot search, the rights functions or the import functions;
- that only the owner can write the marker;
- the pilot-scope trigger;
- RLS on every catalogue table, plus `wine_record_origins`;
- the providers' state.

Also:

- In the Supabase dashboard, open **Advisors → Security** on staging: no errors.
- Confirm sign-ups are disabled.
- Sign in as a test account and confirm the people's search returns **no** provider rows. Every source stays `off` or `pilot`.

## 6. Backup and restore

- Staging data is **rebuildable**: migrations (§3) plus imports (§7) from files whose SHA-256 is recorded. So no PITR.
- Before each import, take a logical dump of the catalogue tables (`docs/BACKUP-RECOVERY.md` §6.4). After a failed run, restore it (§6.6) or rebuild the project. Import runs are idempotent and resumable (004B: killed with `-9` and re-run; exact, 0 duplicates).
- Once, on staging: test the restore of that dump into a second, temporary local database, and compare row counts (§6.6).

## 7. Import procedure (X-Wines pilot; the same commands as the rehearsal, plus `--staging-project`)

1. Register the providers and set the rights exactly as in `staging-rehearsal.sh` §3: X-Wines **`unverified`, scope `pilot`**, using the logged admin step.
2. Dry run, then the import:

   ```bash
   pnpm --filter @cellr/catalog-tools exec tsx import.ts --db "$STAGING_URL" --staging-project <staging-ref> --provider xwines --file <XWines_Full_100K_wines.csv> --sha256 eac2d812b5eb94264f3c4ee1764ccdacf764cdf1c2599c26e3832ed91a4662cc --dataset-version "X-Wines 1.0 (2023-01)" --retrieved-at <date> --pilot --withdraw-missing
   ```

   Add `--apply` to write. Run it a second time: everything must be `unchanged`.

3. `quality.ts --db`, `benchmark.ts`, `recognition.ts` and `perf.ts` with the same target (commands in `staging-rehearsal.sh` §7–8). Keep the JSON outputs with the release record.
4. Re-run the staging check (§5) and keep `staging-check-after.json`.

## 8. What staging will and will not prove

- **It will prove:** Supabase's own roles and grants, PostgREST, the app against the database over the network, and real latency.
- **It will not change the rights.** X-Wines stays `unverified` (pilot) and LWIN stays `blocked` in staging too. Nothing is shown to people until the rights are cleared in writing and production activation is approved separately (`ACTIVATION_PLAN.md`).

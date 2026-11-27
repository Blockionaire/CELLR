# Activation: X-Wines catalogue, ratings and the CELLR community (production)

Every step is the **owner's** unless it says Claude, and each has its own GO. The order matters:

1. everything is built and checked with nothing visible;
2. the credit page and the UI are switched on and checked while the source is still off;
3. only then is the source made public;
4. the community opens last, after moderation is operational.

`verify-api-closed.sql` (read-only) checks before each step that nothing is reachable through the API before its turn.

| #   | Step                                                                                                                                                                                                                                                                                                                                      | Who                                                               | Done when                                                                                         | Undo                                                                                                   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 0   | **Rights on paper.** The terms of the permission are recorded in `SOURCE_RIGHTS_REGISTER.md` §1b. The original stays with the owner, outside the repository                                                                                                                                                                               | Owner confirms; Claude wrote it                                   | §1b filled                                                                                        | —                                                                                                      |
| 1   | **Merge** #137, #138, #139 and #140, in order. Production gets code only: every route answers 404 without its switch, and the database functions do not exist yet                                                                                                                                                                         | Owner (GO given); Claude merges                                   | CI green on `main`                                                                                | Revert                                                                                                 |
| 2   | **Staging:** `migrate` (0051–0054), `ratings` (pilot), `ratings-verify` (read-only: the imported ratings checked in place, no re-import), `perf16` (16 concurrent searches over a public synthetic source)                                                                                                                                | Owner approves each run; Claude starts them and reads the results | 1,008,593 units and 20,857,044 ratings, idempotent; the separation checks pass; perf p95 measured | Staging is rebuildable                                                                                 |
| 3   | **Hardening before anything is public** (separate PR, separate GO): stronger link, spam and manipulation protection, and configurable, documented weights                                                                                                                                                                                 | Claude builds; owner merges                                       | Merged, CI green                                                                                  | —                                                                                                      |
| 4   | **Backup.** Check the latest production backup (Supabase → Database → Backups)                                                                                                                                                                                                                                                            | Owner                                                             | Its date noted                                                                                    | —                                                                                                      |
| 5   | **Migrations in production**, route A (`docs/MIGRATIONS.md` §2). The dry run lists exactly 0051–0054. For the seconds between 0052 and 0054 the review functions exist without their gate; step 6 checks that nothing was made                                                                                                            | Owner                                                             | `migration list` equals the repository                                                            | Additive; fix forward                                                                                  |
| 6   | **API closed?** Run `verify-api-closed.sql`                                                                                                                                                                                                                                                                                               | Owner, or Claude read-only                                        | Every row ok                                                                                      | —                                                                                                      |
| 7   | **Rights in the database**, the logged admin step, with the §1b reference: `verified`, `commercial_use`, `may_store`, `may_display`, `may_display_ratings`, **scope `off`**                                                                                                                                                               | Owner (`admin_catalog_provider_rights`)                           | A row in the rights log                                                                           | `admin_catalog_provider_disable`                                                                       |
| 8   | **Production environment**, in this order: (a) `cellr-production-catalog` with you as required reviewer, `main` only, admin bypass off; (b) then the **environment** secret `PRODUCTION_DB_URL`: session pooler on port 5432, user `postgres.<ref>`, no query parameter except `sslmode`                                                  | Owner                                                             | Saved                                                                                             | Delete the secret                                                                                      |
| 9   | **Import:** `preflight` → `dry-run` → `import` → `verify`, each approved by you, with the backup re-checked before each run. Then `verify-api-closed.sql`: still all ok (stored, not shown). Delete the secret afterwards                                                                                                                 | Owner approves; Claude starts and reads                           | `verify` all PASS                                                                                 | `admin_catalog_provider_disable`                                                                       |
| 10  | **Credit page and UI first, source still off:** add `catalog_ratings` to `CELLR_FEATURES` (Vercel production). Check that `/about/ratings` shows the citation, that a wine page shows **no** ratings block (nothing public), that `/api/v1/wines/<id>/ratings` gives `available: false`, and that `verify-api-closed.sql` is still all ok | Owner sets the switch; Claude checks                              | All four true                                                                                     | Remove the switch                                                                                      |
| 11  | **Source public:** scope `public` (logged admin step). Check a known wine on a phone: score, real counts, source credit page linked                                                                                                                                                                                                       | Owner                                                             | Seen on a phone                                                                                   | Scope `off`                                                                                            |
| 12  | **Moderation operational:** an admin is set, `/admin/reviews` loads, and the moderation functions answer. The community stays closed                                                                                                                                                                                                      | Owner; Claude checks                                              | Queue page works                                                                                  | —                                                                                                      |
| 13  | **Community open:** add `community_reviews` to `CELLR_FEATURES` and run `admin_community_open(true, reason, actor)` (logged). Publish, report and moderate one test review                                                                                                                                                                | Owner                                                             | All three done                                                                                    | `admin_community_open(false, …)` and remove the switch; existing reviews stay hidden behind the switch |
| 14  | **Watch 72 hours:** health, runtime errors, `/admin/reviews`, rate-limit hits, latency                                                                                                                                                                                                                                                    | Claude reports; owner decides                                     | No errors attributable to ratings                                                                 | Steps 13 → 10 back                                                                                     |

**Conditions you set (2026-11-25):**

- The 5× weight stays transparent (the methodology page) and adjustable (step 3).
- External and CELLR averages stay shown separately.
- Moderation is operational before reviews are public (steps 12–13).
- Link, spam and manipulation protection is strengthened before anything is public (step 3).

## What is checked where

- **Production route**: only through `scripts/catalog-tools/production.ts`. Its run checks guard against
  accidents; the control is the URL itself, an environment secret released per run by the owner's approval. It
  accepts a run only when all of these hold:
  - it is a manual run of `main`, inside `cellr-production-catalog`;
  - the typed ref matches;
  - the URL names the project;
  - the database says it is production.

  Every other tool still refuses production. The URL may carry no query parameter but `sslmode`, and through the
  pooler only port 5432.

- **Imports**:
  - The records import is idempotent; a run withdraws what a complete file no longer has.
  - The ratings import always runs a dry run first. The database refuses to finish a run that does not add up.
  - Pilot runs are impossible in production.
- **Logs** (this repository is public, so are its Actions logs): they show pass/fail and the provider's catalogue
  counts only. No artifact is uploaded.

## Costs

- **Database:** about 0.25 GB more in production (rating aggregates 241 MB live after vacuum; records about 180 MB,
  already measured in Sprint 004B), within the plan's 8 GB.
- **No new paid service.** Actions minutes: about 15 minutes per production import run.
- **Staging** stays at about $10/month until you pause it.

## Performance

| Measurement                               | Where              | Result                                                                                               |
| ----------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------- |
| Ratings read                              | Local Postgres 17  | p95 0.26 ms per record                                                                               |
| Reviews read                              | —                  | Uses the partial indexes (review of PR 2)                                                            |
| People's search at 16 concurrent searches | Staging (`perf16`) | To be measured: SQL p95 under 250 ms with 16 searches executing in PostgreSQL at once (method below) |

### perf16: how concurrency is measured, and what passes

- **Measured inside PostgreSQL, never inferred.** Each search records with the database server's clock when its search
  statement started and ended, and on which backend (`clock_timestamp()`, `pg_backend_pid()`). Overlapping those
  intervals gives how many searches PostgreSQL executed at each moment: peak, time-weighted mean, median, and the share
  of the measured window with at least 16 executing. A sampler on its own connection reads `pg_stat_activity` every
  50 ms as an independent cross-check. The number of clients is only the means: more than 16 may be needed to keep 16
  executing across the round trip (the runner is far from the database).
- **Passes only when all hold** (`scripts/catalog-tools/perf-accept.ts`, the workflow fails otherwise): people's search
  timed in the database; at least 500 searches that themselves ran with 16 or more executing (each search's own
  overlap), and their SQL p95 under 250 ms; at least 16 executing for at least 80% of the steady state (the window
  without its first and last 10%), on at least 16 backends, and seen by the sampler; at most 20% of searches empty; at
  least 70% answered by the synthetic source. The p95 per concurrency band (below 16, 16–19, 20 or more) is reported.
- **The pooler is a limit.** If the staging pool allows fewer than 16 server connections, 16 cannot execute at once and
  the run fails by design; the remedy is a larger staging pool (about 24, a hosted setting), not a weaker check. The
  sampler holds one session connection of its own.
- **What it is, and is not:** the database's capacity for people's search at 16 concurrent. It leaves out PostgREST
  (its own pool may hold fewer than 16), the app's network to the database, and a cold cache (the query set repeats).
- **Recorded:** p50, p95, p99, throughput, empty and synthetic answers, the concurrency figures, and the resource use of
  the measured rounds (`pg_stat_statements` for the search, `pg_stat_database`: blocks, cache hits, temp bytes).

### perf16: cleanup and recovery

The synthetic source `perf_synth` (invented records, staging only) is public only during the measurement. On every exit
of the run, success or failure, it is switched off (three attempts, every error shown) and then checked independently:
its scope is `off`, a signed-in person's search finds none of its records, X-Wines is still `pilot`, and the number of
users, households and wines is unchanged. If any of that does not hold, the run fails and prints the recovery:

1. Run the staging workflow in mode `perf16-cleanup` (switches the source off and runs the same checks), or
2. in the staging SQL editor: `select public.admin_catalog_provider_disable('perf_synth', 'manual recovery', '<you>');`
   then `select search_scope from public.catalog_providers where id = 'perf_synth';` must say `off`.

Production is never involved: the source and the tool exist for staging only.

## Undo, honestly

- **Hiding:** `admin_catalog_provider_disable` hides the source's records and ratings at once; nothing is deleted.
- **Removing:** the imported rows can be deleted with the provider's runs. That needs a reviewed migration, or the
  owner's SQL in the editor; it is never a workflow mode.
- **Restoring the whole database** from a backup is the last resort. A restore of the hosted project has not been
  observed yet (register risk R-BAK-1): rehearse it before you depend on it.

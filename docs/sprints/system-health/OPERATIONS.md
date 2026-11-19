# Live monitoring: operations, configuration and release

How to switch on, check and roll back the live monitoring engine (sprint 2, ADR-002). Every step that changes
production or credentials is **the owner's**, by decision. Nothing here has been done to production by the sprint.

The order is free. Each step is optional and independent, and without it the matching checks read `unknown`, never
healthy:

| Step | What                                                              | Production change?                              | Without it                                                  |
| ---- | ----------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------- |
| 1    | Merge the PR (code deploys via Vercel)                            | app code only                                   | nothing new exists                                          |
| 2    | Apply migration 0047 (D4)                                         | **database: 2 tables, 8 functions, 1 cron job** | Health says "not installed"; map unchanged                  |
| 3    | Switch the heartbeat on (D3)                                      | GitHub settings                                 | no rounds: the monitor "never ran"; Measure now still works |
| 4    | Read tokens for CI and deployment status (D2)                     | Vercel env vars                                 | `delivery.*` read unknown (not configured)                  |
| 5    | Uptime provider: readiness token and dead man's switch (sprint 3) | Vercel env vars + provider account              | nothing outside GitHub notices a full outage                |

## 1. Merge and deploy the app

Safe before the migration. Without migration 0047:

- `/admin/system` shows the map unchanged, with one line saying health is not installed;
- System › Health explains the same;
- `/api/cron/health` answers 503 `not_installed`;
- `/api/health` answers ok.

No user-facing path touches the monitor.

## 2. Apply migration 0047 (owner's decision D4; not done)

The migration is additive: two `private` tables, eight `public.health_*` functions for the service role only, and one
pg_cron job (`health-samples-purge`, daily 04:23 UTC). It changes nothing that exists. It is tested on plain
Postgres (CI "Database · migrations + permission suite") and on the real Supabase stack (CI "Database · real Supabase
stack", where pg_cron exists).

Follow [`docs/MIGRATIONS.md` §2](../../MIGRATIONS.md) exactly, from the merged `main`:

```bash
pnpm exec supabase link --project-ref <project-ref>
```

```bash
pnpm exec supabase migration list --linked
```

Every version 0001–0046 must show on both sides; only `20261124000047` may be local-only.

```bash
pnpm exec supabase db push --linked --dry-run --skip-vault
```

It must list exactly `20261124000047_system_health.sql`. Anything else listed: **stop**, see MIGRATIONS.md §5.

```bash
pnpm exec supabase db push --linked --skip-vault
```

Verify (read-only, SQL Editor or psql):

```sql
select jobname, schedule, active from cron.job where jobname = 'health-samples-purge';
```

It must return one row: `23 4 * * *`, active.

```sql
select has_function_privilege('anon', 'public.health_latest()', 'execute') as anon_can,
       has_function_privilege('authenticated', 'public.health_latest()', 'execute') as user_can;
```

Both must be `false`.

Then the schema comparison of MIGRATIONS.md §2 (`compare.sh`). It must say `equivalent`, with the new objects
recorded. Update the notice at the top of MIGRATIONS.md (47 migrations).

**Backups:** daily physical backups (Pro) cover it. The migration deletes nothing.

**Rollback** (only if it must go; drops the health history and nothing else; as a new migration, never by hand in
production):

```sql
select cron.unschedule('health-samples-purge');
drop function public.health_begin_round(text, int), public.health_record_round(bigint, text, jsonb),
  public.health_latest(), public.health_history(int), public.health_ping(), public.health_cron_jobs(),
  public.health_ai_window(timestamptz, timestamptz), public.health_purge(int);
drop table private.health_samples, private.health_rounds;
drop function private.health_detail_ok(jsonb);
```

The app keeps working after a rollback: it falls back to "not installed".

## 3. Switch the heartbeat on (owner's decision D3; not done)

The workflow `.github/workflows/health-heartbeat.yml` runs every 10 minutes, but only when it is switched on. In
GitHub → the repository → Settings → Secrets and variables → Actions:

| Kind     | Name                 | Value                                                                                             |
| -------- | -------------------- | ------------------------------------------------------------------------------------------------- |
| Secret   | `HEALTH_BASE_URL`    | the production address, `https://…`, no trailing slash                                            |
| Secret   | `HEALTH_CRON_SECRET` | **the same value** as the app's `CRON_SECRET` in Vercel (Production)                              |
| Variable | `HEALTH_HEARTBEAT`   | `on` (set last: from then on the schedule calls the app; delete or set to anything else to pause) |

Before switching on:

- **`CRON_SECRET` must be set in Vercel → Settings → Environment Variables (Production), at least 16
  characters.** The drink-reminder cron already needs it. A shorter or missing one makes the probe round answer 503
  `not_configured` (the drink reminders are not affected by this rule). Generate one with `openssl rand -base64 32`.
- **Deployment Protection:** the production domain must be reachable without Vercel Authentication (it normally is).
  A protected preview URL will not work.
- **Who is alerted:** GitHub e-mails failed scheduled runs to the user who last changed the workflow's schedule.
  Check that user's notification settings (GitHub → Settings → Notifications → Actions: "Send notifications for
  failed workflows only").

Verify:

1. Actions → Health heartbeat → Run workflow (manual). Both steps are green. The log shows
   `liveness: HTTP 200` and `round: HTTP 200, recorded=true, failed infrastructure checks=0`.
2. Admin → System → Health shows "Monitor: Running" and a last round of a few seconds ago (heartbeat).
3. After 20–30 minutes, the history strips show a mark for every 10 minutes.

What the heartbeat reports, and how. **The run's log is public** (the repository is public), so a run says only
"ok" or "Heartbeat failed": no status code, reason or count. The details are on Admin › System › Health.

- **The step "The app answers" failed:** the app is down or unreachable (DNS, Vercel, deployment). Check it yourself:
  `curl -i https://<production>/api/health`.
- **The step "One round of health checks" failed:**
  - the database did not take the round;
  - or an infrastructure check (database, Auth, Storage) failed;
  - or the secret does not match;
  - or migration 0047 / the service role / `CRON_SECRET` (at least 16 characters) is missing.

  System › Health shows which: the monitor's state, the failed check, or the configuration cards.

The run does **not** fail on AI, jobs or delivery problems. Those are on the page, and alerting on them is sprint 3.
A round that an admin started less than a minute earlier counts too: the heartbeat then reports that round's failed
checks, so pressing Measure now can never hide a failure from it.

**Owner decision before switching on: is a public pass/fail history acceptable?** Anyone can open the Actions tab
and see when heartbeat runs failed, which is roughly when CELLR or its infrastructure had trouble. Nothing more is
visible: no reason, no component, no count. A full outage is visible from outside anyway, but a database or Auth
failure behind a working front end is not otherwise public. If that is not acceptable, run the same workflow file
from a **private** repository (same secrets and variable), or skip it and rely on the uptime provider of step 5.

**Limits of this alert channel** (why sprint 3 adds a provider):

- GitHub may start scheduled runs late (minutes, sometimes more).
- It **disables scheduled workflows of a public repository after 60 days without activity**. Re-enable it in the
  Actions tab.
- The e-mail goes to one person.

## 4. CI and deployment status (owner's decision D2: optional, no tokens now)

Each check is measured only with its read token. Without one the check reads `unknown` (not configured).

| Variable (Vercel, Production, server only) | Value                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `CELLR_HEALTH_GITHUB_REPO`                 | `Blockionaire/CELLR`                                                                                          |
| `CELLR_HEALTH_GITHUB_TOKEN`                | a **fine-grained** token for this repository only, permission **Actions: read**, nothing else, with an expiry |
| `CELLR_HEALTH_VERCEL_PROJECT_ID`           | the project id (Vercel → Project → Settings)                                                                  |
| `CELLR_HEALTH_VERCEL_TEAM_ID`              | the team id (optional for a personal account)                                                                 |
| `CELLR_HEALTH_VERCEL_TOKEN`                | a Vercel access token scoped to that team, with an expiry                                                     |

The tokens are read on the server only. They never appear in samples, logs, responses or the page (tested). They
cost one API call each per round (about 144 a day). Redeploy after setting them.

## 5. Uptime provider (sprint 3; prepared now)

| Variable (Vercel, Production) | Value                                                                                                                         |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `CELLR_HEALTH_READY_TOKEN`    | a random token of **at least 24 characters**. The provider calls `GET /api/health/ready` with `Authorization: Bearer <token>` |
| `CELLR_HEALTH_PING_URL`       | the provider's heartbeat URL (`https://` only, no credentials in it). Called after every recorded round                       |

Generate a token:

```bash
openssl rand -base64 32
```

What the provider should watch:

- an **HTTP check** on `/api/health` (public) for "the app answers", and on `/api/health/ready` with the token for
  "the monitor runs and infrastructure is not failing". The latter answers 503 otherwise.
- a **heartbeat check** on the ping URL with a period of 10 minutes and a grace of 20. It alerts when rounds stop for
  any reason.

## Checking it locally

```bash
bash scripts/db-test.sh
```

This runs the migration and the permission suite, including `99_system_health.test.sql`.

```bash
pnpm --filter @cellr/web exec vitest run src/server/health src/server/system src/features/admin/system
```

These are the probes, the round, the endpoints and the catalogue checks.

```bash
pnpm build
```

Then run the e2e spec against the local stack. It covers real outage simulations, stale data and the map with
monitoring down:

```bash
pnpm --filter @cellr/web exec playwright test e2e/system-health.spec.ts e2e/admin-system.spec.ts
```

## Troubleshooting

| You see                                           | Check                                                                                                                                         |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Health "not installed"                            | migration 0047 is not applied (step 2)                                                                                                        |
| Monitor "never ran" / "stopped"                   | heartbeat off or failing (step 3; the Actions tab); press Measure now to see whether a round can be recorded at all                           |
| `cron.*` unknown, "not available"                 | pg_cron is missing on this database (normal on local plain Postgres; on Supabase it is installed)                                             |
| `ai.*` unknown, "no traffic"                      | nobody used that AI feature in the last hour. Silence is not health                                                                           |
| `cron.<job>` failed, "overdue"                    | the job did not run for three of its intervals: `select * from cron.job_run_details order by start_time desc limit 20;`                       |
| Measure now: "a round ran less than a minute ago" | the one-a-minute bound; wait and press again                                                                                                  |
| Logs                                              | Vercel logs, events `health_round_unrecorded` (stage, reason code), `health_ping_failed`, `health_view_unavailable`; never values or messages |

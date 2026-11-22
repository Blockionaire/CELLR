# Live monitoring: operations, configuration and release

How to switch on, check and roll back the live monitoring engine (sprint 2, ADR-002). Every step that changes
production or credentials is **the owner's**, by decision. Nothing here has been done to production by the sprint.

The order is free. Each step is optional and independent, and without it the matching checks read `unknown`, never
healthy:

| Step | What                                                                   | Production change?                              | Without it                                                                                        |
| ---- | ---------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1    | Merge the PR (code deploys via Vercel)                                 | app code only                                   | nothing new exists                                                                                |
| 2    | Apply migration 0047 (D4)                                              | **database: 2 tables, 8 functions, 1 cron job** | Health says "not installed"; map unchanged                                                        |
| 3    | External monitoring: round trigger, readiness check, dead man's switch | Vercel env vars + provider account              | no rounds (the monitor "never ran"; Measure now still works) and nobody outside notices an outage |
| 4    | Read tokens for CI and deployment status (D2)                          | Vercel env vars                                 | `delivery.*` read unknown (not configured)                                                        |

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

## 3. External monitoring (recommended; replaces a public GitHub heartbeat)

**Owner's preference (2026-11-19): operational status must not be public through GitHub Actions.** The repository is
public, so a scheduled workflow's run history would show anyone when CELLR had trouble. So:

- `.github/workflows/health-heartbeat.yml` has **no schedule**: it runs only by hand, to check the setup. To schedule
  it after all, copy it into a **private** repository. A private repository's Actions minutes count against the
  plan: about 4,300 runs a month at one minute each, which exceeds the free 2,000.
- **One external uptime provider does all three jobs below, privately.** Any provider with HTTP checks that send a
  header, and with heartbeat (cron) monitors, will do. Examples:
  - **Better Stack Uptime**: EU data region, status pages, phone/SMS/Slack alerts;
  - **Healthchecks.io**: heartbeats; open source, can be self-hosted;
  - **Checkly**: checks as code;
  - **UptimeRobot**: paid tiers for custom headers.

  Prefer an EU-hosted provider (Better Stack is the most complete single choice) and keep its status page private.

  **Chosen and configured: Better Stack** (owner, 2026-11-22: liveness, readiness, round trigger and heartbeat). In
  the architecture register it is the `unverified` component `better-stack`: its configuration lives in Better
  Stack, not in the repository, so CI cannot see a monitor that changes or disappears. Keep monitor ids, heartbeat
  URLs, tokens and alert contacts out of the repository (REGISTRY-GUIDE.md, "External monitoring"). The free tier
  allows 10 monitors and heartbeats together; A–D use four.

| Monitor                    | Calls                                                                                                      | Every                   | Alerts when                                                                              |
| -------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------- |
| **A. Round trigger**       | `GET https://<production>/api/cron/health` with header `Authorization: Bearer <CELLR_HEALTH_ROUND_SECRET>` | 10 min                  | not 200: the app is down, or the database took no round (503)                            |
| **B. Readiness**           | `GET https://<production>/api/health/ready` with header `Authorization: Bearer <CELLR_HEALTH_READY_TOKEN>` | 1–3 min                 | not 200: monitor not running on time, or an infrastructure check failed or is unmeasured |
| **C. Dead man's switch**   | the provider's heartbeat URL, called **by CELLR** after every recorded round (`CELLR_HEALTH_PING_URL`)     | period 10 min, grace 20 | no ping: rounds stopped for any reason (A not firing, app or database down)              |
| (optional) **D. Liveness** | `GET https://<production>/api/health`, no header                                                           | 1 min                   | not 200: the app does not answer                                                         |

Steps (all in Vercel → Settings → Environment Variables, **Production**, then redeploy):

1. Generate two secrets:

   ```bash
   openssl rand -base64 32
   ```

   Run it twice:
   - `CELLR_HEALTH_ROUND_SECRET`: at least 16 characters. It is the round trigger's own secret, so the provider
     cannot also start the drink-reminder cron. Without it the round falls back to `CRON_SECRET`.
   - `CELLR_HEALTH_READY_TOKEN`: at least 24 characters.

2. Create heartbeat monitor C at the provider and set its URL as `CELLR_HEALTH_PING_URL`: `https://` only, no
   credentials in it.
3. Redeploy production so the variables apply.
4. Create monitors A and B (and D) at the provider with those headers. Route alerts to e-mail and phone.
5. Verify:
   - **Admin → System → Health:** within 10–20 minutes the monitor reads "Running", with the last round seconds ago.
     The cards show "Round trigger: its own CELLR_HEALTH_ROUND_SECRET", "Dead man's switch: Configured" and
     "Readiness check: Configured".
   - **Readiness with the token** (`curl -i -H "Authorization: Bearer $TOKEN" https://<production>/api/health/ready`)
     answers `200 {"status":"ok"|"degraded","monitor":"running"}`.
   - **The provider** shows A, B and D green, and C receiving pings.
   - **One alert test:** pause monitor A for 30 minutes. C must alert (no pings) and B must turn to 503 (monitor
     late, then stopped). Resume A.

What each failure means:

| Failing      | Means                                                                                                    |
| ------------ | -------------------------------------------------------------------------------------------------------- |
| D (and A, B) | the app is down or unreachable (DNS, Vercel, deployment)                                                 |
| A with 401   | the provider's header does not match `CELLR_HEALTH_ROUND_SECRET` (or `CRON_SECRET`)                      |
| A with 503   | no round could be recorded: database down or refusing writes, migration 0047 missing, or no service role |
| B only       | an infrastructure check failed or has no current measurement; details on System › Health                 |
| C only       | rounds stopped while the app answers: A is paused or misconfigured                                       |

**Deployment Protection:** the production domain must be reachable without Vercel Authentication. It normally is.

**Manual check from GitHub:** set the repository secrets `HEALTH_BASE_URL` and `HEALTH_CRON_SECRET` (= the round
secret) and the variable `HEALTH_HEARTBEAT=on`, then Actions → Health heartbeat → Run workflow. The log says only
`ok` or `Heartbeat failed`.

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
| Monitor "never ran" / "stopped"                   | nothing triggers rounds (monitor A, step 3); press Measure now to see whether a round can be recorded at all                                  |
| `cron.*` unknown, "not available"                 | pg_cron is missing on this database (normal on local plain Postgres; on Supabase it is installed)                                             |
| `ai.*` unknown, "no traffic"                      | nobody used that AI feature in the last hour. Silence is not health                                                                           |
| `cron.<job>` failed, "overdue"                    | the job did not run for three of its intervals: `select * from cron.job_run_details order by start_time desc limit 20;`                       |
| Measure now: "a round ran less than a minute ago" | the one-a-minute bound; wait and press again                                                                                                  |
| Logs                                              | Vercel logs, events `health_round_unrecorded` (stage, reason code), `health_ping_failed`, `health_view_unavailable`; never values or messages |

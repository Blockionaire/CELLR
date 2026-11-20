# System Intelligence — Sprint 2 plan: Live Monitoring Engine

Starting point: `main` at 07bc80c. Sprint 1 (PR #85) and the Next.js 16.4.6 upgrade (PR #86) are merged.

This sprint adds measured health on top of the architecture register. The map from sprint 1 stays self-contained:
health is an **overlay** keyed by component id. If monitoring is down, the map still renders, and every component
shows `unknown`, never `healthy`.

## 1. Starting point (what exists)

| Exists                                                                                                                                                                                   | Reused for                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `public.ai_usage`: every AI call with task, model, cost, latency and status (`ok`, `error`, `timeout`, `invalid_output`, `rate_limited`, `budget_exhausted`), indexed on `at` and `task` | AI error rate, latency, cost, fallback per task             |
| `admin_*` SECURITY DEFINER RPCs, revoked from `public`/`anon`/`authenticated` and granted to `service_role` only                                                                         | The pattern for the new health RPCs                         |
| `getAdminSession` / `assertAdmin` / proxy 404 for non-admins                                                                                                                             | The admin boundary of the health view                       |
| Two pg_cron jobs (`catalog-scan-reads-purge` every 15 min, `sommelier-conversations-purge` hourly)                                                                                       | Job health from `cron.job_run_details`                      |
| One Vercel cron (`/api/cron/drink-reminders`, daily) with a `CRON_SECRET` bearer check (`server/push/cron.ts`)                                                                           | The pattern for a probe trigger                             |
| Structured JSON logs (`server/log.ts`)                                                                                                                                                   | Probe failures are logged by code, without personal data    |
| Architecture register: component ids, flows, `impactOf`                                                                                                                                  | The overlay, plus "what is affected" when a component fails |

There is **no health endpoint and no `pg_net` extension**. Nothing reads `cron.job_run_details` today.

## 2. Scope

### 2.1 Measurement model (domain package, pure, unit-tested)

- `HealthStatus = "healthy" | "degraded" | "failed" | "unknown"`.
- `Probe { id, componentId, kind, intervalSec, staleAfterSec, thresholds }`, declared in a server-only probe
  registry. A test checks that every probe's `componentId` exists in the architecture register.
- `evaluate(samples, probe, now)` returns `{ status, reason, measuredAt }`:
  - no sample, or the newest sample is older than `staleAfterSec`: **`unknown`** ("no measurement since …");
  - otherwise the status follows the thresholds.
  - A missing measurement is never shown as healthy.
- `rollup(component statuses)`: the worst measured status wins. `unknown` is shown as unknown, not hidden by a
  healthy sibling.

### 2.2 Probes (server-side, bounded, no paid AI calls)

| Probe                      | Measures                                                                                                 | Cost                      |
| -------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------- |
| `db`                       | A round trip (`select 1` through the service client), plus latency                                       | One query                 |
| `auth`                     | GoTrue `/auth/v1/health` reachable, plus latency                                                         | One HTTP GET              |
| `storage`                  | List one known bucket with `limit 1`                                                                     | One API call              |
| `pg-cron`                  | The last run and status per job, from `cron.job_run_details`, via a new RPC                              | One query                 |
| `ai-<task>`                | Error, timeout and invalid rate, p95 latency and cost from `ai_usage` over a window (no live model call) | One aggregate query       |
| `api-routes` (passive)     | 5xx counts per route group, from what the app records (see 2.3)                                          | None extra                |
| `deploy` / `ci` (optional) | Latest GitHub Actions run on `main` and the latest Vercel deployment state                               | Needs tokens: decision D2 |

Each probe has a hard timeout (≤ 3 s) and runs in parallel. One probe failing never fails the round.

### 2.3 Storage (one new migration, local only)

The new migration has a version later than `20261123000046` (`docs/MIGRATIONS.md`). Existing migrations stay
untouched; CI's migration-integrity job enforces that.

- `private.health_samples (id, probe text, status, latency_ms, detail jsonb (bounded), measured_at)`. Indexed on
  `(probe, measured_at desc)`. Not exposed through the API; there are no policies.
- Retention: a pg_cron purge after 14 days (`health-samples-purge`), in the same style as the existing purges.
- `public.health_record(...)`, `public.health_latest()`, `public.health_history(p_probe, p_from, p_to)` and
  `public.health_cron_runs()` (reads `cron.job_run_details` for our own job names only). All are SECURITY DEFINER
  with `search_path = ''` and are granted to `service_role` only.
- The permission suite (`scripts/db-test.sh`) gets checks that `anon` and `authenticated` cannot call or read any of
  them.

### 2.4 Triggering and the external heartbeat

- **The probe round:** `GET /api/cron/health` with the same `CRON_SECRET` bearer check. It runs all probes, records
  the samples and returns only `{ ok, at }`, never details.
- **Who calls it** depends on decision D1:
  - on the Vercel Hobby plan, crons run at most daily, which is too slow;
  - otherwise a scheduled GitHub Actions workflow (`health-heartbeat.yml`, every 10 min) calls the endpoint with
    the secret.

  That workflow is also the **external heartbeat**. If it stops, the samples go stale and everything turns
  `unknown`, which is visible.

- **The public liveness endpoint:** `GET /api/health` answers `{ status: "ok" }` and nothing else (no versions, no
  dependencies). It is used by external uptime checks.

### 2.5 Admin view

- A new **Health** tab in `/admin/system`. The data is read server-side through `admin/service.ts`
  (`adminHealth(session)` with `assertAdmin`). It shows:
  - the statuses per probe and per component;
  - the last measurement and the reason;
  - a 24 h history strip per probe;
  - stale or missing items as `unknown`.
- **The overlay on the map:** a status ring per component. The map receives the overlay as an optional prop. If
  the health read fails, the page still renders the map with "health not available", and `admin-system.spec.ts`
  stays green.
- No polling from the browser by default. A manual "refresh" re-renders the server component. Optional polling
  can come later, at most every 60 s and paused when the tab is hidden.

## 3. Acceptance (from the epic)

- Statuses come from real measurements. Every status shown can be traced to a sample row, with its time.
- A simulated outage is detected. The e2e and integration tests cover:
  - a stopped storage container, or a probe pointed at a dead URL: the result is `failed`;
  - a job that has not run: `unknown` or `failed`;
  - the newest sample older than its stale limit: `unknown`.
- Missing measurements are never healthy. This is a unit test on `evaluate` and an e2e test with an empty samples
  table.
- The map works when monitoring is down. This is an e2e test with the health RPC made to fail.
- Non-admins get a 404 and no health data. `/api/health` exposes nothing beyond `ok`.

## 4. Order of work (checkpoints)

1. **Domain:** the status model, `evaluate`, `rollup` and unit tests.
2. **Migration (local):** tables, RPCs, retention job and permission-suite checks. Verify on the local Supabase
   stack and the CI database jobs. **It is not applied to production.**
3. **Probes and endpoints:** the probe round, `/api/cron/health` and `/api/health`, with tests for timeouts, the
   secret check and the bounded output.
4. **Admin view:** the Health tab, the overlay, the down-monitoring fallback, e2e and axe.
5. **Register and docs:**
   - new components and edges in the architecture register (probe route, samples table, heartbeat workflow), with
     a regenerated inventory;
   - an ADR-002 on the health model;
   - the sprint report.
6. **The heartbeat workflow:** added in the PR. It only works once `CRON_SECRET` and the target URL are set as
   repository secrets (decision D3).

## 5. Decisions (taken by the owner on 2026-11-19)

> D1: GitHub Actions heartbeat every 10 minutes. D2: build the CI and deployment checks extensibly and require no new
> tokens now (unknown while not configured). D3: build the heartbeat workflow, but activate it only once its secrets
> and the production URL are set safely. D4: develop and test the migration locally and in CI, and do **not** apply
> it to production. Further requirements of the same message are covered in ADR-002: never healthy when
> missing/stale/failed, outage detection independent of CELLR, isolation, no details in public, hard time-outs and
> bounded cost, and checks that prove only what they measure.
>
> One change from the plan below: Health is its own page, **System › Health** (`/admin/system/health`), not a tab
> of the Architecture Control Center. A separate route keeps the monitor's reads out of the map's page entirely,
> except the bounded overlay, which is the isolation the owner asked for.

### The options as planned

| #   | Decision                                                                                                                   | Default if not decided                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| D1  | Vercel plan: are sub-daily Vercel crons available? Otherwise use the GitHub Actions heartbeat.                             | The GitHub Actions heartbeat, every 10 min                                   |
| D2  | Tokens for CI/deploy status: a fine-grained GitHub token (actions:read) and a Vercel read token, both stored as server env | The CI/deploy probes are left out and shown as `unknown` ("not configured")  |
| D3  | Repository secrets for the heartbeat (`CRON_SECRET`, production URL)                                                       | The workflow is present but skips with a notice                              |
| D4  | Applying the new migration to production (`supabase db push --linked`, after a dry run, per `docs/MIGRATIONS.md`)          | **Not applied.** The Health tab shows "monitoring not installed" until it is |

## 6. Risks

- **Public repository.** Probe definitions and thresholds are fine to publish. Production samples, incident
  details and hostnames are not, so they live only in the database and are shown only behind the admin boundary.
- **Cost.** About 6 cheap queries every 10 minutes, and no AI calls. The retention job bounds the table to about
  14 days × 144 rounds × 6 probes ≈ 12k rows.
- **GitHub schedule jitter.** Scheduled workflows can be delayed by many minutes. Stale limits are set at 3× the
  interval so jitter does not raise false `unknown`s.
- **E2e capacity.** New e2e tests are not 3D, so they will not add to the shard 8 pressure (#77). They are kept
  short.

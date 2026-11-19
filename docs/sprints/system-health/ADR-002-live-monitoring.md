# ADR-002: Live monitoring engine

- Status: accepted for sprint 2 (owner decisions D1–D4 of 2026-11-19)
- Context: System Intelligence epic, sprint 2; builds on ADR-001 (architecture register)
- Scope: what is measured, how, where it is stored, who sees it, and how an outage of CELLR as a whole is noticed
  outside CELLR

## Decision in one paragraph

A **round** of server-side **probes** runs at most once a minute, started by an **external trigger** (an uptime
provider every 10 minutes, with its own secret) or by an admin. Each probe stores a **status, a reason code and a few numbers**
(never text) in two private tables (migration 0047). The admin's **System › Health** page and the architecture map's
**health overlay** judge the newest samples _at read time_. A sample that is missing, older than three intervals or
from the future is `unknown`, and a failed one is `failed`. **Nothing is ever healthy by default.** The monitor is
an overlay: when it is slow, broken or not installed, the map and the rest of CELLR render exactly as before and say
in one line why there is no health.

## Status model (packages/domain/src/system-health.ts)

| Status     | Means                                                                                                                  |
| ---------- | ---------------------------------------------------------------------------------------------------------------------- |
| `healthy`  | A fresh sample exists and its check passed. It says only what that check **proves** (each probe states its limits).    |
| `degraded` | It answered, but slowly, with some errors, with fallbacks, or a delivery problem (CI red, last deploy failed).         |
| `failed`   | It did not answer, answered an error, timed out, a job's last run failed or it is overdue, an expected bucket is gone. |
| `unknown`  | No sample, a stale sample, clock skew, not configured, no traffic, scheduler absent, or the probe's own code crashed.  |

The roll-up order is **failed > degraded > unknown > healthy**. `unknown` outranks `healthy`, so one unmeasured aspect
keeps a component from looking healthy. A component no probe speaks for gets **no badge** ("not measured"); it is
never coloured healthy. The page's headline says "All N checks pass" only when every check is fresh and passing.
Otherwise it names the gap: "No failure measured · k of N checks without a current measurement".

## What is measured, and what is not (apps/web/src/server/health/catalogue.ts)

| Probe                            | Measures                                                                                    | Does not prove                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `monitor.round`                  | A round ran and was recorded (heartbeat → route → database)                                 | anything the other checks do not cover                 |
| `db.read`, `db.write`            | PostgREST + Postgres answer a read; Postgres commits a write (the round's own row)          | RLS paths for people; other tables; capacity           |
| `auth.api`                       | GoTrue's health endpoint answers through the gateway                                        | mail delivery; an end-to-end sign-in                   |
| `storage.api`                    | The Storage API answers, and every bucket the migrations create exists                      | uploads/downloads; policies; backups                   |
| `cron.extension`, `cron.*`       | pg_cron is there; each expected job is scheduled, active, did not fail last, is not overdue | what a job's statement changed                         |
| `ai.all`, `ai.<task>`            | Real AI calls of the last hour (ai_usage): error rate, fallbacks, p95. **No test call.**    | anything when nobody used it (unknown); answer quality |
| `delivery.ci`, `delivery.deploy` | Newest CI run on main; newest production deployment (read tokens)                           | that production runs that code; that people can use it |

**Not measured in sprint 2**, by decision and stated on the page:

- per-route API error rates (that needs log access or instrumentation of every route, which is sprint 3 or a log
  drain);
- the Vercel cron for drink reminders (its runs are not visible to the app);
- flows end to end (sign in, scan, save). Synthetic flows are a later decision because they cost and write data.

## Cost and safety bounds

- **One round a minute at most**, whoever asks. `health_begin_round` takes an advisory lock and refuses a round
  within 60 s of the last one, a floor the caller cannot lower. A leaked cron secret cannot make the monitor
  expensive. A skipped round answers with the findings of the round that ran instead, so pressing "Measure now"
  (or a hostile caller) cannot make the heartbeat miss a failure.
- **Every probe ≤ 3 s.** There is a per-request abort in the probe client, plus a race in the round. A round is about
  1–2 s when all is well and about 4 s when something hangs. Then the samples are written in one call.
- **No paid calls.** AI health is read from calls people already made. GitHub and Vercel are called only with a
  configured token, once per round.
- **Storage is bounded.** About 18 small rows per round and 14 days of retention (a pg_cron job) give roughly 36k rows.
- **Nothing textual is stored.** `reason` must match `^[a-z0-9_]{1,64}$`: no dots, colons or dashes, so not even a host or an address fits. `detail` holds only numbers, booleans
  and nulls (a CHECK constraint, whoever writes). Errors are reduced to codes (`timeout`, `unreachable`,
  `http_503`, `rpc_pgrst301`) before they leave the probe.

## The monitor's own state

`running`, `late` (one interval missed), `failing` (the newest round started over a minute ago and was never
recorded: the database may refuse writes, so the samples on show are older than they look), `stopped` (nothing for
30 minutes: everything reads unknown), and `never`. The `monitor.round` check follows that state: late is degraded,
failing is failed. When the database refuses the round's first write, nothing can be stored at all. The heartbeat
fails at once (the external alert), the monitor turns late after 15 minutes and stopped after 30, and readiness says
503 from "late" on.

CI and deployment checks look at the newest **finished** run of `ci.yml` on main and the newest **finished**
production deployment. A run in progress is unknown, never healthy, and the monitor's own heartbeat runs are never
counted as CI.

## Who sees what

| Surface                      | Who                                                                    | Shows                                                                                                                                                                    |
| ---------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/health`            | anyone                                                                 | `{"status":"ok"}` while the app runs. Nothing else (no DB, no version)                                                                                                   |
| `GET /api/health/ready`      | holder of `CELLR_HEALTH_READY_TOKEN` (≥ 24 chars)                      | one word + monitor state; 200 only while the monitor runs on time and every infrastructure check is measured and not failed, otherwise 503; **404 when no token is set** |
| `GET /api/cron/health`       | holder of `CELLR_HEALTH_ROUND_SECRET`, else `CRON_SECRET` (≥ 16 chars) | recorded or not, outcome, and the **number** of failed infrastructure checks (when skipped: those of the round that ran instead)                                         |
| System › Health, the overlay | admins (proxy 404 + page check + `assertAdmin`)                        | everything stored: statuses, reasons, numbers, what each check proves                                                                                                    |
| The repository (public)      | anyone                                                                 | what is measured (catalogue, thresholds), never a measurement                                                                                                            |

## Isolation from the map and from CELLR

- The architecture page reads the overlay with a **1.5 s limit** and **never throws**. Unavailable health becomes
  `{ state: "unavailable", reason }` and one line above the map. The map's data (the register) does not depend on it.
- The Health page reads with a 4 s limit and shows why it has nothing (`not_installed`, `not_configured`, `timeout`,
  `error`).
- Probe requests carry `x-cellr-probe: 1`. They use their own client with a hard timeout, so probe traffic is
  recognisable and never shares a slow connection with user traffic.
- No user-facing route, page or job imports the monitor. A failure in it cannot reach them.

These rules are proven by e2e tests (`e2e/system-health.spec.ts`): monitoring that hangs (10 s) leaves the map fully
rendered in under 8 s, and monitoring not installed shows the map with a notice.

## Noticing a full outage outside CELLR (requirement 2)

A heartbeat and an alert are different things. Everything inside CELLR (this page, the overlay, the database) goes
down with CELLR, so the outage must be **detected and reported by something that does not run on CELLR**.

**The owner's choice (2026-11-19): no operational status in public GitHub Actions.** The design is one external,
private uptime provider doing three jobs (OPERATIONS.md §3):

| Monitor at the provider                        | Detects                                                                     | State after sprint 2                                   |
| ---------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------ |
| A. Round trigger (every 10 min)                | app down, or the database takes no round (503); also _starts_ the rounds    | endpoint built, own secret `CELLR_HEALTH_ROUND_SECRET` |
| B. Readiness (`/api/health/ready`)             | monitor late or stopped, an infrastructure check failed or unmeasured (503) | endpoint built (token)                                 |
| C. Dead man's switch (`CELLR_HEALTH_PING_URL`) | rounds stopped for any reason: A not firing, app or database down           | ping built                                             |

The provider alerts through its own channels, independent of CELLR, Vercel and GitHub. Choosing and configuring it
is the owner's step; no code change is needed.

The GitHub workflow `health-heartbeat.yml` is kept **without a schedule**: a manual check of the setup, and a
template for a scheduled heartbeat in a private repository. In the public repository its run history would show
when CELLR had trouble, and GitHub disables public schedules after 60 days without activity.

## Alternatives considered

- **Vercel cron as the trigger.** It runs inside the platform it should watch and is limited to daily runs on the
  Hobby plan. On Pro it would be a fine _trigger_ (the dead man's switch still catches a stopped cron), with
  detection staying external. It can be added at any time as a second trigger: the gap rule makes double triggering
  harmless.
- **A scheduled GitHub Actions heartbeat in this repository (the original D1).** It works, but its pass/fail history
  is public, which conflicts with the owner's preference. It is kept as a manual check and a template for a private
  repository.
- **pg_cron + pg_net calling the app.** pg_net is not installed, it would need a secret in the database, and it runs
  inside the database it watches. Rejected.
- **Storing error messages for debugging.** It would put host names, SQL fragments or tokens in the database and on
  the page. Rejected: codes only. Logs (`server/log.ts`) carry the code and the stage, never values.
- **A public readiness endpoint with details.** It leaks the component list and failures to anyone. Rejected: the
  public endpoint is liveness only, and readiness needs a token.
- **Probing by making AI calls.** It costs money on every round and proves less than real traffic. Rejected; no
  traffic reads `unknown`.

## Consequences

- Migration 0047 must be applied before anything is measured in production (D4: not yet). Until then System › Health
  says "not installed", the overlay line says so, and the map is unchanged. That state is tested.
- Switching on external monitoring is three server settings and one provider account (OPERATIONS.md §3). Turning on
  CI and deploy checks is two read tokens. Each is optional and independent.
- Sprint 3 (incidents) reads `health_latest` / `health_history`. The model keeps every round, so incidents can be
  derived and deduplicated from history without changing the probes.

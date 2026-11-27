# Activation: X-Wines catalogue, ratings and the CELLR community (production)

The production runbook for 100,646 wine records, their 1,008,593 rating aggregates (20,857,044 ratings) and CELLR
community reviews. Every step is the **owner's** unless it says Claude, and each production step has its own GO.
Nothing in phase A touches production. Two milestones, in this order:

- **Milestone 1, the catalogue and external ratings, for every user** (C1–C5): after A1, A3 and phase B.
- **Milestone 2, CELLR community reviews** (C6–C7): later, after the community hardening (A2). Until then the community
  stays closed in the database (migration 0054), which `verify-api-closed.sql` checks at every step.

The order matters:

1. **A, prerequisites:** staging validated, rights complete, the rollout decided (and, for milestone 2, the hardening);
2. **B, production, invisible:** backup, migrations, the provider, its rights, the import, the links;
3. **C, visible, one switch at a time:** the credit page first, then the source, then search and scan; the community
   last, after moderation works. Each step has a phone acceptance and an undo;
4. **D, watch 72 hours** against a stop rule, then close with the release record.

Before and after every B and C step, run `verify-api-closed.sql` (read-only) in the production SQL editor. Every row
must be ok, except: from C3, "no provider is public yet" turns false; from C7, "the community is closed" and "no
review and no report" turn false.

## Phase A: prerequisites (no production)

| #   | Step                                                                                                                                                                                                                                                                                                                                        | Who                               | Done when                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ----------------------------------------------- |
| A1  | **Staging validated:** `ratings-verify` 42/42 (`ratings-verify.ts db`), `pool-check` 16 or more at once, `perf16` MET (method below), and after it `perf_synth` off and X-Wines pilot                                                                                                                                                       | Owner approves runs; Claude reads | All three green, results recorded in `results/` |
| A2  | **Community hardening merged** (separate PR; needed for milestone 2 only, not for the catalogue): the CELLR weight configurable and documented (no code change to adjust it), the link and spam filter strengthened, a minimum account age or verified e-mail before publishing and reporting, the methodology text derived from the weight | Claude builds; owner merges       | Merged, CI green                                |
| A3  | **Rights complete:** `SOURCE_RIGHTS_REGISTER.md` §1b gains what the original permission says about the grantor's role, withdrawal or takedown, and third-party rights; §1 and §4 are updated from "pilot only" and "NO" to the recorded permission. A short legal confirmation is advised                                                   | Owner (Claude drafts the PR)      | Merged; the evidence line of §1b is final       |
| A4  | **Rollout decided** (D1 below): **decided 2026-11-27, everyone at once** at C3                                                                                                                                                                                                                                                              | Owner                             | Recorded in D1                                  |
| A5  | **GO/NO-GO for phase B** (below): every criterion met, recorded with the run ids                                                                                                                                                                                                                                                            | Owner                             | GO given                                        |

## Phase B: production, nothing visible

| #   | Step                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Done when                                                                                   | Undo                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| B0  | **The right project.** In the Supabase dashboard of the production project, the SQL editor: `select public.catalog_target_identity();` must say `production` and the production ref; `select version from supabase_migrations.schema_migrations order by 1 desc limit 3;` must end at 0050 (nothing from 0051 yet). Nothing is changed                                                                                                                                                                                   | Both answers noted                                                                          | —                                                                          |
| B1  | **Backup.** Note the time of the latest completed daily backup, less than 24 h old (`docs/BACKUP-RECOVERY.md` §6.1). Run a Storage backup (§4) and a logical dump of the catalogue tables (§6.4), and restore that dump into a separate, throwaway database (§6.6: a local Postgres, never production) and compare its row counts. A hosted restore has never been rehearsed (register R-BAK-1); restoring a backup into a new Supabase project is the only full rehearsal, at a cost: decide whether to do it before B2 | The backup time and the dump's checksum noted                                               | —                                                                          |
| B2  | **Migrations 0051–0054**, route A (`docs/MIGRATIONS.md` §2): the dry run lists exactly these four; then push from the merged `main`. For the seconds between 0052 and 0054 the review functions exist without their gate                                                                                                                                                                                                                                                                                                 | `migration list` equals the repository; `verify-api-closed.sql` all ok                      | Additive; fix forward with a new migration                                 |
| B3  | **Register the provider** (SQL editor; the import tools refuse an unknown provider): `select public.catalog_provider_register('{"id":"xwines","name":"X-Wines dataset","homepage":"https://github.com/rogerioxavier/X-Wines"}');`                                                                                                                                                                                                                                                                                        | The row exists with scope `off`                                                             | `admin_catalog_provider_disable('xwines', …)`                              |
| B4  | **Rights, with the evidence, scope still off** (logged): the payload below, every value from §1b                                                                                                                                                                                                                                                                                                                                                                                                                         | A row in the rights log; `verify-api-closed.sql` all ok                                     | `admin_catalog_provider_disable('xwines', …)`                              |
| B5  | **Production environment**, in this order: (a) `cellr-production-catalog` with you as required reviewer, `main` only, admin bypass off; (b) then the environment secret `PRODUCTION_DB_URL`: session pooler on port 5432, user `postgres.<ref>`, no query parameter except `sslmode`                                                                                                                                                                                                                                     | Saved                                                                                       | Delete the secret                                                          |
| B6  | **Import:** `production-catalog.yml` modes `preflight` → `dry-run` → `import` → `verify`, each approved by you, the backup time re-checked before `import`. Then the read-only checks of `verify-production-catalog.sql` in the SQL editor (below). Delete the secret afterwards                                                                                                                                                                                                                                         | 100,646 active records, 1,008,593 units, 20,857,044 ratings; every check of the SQL file ok | `admin_catalog_provider_disable`; removing rows needs a reviewed migration |
| B7  | **Links reviewed:** Admin → External sources, the `suggested` links in batches. Only `verified` links give a household's canonical wine the record's ratings and credit; a record is never a CELLR identity by itself                                                                                                                                                                                                                                                                                                    | The queue decided, or a recorded decision to leave the rest suggested                       | Each decision can be reversed in the same screen                           |

**B4 payload** (the owner's SQL; every `<…>` from `SOURCE_RIGHTS_REGISTER.md` §1b, nothing invented here):

```sql
select public.admin_catalog_provider_rights('xwines', jsonb_build_object(
  'license', '<licence as recorded in §1b>', 'license_url', '<its URL>',
  'attribution', '<the authors'' citation, as on /about/ratings>',
  'legal_notice', '<the notice §1b requires, or null>',
  'modification_notice', 'CELLR normalises names and aggregates the ratings per wine and vintage',
  'may_store', true, 'may_display', true, 'commercial_use', true, 'may_display_ratings', true,
  'rights_status', 'verified', 'rights_evidence', '<the evidence line of §1b>',
  'rights_verified_at', now(), 'rights_verified_by', '<you>', 'search_scope', 'off'),
  'production activation B4: written permission recorded (SOURCE_RIGHTS_REGISTER.md §1b)', '<you>');
```

The database refuses `verified` without evidence, display without storage, ratings without display, and any scope but
`off` without storage and display; `public` later needs `verified` and `commercial_use`.

**B6 checks after the import** (`verify-production-catalog.sql`, read-only): active records equal the file; no
duplicate external id; no CELLR wine written by the import; verified links unchanged; units, ratings and NV units as
above; every distribution adds up; no rater column; the runs hold counts only; a person's search returns no X-Wines row
(scope still off); `verify-api-closed.sql` all ok.

## Phase C: visible, one switch at a time

Each step: GO, the change, the phone acceptance (below), `verify-api-closed.sql`, then the next step. `CELLR_FEATURES`
is the Vercel production environment variable; a change needs a redeploy.

| #   | Step                                                                                                                                    | `CELLR_FEATURES` after (added) | Phone acceptance                                                                                                                                                        | Undo                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| C1  | **Credit page and ratings UI, source still off**                                                                                        | + `catalog_ratings`            | `/about/ratings` shows the citation and the method; a wine page shows **no** ratings block; `/api/v1/wines/<id>/ratings` answers `available: false`                     | Remove the switch                                                                 |
| C2  | **Sources panel**, so the full credit exists before any external data is used                                                           | + `sources_panel`              | A wine's "Sources & reliability" opens; nothing external is listed yet                                                                                                  | Remove the switch                                                                 |
| C3  | **Source public** (logged admin step: scope `public`). From here every signed-in person's search can return X-Wines records (D1)        | —                              | Phone checklist R1–R6: a known wine's ratings block (score, real counts, external and CELLR apart, the credit link), a record page, NV and a vintage, Dutch and English | Scope `off` (`admin_catalog_provider_disable`): hides records and ratings at once |
| C4  | **Wine search** in "add a bottle" and Koopcheck                                                                                         | + `wine_search`                | Typing finds an X-Wines record with its credit; choosing it fills the form and shows its ratings inline                                                                 | Remove the switch                                                                 |
| C5  | **Scan resolver**                                                                                                                       | + `scan_resolver`              | `sprint-004c/IPHONE_CHECKLIST.md` 1–15 against production                                                                                                               | Remove the switch                                                                 |
| C6  | **Moderation operational, community still closed:** an admin is set; `/admin/reviews` loads; the moderation functions answer            | —                              | The queue page on a phone; nothing to publish yet                                                                                                                       | —                                                                                 |
| C7  | **Community open:** the switch, then `admin_community_open(true, reason, actor)` (logged). Publish, report and moderate one test review | + `community_reviews`          | Phone checklist R7–R10                                                                                                                                                  | `admin_community_open(false, …)`, then remove the switch                          |

**Phone checklist (ratings and community).** iPhone, Safari, CELLR on the home screen; record model, iOS, date and a
screenshot of R1, R3 and R8.

| #   | Check                                                      | Expected                                                                                                |
| --- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| R1  | A wine with a verified link to an X-Wines record: its page | The ratings block: CELLR score, real counts, the external and the CELLR averages apart, the credit link |
| R2  | The vintage filter: a year, then NV                        | Numbers change; NV is never shown as a year                                                             |
| R3  | A record page from search (`/catalog/<id>`)                | Name, region, vintages, the credit, the ratings                                                         |
| R4  | A wine with no verified link                               | No external ratings, a clear empty state                                                                |
| R5  | Dutch and English                                          | All texts translated; numbers in the app's locale                                                       |
| R6  | VoiceOver, the largest text size, dark mode                | Read in order; nothing cut off; readable                                                                |
| R7  | Publish a tasting as a review (explicit consent)           | Published with the display name only; the private note never appears                                    |
| R8  | A link or an e-mail address in the review text             | Refused with the message                                                                                |
| R9  | Report the review from a second account                    | Reported; it appears in `/admin/reviews`                                                                |
| R10 | Moderate it (hide), then try to edit it as its author      | Hidden; the author cannot undo the moderation                                                           |

## Phase D: watch, stop, close

- **Watch 72 hours** (Claude reports, the owner decides): people's search p95, error rate (`/api/health`, Vercel
  logs), rate-limit hits, `/admin/reviews`, reports through feedback.
- **Stop rule:** p95 of people's search above 300 ms for 15 minutes; any report of a wrong wine or vintage identity;
  any external row shown without its credit; spam or abuse the moderation cannot keep up with. Then roll back at once
  in reverse order (C7 → C1), file the reason, and fix forward.
- **Close:** record the release in the register: dataset version, both SHA-256 checksums, the run ids, the counts, the
  evidence line, the dates of each step.

**Rollback rules.**

| What                             | How                                                               | Effect                                                            | Time      |
| -------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------- | --------- |
| The community                    | `admin_community_open(false, …)`, then remove `community_reviews` | No new review or report; existing reviews stay, hidden by the app | Minutes   |
| Search, scan, sources            | Remove `wine_search`, `scan_resolver`, `sources_panel`; redeploy  | The previous flows, as before                                     | Minutes   |
| The source (records and ratings) | `admin_catalog_provider_disable('xwines', reason, actor)`         | Records and ratings hidden at once; nothing deleted               | Seconds   |
| The data                         | A reviewed migration deleting the provider's runs and rows        | Removed; the import can be repeated                               | A release |
| The whole database               | Restore the backup of B1 (last resort; R-BAK-1: never rehearsed)  | Everything after the backup lost                                  | Hours     |

## D1: the rollout decision (decided 2026-11-27: everyone at once)

**What the code does.** `wine_search` switches the autocomplete UI only. `/api/v1/catalog/search` answers every
signed-in person whatever the switch, and `public.catalog_search` is granted to `authenticated`, so it can also be
called directly as an RPC with the public anon key and a person's session. The scan resolver is gated by
`scan_resolver`. The one real gate is the source's scope in the database: from C3, every signed-in person can find
X-Wines records and their ratings, whatever the switches.

**The decision (owner, 2026-11-27): option A, everyone at once at C3.** CELLR has few users, known to the owner, who
act as the test group. No cohort or household-specific rollout is built. Accepted deliberately: from C3 a public X-Wines
source is reachable through the catalogue API and the database RPCs by every signed-in person. Kept: sign-in, RLS, the
rights checks and every gate; anonymous callers reach nothing. The source can be switched off at once without deleting
anything (`admin_catalog_provider_disable`, seconds). Consequence for this runbook: the phone acceptance of C3 runs with
the source already visible to everyone, so C3 is done at a quiet moment with the undo ready.

## GO/NO-GO criteria

**Phase B may start (A5) only when all hold:** A1 green on staging (`ratings-verify` 42/42, `pool-check` at least 16 at
once, `perf16` MET, `perf_synth` off afterwards and X-Wines pilot); A3 merged; CI green on `main`; the B1 backup time
noted; no open P1/P2 review finding.

**Milestone 1 may go live (C3) only when all hold:** B0–B7 done; `verify-production-catalog.sql` all ok after the
import (scope still off); `verify-api-closed.sql` all ok; C1 and C2 accepted on a phone.

**Milestone 2 may open (C7) only when all hold:** A2 merged; C6 done (moderation answers); `verify-api-closed.sql` all ok
with the community still closed; a moderator available during the first 72 hours.

**NO-GO at any point:** a check above not met, a stop rule hit, or a doubt about rights or identity: stop, record why.

## Release record (filled in at the close)

| Field                                                              | Value |
| ------------------------------------------------------------------ | ----- |
| Dataset version, both SHA-256 checksums                            |       |
| Staging runs (ratings-verify, pool-check, perf16): ids and results |       |
| Production backup time (B1), dump checksum                         |       |
| Migration list after B2                                            |       |
| Rights log row (B4): date, actor, evidence line                    |       |
| Import runs (B6): ids, counts                                      |       |
| Each C step: date, GO, phone acceptance (model, iOS, screenshots)  |       |
| 72-hour watch: incidents, decisions                                |       |

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
- **The pool is checked first.** Mode `pool-check` (read-only) and the start of every `perf16` run open 24 clients
  through the transaction pooler; each holds a server connection for 2 s, and the same server-clock overlap shows how
  many ran at once. Below 16 the run stops before anything is made public.
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

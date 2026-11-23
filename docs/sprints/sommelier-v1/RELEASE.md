# Sommelier V1 — release procedure (database first, then the app)

> **Closed on 2026-11-18: 0043–0046 are applied. Do not run §4 again.** New migrations follow `docs/MIGRATIONS.md` §2.
>
> The release did not run as §4 describes. 0037–0042 went first, alone
> ([`RELEASE_RUNBOOK_0042.md`](../wine-intelligence-mega/RELEASE_RUNBOOK_0042.md)); this release then pushed 0043–0046,
> on 2026-11-18 at about 20:15 UTC (when 0043 wrote `private.cellar_settings`). Checked read-only on 2026-11-18
> (Supabase MCP, `SELECT` only):
>
> | Step                       | State                                                                                                                                                                                                                                                                                 |
> | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | 0a backup                  | Daily physical backups on Pro. Whether a backup from the last 24 hours was confirmed, and whether an extra dump was taken, is the owner's record                                                                                                                                      |
> | 0b the files               | **Holds:** `0046` on `main` has sha256 `9e85e2e0…c69898` (as in step 0b), and `git diff 14efa58 origin/main -- supabase/migrations` is empty                                                                                                                                          |
> | 1–3 link, preflight        | Step 2 was done on 2026-11-17 (the bootstrap). Steps 1 and 3 as written ("46 local, 0 remote", a dry run of ten) no longer applied after 0037–0042; the dry run before this push is the owner's record                                                                                |
> | 4 apply (A3)               | **Done** by the owner: 0043–0046 only                                                                                                                                                                                                                                                 |
> | 5 verify                   | **Holds:** 46 versions recorded, the same names as the files; "Remote database is up to date" (the owner's CLI run); the comparison at 0046 is equivalent (`MIGRATIONS.md` §3); `cron.job` has both jobs active; `sommelier-conversations-purge` first ran at 20:41 UTC and succeeded |
> | 6, 6b smoke before merging | Not applicable: PR #75 was merged on 2026-11-17, before the database (the update below)                                                                                                                                                                                               |
> | 7 after the merge          | **Open: to be confirmed by the owner** (ask, reload, rate, "New conversation"; Vercel → Logs without `sommelier_exchange_not_kept`). Read-only: a kept conversation with 4 messages and 1 rating exists since 20:18 UTC. So the path works, but that is not the smoke test            |
> | 8 docs PR (A6)             | The docs PR of 2026-11-18 (`MIGRATIONS.md` notice and §3)                                                                                                                                                                                                                             |
>
> 0043–0045 make nothing visible: the Smart Cellar 3D columns, zones and functions are there. Depth placement is off
> (`private.cellar_settings.depth_placement = false`) and the old index `bottles_slot_unique` is kept. Dropping it is
> the gated file, only with separate approval (`supabase/gated-migrations/README.md`).
>
> §5 item 1 (revert the 36 recorded versions) no longer applies and must not be run: it would now break a history
> of 46. After the release, §5 items 3–4 hold: no database rollback; the app by Instant Rollback.
>
> The notices and text below are kept as they were written (2026-11-15 and 2026-11-17).

> **Update 2026-11-17: this procedure is overtaken by events. Do not run §4 as written.** Checked read-only on
> 2026-11-17:
>
> - **PR #75 was merged** on 2026-11-17 at 20:34 UTC, before the database steps. A merge to `main` deploys
>   production (`BETA-OPERATIONS.md` §5; the deployment itself was not visible to this tooling, see §3). As §3
>   expected, the app copes with 0046 missing: nothing is kept and nothing errors.
> - **Step 2 is done.** The history holds exactly 0001–0036.
> - **The database release is now split.** First 0037–0042 only (Wine Intelligence), from a checkout of `248206a`, by
>   [`RELEASE_RUNBOOK_0042.md`](../wine-intelligence-mega/RELEASE_RUNBOOK_0042.md). **0043–0046, 0046 included, are
>   not part of that release.** They follow later with their own runbook, which can reuse §4 steps 5–8 and §5 here
>   (the cron check, the smoke tests and the rollback notes for 0046).
> - **Backups (§4 step 0a is corrected):** the organisation is now on **Pro**, with daily physical backups.
>
> Steps 1–4 below expect "46 local, 0 remote" and a dry run of ten files. Neither is true any more.

**Status 2026-11-15: prepared and rehearsed. Nothing has been run against production except read-only queries.**
Every write step below needs the owner's go-ahead (§6). `docs/MIGRATIONS.md` stays the rulebook; this document applies
it to this release.

## 1. Read-only production audit (2026-11-15)

The production project. Only `SELECT` statements were run:

- the migration-history check;
- the schema fingerprint (`scripts/migration-audit/fingerprint.sql`), compared with the repository at `main`
  (`a076cbb`, migrations 0001–0045) and with the per-migration inventory (`scripts/migration-audit/inventory.sh`);
- row counts for the data prechecks.

**Migration history:** none. There is no `supabase_migrations` schema, and `list_migrations` is empty. That is
unchanged since 2026-11-02.

**Schema, per migration:**

| Migration                   | Production                                                                                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0001–0036                   | Applied. Identical to the repository except the **13 deviations accepted on 2026-11-02** (`production-accepted.txt`), all at their pinned hashes          |
| 0037 catalog search         | **Not applied.** Its 46 new object groups are absent; the 3 groups it changes (triggers on `producers`, `wines`, `wine_aliases`) are exactly as before it |
| 0038 provider lifecycle     | **Not applied** (3 groups absent)                                                                                                                         |
| 0039 profile claim          | **Not applied** (5 groups absent)                                                                                                                         |
| 0040 source notices         | **Not applied** (1 group absent)                                                                                                                          |
| 0041 admin sources          | **Not applied** (5 groups absent)                                                                                                                         |
| 0042 hardening              | **Not applied** (1 group absent)                                                                                                                          |
| 0043 smart cellar structure | **Not applied** (5 groups absent; the 7 it changes on `bottles`, `cellar_locations` and `check_bottle_location` are exactly as before it)                 |
| 0044 smart cellar zones     | **Not applied** (8 absent; 2 changed groups as before it)                                                                                                 |
| 0045 smart cellar RPCs      | **Not applied** (2 absent; `swap_bottles` as before it)                                                                                                   |
| 0046 sommelier (this PR)    | Not applied (expected)                                                                                                                                    |

There are **no unexplained differences** and nothing was half-applied: every object of 0037–0045 is either absent or
exactly in its pre-0037 state. Production is the repository at 0036 plus the known platform deviations.

**Data prechecks (counts only):** wines, producers, aliases, bottles, places, households and database size were counted
(verified read-only on 2026-11-15; values kept by the owner, not in the repository).

- 0043's new capacity check (`grid_rows × grid_cols ≤ 1200`): 0 places would violate it.
- 0043's new whole-spot index: 0 cells hold two bottles.
- 0037's search backfill covers 43 wines (instant).

**pg_cron:** installed. `catalog-scan-reads-purge` is present and active. 0046 adds `sommelier-conversations-purge`
(hourly at :41).

## 2. Why 0037–0045 go out together with 0046

> _Superseded 2026-11-17: the owner chose a split release. 0037–0042 go first and alone
> ([`RELEASE_RUNBOOK_0042.md`](../wine-intelligence-mega/RELEASE_RUNBOOK_0042.md)). The reasoning below, that `db push`
> runs every pending file in order, is exactly why that release runs from a checkout holding only 0001–0042._

- `supabase db push` runs every migration missing from the history, **in order**. It cannot run 0046 without 0037–0045
  before it, and `MIGRATIONS.md` forbids running SQL by hand. So the sanctioned way to ship 0046 ships 0037–0046.
- Their app code is already in production: those PRs were merged to `main` and Vercel deployed them. That code was built
  and tested (CI, every run) against the full schema, and copes with it missing. The features those migrations serve
  stay off until switched on: Wine Intelligence through `CELLR_FEATURES`, depth placement through
  `private.cellar_settings` (default off). The gated index drop (`supabase/gated-migrations/`) is not a migration and is
  not part of this.
- **Rehearsed end to end:** `bash scripts/migration-audit/rehearse-release-0046.sh`. It builds a throwaway database the
  way production was built (0001–0036 pasted with CRLF, 0013 skipped, the first 0028/0034 plus repairs, 0037–0045 not
  run), then runs the exact steps of §4:
  - preflight: equivalent;
  - recording 0001–0036 leaves the schema fingerprint unchanged;
  - the dry run lists exactly 0037–0046;
  - `db push` applies all 10;
  - the result is equivalent to the repository;
  - the permission suite passes on it: **1575 / 1575**.

## 3. Vercel: a merge to `main` is a production deploy

`docs/BETA-OPERATIONS.md`: "Deploy by merging a reviewed PR to `main`; Vercel builds production from it." So the order
is **database (§4 steps 1–6) → merge PR #75 (step 7)**. Never the other way round.

- The new app code tolerates a database without 0046. The chat then lives in memory, no thumbs are shown, and nothing
  errors. An accidental early merge would degrade the feature, not break the app. Do not plan on it.
- The **old** app (current production) runs fine on the new schema: it never touches the new tables. So there is no
  window in which app and database disagree.
- **Previews use the production database (documented, not yet seen live).** `docs/SETUP.md` §5 sets
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SERVICE_ROLE_KEY` for **Production
  and Preview**. Previews are behind Vercel Authentication (checked 2026-11-15: the PR #75 preview redirects to the
  Vercel login). Consequences:
  - the PR #75 preview has run against production since its first push. Without 0046 it degrades: nothing is kept and
    nothing errors;
  - after step 4, **any** preview (any branch) writes sommelier conversations to production. The PR #75 preview then
    becomes the smoke test before the merge (step 6b).
- **Owner check before step 7** (this session got 403 on team `jp-builds`), in Vercel → project `cellr`:
  1. _Settings → Git_: **Production Branch** is `main`, and Git deployments are not disabled or ignored (no Ignored Build
     Step that skips `main`);
  2. _Settings → Environment Variables_: `NEXT_PUBLIC_SUPABASE_URL` for **Production** names the
     production project (Supabase → Project Settings → API → Project URL). For **Preview**, note which project it names. If it is the same, the
     points above apply;
  3. _Deployments_: the newest **Production** deployment is from `main` at `2f4079e` (the PR #74 merge). That confirms
     the automatic deploy on merge;
  4. _Settings → Deployment Protection_: Preview protection stays on (it keeps previews, which hold the service-role key
     to production, away from the public).

## 4. Procedure

On a laptop, with the database password, from a checkout of the **exact commit that will be merged** (the PR #75
head). `db push` reads the migration files from disk, and once 0046 has run in production its file may never change
(`MIGRATIONS.md` §1).

**0. Before you start.** Get the go-ahead (§6). No other merges to `main` during the window.

**0a. Backup.** _Corrected 2026-11-17:_ the Supabase organisation is now on the **Pro** plan (checked read-only:
plan `pro`). Production has **daily physical backups**, the last 7 days, in Supabase → Database → Backups. PITR is not
enabled. Before a release, confirm that a completed backup from the last 24 hours is listed. A restore brings the
whole project back to that moment.

(On 2026-11-15 the plan was `free`, without automatic backups, and this step required a dump of your own.)

A logical dump of your own is now **optional**, as an extra copy. The three-file dump from the Supabase guide reads
production and writes the files on **your** machine. Keep them encrypted and out of git and chats: `data.sql` holds
people's accounts and cellars. It needs Docker, the connection string (Supabase → Connect → Session pooler) and the
database password.

```bash
pnpm exec supabase db dump --db-url "$DATABASE_URL" -f roles.sql --role-only
```

```bash
pnpm exec supabase db dump --db-url "$DATABASE_URL" -f schema.sql
```

```bash
pnpm exec supabase db dump --db-url "$DATABASE_URL" -f data.sql --use-copy --data-only -x "storage.buckets_vectors" -x "storage.vector_indexes"
```

Check that `data.sql` contains `COPY public.wines` and `COPY auth.users`, and that its size is plausible (a few MB at
most). Storage files (label photos, avatars) are not in a database dump. This release does not touch them.

These three files alone cannot be restored into a new project safely: CELLR's storage policies, `auth.users` triggers,
cron job and migration history are not in them. For a dump that can be restored, also take
`platform-objects.sql` and the two history files as in `docs/BACKUP-RECOVERY.md` §6.4.

**0b. The files that will run are the tested ones.** `db push` runs what is on disk:

```bash
sha256sum supabase/migrations/20261123000046_sommelier_conversations.sql
```

It must print `9e85e2e0415db95747738014ca00d40afb22e43a6f062c7f41495fc827c69898`, the file rehearsed and tested in
CI. Then:

```bash
git diff 14efa58 HEAD -- supabase/migrations
```

It must print nothing: no migration changed since the security fix that was audited.

**1. Link and preflight (read-only).** Each check must pass, or stop.

```bash
pnpm exec supabase link --project-ref <production-ref>
```

```bash
bash scripts/migration-audit/reference.sh --skip 20261114000037 --skip 20261115000038 --skip 20261116000039 --skip 20261117000040 --skip 20261118000041 --skip 20261119000042 --skip 20261120000043 --skip 20261121000044 --skip 20261122000045 --skip 20261123000046 > /tmp/ref-0036.txt
```

```bash
bash scripts/migration-audit/compare.sh --target "$DATABASE_URL" --reference /tmp/ref-0036.txt --accept scripts/migration-audit/production-accepted.txt
```

The comparison must print `RESULT: equivalent`. Then:

```bash
pnpm exec supabase migration list --linked
```

It must show 46 local and 0 remote.

**2. Record 0001–0036 as applied** (history only; the schema does not change). The list is written out on purpose,
never derived from the files on disk:

```bash
pnpm exec supabase migration repair --linked --status applied 20261010000001 20261010000002 20261010000003 20261010000004 20261010000005 20261010000006 20261010000007 20261012000008 20261012000009 20261013000010 20261014000011 20261015000012 20261018000013 20261019000014 20261020000015 20261021000016 20261024000017 20261026000018 20261027000019 20261028000020 20261029000021 20261030000022 20261031000023 20261101000024 20261102000025 20261103000026 20261104000027 20261105000028 20261106000029 20261107000030 20261108000031 20261109000032 20261110000033 20261111000034 20261112000035 20261113000036
```

`20261018000013` is included on purpose: its objects exist, identical, through 0036 (audit 2026-11-02).

**3. Verify the history, and what would run.**

```bash
pnpm exec supabase migration list --linked
```

It must show 46 local and 36 remote. Then:

```bash
pnpm exec supabase db push --linked --dry-run
```

It must list **exactly** `20261114000037` … `20261123000046` (10 files) and nothing else. If it lists anything else,
**stop**. Rolling the history back is §5.1.

**4. Apply.**

```bash
pnpm exec supabase db push --linked
```

**5. Verify (read-only).**

```bash
pnpm exec supabase migration list --linked
```

It must show 46 local and 46 remote. The dry run must now say "Remote database is up to date":

```bash
pnpm exec supabase db push --linked --dry-run
```

```bash
bash scripts/migration-audit/compare.sh --target "$DATABASE_URL" --accept scripts/migration-audit/production-accepted.txt
```

The comparison must print `RESULT: equivalent`. In the SQL Editor:

```sql
select jobname, schedule, active from cron.job order by jobname;
```

It must show two active jobs: `catalog-scan-reads-purge` and `sommelier-conversations-purge`.

**6b. Smoke the PR #75 preview** (if it uses production, see §3): ask the sommelier something, reload, rate an
answer, start a new conversation. These are real rows in production; "New conversation" deletes the conversation
again.

**6. Smoke the current app (still the old code):** sign in, open the cellar, a wine, Tonight and the sommelier. Nothing
may have changed for people.

**7. Merge PR #75** (Vercel deploys production). Then:

- in the app: ask the sommelier, open a wine, come back, reload: the conversation is there; rate an answer; "New
  conversation";
- Vercel → Logs: no `sommelier_exchange_not_kept`;
- in the SQL Editor: `select count(*) from public.sommelier_messages;` grows with your questions.

**8. Afterwards (docs PR):** update `MIGRATIONS.md`. Lift the STOP notice; add 0037–0046 to the production inventory in
§3, with this audit as the source. Check that `main` holds the exact 0046 that was pushed:

```bash
git diff <pushed-commit> origin/main -- supabase/migrations
```

It must print nothing.

## 5. Rollback

**Restoring data** (only if a migration damaged existing rows, which none of 0037–0046 is written to do): with the
dump from step 0a, either load the affected tables' `COPY` blocks from `data.sql` back into production (with
`SET session_replication_role = replica`), or restore everything into a new project
**exactly as `docs/BACKUP-RECOVERY.md` §6.6** (`pre-restore.sql` first, platform objects and migration history last,
then the fingerprint comparison) and point Vercel at it. Not the plain three-file `psql` restore: in the rehearsal of
2026-11-16 it gave `anon` and `authenticated` rights on admin functions and tables that production does not grant, and
it left out the storage policies, the `auth.users` triggers and the cron job. Both are owner actions with downtime. Decide per incident.

1. **After step 2 or 3, before step 4:** only the history changed. Revert exactly what step 2 recorded (the same
   36 versions, `--status reverted`) and the database is as it was. Rehearsed on 2026-11-02 for this exact list.
2. **A migration fails during step 4:** the CLI stops at that file. Earlier files stay applied and recorded; the
   failing one is rolled back. Stop, keep the app as it is (the old app runs on any of these states), and investigate.
   Never edit an applied migration; fix forward with a new one.
3. **After step 4:** the schema changes are additive and the old app ignores them. No database rollback is needed or
   planned.
4. **After step 7:** Vercel → Deployments → the previous production deployment → _Instant Rollback_. The database stays.
   The kept conversations simply wait (and expire); the purge keeps running.

## 6. What needs the owner's approval

| #   | Action                                                                               | Kind             | Who              |
| --- | ------------------------------------------------------------------------------------ | ---------------- | ---------------- |
| A0  | Step 0a: optional extra dump (reads production; production data on your machine)     | data handling    | owner (password) |
| A1  | ~~Release 0037–0045 together with 0046 (§2)~~ superseded: split release (2026-11-17) | decision         | owner            |
| A2  | Step 2: `migration repair` (36 rows): **done** (verified 2026-11-17)                 | production write | owner (password) |
| A3  | Step 4: `db push`: **done** 2026-11-18, as 0043–0046 only (0037–0042 went first)     | production write | owner (password) |
| A4  | Step 7: merge PR #75 (triggers the production deploy): **done** 2026-11-17           | deploy           | owner            |
| A5  | Optional: give this tooling read access to the Vercel team `jp-builds` to verify §3  | access           | owner            |
| A6  | Step 8: the `MIGRATIONS.md` update: the docs PR of 2026-11-18                        | docs PR review   | owner            |

Everything else in this document is read-only.

## 7. CI state at the PR #75 head (for the merge decision)

The full end-to-end run on the branch (manual run 43711511361) has every shard green except tests that also fail on
`main`. Each was checked against last night's scheduled `main` run (43705601074) or reproduced locally on `main`:

- `sprint-s.spec.ts:104` (label OCR): fails 3/12 on `main` too; the test photo's width is random.
- `storage-showcase.spec.ts:82` [desktop]: the same 120 s timeout on `main`.

All sommelier specs are green. Separate follow-ups:

- **Shard 8 capacity:** shard 8 holds the CPU-heavy 3D specs and takes 19–29 min against a 30-min job limit (`ci.yml`
  asks for another shard when that happens). Issue #77.
- **OCR vintage flake:** issue #78. **storage-showcase timeout** (and the storage-gallery flake): issue #79.
- **Simultaneous duplicate question ids:** see issue #76.

**`main` moved on 2026-11-15** (PR #74, Smart Cellar sprint 1C: no migrations, app code only). It was merged into this
branch (`5d02ae7`) and checked there:

- `pnpm check`: domain 922, web 1177 and database 1591 tests;
- the types check and the migration-integrity check;
- the release rehearsal on the merged tree: equivalent, 1591/1591;
- the sommelier, Smart Cellar API, Tonight, reserved and taste end-to-end specs: 105 passed.

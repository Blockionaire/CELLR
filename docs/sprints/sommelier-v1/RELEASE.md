# Sommelier V1 — release procedure (database first, then the app)

**Status 2026-11-15: prepared and rehearsed. Nothing has been run against production except read-only queries.**
Every write step below needs the owner's go-ahead (§6). `docs/MIGRATIONS.md` stays the rulebook; this document applies
it to this release.

## 1. Read-only production audit (2026-11-15)

Project `vvelgyhbjfmjvxkzekyz` (Postgres 17.11). Only `SELECT` statements were run:

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

**Data prechecks (counts only):** 43 wines, 39 producers, 0 aliases, 55 bottles, 5 places, 4 households, 17 MB.

- 0043's new capacity check (`grid_rows × grid_cols ≤ 1200`): 0 places would violate it.
- 0043's new whole-spot index: 0 cells hold two bottles.
- 0037's search backfill covers 43 wines (instant).

**pg_cron:** installed. `catalog-scan-reads-purge` is present and active. 0046 adds `sommelier-conversations-purge`
(hourly at :41).

## 2. Why 0037–0045 go out together with 0046

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
- **Not verified (no Vercel access from this session):** which Supabase project Preview deployments use, and whether
  production deploys automatically on push to `main`. Check both under Vercel → Project → Settings → Git and
  Environment Variables before step 7. If Previews point at production Supabase, the PR #75 preview is a good smoke test
  after step 6.

## 4. Procedure

On a laptop, with the database password, from a checkout of the **exact commit that will be merged** (the PR #75
head). `db push` reads the migration files from disk, and once 0046 has run in production its file may never change
(`MIGRATIONS.md` §1).

**0. Before you start.** Get the go-ahead (§6). No other merges to `main` during the window. Confirm a recent backup
(Supabase → Database → Backups). Optional, read-only:

```bash
pnpm exec supabase db dump --linked -f pre-0046-schema.sql
```

**1. Link and preflight (read-only).** Each check must pass, or stop.

```bash
pnpm exec supabase link --project-ref vvelgyhbjfmjvxkzekyz
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

| #   | Action                                                                              | Kind             | Who              |
| --- | ----------------------------------------------------------------------------------- | ---------------- | ---------------- |
| A1  | Decide to release 0037–0045 together with 0046 (§2)                                 | decision         | owner            |
| A2  | Step 2: `migration repair` (creates the history schema and writes 36 rows)          | production write | owner (password) |
| A3  | Step 4: `db push` (applies 0037–0046)                                               | production write | owner (password) |
| A4  | Step 7: merge PR #75 (triggers the production deploy)                               | deploy           | owner            |
| A5  | Optional: give this tooling read access to the Vercel team `jp-builds` to verify §3 | access           | owner            |
| A6  | Step 8: the `MIGRATIONS.md` update                                                  | docs PR review   | owner            |

Everything else in this document is read-only.

## 7. CI state at the PR #75 head (for the merge decision)

The full end-to-end run on the branch (manual run 43711511361) has every shard green except tests that also fail on
`main`. Each was checked against last night's scheduled `main` run (43705601074) or reproduced locally on `main`:

- `sprint-s.spec.ts:104` (label OCR): fails 3/12 on `main` too; the test photo's width is random.
- `storage-showcase.spec.ts:82` [desktop]: the same 120 s timeout on `main`.

All sommelier specs are green. Separate follow-ups:

- **Shard 8 capacity:** shard 8 holds the CPU-heavy 3D specs and takes 19–29 min against a 30-min job limit (`ci.yml`
  asks for another shard when that happens).
- **Simultaneous duplicate question ids:** see issue #76.

# CI exceptions for the isolated release of 0037–0042

**What this is:** a documented, scoped acceptance of known CI failures on `main`, **for one decision only**: applying
the database migrations 0037–0042 to production, following [`RELEASE_RUNBOOK_0042.md`](RELEASE_RUNBOOK_0042.md).

**Since 2026-11-18, E1 is a temporary CI exception** (owner's request, because "Dependency audit" is a required check).
It is one entry in `scripts/audit/audit-exceptions.json`, read by the gate `scripts/audit/check-audit.mjs`, and it is
narrow:

- **What it covers:** one advisory (GHSA-fc5q-39xc-vjpf), one package and version (picomatch 4.0.7), and one dependency
  path;
- **Who and how long:** an owner, and an expiry 30 days out;
- **What the audit still does:** it runs in full, its report stays in the job log and the job summary, and every other
  high or critical advisory still fails the job. So does this advisory through any other path or version, and so does
  the exception itself once it has expired.

There is **no** `ignoreGhsas` (it would hide the advisory on every path), no `test.skip` and no `test.fixme`. E2 and E3
stay red until they are fixed.

> **2026-11-18, evening: E1 removed.** GitHub withdrew GHSA-fc5q-39xc-vjpf at 15:38 UTC (OSV records `withdrawn:
2026-11-18T15:38:56Z`; the npm registry no longer reports any advisory for picomatch 4.0.7, checked on its bulk
> advisory endpoint). The gate said so itself ("no longer needed"), and its registry self-test, which relied on that
> advisory, started failing on every branch. `scripts/audit/audit-exceptions.json` is now empty: **every** high or
> critical advisory fails the job again, with no exception at all. What did not change: CVE-2026-112366 (VulnCheck) is
> still listed at NVD ("Awaiting Analysis", high), and picomatch 4.0.7 is still in the tree through the path below; the
> reachability analysis in E1 stands. If npm reports the advisory again, the job fails and a new owner decision is
> needed. The gate's tests no longer depend on any live advisory: CI runs them on fixed fixtures only, one of them a
> real `pnpm audit` report recorded on 2026-11-18. Residual risk and CELLR's actual use of picomatch 4.0.7: E1,
> "Status after the withdrawal".

Written 2026-11-17 from CI run [44170769177](https://github.com/Blockionaire/CELLR/actions/runs/44170769177) (`main`
at `21186f6`, the PR #75 merge). Updated 2026-11-18.

## Scope: what is covered, exactly

| ID  | Job                       | Covered failure                                                                                                                                                                           |
| --- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | Dependency audit          | **Removed on 2026-11-18** (advisory withdrawn by GitHub, see above). Was: GHSA-fc5q-39xc-vjpf only, picomatch 4.0.7 via `apps__web>next-intl>@parcel/watcher>picomatch`, until 2026-12-18 |
| E2  | End to end · shard 4 of 8 | `storage-gallery.spec.ts:351` [phone] and `storage-premium.spec.ts:80` [phone] failing; `storage-gallery.spec.ts:123` and `:228` [phone] flaky                                            |
| E3  | End to end · shard 8 of 8 | `storage-showcase.spec.ts:82` [desktop] failing (timeout)                                                                                                                                 |
| —   | End to end · whole app    | The aggregate job, red because of E2 and E3                                                                                                                                               |

**Not covered, so any of these is a NO-GO** (runbook §8 G8):

- any other failing or flaky test;
- another advisory at level high or above;
- the same advisory through another path;
- any red database job ("Migration integrity", "Database · migrations + permission suite (Postgres 16)" including its
  concurrency and upgrade steps, "Database · real Supabase stack");
- a red "Format · lint · types · unit tests" or "Secret scan".

**Expiry:** the exceptions apply to the 0037–0042 release only. They must be re-assessed before the 0043–0046 release
and before any feature switch (`CELLR_FEATURES`) is turned on.

In the same run every other job was green:

- format, lint, types and unit tests;
- migration integrity;
- the database suite on Postgres 16, with its concurrency and upgrade rehearsals;
- the real Supabase stack;
- the secret scan;
- end-to-end shards 1, 2, 3, 5, 6 and 7.

Shards 4 and 8 passed every other test: 110 and 118 passed respectively.

## E1. picomatch ReDoS (GHSA-fc5q-39xc-vjpf, high)

**The advisory:** "picomatch vulnerable to ReDoS through single-branch repeated extglobs". It affects versions
`<=4.0.7`, and there is no patched version: the audit reports "Patched versions `<0.0.0`". `npm view picomatch
version` gives `4.0.7`, the newest release. So no upgrade fixes it today.

**It came from the advisory, not from code:**

- the audit job passed on `main` at 11:45 UTC on 2026-11-17 (run 44076811261);
- it failed at 20:35 UTC (run 44170769177);
- both ran on the same lockfile. `pnpm-lock.yaml` was last changed in `0721378` (Sprint 004A); PR #75 did not touch it.

**Reachability in production: not reachable.** The evidence, from the installed packages:

1. **The only path** is `next-intl@4.14.9 → @parcel/watcher@2.6.0 → picomatch@4.0.7` (`pnpm audit --json`).
2. **@parcel/watcher's use of picomatch.** It uses it in one place: `wrapper.js` compiles the watcher's `ignore` glob
   patterns into regular expressions (`picomatch.makeRe`). The ReDoS needs an attacker-chosen pattern. These patterns
   come from configuration, not from requests.
3. **next-intl's use of @parcel/watcher.** It is used only in its message **extractor**: `SourceFileWatcher`, loaded by
   `next-intl/plugin`. The watcher is started only in development, and only when message extraction is configured
   (the `messages` / `extract` options of the plugin).
4. **CELLR does not configure extraction.** `apps/web/next.config.ts` calls
   `createNextIntlPlugin("./src/i18n/request.ts")` without options. The plugin runs while the Next config loads at build
   time, not while serving requests.
5. **The production server bundle.** Its trace (`.next/next-server.js.nft.json` of a local `pnpm build`) contains no
   `picomatch@4.0.7`. It contains only Next's own vendored copy, `next/dist/compiled/picomatch`, which Next uses to
   match `images` remote and local patterns from static configuration. The audit does not flag that copy, and it is
   not this package.

**Conclusion:** the vulnerable code is not executed by production request handling. The theoretical exposure is a
developer machine running `next dev` with message extraction configured, which CELLR does not do.

### Status after the withdrawal (2026-11-18, re-verified)

| Question                         | Answer, with the source                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The advisory GHSA-fc5q-39xc-vjpf | **Withdrawn by GitHub** on 2026-11-18 at 15:38:56 UTC (OSV: `withdrawn`, title "Withdrawn Advisory: …"). The npm registry's bulk advisory endpoint returns nothing for picomatch 4.0.7, so `pnpm audit` no longer reports it. The withdrawal note points to picomatch PR #235; its own wording ("withdrawn because it is a security issue") contradicts GitHub's usual "not a security issue", so nothing here relies on its reason |
| The CVE, CVE-2026-112366         | **Not withdrawn.** NVD lists it as "Awaiting Analysis", high (CVSS 3.1 and 4.0 by VulnCheck, the CNA), last modified 2026-10-19. The claim that picomatch ≤4.0.7 can be made to backtrack exponentially by a crafted extglob (`+(*)`, `+(*a)`) still stands; only GitHub's record of it, and with it npm's, is gone                                                                                                                 |
| Where picomatch 4.0.7 is         | Production graph: only `next-intl@4.14.9 → @parcel/watcher@2.6.0 → picomatch@4.0.7`. Development and test tooling: `vite`, `vitest`, `tinyglobby`, `fdir`                                                                                                                                                                                                                                                                           |
| What runs it                     | `@parcel/watcher/wrapper.js` calls `picomatch.makeRe` only on the `ignore` globs of a subscription. `next-intl/plugin` loads `@parcel/watcher` whenever `next.config.ts` is evaluated (`next dev`, `next build`), but subscribes only in development **and** only with message extraction configured (`CatalogManager` → `SourceFileWatcher`). CELLR calls `createNextIntlPlugin("./src/i18n/request.ts")` without it               |
| What is deployed                 | A `pnpm build` on 2026-11-18: none of the 129 `.nft.json` traces lists `@parcel/watcher` or `picomatch@4.0.7`, so neither ships with the server functions. Next's own vendored copy (`next/dist/compiled/picomatch`) is in `next-server.js.nft.json`, used only by `match-remote-pattern` / `match-local-pattern` for `images` patterns; CELLR's `next.config.ts` has no `images` patterns                                          |
| Dev and test tooling             | vite, vitest and tinyglobby compile globs written in the repository (test includes, configuration), never input from people                                                                                                                                                                                                                                                                                                         |

**Residual risk: low.** The ReDoS needs an attacker-chosen glob to be compiled. No code path in CELLR compiles a glob
that comes from a request, and the vulnerable copy is not deployed. It would change if CELLR (a) enabled next-intl
message extraction (a development feature, still with repository-controlled globs), (b) added code that matches
user-supplied globs with picomatch, micromatch or tinyglobby, or (c) ran `next start` on its own server with
extraction configured. Re-check with `pnpm why picomatch`, `grep -n createNextIntlPlugin apps/web/next.config.ts`, and
the traces of a `pnpm build` (`grep -l picomatch@4 apps/web/.next/**/*.nft.json`).

**What the gate does now:** there is no exception. If npm reports the advisory again, the Dependency audit fails at
once and needs a new owner decision (F1). An upgrade past picomatch 4.0.7 is still the fix when one is released,
because the CVE itself stands.

**Effect on 0037–0042:** none. The migrations are SQL, applied by the Supabase CLI from the owner's machine. The app
is not rebuilt or redeployed by this release, and the package is not part of any database path.

**Can it be removed from the production graph? No** (tested 2026-11-18, in throwaway worktrees):

| Option                                                                        | Result                                                                                                                                                                             |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A patched picomatch                                                           | None: 4.0.7 is the newest release, and the advisory names no patched version                                                                                                       |
| A newer next-intl or @parcel/watcher                                          | None helps: next-intl 4.15.1 (newest) still needs `@parcel/watcher ^2.4.1`, and @parcel/watcher 2.6.0 (newest) still needs `picomatch ^4.0.4`                                      |
| Remove @parcel/watcher (`pnpm.overrides`: `"next-intl>@parcel/watcher": "-"`) | **Breaks the app.** `next-intl/plugin` requires it as it loads, so `next build` fails with `Cannot find module '@parcel/watcher'`                                                  |
| Remove only picomatch (`"@parcel/watcher>picomatch": "-"`)                    | **Cosmetic, so rejected.** The audit turns green, but the watcher still loads the very same `picomatch@4.0.7` through pnpm's hoisted copy. That would hide the code, not remove it |
| Replace next-intl                                                             | Out of proportion for code that never runs in production                                                                                                                           |

**The temporary CI exception** (`scripts/audit/audit-exceptions.json`):

| Field             | Value                                                                                                                                                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Advisory          | GHSA-fc5q-39xc-vjpf (high): picomatch ReDoS through single-branch repeated extglobs                                                                                                                                          |
| Package, versions | `picomatch`, `4.0.7` only                                                                                                                                                                                                    |
| Dependency path   | `apps__web>next-intl>@parcel/watcher>picomatch` only                                                                                                                                                                         |
| Owner             | Blockionaire (repository owner)                                                                                                                                                                                              |
| Added, expires    | 2026-11-18, **2026-12-18** (the gate refuses an exception longer than 30 days)                                                                                                                                               |
| Why               | Not reachable from production requests (the five points above); no patched version; removal breaks the build or only hides the code                                                                                          |
| Removed when      | A picomatch release above 4.0.7 fixes the advisory, or @parcel/watcher / next-intl stop using a vulnerable picomatch: upgrade, then delete the entry. The gate also prints a warning once the advisory is no longer reported |
| On expiry         | The job fails again. Renewing needs an explicit owner decision, a new reachability check and a new date at most 30 days ahead                                                                                                |

**What the gate checks** (`scripts/audit/check-audit.sh` runs `pnpm audit --prod` in full, then `check-audit.mjs` on its
JSON). It fails on:

- every high or critical advisory without an exception;
- the excepted advisory through **any other path**, at **any other version** or on **another package**;
- an expired exception, or an invalid one: a missing owner or reason, no versions or paths (so no wildcards), or more
  than 30 days long;
- an audit that produced no report, for example when the registry cannot be reached.

Low and moderate advisories are listed, as before with `--audit-level high`.

**Tests:** `scripts/audit/check-audit.test.sh` runs in the job before the gate. Since 2026-11-18 (evening) every case CI
runs is **deterministic**: no network, no registry, fixed dates (checked by running it with networking disabled). 23
cases:

- 18 on reports shaped like `pnpm audit --json`: the 16 rules, with the test's own exceptions file (the picomatch entry
  as it was), so they test the gate whatever the repository's file holds; and 2 on the repository's own file (it is
  valid, and with it a high advisory fails);
- 5 on a **real** `pnpm audit --prod --json` report, recorded on 2026-11-18 with pnpm 10.28.0 and kept in
  `scripts/audit/fixtures/` (`lodash@4.17.20`: high GHSA-35jh-r3h4-6jhm and GHSA-r5fr-rjxr-66jc, 2 moderate):
  - with the repository's exceptions it **fails**, naming both high advisories;
  - exceptions for them that name another path **do not** cover the direct dependency (`.>lodash`);
  - the same exceptions naming `.>lodash` cover it (the control), and the moderate ones are still reported.

`--registry` (by hand, not in CI) adds 2 live cases: lodash 4.17.20 still fails the gate on today's registry, and the
registry reports the same advisories as the recording (if not, re-record: `scripts/audit/fixtures/README.md`).

Before that, CI ran the live cases, one of them on `picomatch@4.0.7` as a direct dependency; it failed on every branch
once GitHub withdrew the advisory, because there was nothing left to report. The real audit of the repository is not a
test and still asks the live registry on every run.

Mutation check: with the path rule removed from the gate, the synthetic and the recorded path cases fail; with high no
longer blocking, 13 cases fail, the recorded ones included.

On the repository the gate reports 3 advisories, 2 moderate and 1 low, none of them blocking. It passes with no
exceptions.

**The same audit, below the threshold** (these do not fail the job, but are recorded here):

- **Next.js 16.4.1, moderate:** GHSA-mfr8-8qww-v76h and GHSA-vc7v-qv4w-wrv8. Both concern `'use cache'` /
  `unstable_cache` cache leaks across root params. CELLR uses neither: `grep -rn "use cache\|unstable_cache"
apps/web/src` finds nothing. 16.4.6 is available.
- **esbuild, low:** GHSA-g7r4-m6w7-qqqr. It concerns the dev server on Windows, through `scripts/catalog-tools > tsx`.
  This is dev tooling only.
- `next build` on 2026-11-17 also stopped once with Next's own "affected by a known security vulnerability" upgrade
  notice. It built on the next run, and no upgrade was run here.

## E2 and E3. The 3D end-to-end failures

| Test                          | Project | Run 44170769177 (`21186f6`)                                 | Before PR #75: run 43714493764 (`2f4079e`) | Locally on `21186f6`, `--retries=0` | Tracked              |
| ----------------------------- | ------- | ----------------------------------------------------------- | ------------------------------------------ | ----------------------------------- | -------------------- |
| `storage-gallery.spec.ts:351` | phone   | failed twice: `data-template` not seen within the 30 s test | failed the same way                        | passed                              | #79                  |
| `storage-premium.spec.ts:80`  | phone   | failed twice: showcase stuck in `returning` / `extracting`  | failed the same way                        | passed                              | to add to #79 (F4)   |
| `storage-gallery.spec.ts:228` | phone   | flaky: `returning` not back to `idle` within 30 s           | flaky                                      | passed                              | to add to #79 (F4)   |
| `storage-gallery.spec.ts:123` | phone   | passed                                                      | flaky                                      | not run                             | to add to #79 (F4)   |
| `storage-showcase.spec.ts:82` | desktop | failed twice: 120 s timeout in `scrollIntoViewIfNeeded`     | failed in nightly 43705601074              | passed (54.6 s)                     | #79; shard time: #77 |

**These failures are older than the Sommelier merge.** The same tests failed on `main` before PR #75 (the PR #74 merge,
`2f4079e`), and shard 4 passed in the scheduled run of 2026-11-17 11:45 on that same commit (run 44076811261). They
are intermittent. All of them pass locally on `21186f6` without retries.

**They do not touch the database.** Every one of them opens the development gallery, `/design/cellar-3d?sample=…` (`show()` in
`storage-gallery.spec.ts`, the shared helper in `e2e/storage3d.ts`), with built-in sample data and no database call. That gallery is closed in every production
deployment (`isCellarGalleryEnabled` → `cellarGalleryOpenIn`, "never a production deployment whatever is set"). What
they exercise is the WebGL storage view and the bottle showcase of Smart Cellar 3D, a separately gated feature
(`smart-cellar-gate`). Its database step is 0043–0045, which is not part of this release.

**The likely cause, which is an assumption and not proven:** frame and animation timing under CI's software WebGL
renderer, with iPhone 13 emulation (device scale 3) on the phone project. The failures are timeouts waiting for an
animation phase or a stable element, never a wrong value. A real slowness on low-end phones cannot be ruled out from
CI alone. That is a question for the 3D work (F4), not for this release.

**Why main is red after 3D merges:** `ci.yml` runs the end-to-end shards only on push and schedule, not on pull
requests. The 3D PRs #70–#74 were merged without an end-to-end run, and `main` showed these failures afterwards (F5).

**No 3D test or 3D code was changed for this release.** Any change to these specs belongs to the existing Smart Cellar
3D development session.

## Fixed in this PR (not an exception): the database job's throwaway Postgres could not start

The job "Database · migrations + permission suite (Postgres 16)" failed this way twice: on `main` in run 43854571181
(2026-11-16), and on this PR in run 44183381921 (2026-11-17, green on its single re-run). Both times:

- the permission suite (1591/1591) and the concurrency step had passed;
- `scripts/db-smart-cellar-upgrade.sh` then failed 0.65 s into its step with `pg_ctl: could not start server`;
- the step started 0.2 s after the concurrency step had ended.

**Cause (reproduced 2026-11-18):**

- Every psql connection over TCP leaves, on its client side, a TIME_WAIT socket on its ephemeral source port for 60 s.
  `scripts/db-placement-concurrency.sh` leaves 666 of them, spread over Linux's whole ephemeral range (32768–60999).
- The test clusters listened on fixed ports **inside** that range (54992–54999). A new server on a port held by such a
  TIME_WAIT socket fails with `could not bind IPv4 address "127.0.0.1": Address already in use`, then `FATAL: could
not create any TCP/IP sockets`, then `pg_ctl: could not start server`.
- 300 psql connections, then a cluster on one of their source ports, gave exactly that, every time it was tried.
- With 666 ports held for 60 s, the upgrade step's 54992 is taken in a few percent of runs. That fits two failures in a
  few dozen runs, always in the same place, and gone on a re-run.

**Ruled out:**

- **Earlier clusters not cleaned up:** each step stops its clusters. 0.2 s after the concurrency step, no loopback
  socket other than TIME_WAIT is left.
- **The same port used by two steps:** every step had its own port.
- **initdb:** it succeeded.
- **Memory and `/dev/shm`:** about 16 GB available and `/dev/shm` empty, in the reproduction.

**The fix:**

- The fixed ports of everything CI or the runbook starts move below 32768: `db-test.sh` 25499, `db-types.sh` 25498,
  `db-placement-concurrency.sh` 25493/25494, `db-smart-cellar-upgrade.sh` 25492, `reference.sh` 25450, the default of
  `scripts/lib/temp-cluster.sh` 25499, and `rehearse-release-0042.sh` 25461. Linux never gives a connection a source
  port there. In the reproduction, none of the 666 TIME_WAIT sockets was below 32768.
- When a server still does not start, `temp-cluster.sh` now prints the end of its log, every TCP socket on that port
  and the memory, so a recurrence names its own cause in the CI log. It still fails the step; nothing is retried or
  hidden.
- **Left as they were (not started by CI or the runbook):** `local-stack/up.sh` (the end-to-end stack, 54997),
  `db-budget/claim/import-concurrency.sh`, `inventory.sh`, `rehearse-bootstrap.sh`, `rehearse-release-0046.sh` and
  `catalog-tools/pilot.sh`. They are a follow-up (F6).

## Why none of this affects migrations 0037–0042

- **The paths are separate.** 0037–0042 create catalogue and Wine Intelligence objects, plus three triggers on
  `wines`, `producers` and `wine_aliases`. The failing tests render sample data in a gallery that never calls the
  database. The audit finding is in build-time tooling.
- **The checks for these migrations are green**, in the same run:
  - the permission suite on Postgres 16;
  - the real Supabase stack;
  - the migration-integrity check;
  - every non-3D end-to-end test, with all migrations applied.
- **This release adds its own evidence:**
  - the rehearsal of exactly this release (`scripts/migration-audit/rehearse-release-0042.sh`): the preflight, the
    six-file dry run and push, the post-checks and schema equivalence, the triggers on existing rows, and 1327/1327 in
    the suite;
  - the app on `main` against a database at exactly 0042 (runbook §2);
  - the read-only production checks (runbook §2).
- **Nothing is deployed.** The release does not rebuild or redeploy the app, so neither finding changes what runs in
  production.

## Remaining risks

| Risk                                                                                | Size       | Mitigation                                                                                                 |
| ----------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------- |
| The audit exception is renewed out of habit                                         | low        | The gate fails by itself after 2026-12-18; renewing needs an owner decision and a fresh reachability check |
| The intermittent 3D failures hide a **new** failure in shards 4 or 8                | medium     | Compare the failing list of each run with the table above; anything else is a NO-GO (scope)                |
| The 3D slowness is real on low-end phones                                           | low–medium | F4, before the Smart Cellar 3D release; not relevant to 0037–0042                                          |
| The withdrawn picomatch advisory is published again                                 | low        | The job fails at once (no exception left); then F1: upgrade or decide again. Exposure is dev-time only     |
| Next 16.4.1's two moderate advisories become relevant (if `'use cache'` is adopted) | low        | F2                                                                                                         |

## Follow-up actions (separate PRs; none is part of this release)

- **F1.** The exception is gone (advisory withdrawn on 2026-11-18). Still upgrade picomatch, @parcel/watcher or
  next-intl in a tested PR when a release past picomatch 4.0.7 appears, since the CVE itself is not rejected. Owner:
  Blockionaire.
- **F2.** Upgrade Next.js to 16.4.6 or later in its own PR, with a full end-to-end run.
- **F3.** Shard 8 capacity (#77): it runs close to the 30-minute job limit.
- **F4.** For the Smart Cellar 3D session: add `storage-premium.spec.ts:80` and `storage-gallery.spec.ts:123/228` to
  #79. Make the 3D phone specs deterministic under software rendering, and check the real-device performance question.
- **F5.** Consider running at least the 3D shards on pull requests that touch `apps/web/src/features/cellar/storage3d` (or the
  whole end-to-end suite on PRs), so `main` does not turn red only after a merge.
- **F6.** Move the remaining fixed test ports in the ephemeral range below 32768 too (the list in "Fixed in this PR").
  `local-stack/up.sh` is used by the end-to-end stack and `catalog-tools`, so change it with those.

# CI exceptions for the isolated release of 0037–0042

**What this is:** a documented, scoped acceptance of known CI failures on `main`, **for one decision only**: applying
the database migrations 0037–0042 to production, following [`RELEASE_RUNBOOK_0042.md`](RELEASE_RUNBOOK_0042.md).

**What this is not:** a suppression. Nothing is ignored, skipped or switched off:

- no `ignoreGhsas` or other audit configuration;
- no `test.skip` or `test.fixme`;
- no change to `ci.yml`.

CI stays red until the causes are fixed. The security baseline is unchanged.

Written 2026-11-17 from CI run [44170769177](https://github.com/Blockionaire/CELLR/actions/runs/44170769177) (`main`
at `21186f6`, the PR #75 merge).

## Scope: what is covered, exactly

| ID  | Job                       | Covered failure                                                                                                                                      |
| --- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | Dependency audit          | `pnpm audit --prod --audit-level high` failing on **GHSA-fc5q-39xc-vjpf only** (picomatch 4.0.7 via `apps__web>next-intl>@parcel/watcher>picomatch`) |
| E2  | End to end · shard 4 of 8 | `storage-gallery.spec.ts:351` [phone] and `storage-premium.spec.ts:80` [phone] failing; `storage-gallery.spec.ts:123` and `:228` [phone] flaky       |
| E3  | End to end · shard 8 of 8 | `storage-showcase.spec.ts:82` [desktop] failing (timeout)                                                                                            |
| —   | End to end · whole app    | The aggregate job, red because of E2 and E3                                                                                                          |

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

**Effect on 0037–0042:** none. The migrations are SQL, applied by the Supabase CLI from the owner's machine. The app
is not rebuilt or redeployed by this release, and the package is not part of any database path.

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

| Risk                                                                                | Size       | Mitigation                                                                                       |
| ----------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------ |
| A red audit job hides a **new** high advisory                                       | medium     | Read the audit output of every run until E1 is resolved: anything besides the four listed is new |
| The intermittent 3D failures hide a **new** failure in shards 4 or 8                | medium     | Compare the failing list of each run with the table above; anything else is a NO-GO (scope)      |
| The 3D slowness is real on low-end phones                                           | low–medium | F4, before the Smart Cellar 3D release; not relevant to 0037–0042                                |
| picomatch stays unpatched for long                                                  | low        | F1; exposure is dev-time only                                                                    |
| Next 16.4.1's two moderate advisories become relevant (if `'use cache'` is adopted) | low        | F2                                                                                               |

## Follow-up actions (separate PRs; none is part of this release)

- **F1.** Watch GHSA-fc5q-39xc-vjpf. When picomatch, @parcel/watcher or next-intl ships a fix, upgrade in a tested PR
  (an override or a next-intl bump). Until then, do not add an audit exception without an explicit owner decision with
  an expiry date.
- **F2.** Upgrade Next.js to 16.4.6 or later in its own PR, with a full end-to-end run.
- **F3.** Shard 8 capacity (#77): it runs close to the 30-minute job limit.
- **F4.** For the Smart Cellar 3D session: add `storage-premium.spec.ts:80` and `storage-gallery.spec.ts:123/228` to
  #79. Make the 3D phone specs deterministic under software rendering, and check the real-device performance question.
- **F5.** Consider running at least the 3D shards on pull requests that touch `apps/web/src/features/cellar/storage3d` (or the
  whole end-to-end suite on PRs), so `main` does not turn red only after a merge.

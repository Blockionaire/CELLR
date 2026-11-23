# Smart Cellar 3D — production release

Owner decision (2026-11-21): **full rollout** of the supported Smart Cellar 3D experience to every signed-in user
of the production CELLR PWA: the 3D view, the Rack Builder with saving, index-1 placement and moves, swaps,
temperature zones and Smart Placement advice. **Depth is not part of this release** (§12).

Branch `claude/adoring-cori-jn7num` (PR #105), on top of `main` at `4ffa39f`.

## 1. Production readiness (verified read-only on 2026-11-21)

Each fact below was checked read-only (Supabase MCP, `SELECT` only) on 2026-11-21. The observed values (project
status and version, numbers of places, bottles, accounts and households) are kept by the owner, not in the
repository: the repository is public (`CLAUDE.md`, "Hard rules").

| Fact                             | Verified                                                                                                                                                                                                             |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production database              | the production Supabase project, checked for status and Postgres version; its host is the one listed in `PRODUCTION_DATABASE_HOSTS` (`lib/smart-cellar-write-target.ts`)                                             |
| Migration history                | 0001–0047 and 0050 recorded (no 0048/0049 exist). **Identical to `main`**: this release needs **no migration**                                                                                                       |
| Smart Cellar schema              | 0043–0045 present: template/semantics/appearance columns, `cellar_location_zones`, `save_storage_layout`, `swap_bottles_v2`                                                                                          |
| Storage locations                | **every existing place has `template = NULL`** (one bottle per cell); no zones                                                                                                                                       |
| Bottles                          | **none beyond index 1**                                                                                                                                                                                              |
| Depth                            | `private.cellar_settings.depth_placement = false`; `bottles_slot_unique` **and** `bottles_slot_index_unique` both present                                                                                            |
| Accounts                         | counted (value kept by the owner); the release is for every signed-in user, so the number changes nothing in the plan                                                                                                |
| Feature gates before this change | every Smart Cellar gate closed on production by code; writes refused for the production database by code                                                                                                             |
| Vercel                           | **not readable from this session** (403 for the Vercel team): environment variables, current production deployment and Deployment Protection unverified                                                              |
| Backups                          | Supabase Pro daily physical backups, 7 days (per `docs/BACKUP-RECOVERY.md`; the dashboard itself is the owner's to check). Storage files are not touched by this release; their first backup is planned by the owner |

## 2. Code changes

- `apps/web/src/lib/smart-cellar-release.ts` (new): the **explicit production authorization** (§6).
- The five gates (`smart-cellar-gate.ts`, `-renderer-gate.ts`, `-builder-gate.ts`, `-placement-gate.ts`,
  `-advice-gate.ts`) open where they did before **or** in the authorized production release. The write target check
  (`smart-cellar-write-target.ts`) is unchanged; only `hostOf` is exported.
- `smart-cellar-release.test.ts` (new): the policy as a matrix over every gate.
- `server/env.ts`, `server/system/registry.ts`, `docs/SETUP.md`: the new setting and the kill switch documented.
- PR #105's Sprint 6 work comes along: the demo environment (local only), two 3D-panel UX fixes, and the local
  Codespaces sign-in exception (ignored on Vercel Production, §6).
- No database change, no change to RLS, routes, services or the client's authority.

## 3. Open PRs and conflicts

`main` merged into this branch without conflicts. Other open PRs (#94–#111: Sommelier 3.0, scan review, catalogue
staging) touch none of the files changed here; they are **not** part of this release. `main` itself carries 13
commits since Sprint 5 (Sommelier S0–S2, wine database 004B/C); whether they are already in production could not be
checked (Vercel 403). Merging this PR deploys `main` as it is plus this branch.

## 4. Tests and results

Run on this branch (`main` merged in), production build, local stack (real Postgres 16, PostgREST, RLS):

| Check                                                                                                                                                   | Result                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`, `pnpm typecheck`, `pnpm migrations:check`                                                                                          | passed                                                                                                                                                                                                                                                                                                                                                           |
| `pnpm lint`                                                                                                                                             | passed (the one warning that is also on `main`)                                                                                                                                                                                                                                                                                                                  |
| `pnpm test`                                                                                                                                             | domain 1,325 · web 1,375 (+13 skipped) · scripts 268: all passed; includes the new release matrix and every gate's tests (120)                                                                                                                                                                                                                                   |
| `scripts/db-test.sh` (RLS, functions, triggers, both slot indexes)                                                                                      | 1,681 passed                                                                                                                                                                                                                                                                                                                                                     |
| `pnpm build`, `scripts/check-bundle-secrets.sh`, `pnpm architecture:inventory`                                                                          | passed, no secret in the bundle, inventory unchanged                                                                                                                                                                                                                                                                                                             |
| Browser: placement, advice, rack-builder, smart-cellar-3d (+ old database), smart-cellar-api, cellar3d, racks, flows, smoke, drag-swap; desktop + phone | **316 passed**, 51 skipped (the other project's), 5 failed: `cellar3d.spec.ts:171` ×2 and `racks.spec.ts:371` ×3, **the same failures as on `main`** (reported since sprint 2B.3 / 4)                                                                                                                                                                            |
| Sprint 6 acceptance on the demo (W1–W6, isolation, read-only, no WebGL, context loss, reduced motion, slow CPU)                                         | 36/36 (PR #105)                                                                                                                                                                                                                                                                                                                                                  |
| CI on the PR                                                                                                                                            | All green on `cf13473`: format/lint/types/unit, migrations + permission suite, **real Supabase stack**, migration integrity, secret scan, dependency audit, backup round trip, Vercel preview build. (The real-stack job's first run had failed before running: GitHub returned 403 downloading the Supabase CLI.) End-to-end jobs do not run on PRs (by design) |

The workflows of the brief map onto these suites: create / configure / zones / save and reopen
(`rack-builder.spec.ts`, acceptance W1, W4); place an unplaced bottle, move across places, swap, Undo, lost answer
(`placement.spec.ts`, W2, W3, W6); advice and placing on exactly the advised spot (`advice.spec.ts`, W2); consistent
views (every placement test checks the database and the other views). The production-mode difference is only which
gate opens; it is covered by the release matrix (the production host cannot be emulated locally without weakening
the check). **PWA reopen (workflow 12) and real phones are part of the post-deployment smoke checks (§10).**

## 5. Database and migration verification

Read-only (Supabase MCP, `SELECT` only): §1. `pnpm migrations:check` passes; `main`'s migrations equal production's
history; nothing to push. `scripts/db-test.sh` (RLS, functions, triggers, both slot indexes) passes on a fresh
database built from the same migrations.

## 6. Production write-security model

A deployment is the **authorized production release** only when all hold:

1. `VERCEL=1`, `VERCEL_ENV=production`, `VERCEL_TARGET_ENV` `production` or unset (not a preview, not a custom
   environment, not an unmarked build);
2. `CELLR_SMART_CELLAR_PRODUCTION_DATABASE` equals, exactly, the host in `NEXT_PUBLIC_SUPABASE_URL` (the server's own
   configuration; never a request);
3. that host is in `PRODUCTION_DATABASE_HOSTS`, a list in code.

Then each feature opens only through its own server setting, and writes only with `CELLR_SMART_CELLAR=write`.

| Situation                                                     | Result                                                          |
| ------------------------------------------------------------- | --------------------------------------------------------------- |
| Production, release declared exactly, `write`                 | all features, writes open (index 1 only)                        |
| Production without the declaration                            | exactly as before: nothing new shown, nothing written           |
| Declaration with another host, a scheme, wildcard, upper case | closed                                                          |
| Preview, even with the declaration                            | never production writes (its writes still need a test database) |
| Unmarked build, custom environment, unreadable database URL   | closed                                                          |
| `CELLR_SMART_CELLAR=off` (kill switch)                        | everything closed, every new endpoint 404, legacy views         |
| `CELLR_SMART_CELLAR=read`                                     | views and advice stay, every write closed                       |

Unchanged: authentication on every route, the household from the server, RLS, conditional moves (one statement,
stale source refused), swaps (`swap_bottles_v2`, both spots checked), layout saves (occupied positions checked in the
app and bounds in the database under a lock), the depth switch and both unique indexes. **No client value
authorizes anything**: the browser receives booleans for display; every mutation is decided again on the server.
No app request runs a migration or repairs schema (a database without 0043–0045 is reported as "not set up").

**Known, accepted limitation:** two simultaneous _layout_ saves of the same place within one round trip can end
with the last one winning (the app's `If-Match` check runs before the database call;
`PROPOSAL-layout-compare-and-swap.md`). It cannot move, lose or duplicate a bottle (the database refuses any shape
that strands one); at worst one person's look/zone change is replaced by the other's. Not a blocker for this release;
the additive migration remains proposed.

## 7. Existing storage: conversion workflow

Nothing is converted automatically. The existing locations keep showing in the existing views (2D racks, list, and the
existing 3D view for places without a template), with every bottle on its row and column.

To make one a 3D furniture piece: **Cellar → Racks → (the place) → Manage → "Design in 3D"**. The Rack Builder
opens that place: its kind only _suggests_ a template (never its name), and **Save stays disabled until the person
chooses one**. Any choice that would leave a bottle outside the new shape, need depth, or change how existing
positions are read is refused with an explanation, in the app and again on the server, and the database checks once
more under a lock. Saving changes the place's description only: no bottle moves. A brand-new place: **Racks → "Design a place in 3D"**.

## 8. Feature settings (Vercel → Project → Settings → Environment Variables, **Production** scope only)

| Variable                                 | Value                                                 |
| ---------------------------------------- | ----------------------------------------------------- |
| `CELLR_SMART_CELLAR`                     | `write`                                               |
| `CELLR_SMART_CELLAR_PRODUCTION_DATABASE` | the exact host of the production database (see below) |
| `CELLR_SMART_CELLAR_3D`                  | `1`                                                   |
| `CELLR_SMART_CELLAR_BUILDER`             | `1`                                                   |
| `CELLR_SMART_CELLAR_PLACEMENT`           | `1`                                                   |
| `CELLR_SMART_CELLAR_ADVICE`              | `1`                                                   |

`CELLR_SMART_CELLAR_PRODUCTION_DATABASE` is the bare host, without `https://`, path or trailing slash: the host of
Production's `NEXT_PUBLIC_SUPABASE_URL` (Supabase → Project Settings → API → Project URL), which is also the entry in
`PRODUCTION_DATABASE_HOSTS` (`apps/web/src/lib/smart-cellar-write-target.ts`). Any other value keeps production closed.

Do **not** add `CELLR_SMART_CELLAR_WRITE_DATABASE` or `CELLR_DEMO_ORIGINS` anywhere. Leave Preview as it is.

## 9. Deployment steps

1. Merge this PR to `main` (the repository's workflow, `docs/BETA-OPERATIONS.md` §5). Without the variables of §8
   this changes nothing visible: production stays closed.
2. Set the six variables of §8 on **Production**.
3. Redeploy production (Vercel → Deployments → the new production deployment → Redeploy), because variables apply to
   new deployments only.
4. Smoke checks (§10).

**Actual result (2026-11-21): NOT deployed.** This session cannot read or change the Vercel project (403 for the
Vercel team), so it can neither set the variables nor watch the deployment, nor verify that production runs the
expected commit. Per the brief it stops here. The PR is ready; production stays exactly as it is until the owner
merges and sets the variables (or grants this session team access, after which it can do steps 1–4 and the smoke
checks itself).

## 10. Production smoke checks (non-destructive)

On the phone, in the installed PWA:

1. Sign in normally; the cellar loads as before.
2. Cellar → 3D: places without a template appear in the existing 3D view (nothing converted).
3. Cellar → Racks → **Design a place in 3D** → choose a template → Save → it appears in 3D. (This creates one new,
   empty place: deletable from Racks → Manage, no other data touched.)
4. Place a bottle that has no place into it (advice shows "where it fits best"; Place here) → it is on that spot in
   every view → **Undo** returns it to "no place". Restoration path: Undo, or move it back.
5. Open an existing place in the Builder: the template is only suggested and Save is disabled until chosen; leave
   without saving.
6. Close the PWA completely, reopen: the new place and the state are there.
7. Vercel runtime logs and Supabase logs: no new errors.

## 11. Rollback

| Need                               | Do                                                                           | Effect                                                                            |
| ---------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Stop everything Smart Cellar, fast | `CELLR_SMART_CELLAR=off` on Production, then Redeploy                        | new views, Builder, placement, advice and every new endpoint closed; legacy views |
| Keep the views, stop writes        | `CELLR_SMART_CELLAR=read`, Redeploy                                          | look only                                                                         |
| Previous app altogether            | Vercel → Deployments → previous production deployment → **Instant Rollback** | the previous build; no redeploy needed                                            |

None of these touches the database. Layouts, zones and bottle positions saved meanwhile **stay** (they are ordinary
rows; the legacy views read positions as before and ignore templates). There is **no database rollback** to do or to
promise: this release adds no migration. A location that was given a template keeps it; with Smart Cellar off it is
shown by the existing views like any other place.

## 12. Remaining limitations: depth placement

Not released, and nothing here depends on it: `bottles_slot_unique` stays, `private.cellar_settings.depth_placement`
stays false, `DEPTH_PLACEMENT_ENABLED` stays false. The three templates that need more than one bottle per cell
(double-depth rack, modular cubes, diamond bins) remain preview-only in the Builder with Save disabled and the reason
shown. Crates are supported at one bottle per compartment only.

Releasing depth needs, in order, each its own reviewed step and owner decision:

1. **Older clients**: anything that writes positions through the old routes assumes one bottle per cell
   (`PATCH /bottles`, the legacy racks view, `swap_bottles` v1). Before index > 1 exists, those paths must refuse or
   understand an occupied index > 1 (the database already refuses an index > 1 while the switch is off).
2. **A migration** (forward-only, reviewed, run through `docs/MIGRATIONS.md` §2): replace `bottles_slot_unique`
   (location, row, col) with the index-aware `bottles_slot_index_unique` only — **dropping an index is irreversible in
   effect** (data written meanwhile may not satisfy it again) — and add `move_bottle_v2` (the Sprint 4 proposal,
   already tested against disposable databases).
3. **The switch**: `depth_placement = true` and `DEPTH_PLACEMENT_ENABLED = true`, in that order, after a backup.
4. Device checks of depth placement and of the three templates.

This session stops before any of these: they are irreversible database changes that need specific owner
authorization.

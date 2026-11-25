# Smart Cellar 3D — completion mega sprint: management report

One coordinated initiative in six focused pull requests, built by five specialised workstreams (Quick Add and mobile
UX, Shared Racks, depth storage and Rack Builder reliability, 3D rendering polish, independent quality and security)
and integrated by the lead. Dates: 2026-11-23 to 2026-11-25.

This report holds no production observation, identifier or setting value (the repository is public, `CLAUDE.md`).

## 1. Executive summary

- **Built, reviewed and tested:** Sprint 7.2 finished on the current `main` with Quick Add on places from before
  templates; a database-level compare-and-swap for Rack Builder saves; a final 3D polish pass; Shared Racks (schema,
  API, authorization, screens); depth storage behind a closed gate.
- **Independent review** of every pull request by a reviewer that did not build it: **no blocker remained**. It found
  and got fixed, among others, one real product regression (Rack Builder Save stuck after a failed refresh), a dead end
  for touch users (Quick Add on a failed read), a privacy leak of a non-member's name in rack history, a silent way to
  take a bottle out of a shared rack from the owner's own cellar, and the fact that switching depth off was not a kill
  switch.
- **Full CI incl. every end-to-end shard** on the whole stack: green except one test that fails identically on `main`
  (`admin-mobile.spec.ts:474`, phone).
- **Nothing is merged, deployed, migrated or switched on.** Three pull requests are ready for the owner's review; three
  stay draft until the owner has looked at the first three (they carry migrations and new product surface).

## 2. Status per component

The five statuses are separate: implemented and tested ≠ merged ≠ deployed ≠ enabled in production ≠ verified on a
physical device.

| Component                                      | PR   | Implemented + tested     | Independently reviewed | Merged | Deployed | Enabled in production                                    | Device-verified |
| ---------------------------------------------- | ---- | ------------------------ | ---------------------- | ------ | -------- | -------------------------------------------------------- | --------------- |
| Sprint 7.2 completion + legacy Quick Add       | #134 | yes                      | yes                    | no     | no       | n/a (rides on the live Smart Cellar gates once deployed) | no              |
| Rack Builder compare-and-swap (migration 0055) | #130 | yes                      | yes                    | no     | no       | no (migration not applied)                               | no              |
| Final 3D polish                                | #135 | yes                      | yes                    | no     | no       | n/a (rides on the live gates once deployed)              | no              |
| Shared Racks foundation (migration 0056)       | #131 | yes                      | yes (security)         | no     | no       | no (gate has no production clause)                       | no              |
| Shared Racks screens                           | #143 | yes                      | yes                    | no     | no       | no                                                       | no              |
| Depth storage (migration 0057, gated files)    | #132 | yes, disabled by default | yes                    | no     | no       | no (must stay off)                                       | no              |

Stack order (each based on the one before): `main` ← #134 ← #130 ← #135 ← #131 ← #143 ← #132. #121 (Sprint 7.2 as
first written) is fully contained in #134.

## 3. What was built

- **#134 Quick Add:** glass placeholder bottles without plus glyphs; Add bottle above the furniture on every stage path
  (also while loading, after a failed read, when a template disappeared); focus follows adding; one English term; Quick
  Add in the existing 3D view for places from before templates wherever the view's pinned grid gives an exact spot (all
  six kinds; anything ambiguous keeps the 2D list; no coordinate guessed). No new write, route, setting or migration.
- **#130 compare-and-swap:** `save_storage_layout_v2` compares the draft's revision under the place's row lock; the
  revision strictly increases; direct zone writes move it; the app falls back to today's save where the function is
  absent (logged); the Builder recovers from a conflict without dropping the draft or overwriting the newer save.
- **#135 polish:** camera never inside the furniture; keyline rings legible on every finish; aim help for a finger on
  dense racks ("tap again"); whole-spot placeholder identity; shader warm-up; context restore; no loading jump; 44 px
  place chips; one source for the placeholder bottle; one first-picture budget in the 3D specs.
- **#131 Shared Racks foundation:** five `private` tables reached only through 21 definer functions that check active
  rack membership inside the transaction; a bottle stays its owner's household row; one occupancy unique on the whole
  spot and on the bottle; append-only attributed history with name snapshots; two triggers that keep the private
  cellar and the rack consistent; invitations via the existing people search with cool-down and caps; leave, remove,
  last-owner and account-deletion rules; the depth switch respected; gate `CELLR_SHARED_RACKS` without a production
  clause. No existing policy, grant, constraint or function changed.
- **#143 Shared Racks screens:** shared racks in the cellar's 3D row, owner filter, place/move/take out with honest
  confirmations, people, invitations, history; "in shared rack" said and asked about everywhere a bottle is offered for
  a place at home; focus handled; 2D alternative; nothing requested or downloaded with the gate closed.
- **#132 depth:** additive migration (`move_bottle_v2`, depth status, a trigger that refuses new back positions while
  depth is off); gated switch-on, switch-off and collapse files; gate `CELLR_SMART_CELLAR_DEPTH` (never production by
  configuration); index-aware spot picker, Rack Builder depth configuration, racks grid that never loses a bottle;
  opt-in depth end-to-end job in CI.

## 4. Tests and CI (observed)

| Level                                                   | Result on the top of the stack                                                                                                                                           |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Format, lint, typecheck                                 | green (one lint warning that is on `main`)                                                                                                                               |
| Unit tests                                              | domain 2,049 and web 1,851 passed; scripts green                                                                                                                         |
| Database suite (`db-test.sh`, RLS, functions, triggers) | 2,138 passed, 0 failed                                                                                                                                                   |
| Concurrency scripts                                     | placement, layout compare-and-swap, shared racks: green; e.g. 30/30 rounds of simultaneous layout saves → exactly one saved; 24 sessions on one shared spot → one placed |
| Upgrade rehearsal on a database with data               | every existing place and bottle unchanged; depth switch, switch-off and collapse rehearsed                                                                               |
| Production-order rehearsal (independent)                | `main`'s 0001–0054 with data, then 0055 → 0056 → 0057: bottles byte-identical, triggers coexist                                                                          |
| Shared-racks dump/restore round trip                    | 65 constraints and indexes identical                                                                                                                                     |
| GitHub CI on each pull request                          | real Supabase stack, backup round trip, migration integrity, architecture, secret scan, dependency audit: green                                                          |
| Full end-to-end, all 14 shards + depth job              | green except `admin-mobile.spec.ts:474` (fails identically on `main`)                                                                                                    |

The owner's required scenarios each have a test: two users editing a shared rack; a member reaching another member's
private cellar (refused through every new and old route); forging bottle ownership (refused); a revoked member's stale
mutation (refused, also racing the removal); two users placing into one slot (one wins); two simultaneous Rack Builder
saves (one wins, the other gets the conflict); several bottles at different indices of one cell; older APIs against
depth-enabled storage (refuse, never guess); scan returning to the selected 3D position; repeated entering and leaving
placement mode (resource counts constant); a very large rack loading and staying interactive (450-spot test in the
ordinary suite).

Known flaky tests that come from `main` (proven there, not caused here): a timing bound in
`sommelier-check.review.test.ts` and `experiences/annotate.test.ts` under load, and `admin-mobile.spec.ts:474`.

## 5. Security review (independent)

Verdicts on Shared Racks: household RLS not weakened (catalogue diff: additions only); no cross-household leakage of
data (projection, ids, prices, notes, images, over SQL and HTTP); one authoritative occupancy under concurrency;
ownership cannot be forged or silently transferred; a revoked member cannot mutate; history append-only for every role
including the table owner; leaving, removal and deletion never orphan or transfer bottles. Fixed after the review:
non-members named in history, unsolicited invitations, a count oracle on the bottle filter, an emptied rack left
unarchived, the rack cap on accept, the depth kill switch, and the silent take-out from the owner's own cellar.
Accepted risks for the owner (ADR-010 §12): any member may move or take out any bottle (attributed, never touching the
owner's bottle); display names stay in history snapshots after an account is deleted.

## 6. Performance

Software rendering only; no device frame rate is claimed. No change in draw calls, triangles, geometries, textures or
programs from the polish pass; placeholders one draw call; nothing drawn at rest; resource counts identical over ten
Quick Add rounds and five forced context losses; a 450-spot rack half full loads and is tappable in about 17–22 s on
the CI-like software renderer; the depth trigger costs nothing measurable on 36,000 bottles.

## 7. Migrations

`main` took 0051–0054 for catalogue ratings while this work was in flight, so this work's migrations were renumbered,
SQL unchanged: **0055** layout compare-and-swap, **0056** shared racks, **0057** depth (additive). All are additive,
none is applied anywhere but throwaway databases, and they must be applied **in number order** by `docs/MIGRATIONS.md`
§2, each on the owner's decision. Destructive or decision-bound SQL (dropping `bottles_slot_unique`, the depth switch,
switch-off, collapse) stays in `supabase/gated-migrations/` without a version number.

## 8. Production activation sequence (each step its own owner approval)

1. Review and merge #134, then #130, then #135 (no migration needed for #134 and #135; Smart Cellar 3D users get
   Quick Add on old places and the polish on deploy).
2. Owner's phone check after that deploy (the device checklists in the Sprint 7.2 and Sprint 10 reports).
3. Apply 0055 (compare-and-swap); either order with the app is safe.
4. Shared Racks: merge #131 and #143 (closed), apply 0056, re-run the catalogue audit against the real stack, test on
   a preview with real accounts, then a reviewed code change adding a production clause to the gate.
5. Depth: merge #132 (closed), apply 0057 (inert). Switching depth on needs every "not met" precondition of
   `SPRINT-9-DEPTH-REPORT.md` first, then a backup, the gated index drop, and the switch — the first cell that holds two
   bottles is the point of no return.

## 9. Rollback

- App: Vercel Instant Rollback; `CELLR_SMART_CELLAR=read` stops all placement writes; `=off` closes Smart Cellar.
- Shared Racks: unset `CELLR_SHARED_RACKS` (every route 404, data kept).
- Migrations 0055–0057 need no rollback for behaviour (the app ignores them when absent or closed); removing one is a
  new migration. Depth after a cell holds two bottles cannot be rolled back without moving bottles (collapse file).

## 10. Remaining blockers and open items

- **Owner decisions:** merges, migrations, gates; the eight Shared Racks decisions in ADR-010 §12 (including that
  invitations do not require friendship); the "Position" vs "spot" wording; whether the Add bottle button keeps its plus.
- **Physical devices:** nothing is verified on a real phone.
- **Depth "not met" preconditions:** Quick Add beyond index 1, legacy capacity counts (cellar, stats, sommelier),
  `occupiedSlots` for a free front, export v1, `friend_racks` index, the legacy 3D view for a deep templated place, the
  shared-rack front/back rule in the transaction.
- **Shared Racks gaps:** export does not mention the rack; a person with an empty cellar has no way to invitations;
  no push notice; create/layout use a small form, not the Rack Builder.

## 11. GO / NO-GO

| Component                                     | Verdict                                                                                                           |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| #134 Sprint 7.2 completion + legacy Quick Add | **GO for merge and deploy**, with the owner's phone check right after                                             |
| #130 compare-and-swap                         | **GO for merge**; **GO for applying 0055** after the owner's approval                                             |
| #135 3D polish                                | **GO for merge and deploy**, with the device checklist                                                            |
| #131 + #143 Shared Racks                      | **GO for merge with the gate closed**; **NO-GO for production** until the steps of §8.4 and the owner's decisions |
| #132 depth                                    | **GO for merge with depth off**; **NO-GO for switching depth on** until the preconditions are met                 |

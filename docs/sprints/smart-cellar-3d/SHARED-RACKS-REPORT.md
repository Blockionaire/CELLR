# Shared Racks foundation — report

Branch `claude/sc3d-shared-racks-foundation-bqvck4` (base `71aa349`). Decision record:
[ADR-010](ADR-010-shared-racks.md). This run delivers the schema, the API, ownership and authorisation, and their
tests. **No product screen. Nothing is applied to or opened on production.**

## 1. What was built

| Part             | Where                                                                                     | What it is                                                                                                                                                                      |
| ---------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database         | `supabase/migrations/20261130000052_shared_racks.sql`                                     | Five tables in `private` (RLS on, no policy, no grant), 21 functions in `public` (the only way in), 12 private helpers and trigger functions, two triggers on `public.bottles`. |
| Permission suite | `supabase/tests/99_shared_racks.test.sql`                                                 | 178 assertions, as the API's roles.                                                                                                                                             |
| Concurrency      | `scripts/db-shared-racks-concurrency.sh` (`pnpm db:test:shared-racks`, CI job `database`) | Real sessions of people from different households; the history is replayed to the occupancy after every step.                                                                   |
| Domain           | `packages/domain/src/shared-racks.ts`                                                     | Views, zod schemas, the permission matrix and lifecycle rules as pure functions, the event vocabulary, a replay of a history.                                                   |
| Server           | `apps/web/src/server/shared-racks/` (`types`, `repository`, `service`)                    | One database function per repository method, as the signed-in person; the service turns answers into views and refusals.                                                        |
| Routes           | `apps/web/src/app/api/v1/shared-racks/**` (16 route files, 23 handlers)                   | §3.                                                                                                                                                                             |
| Gate             | `apps/web/src/lib/shared-racks-gate.ts`, `getSharedRacksAccess()` in `server/env.ts`      | `CELLR_SHARED_RACKS=1`, `next dev` and Vercel previews only; writes only to a database known not to be production. No production clause.                                        |
| End to end       | `apps/web/e2e/shared-racks-api.spec.ts` (core suite)                                      | Through the app to the real PostgREST and Postgres of the local stack.                                                                                                          |

Shared files touched, each only by adding: `packages/domain/src/index.ts` (one export), `apps/web/src/server/env.ts`
(one function), `apps/web/src/server/services.ts` (one service), `apps/web/src/lib/known-messages.ts` and
`apps/web/messages/{en,nl}.json` (23 keys `errors.known.sharedRack*`: the test of that file requires every sentence
the server can send to be there), `apps/web/playwright.config.ts` (one setting on two test servers),
`package.json` (one script), `.github/workflows/ci.yml` (one step), `database.types.ts` (generated), the architecture
register and inventory, `docs/MIGRATIONS.md` and `docs/BACKUP-RECOVERY.md` (one row each).

## 2. The model in short

- A shared rack is its own entity; members are **people**, not households; roles `owner` | `member`.
- A bottle in it stays a `public.bottles` row of its owner's household with no private place. Where it stands is one
  row of `private.shared_rack_placements`: unique per whole spot `(rack, row, col, index)` and per bottle.
- Owner in the rack = the member who placed it (`auth.uid()`), who must be in the bottle's household. Never an
  argument; a trigger refuses any change of a placement's owner, bottle or rack.
- Every change writes `private.shared_rack_events` (append-only: no privilege for anyone, and a trigger that refuses
  update, delete and truncate; account deletion clears the reference, the name stays).
- The owner's private flows (a private place, opened, gifted, removed, deleted) end the placement in the same
  transaction, attributed. Taking a bottle out through the rack never touches the bottle's record.
- Locks: every write takes the rack row `FOR NO KEY UPDATE`, then the caller's member row `FOR SHARE` requiring
  `active`. All writes to one rack are serial; a removal and a change cannot interleave.

## 3. The API contract

Base `/api/v1`. All routes need a session (401 otherwise) and the usual same-origin rule for cookie sessions.
**Gate closed: 404 on every route. Open without writes: every changing route 403.** Errors are the usual body
`{ error: { code, message, retryable } }`. `spot` is `{ row, col, index }` (index defaults to 1). Ids are UUIDs; a
path id that is not one is 404.

| Method and path                                        | Body / query                                         | Success                                                              | Refusals (besides 404 for a rack the caller is not in)                                                                                                                                                                   |
| ------------------------------------------------------ | ---------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /shared-racks`                                    | `?archived=1`                                        | 200 `{ version, writes, depthPlacement, racks: SharedRackView[] }`   |                                                                                                                                                                                                                          |
| `POST /shared-racks`                                   | `{ name, structure, appearance }`                    | 201 `SharedRackView`                                                 | 422 not in the catalogue, zones; 409 depth off, too many racks; 429                                                                                                                                                      |
| `GET /shared-racks/:id`                                |                                                      | 200 `SharedRackView`                                                 |                                                                                                                                                                                                                          |
| `PATCH /shared-racks/:id`                              | `{ name }`                                           | 200 `SharedRackView`                                                 | 403 not an owner; 409 archived; 422                                                                                                                                                                                      |
| `DELETE /shared-racks/:id`                             |                                                      | 200 `SharedRackView` (archived; never deleted)                       | 403                                                                                                                                                                                                                      |
| `POST /shared-racks/:id/restore`                       |                                                      | 200 `SharedRackView`                                                 | 403                                                                                                                                                                                                                      |
| `PUT /shared-racks/:id/layout`                         | `{ structure, appearance }`, `If-Match: "rev"`       | 200 `SharedRackView`                                                 | 403; 422; 409 stale revision, a bottle would lose its spot, depth off, archived                                                                                                                                          |
| `GET /shared-racks/:id/members`                        |                                                      | 200 `{ members: SharedRackMemberView[] }`                            |                                                                                                                                                                                                                          |
| `PATCH /shared-racks/:id/members/:userId`              | `{ role: "owner" \| "member" }`                      | 200 `{ userId, role }`                                               | 403; 404 not a member; 409 last owner                                                                                                                                                                                    |
| `DELETE /shared-racks/:id/members/:userId`             |                                                      | 204                                                                  | 403; 404 not a member; 422 yourself (use leave)                                                                                                                                                                          |
| `POST /shared-racks/:id/leave`                         |                                                      | 204                                                                  | 409 last owner                                                                                                                                                                                                           |
| `GET /shared-racks/:id/invitations`                    |                                                      | 200 `{ invitations: SharedRackInvitationView[] }`                    | 403 not an owner                                                                                                                                                                                                         |
| `POST /shared-racks/:id/invitations`                   | `{ userId }`                                         | 201 `{ invitationId, outcome: "invited" \| "already_invited" }`      | 403; 422 yourself; 404 nobody by that id; 409 already a member, declined in the last 7 days (this rack, or this inviter for any rack), three open invitations to that person already, full, too many open, archived; 429 |
| `GET /shared-racks/invitations`                        |                                                      | 200 `{ invitations: MySharedRackInvitationView[] }` (mine, open)     |                                                                                                                                                                                                                          |
| `POST /shared-racks/invitations/:id`                   | `{ accept }`                                         | 200 `{ outcome: "accepted" \| "declined", rackId }`                  | 404 not mine; 409 expired, cancelled, declined, full, in 20 racks already, rack archived, declining what was accepted                                                                                                    |
| `DELETE /shared-racks/invitations/:id`                 |                                                      | 204 (an owner cancels)                                               | 404 not in that rack; 403 not an owner; 409 no longer open                                                                                                                                                               |
| `GET /shared-racks/:id/bottles`                        | `?owner=<userId>`                                    | 200 `{ rack, bottles: SharedRackBottleView[] }`                      | 422 owner not an id                                                                                                                                                                                                      |
| `POST /shared-racks/:id/bottles`                       | `{ bottleId, to: spot }` (strict)                    | 201 `{ placementId, outcome: "placed" \| "already_there", to }`      | 404 not my bottle; 422 unknown field, not a spot of the rack; 409 taken (retryable), not in the cellar, already in a rack, archived                                                                                      |
| `POST /shared-racks/:id/bottles/:placementId/move`     | `{ from: spot, to: spot }` (strict)                  | 200 `{ placementId, outcome: "moved" \| "already_there", from, to }` | 409 stale, gone, taken (retryable), archived; 422 not a spot of the rack                                                                                                                                                 |
| `POST /shared-racks/:id/bottles/:placementId/take-out` | `{ from: spot }` (strict)                            | 200 `{ placementId, outcome: "taken_out" }`                          | 409 stale, gone                                                                                                                                                                                                          |
| `GET /shared-racks/:id/events`                         | `?before&limit(1..100)&owner&actor&placement&bottle` | 200 `{ events: SharedRackEventView[], nextBefore }` newest first     | 422 a bad query. `bottle` answers only for a bottle of my own household                                                                                                                                                  |
| `GET /shared-racks/bottles`                            |                                                      | 200 `{ bottles: MySharedRackBottleView[] }` (my households' bottles) |                                                                                                                                                                                                                          |
| `DELETE /shared-racks/bottles/:bottleId`               |                                                      | 204 (the owner's side: withdraw, with or without access to the rack) | 404 not my bottle; 409 not in a rack                                                                                                                                                                                     |

Finding someone to invite is the existing `GET /api/v1/friends/search?q=<@name or friend code>` (exact match, rate
limited); its `person.userId` goes into `POST …/invitations`. Being friends is not needed.

The types are in `packages/domain/src/shared-racks.ts`. For the UI and the 3D view:

- `SharedRackView` has the fields of a place (`kind`, `templateId`, `rows`, `cols`, `cellCapacity`, `slotSemantics`,
  `appearance`, `indexMeaning`, `arrangementKnown`, `fallbacks`, `revision`) plus `role`, `archived`, counts and
  `permissions` (`sharedRackPermissions`). `resolveSharedRack(view)` gives the `ResolvedStorage` the existing renderer
  draws from.
- `SharedRackBottleView`: `placementId` (the handle for every member), `bottleId` (**only** for the bottle's own
  household, else null), `row`/`col`/`index`, `owner { userId, name, isMember }`, `mine`, `placedBy`, `placedAt`,
  `movedAt`, `producer`, `wineName`, `year`, `type`, `region`, `countryCode`, `formatMl`. No photo (`image`): the
  label is drawn from the names.
- `SharedRackEventView`: `seq`, `type`, `occurredAt`, `actor`, `owner`, `subject`, `placementId`, `bottleId` (own
  bottles only), `wine` snapshot, `from`, `to`, `detail`.
- A database without migration 0052 answers every route 404 with "Shared racks aren't set up on this server yet."

## 4. Database functions and who may call them

Every function is `SECURITY DEFINER`, `search_path = ''`, executable by `authenticated` only (not `anon`, not
`service_role`), and takes the person from `auth.uid()`.

| Function                                                                                 | Authorisation                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared_racks(p_rack, p_include_archived)`                                               | rows only for racks the caller is an active member of                                                                                                                                              |
| `shared_rack_members(p_rack)`                                                            | active member                                                                                                                                                                                      |
| `shared_rack_bottles(p_rack, p_owner)`                                                   | active member; only bottles with a placement in this rack; named columns only                                                                                                                      |
| `shared_rack_events(p_rack, p_before, p_limit, p_owner, p_actor, p_placement, p_bottle)` | active member; `bottle_id` only on the caller's own bottles; `p_bottle` filters only for a bottle of the caller's own household                                                                    |
| `shared_rack_invitations(p_rack)`                                                        | active **owner**                                                                                                                                                                                   |
| `my_shared_rack_invitations()`                                                           | the invited person; open, not expired, rack not archived                                                                                                                                           |
| `my_shared_rack_bottles()`                                                               | bottles of the caller's households; rack and spot only while an active member                                                                                                                      |
| `shared_rack_create(…)`                                                                  | any signed-in person; 10 per hour, 20 racks per person                                                                                                                                             |
| `shared_rack_rename`, `shared_rack_save_layout`, `shared_rack_set_archived`              | active owner (member: `forbidden`; anyone else: `not_found`)                                                                                                                                       |
| `shared_rack_invite(p_rack, p_user)`                                                     | active owner; 30 per hour; caps on members and open invitations; a week of quiet after a decline (per rack, and per inviter over all racks); at most 3 open invitations from one person to another |
| `shared_rack_respond_invitation(p_invitation, p_accept)`                                 | only the invited person, only while pending (and, to accept: not expired, the rack not full, the person in fewer than 20 racks)                                                                    |
| `shared_rack_cancel_invitation(p_invitation)`                                            | active owner of that invitation's rack                                                                                                                                                             |
| `shared_rack_set_member_role`, `shared_rack_remove_member`                               | active owner; never leaves a rack without an owner; removing oneself is refused                                                                                                                    |
| `shared_rack_leave(p_rack)`                                                              | active member; the last owner is refused                                                                                                                                                           |
| `shared_rack_place(p_rack, p_bottle, p_row, p_col, p_index)`                             | active member **and** member of the bottle's household; the owner is the caller                                                                                                                    |
| `shared_rack_move(…)`, `shared_rack_take_out(…)`                                         | active member; any bottle of the rack; conditional on the spot the caller saw                                                                                                                      |
| `shared_rack_withdraw_bottle(p_bottle)`                                                  | member of the bottle's household; rack membership not needed; named as actor only when in the rack                                                                                                 |

Every write except `create` and `invite` (which have their own budgets) spends from a budget of 1200 writes per
person per hour (`shared_rack_write`).

## 5. Test results

Run on this branch on 2026-11-24, against throwaway databases and the local stack only.

| What                                                                                               | Result                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bash scripts/db-test.sh` (all migrations, the whole permission suite)                             | 1911 passed, 0 failed, 0 errors; of these `99_shared_racks.test.sql` 190, the independent `99_shared_racks_redteam.test.sql` 40 and `00_hygiene.test.sql` 21                                         |
| `bash scripts/db-shared-racks-concurrency.sh`                                                      | passed (after the review fixes too); it now also holds a rack call open over a bottle that is opened at home: the opening waited about 0.6 s and went through, the history in order                  |
| `bash scripts/db-placement-concurrency.sh`, `bash scripts/db-smart-cellar-upgrade.sh`              | passed: the existing placement races and the upgrade rehearsal are unchanged by the new triggers                                                                                                     |
| `bash scripts/db-shared-racks-roundtrip.sh`                                                        | 65 constraints and indexes of the shared-rack tables read the same after `pg_dump` and a restore (CI's backup rehearsal had found one that did not: the name check, written with BETWEEN; rewritten) |
| `pnpm db:types:check`                                                                              | `database.types.ts is up to date`                                                                                                                                                                    |
| `bash scripts/check-migration-immutability.sh 71aa349`                                             | OK (1 new migration file, none on the base changed)                                                                                                                                                  |
| `pnpm --filter @cellr/domain test`                                                                 | 74 files, 1527 tests passed (`shared-racks.test.ts`: 24)                                                                                                                                             |
| `pnpm --filter @cellr/web test`                                                                    | 114 files passed, 2 skipped; 1669 tests passed, 13 skipped (gate 7, repository 19, service 34, register 27)                                                                                          |
| `pnpm format:check`, `pnpm lint`, `pnpm typecheck`                                                 | clean (lint: one warning in `playwright.webkit.config.ts`, a file this work does not touch)                                                                                                          |
| `pnpm --filter @cellr/web e2e shared-racks-api --project=desktop --trace off` (after `pnpm build`) | 12 passed (19.0 s)                                                                                                                                                                                   |
| `node apps/web/scripts/e2e-suites-check.mjs`                                                       | 1410 tests = 350 (3d) + 1060 (core), none in both; the new spec is in the core suite                                                                                                                 |
| `pnpm architecture:inventory -- --check`, `vitest run src/server/system`                           | up to date; 27 passed                                                                                                                                                                                |

Not run here: the whole end-to-end suite (only the new spec), the restore rehearsal (needs Docker), anything
against a hosted database.

In one parallel run of `pnpm test`, while a build and the database scripts were running on the same four cores, one
existing test (`packages/domain/src/storage-compat.test.ts`, "every kind and every size the database allows") ran
into its 5 s limit. Run on its own the package passes, as above. It is not a test of this work.

The numbers above are from 2026-11-24 after the review fixes of ADR-010 §14, run on the foundation branch. The API
end-to-end spec was run again on the branch of the screens, which contains this branch whole.

## 6. What a real concurrency test found

`scripts/db-shared-racks-concurrency.sh` found a deadlock in the first design: the rack lock was `FOR UPDATE`, and a
line of history written from an owner's own cellar (opening a bottle) takes `FOR KEY SHARE` on the rack row through
the foreign key of `shared_rack_events.rack_id`. A move held the rack and waited for the placement; the opening held
the placement and waited for the rack. The rack lock is now `FOR NO KEY UPDATE`, which is exactly what lets a key
share through; the script ran clean three times in a row afterwards and is a step of CI's `database` job.

## 7. Known gaps and risks

1. **No screens**, no push notices, no swap of two bottles in one step, no temperature zones for a shared rack, no
   label photos across households (the 3D label is drawn from the names).
2. **Depth**: the whole-spot key and the shared depth switch are in place and tested with the switch turned on inside
   a rolled-back transaction, but the service refuses any index above 1 while `DEPTH_PLACEMENT_ENABLED` is false, and
   for a rack more than one deep it relies on `placementProblem` with the occupants read just before (the database
   then only checks bounds and uniqueness, not "behind a taken front"). When depth is released this needs the same
   care the private cellar gets (handoff to the depth workstream).
3. **Account deletion racing a write that names the same person** can deadlock (the deletion holds the account row
   and wants the member or rack row; the write holds those and needs a key share on the account row). Postgres ends
   one of the two after its deadlock timeout; either can be retried; nothing is left half done. Not reproduced in a
   test.
4. **The last owner deleting their account archives the rack** (built, tested at database level). The account screen
   does not warn about it; `server/account/service.ts` was not changed. Open decision 2 of the ADR.
5. **A person who leaves the household that holds their bottle** stays named as the owner of the placement; the
   household's remaining members can still end it from their cellar, and any rack member can record taking it out.
6. **Export (review N3), not changed, on purpose for now.** A bottle that stands in a shared rack is exported as a
   bottle without a place (its `place` is empty, which is true of the household's own cellar), and the export does
   not add "in shared rack <name>, shelf r, spot c". Why not now: the export (`server/export`,
   `packages/domain/src/export.ts` and `export-v2.ts`) has two versioned, documented formats whose columns are a
   contract with whoever re-imports them; adding a field means a format decision (a new column in version 2, or a
   version 3) that belongs with that module, and the fact itself is available to the owner today through
   `GET /api/v1/shared-racks/bottles` (own bottles only: rack name and spot while a member). What a later change
   needs: one optional column `sharedRack` on the owner's own bottle rows, filled from `my_shared_rack_bottles()`;
   nothing cross-household. Rack history is not part of a personal export. Nothing of another household can leak
   into an export (it reads household tables under the unchanged policies).
7. **A household co-member who is not in the rack** and changes the bottle at home is NOT named in the rack's
   history (review S1, fixed): the line has no actor and says it was done by the owner's household.
8. **History visibility**: a member sees the whole history of the rack, also from before they joined.
9. **`shared_rack_events` grows for ever** by design; the write budget bounds it per person. No retention job.
10. **A database without the migration** is answered "not set up" by code that is unit-tested; it was not exercised
    end to end (that needs the functions hidden from PostgREST while other specs run).
11. **The restore rehearsal** (`scripts/db-backup/rehearse-restore.sh`, needs Docker) was not run here; it runs in CI.
    The fingerprint of a restored database includes the new objects automatically.

## 8. Release, activation and rollback

1. **Merge** changes nothing for anyone: the gate is closed everywhere but `next dev` and previews, and only where
   `CELLR_SHARED_RACKS=1` is set.
2. **The migration** is applied only by `docs/MIGRATIONS.md` §2, on the owner's decision. It is additive; on a
   database with data it adds empty tables and two triggers that return at once for every existing bottle. Until it
   is applied, an open deployment answers "not set up".
3. **A preview** that should use it: `CELLR_SHARED_RACKS=1` and a database that has the migration and is declared as
   the test database (`CELLR_SMART_CELLAR_WRITE_DATABASE`, the existing rule). A preview on the production database
   never writes.
4. **Production** is not authorised and cannot be opened by configuration. Opening it is a reviewed change of
   `lib/shared-racks-gate.ts` (an explicit release clause) plus the migration, both by owner decision.
5. **Rollback** is unsetting `CELLR_SHARED_RACKS`: every route is 404 again and the data stays. The private flows
   keep ending placements correctly while the gate is closed (that is the database's work, not the API's).

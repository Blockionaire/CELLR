# Smart Cellar 3D — sprint 1C: API integration and backward compatibility

2026-11-15. The Smart Cellar database foundation (1B) and domain models (1A) made reachable through the server:
places and their bottles in the new terms with the whole slot identity, layouts and zones saved in one transaction,
export version 2, and the old API kept exactly as it was, with one guard where it could otherwise make a templated
place disagree with its template.

**Nothing was merged, deployed, migrated or switched on, and nothing connected to production.** No migration was
written: the sprint uses 0043-0045 as merged. The new API is closed unless `CELLR_SMART_CELLAR` opens it; writes
never open on a production deployment, whatever is set; depth placement stays off in the app and in the database;
the legacy unique index stays.

Read with: [`ADR-005`](./ADR-005-smart-cellar-api.md) (the decisions and the contracts), [`ADR-001`](./ADR-001-templates-and-slot-identity.md)
(what an index means), the 1B report (the database), [`ADR-002`](./ADR-002-layout-driven-renderer.md) (the view).

## 1. Audit: what exists and which conventions were followed

Read before anything was written: `server/cellar/{types,repository,service}.ts`, `server/services.ts`,
`app/api/v1/{storage,racks,bottles,export,friends}`, `server/export/*`, `server/friends/*`, `server/http.ts`,
`server/db/errors.ts`, `server/env.ts`, `lib/cellar-gallery-gate.ts`, packages/domain `storage-{compat,config,
layout,templates}.ts` and `export.ts`, migrations 0004 (places, RLS), 0015 (friends), 0043-0045, the gated
migration, the SQL suite for 0043-0045, the e2e helpers and the local stack, ADR-001 to ADR-004.

| Convention found                                                                                                                                                             | Used as                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `authed()` wraps every route: origin check (CSRF; bearer exempt), session or bearer → `RequestContext`, `DomainError` → status and `{ error: { code, message, retryable } }` | Every new route uses it; nothing new in the HTTP layer                     |
| `readJson(request, schema)`: size limit, JSON only, zod → 422                                                                                                                | The layout PUT reads `StorageConfigSchema` (strict)                        |
| `uuidParam`: a malformed id is 404, never a validation hint                                                                                                                  | All `:id` routes                                                           |
| Composition root `servicesFor(ctx)`: services from repositories running AS the user (`ctx.db`, RLS applies)                                                                  | `smartCellar` service, its repository on `ctx.db`; no service role         |
| The active household: `getActiveHousehold(userId)`, else "Create or join a household first." (404)                                                                           | The same `household()`                                                     |
| Paging: `allRows` (the data API cuts at 1000 rows)                                                                                                                           | Occupancy and placements                                                   |
| A database step not taken yet: `isMissingTable`, `missingColumn`, a kind message, never a crash                                                                              | `isSchemaMissing` adds PGRST202 (function); only these codes               |
| Feature switches: server-only env, parsed fail-closed (`parseFeatures`); stricter gate for unreleased work (`cellarGalleryOpenIn`)                                           | `CELLR_SMART_CELLAR` with the gallery gate's environment rule for writes   |
| API versioning: `/api/v1`, additive changes, new routes for new representations                                                                                              | `/api/v1/smart-cellar/*` and `export?version=2`; no response shape changed |
| Every server sentence translated (`lib/known-messages.ts`, `messages/{en,nl}.json`, enforced by a test)                                                                      | Eight new sentences, both languages                                        |

What the database offers (0043-0045) and how it is used: `save_storage_layout` (SECURITY INVOKER; locks the place
`for no key update`, replaces kind/template/semantics/size/capacity/appearance and, when `p_zones` is not null, the
zones; answers `saved | not_found | in_use | semantics_change | invalid_zones | depth_not_enabled`; anything else is
an error and changes nothing) is the only write. `swap_bottles_v2` is not exposed (no movement in this sprint).
Members and owners may update places (RLS `locations_update`), so both may save layouts; only owners delete.

## 2. Architecture and API design

```
app/api/v1/smart-cellar/**            authed · uuidParam · readJson(StorageConfigSchema)
        │
server/smart-cellar/service.ts        switch (404 / 403) · household · resolve via the domain · layoutChangeProblem
        │                             · one RPC per write · refusals → DomainError
server/smart-cellar/repository.ts     AS the user: cellar_locations, cellar_location_zones, bottles (+ loc_index),
        │                             rpc save_storage_layout · isSchemaMissing · mapSmartCellarError
packages/domain                       resolveStorage (unchanged) · smart-cellar.ts (views, indexMeaningOf,
                                      layoutChangeProblem, legacyEditProblem) · export-v2.ts
```

The contracts are in ADR-005 §1. In short:

| Route                                              | Closed                   | `read`                        | `write` (preview / `next dev`) |
| -------------------------------------------------- | ------------------------ | ----------------------------- | ------------------------------ |
| `GET /api/v1/smart-cellar`                         | 404                      | capabilities, `writes: false` | capabilities, `writes: true`   |
| `GET /api/v1/smart-cellar/storage[/:id[/bottles]]` | 404                      | 200                           | 200                            |
| `PUT /api/v1/smart-cellar/storage/:id/layout`      | 404 (body not looked at) | 403 (body not looked at)      | 200 / 404 / 409 / 422          |
| `GET /api/v1/export`                               | v1                       | v1                            | v1                             |
| `GET /api/v1/export?version=2`                     | 422                      | v2                            | v2                             |

## 3. Exact changed files

| File                                                                                                                                                          | Change                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `packages/domain/src/smart-cellar.ts`                                                                                                                         | **new**: views, `indexMeaningOf`, `layoutChangeProblem`, `legacyEditProblem`, `DEPTH_PLACEMENT_ENABLED`                  |
| `packages/domain/src/smart-cellar.test.ts`                                                                                                                    | **new**: 14 tests                                                                                                        |
| `packages/domain/src/export-v2.ts`                                                                                                                            | **new**: `CellrExportV2`, `EXPORT_V2_VERSION`, `EXPORT_VERSIONS`                                                         |
| `packages/domain/src/index.ts`                                                                                                                                | exports the two new modules                                                                                              |
| `apps/web/src/lib/smart-cellar-gate.ts` (+ `.test.ts`)                                                                                                        | **new**: the switch; 6 tests incl. every combination of other variables                                                  |
| `apps/web/src/server/env.ts`                                                                                                                                  | `getSmartCellarAccess()`                                                                                                 |
| `apps/web/src/server/smart-cellar/{types,repository,service}.ts` (+ `service.test.ts`)                                                                        | **new**: 20 tests                                                                                                        |
| `apps/web/src/server/services.ts`                                                                                                                             | wires `smartCellar`; export gets `smartPlaces` only where reads are on                                                   |
| `apps/web/src/app/api/v1/smart-cellar/route.ts`, `storage/route.ts`, `storage/[id]/route.ts`, `storage/[id]/bottles/route.ts`, `storage/[id]/layout/route.ts` | **new** routes                                                                                                           |
| `apps/web/src/server/cellar/repository.ts` (+ `repository.test.ts`)                                                                                           | the old edit of a place: template guard, tied to the template it checked; 8 new tests                                    |
| `apps/web/src/server/export/{types,repository,service}.ts` (+ `service.test.ts`)                                                                              | version 2 beside version 1 (one read for bottles and indexes); 6 new tests                                               |
| `apps/web/src/app/api/v1/export/route.ts`                                                                                                                     | `?version=2`; other versions 422                                                                                         |
| `apps/web/src/features/cellar/storage3d/from-api.ts` (+ `.test.ts`)                                                                                           | **new**: API views → `ResolvedStorage`, `StoredBottle`; 6 tests                                                          |
| `apps/web/src/lib/known-messages.ts`, `apps/web/messages/{en,nl}.json`                                                                                        | eight new sentences, translated                                                                                          |
| `apps/web/playwright.config.ts`                                                                                                                               | `CELLR_SMART_CELLAR=write` on the 3101 server (an unmarked production build: reads only) and on 3102 (a preview: writes) |
| `apps/web/e2e/smart-cellar-api.spec.ts`                                                                                                                       | **new**: 22 HTTP tests through the real PostgREST                                                                        |
| `supabase/tests/99_smart_cellar_api.test.sql`                                                                                                                 | **new**: friends, members, depth and the legacy index, in SQL                                                            |
| `docs/SETUP.md`                                                                                                                                               | the `CELLR_SMART_CELLAR` setting                                                                                         |
| `docs/sprints/smart-cellar-3d/{README.md, ADR-005-smart-cellar-api.md, SPRINT-1C-REPORT.md}`                                                                  | roadmap, decisions, this report                                                                                          |

Not changed: anything under `supabase/migrations` and `supabase/gated-migrations`, `packages/domain/src/storage-*.ts`
and `export.ts`, every existing route's path and response shape, `server/cellar/service.ts`, `server/friends/*`, the
production 3D view (`features/cellar/three/`), `cellar-3d-view.tsx`, `rack-grid.tsx`, every screen, `package.json`
and the lockfile.

## 4. Read model and adapters

**Database row → domain.** `toStoredPlace` copies `cellar_locations` (`template`, `cell_capacity`, `slot_semantics`,
raw `appearance`) and the zone rows (sorted by `zone_index`, renamed, numeric temperatures read whether PostgREST
sends a number or a string) without interpreting anything. `toPlacement` keeps `loc_index` as stored; a row without
location, row or column is not a placement (the database keeps the three together, so there is none).

**Domain → API.** `toUnitView` = `resolveStorage(everything stored)` + occupancy + `indexMeaningOf`. Every one of
the 14 templates stored as itself reads back known, its own family, no fallbacks, its zones; a place from before
templates reads back legacy, one per cell, `indexMeaning: "single"`, the default look; unknown template, a template
of another kind, a stored meaning that is not the template's, an unreadable look, zones that do not split: each is
returned as stored where it can be (`templateId`, `slotSemantics`, `rows`, `cols`, `cellCapacity`), with
`arrangementKnown: false` where the arrangement cannot be trusted, and listed in `fallbacks`. Capacity and occupancy
are from what is stored (rule 1 of storage-compat: never narrowed).

**API → the new view.** `resolvedFromView` reads the view with the same `resolveStorage` and keeps the server's
`fallbacks`; `storedBottlesFrom` gives `StoredBottle`s with the index as stored. Tested: every template comes back
as itself, an unknown arrangement gets the neutral picture, a bottle at an index the place does not have is reported
as stranded (not dropped), and two deep with a known arrangement draws the back bottle behind the front one.

Full slot identity, in tests at every layer: index 1 for every bottle from before depth; index 2 and 16 kept (unit);
a real bottle at index 2 (made by the database owner in one transaction, the switch on only inside it) read back as
index 2 through the API, kept by export version 2, still listed by the old `/racks` in its place, and refused by the
old swap ('stale', 409) because that swap cannot vouch for an index (browser test against the real database).

## 5. The atomic layout update

`PUT …/layout` → `guardWrites` (before the body is read) → `StorageConfigSchema` (strict: template known, size and
capacity inside it, total inside it, zones split the shelves and are its kind's, look of version 1 that the template
offers, temperature 3-22 °C in half degrees, purpose storage/serving; `kind` and `semantics` cannot be sent) →
household → the place → its occupied spots → `layoutChangeProblem` (depth off; no bottle may lose its spot; no change
of meaning under bottles in a place more than one deep) → ONE `save_storage_layout` call with the template's own
kind and meaning → its answer mapped (`in_use`, `semantics_change`, `depth_not_enabled` 409; `invalid_zones` 422;
`not_found` 404) → the saved place read back.

Proven against the real database: a database error after the place was already updated inside the function (a test
trigger failing the zone insert, for that place only) leaves the place exactly as it was, `updated_at` included;
three rounds of two saves at once always end as one of the two layouts with its own zones, never a mix; a save
during a held lock on the place waits and then succeeds, while a direct zone write by the same person through
PostgREST in that moment is refused at once with `zone_place_busy` (55P03), the database's deadlock guard; a refused
save of any kind leaves the row and its zones unchanged.

## 6. Backward compatibility guarantees

| What                                                                        | Guarantee                                                                                                                                                                                                                                                                     | Evidence                                                                                            |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `/api/v1/storage` GET/POST/PATCH/DELETE, `/api/v1/racks`, `/api/v1/bottles` | Same paths, same request and response shapes; no field added or removed                                                                                                                                                                                                       | browser tests: key sets pinned, on the closed and the open server                                   |
| A place with `template = NULL`, `cell_capacity = 1`                         | Edited exactly as before: any kind, any size the database allows; the update only applies while it still has no template                                                                                                                                                      | repository tests; browser test (to 30 × 30 and another kind)                                        |
| A place with a template, through the old edit                               | Rename: always. Kind: only its template's (else 409). Size: within the template (else 422). Unknown template: rename only (409). Zones: the database refuses a change of shelves they do not split (422). Tied to the template that was checked (409 retryable if it changed) | repository tests (8); browser test on both servers; mutation check (guard removed → test fails)     |
| Placing and moving without an index (every client of today)                 | Index 1, the database's rule; a move into a templated place works                                                                                                                                                                                                             | browser test                                                                                        |
| Two-coordinate swaps                                                        | Unchanged for every bottle at index 1; a bottle at index > 1 is never swapped by it (stale, 409)                                                                                                                                                                              | browser tests                                                                                       |
| Capacity                                                                    | Old API: `rows × cols` as always; new API: `rows × cols × cellCapacity`, both from what is stored                                                                                                                                                                             | browser test: equal for every place from before templates                                           |
| Export version 1                                                            | Same keys, same order, same query; the default; identical on every server                                                                                                                                                                                                     | unit tests (key order pinned); browser test (closed vs open server, byte-equal apart from the time) |
| Friends                                                                     | `friend_racks` / `friend_cellar` unchanged; nothing of template, look, zones or temperatures                                                                                                                                                                                  | SQL test (exact keys); browser test                                                                 |
| A database without 0043-0045                                                | Old API unchanged (the template check is skipped only on "no such column"; any other error stops the edit); new API: 404 "isn't set up", capabilities `schema: "missing"`                                                                                                     | unit tests (fake client); not run against a real old database (see §11)                             |

## 7. Export version 2

`GET /api/v1/export?version=2` (only where the Smart Cellar API reads):

```jsonc
{
  "app": "cellr", "version": 2, "exportedAt": "…", "household": { "name": "…", "currency": "EUR" },
  "places": [{
    "name": "Cooler", "kind": "fridge", "template": "cooler_dual", "arrangement": "known",   // legacy | known | unknown
    "shelves": 8, "positionsPerShelf": 4, "bottlesPerPosition": 1, "capacity": 32,
    "indexMeaning": "single",                                                                // single | depth | ordinal
    "look": { "v": 1, "material": "metal", "color": "graphite", "lighting": "warm", "door": "glass" },
    "zones": [{ "fromShelf": 1, "toShelf": 4, "purpose": "storage", "setToC": 12 }, …],      // set, not measured
    "fallbacks": []
  }],
  "bottles": [{ …every field of version 1…, "index": 1 }],                                    // null without a place
  "tastings": […], "favorites": […], "wishlist": […]                                          // as version 1
}
```

Depth, ordinal and unknown are told apart by `indexMeaning` and `arrangement` together: an index is a physical depth
only where `indexMeaning` is `depth`, which is only ever said for a known arrangement. Tested with a cellar from
before templates, a mixed one (templated cooler with zones, legacy rack, unknown template) and a future one (two deep
with depth, bins with an ordinal 7, an unknown arrangement with index 2), and through the real database.

**Import.** Unchanged (it reads Wijnkelder's files). What an import of version 2 would need, for later: match places
by name (unique per household), create them as legacy places first and then save each layout with the API's one
write (never zone rows directly); place bottles at their index only where `indexMeaning` is `depth` and depth is on
there, otherwise at index 1 of the position or unplaced; refuse `bottlesPerPosition > 1` while depth is off rather
than flatten it; keep `fallbacks` as a warning, not as data; treat `setToC` as a setting.

## 8. Household authorization results

All through the app to the real PostgREST and Postgres, as the person (browser tests), and in SQL as each role:

| Who                                   | Result                                                                                                                                                                                                                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anonymous, and a bad token            | 401 on every Smart Cellar route and on export version 2                                                                                                                                                                                                                                                 |
| Signed in, no household               | 404 "Create or join a household first."                                                                                                                                                                                                                                                                 |
| Owner                                 | reads, saves                                                                                                                                                                                                                                                                                            |
| Member (joined by invite)             | reads, saves (members may edit places; only owners delete them)                                                                                                                                                                                                                                         |
| Another household                     | 404 on the place, its bottles and its layout, the same as an id that does not exist, with nothing of it in the answer; its own list does not contain it; `save_storage_layout` called directly with the victim's household answers `not_found`; the zones table returns nothing; the place is unchanged |
| A friend who may see the whole cellar | the friend view exactly as before (`label, kind, rows, cols, bottles`), with no template, look, zone or temperature anywhere in it; 404 on the Smart Cellar routes for the friend's places; no zone rows readable; no layout writable (SQL)                                                             |
| Service role                          | not used by any of this                                                                                                                                                                                                                                                                                 |

## 9. Database and integration test results

| Check                                                                                                                                                                                                                                            | Result                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`                                                                                                                                                                                                                              | clean                                                                                                                                                                                                                                                                                                                 |
| `pnpm lint`                                                                                                                                                                                                                                      | 0 errors, 1 warning (the one `main` has: an anonymous default export in a config file)                                                                                                                                                                                                                                |
| `pnpm typecheck`                                                                                                                                                                                                                                 | clean                                                                                                                                                                                                                                                                                                                 |
| `pnpm test`                                                                                                                                                                                                                                      | web 1,149 passed, 12 skipped (85 files; 46 new); domain 916 (14 new); catalog-tools 86; scan-eval 83                                                                                                                                                                                                                  |
| `pnpm build`                                                                                                                                                                                                                                     | succeeds                                                                                                                                                                                                                                                                                                              |
| `scripts/check-bundle-secrets.sh`                                                                                                                                                                                                                | no server secrets in the client bundle (89 files)                                                                                                                                                                                                                                                                     |
| `pnpm migrations:check`                                                                                                                                                                                                                          | OK: 0 new migration files, none changed                                                                                                                                                                                                                                                                               |
| `pnpm db:test` (Postgres 16, every migration, the whole permission suite)                                                                                                                                                                        | **1,529 passed, 0 failed, 0 errors**, including the new `99_smart_cellar_api.test.sql`                                                                                                                                                                                                                                |
| `e2e/smart-cellar-api.spec.ts` (through Next.js to the real PostgREST and Postgres of the local stack)                                                                                                                                           | **22 passed, 0 failed**, run twice in a row (44/44); the phone project skips it by design (HTTP only)                                                                                                                                                                                                                 |
| Existing browser suites that touch places, bottles, swaps, export, friends and the gallery: `racks`, `drag-swap`, `cellar.spec`, `account`, `friends`, `rack-fill`, `add-to-spot`, `import`, `storage-gallery`, `three-view` (desktop and phone) | 171 passed, 28 skipped (by project), **1 failed: `racks.spec.ts:371` (light), an accessibility audit of the "place here" dialog finding one element below contrast. Not a regression: on a fresh build of `main` (a076cbb) the same test failed 3 of 6 runs, the same way; on this branch it also passes some runs.** |
| Mutation check                                                                                                                                                                                                                                   | With the production write block removed and with the old edit's template check removed (one build), exactly the two tests that guard them failed; both restored                                                                                                                                                       |

Not run here: the full end-to-end suite (CI runs it nightly and on `main`; on a pull request those jobs are skipped), the real Supabase stack
(`supabase start`; CI runs it on this PR), and a database without migrations 0043-0045 (see §12, limitation 2).

## 10. CI results

<!--CI-->

## 11. Production deployment prerequisites

In this order, each a separate decision of the owner; none was done here:

1. **Migrations 0043-0045 in production.** Their state there is not known in this repository (see `docs/MIGRATIONS.md`,
   the stop notice): schema inventory and migration-history inventory first, then a written decision, then a push.
   The app does not need them to keep working: the old API checks a template only where the column exists, and the
   new API stays closed (and, if opened early, answers "isn't set up here").
2. **Reads.** `CELLR_SMART_CELLAR=read` on Preview first; check `GET /api/v1/smart-cellar` says `schema: "ready"`;
   then, if wanted, on Production. Rollback: unset it (the routes answer 404 again; nothing was written).
3. **Writes.** Not possible on Production by configuration. Opening them is a code change in
   `lib/smart-cellar-gate.ts`, reviewed, after the owner decides; on Preview `write` opens them today. Rollback: the
   setting, or the code change reverted. A layout saved meanwhile stays and is read correctly by both APIs.
4. **Depth.** Off. Switching it on is a migration (`private.cellar_settings`) and, before that, the old reads must
   stop presenting a bottle at an index above 1 as if it were at the front (see §12); the legacy unique index is a
   further, separate decision (`supabase/gated-migrations/`).

Order of deployment: the code of this PR can be deployed before the migrations (nothing changes); the migrations
can be applied before the switch (nothing changes); the switch last. Each step can be undone on its own.

## 12. Known limitations and next steps

Limitations:

1. **No compare-and-set on layouts.** Two saves of one place are serialised and the later one wins, whole; a client
   that saved on top of a layout it had not seen is not told. Needs an expected `updated_at` (or a version) in
   `save_storage_layout`: a migration, for Sprint 3 (the builder).
2. **A database without 0043-0045 was not run.** The capability check and the old edit's fallback are unit-tested
   with a fake client and the error codes PostgREST documents; a real old database was not stood up. Worth one run
   against a restored copy before step 1 above.
3. **The old reads drop the index.** `/racks`, `/inventory` and the bottle views do not select `loc_index`; a bottle
   at index 2 is listed at its (row, col) as if in front. It cannot happen while depth is off. Before depth is
   switched on they must use `toLegacySlot` (index > 1 → no legacy spot) and say so, without losing the bottle.
4. **Export version 2 is not imported.** Requirements in §7.
5. **The friend view does not know depth.** `friend_racks` lists (row, col) only; same condition as 3.

For Sprint 2B.3 (the new view in the app): fetch `GET /api/v1/smart-cellar/storage/:id/bottles`, map with
`resolvedFromView` and `storedBottlesFrom`, mount behind a flag; keep the existing view for `legacy: true` places
(ADR-002); show `fallbacks` and `arrangementKnown: false` honestly; the device validation of 2B.2 first.

For Sprint 4 (depth in daily use), the contracts a movement API will need (documented, not built):

- **Move with an index**: `{ to: { locationId, row, col, index } }`, written in two steps inside one database
  function (out of its place, then onto the new spot with the index named), because `check_bottle_location` refuses
  an index carried over to another cell (`slot_index_ambiguous`). Index required for places whose `indexMeaning` is
  `depth`; for `ordinal`, only the compartment is chosen and the index is the next free counter.
- **Swap with an index**: `swap_bottles_v2` as it is (whole spots expected, `stale` on any difference; `invalid` for
  two counters of one bin).
- **Expected state**: every move names the spot it saw (the whole slot), like the swaps.
- **Old clients**: the two-coordinate move keeps meaning "index 1 of that cell"; a bottle at index > 1 is never moved
  by it (already refused by the database).
- Switching depth on: the switch migration, then the gated index drop, each after an owner decision.

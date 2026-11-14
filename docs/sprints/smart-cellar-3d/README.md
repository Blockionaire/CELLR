# Smart Cellar 3D

More kinds of places for bottles (racks, cubes, diamond bins, crates, wall pegs and rails, coolers with zones), a look
that can be chosen, depth, and later advice on where a bottle should go. Built in sprints; each one ships switched
off and leaves every existing place and bottle as it is.

## Where it stands

| Sprint                           | Status                           | What it is                                                                                                                        |
| -------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 0 — audit and architecture       | done (2026-11-14, no files)      | What exists, what to reuse, the plan.                                                                                             |
| 1A — domain foundation           | done, merged (PR #69)            | Template catalogue, logical layout engine, configuration schemas, adapter for what exists.                                        |
| 1B — database foundation         | done, merged (PR #70)            | Columns, limits, the whole-spot index, bounds and resize under a lock, zones, the swap and save functions. Depth is switched off. |
| 1C — API                         | not started                      | The server reads and writes the new columns; a move for back bottles; export v2; what friends see.                                |
| **2A — template renderer**       | **done (2026-11-14), in review** | A second 3D view that draws all 14 templates from a layout, a read-only flat picture, a closed gallery. In no product screen.     |
| 2B — renderer into the app       | not started                      | The showcase in the new view, parity and speed on real devices, then the cellar screens read a layout behind a flag.              |
| 3 — builder                      | not started                      | Choosing a template, sizing it, the look, a live preview.                                                                         |
| 4 — depth and zones in daily use | not started                      | Placing, moving and swapping with an index; zones on screen.                                                                      |
| 5 — placement advice             | not started                      | A deterministic, explained suggestion for where a bottle goes.                                                                    |

## Documents

- [`ADR-001-templates-and-slot-identity.md`](./ADR-001-templates-and-slot-identity.md): the decisions of sprint 1A.
  Read this first.
- [`SPRINT-1B-DATABASE-REQUIREMENTS.md`](./SPRINT-1B-DATABASE-REQUIREMENTS.md): why the database enforces what it
  enforces, with the corrections made while building it.
- [`SPRINT-1B-REPORT.md`](./SPRINT-1B-REPORT.md): what sprint 1B built, the migrations, the guarantees, what old
  clients get, the test results, and what is not known about production.
- [`ADR-002-layout-driven-renderer.md`](./ADR-002-layout-driven-renderer.md): the decisions of sprint 2A: a second
  3D view beside the existing one, and how it is put together.
- [`SPRINT-2A-REPORT.md`](./SPRINT-2A-REPORT.md): what sprint 2A built, how to open the gallery, the pictures, the
  measurements and what they do not say, and what is left for 2B.
- [`experiments/index-named-trigger.sql`](./experiments/index-named-trigger.sql): the design that was tested and NOT
  built, and why.

## What sprint 1A added (code)

All in `packages/domain/src`, pure TypeScript, exported from `@cellr/domain`:

| File                   | What                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- |
| `storage-templates.ts` | The 14 templates, the vocabulary (families, slot semantics, materials, colours, lighting, doors), the limits. |
| `storage-layout.ts`    | Spots `(row, col, index)`, layouts as lists of cells, validity, occupancy, the next free spots.               |
| `storage-config.ts`    | Strict schemas for structure, zones and appearance; defaults; reading a stored appearance safely.             |
| `storage-compat.ts`    | Today's places and spots in the new terms (`resolveStorage`, legacy slot conversion).                         |

Outside the domain package only: the new check sentences are registered and translated (`known-messages.ts`,
`messages/en.json`, `messages/nl.json`), and `three/legacy-parity.test.ts` pins where the 3D view draws a bottle.

Nothing in the app calls these modules yet.

## What sprint 1B added (database)

| File                                                                         | What                                                                                                                                  |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/20261120000043` to `20261122000045`                     | Three additive migrations. See the report, §1.                                                                                        |
| `supabase/gated-migrations/`                                                 | The one destructive statement (dropping the old unique index). **Not a migration, cannot be pushed, not authorised.**                 |
| `supabase/tests/99_smart_cellar_{as_deployed,structure,zones,rpcs}.test.sql` | 186 tests, run by `pnpm db:test` and by CI on plain Postgres and on a real Supabase stack. `as_deployed` is also the gate's tripwire. |
| `scripts/db-placement-concurrency.sh` (`pnpm db:test:placement`)             | Placement, resizing, zones and swaps from many sessions at once.                                                                      |
| `scripts/db-smart-cellar-upgrade.sh` (`pnpm db:test:upgrade`)                | The migrations on a database that already holds a cellar: no row is touched.                                                          |
| `scripts/real-stack-smoke.mjs` (extended)                                    | The same rules through PostgREST itself.                                                                                              |

Outside the database: `database.types.ts` regenerated; `server/db/errors.ts` words the four new refusals;
`storage-compat.ts` reads the stored `slot_semantics`. **Not changed:** every service, repository and route, the 3D
view, the racks view, `placement.ts`, the storage schemas in `cellar.ts`.

**More than one bottle per cell is switched off in the database** (`private.cellar_settings`) until the API and the
screens exist. Switching it on is a migration of its own.

## What sprint 2A added (renderer and gallery)

All in `apps/web`. Nothing under `supabase/`, `packages/domain`, `src/server` or `src/app/api` changed.

| File                                                     | What                                                                                                     |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `src/features/cellar/storage3d/parts.ts`, `families.ts`  | A place as plain numbers: parts and poses for the grid, bins and wall families, and the neutral picture. |
| `…/storage3d/palette.ts`                                 | What the catalogue's named looks are, as surfaces.                                                       |
| `…/storage3d/model.ts`                                   | Which renderer a place gets, where each bottle goes, camera framing, the levels of detail.               |
| `…/storage3d/resources.ts`                               | The three.js side: merged furniture, the shared bottle kit, ownership and release.                       |
| `…/storage3d/template-scene.tsx`                         | The React Three Fiber scene. Refuses a place from before templates.                                      |
| `…/storage3d/layout-cells.ts`, `layout-map.tsx`          | The read-only flat picture, as data and as a component.                                                  |
| `…/storage3d/fixtures.ts`                                | Made-up places and bottles for the gallery and the tests.                                                |
| `src/features/design/cellar-gallery*.ts(x)`              | The gallery and its state (what the address may ask for).                                                |
| `src/app/design/cellar-3d/page.tsx`                      | The route. 404 unless development or `DESIGN_GALLERY=1`.                                                 |
| `e2e/storage-gallery.spec.ts`                            | The gallery in a browser: 28 tests on a desktop and a phone profile.                                     |
| `e2e/visual-storage3d.spec.ts`, `perf-storage3d.spec.ts` | The photographer and the measuring bench (run only when asked for).                                      |

**Not changed:** `three/scene.tsx` and everything else in `three/`, `rack-grid.tsx`, `cellar-3d-view.tsx`, placing,
swapping and dragging, every service and route, the database. **No product screen mounts the new view.**

## Rules for whoever continues

1. A released template id never changes kind, family or slot semantics (pinned in `storage-templates.test.ts`).
2. A spot without an index is index 1. An index in a bin is a counter, not a place: never show it as one.
3. A temperature on a zone is a setting. No measured value is stored with a zone.
4. Reading never throws and never reads a bottle's spot away; writing refuses what it does not know.
5. While a place has no template it is drawn exactly as today (`legacy-parity.test.ts` is the gate).
   A place whose template is unknown, belongs to another kind, or does not describe that many bottles per cell
   is not drawn as any template's furniture (`arrangementKnown` is false): cells and counts only.
6. A feature flag hides a screen. It does not protect data: constraints, triggers and RLS do.
7. A bottle is never put on an index its writer did not name. Where the database cannot tell what was meant it
   refuses (`slot_index_ambiguous`); do not replace that with a guess.
8. The old unique index `bottles_slot_unique` stays until the owner says otherwise. Nothing in
   `supabase/gated-migrations/` is ever run by hand or moved into `supabase/migrations` without that.
9. The order of locks is: the place, then its zones (and bottles before places only for reading). Code that holds a
   zone row and needs the place must not wait for it.
10. The new 3D view never draws a place from before templates, and the existing view is not replaced until parity
    and speed are shown on real devices (ADR-002). An index in a pile is drawn as "one more bottle in the pile",
    never as a place in it.
11. No migration is run against production from here. `docs/MIGRATIONS.md` describes 36 migrations and `main` has
    more: see the 1B report, §8, before anything is pushed.

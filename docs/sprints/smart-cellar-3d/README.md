# Smart Cellar 3D

More kinds of places for bottles (racks, cubes, diamond bins, crates, wall pegs and rails, coolers with zones), a look
that can be chosen, depth, and later advice on where a bottle should go. Built in sprints; each one ships switched
off and leaves every existing place and bottle as it is.

## Where it stands

| Sprint                                         | Status                           | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 — audit and architecture                     | done (2026-11-14, no files)      | What exists, what to reuse, the plan.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 1A — domain foundation                         | done, merged (PR #69)            | Template catalogue, logical layout engine, configuration schemas, adapter for what exists.                                                                                                                                                                                                                                                                                                                                                                          |
| 1B — database foundation                       | done, merged (PR #70)            | Columns, limits, the whole-spot index, bounds and resize under a lock, zones, the swap and save functions. Depth is switched off.                                                                                                                                                                                                                                                                                                                                   |
| 1C — API                                       | done, merged (PR #74)            | The Smart Cellar API next to the old one: places and bottles in the new terms (full slot identity), layout and zones saved in one transaction, export version 2, the old edit kept consistent with templates. Switched per deployment; never writing on production; depth stays off. No migration.                                                                                                                                                                  |
| 2A — template renderer                         | done, merged (PR #71)            | A second 3D view that draws all 14 templates from a layout, a read-only flat picture, a closed gallery. In no product screen.                                                                                                                                                                                                                                                                                                                                       |
| 2B.1 — bottle showcase                         | done, merged (PR #72)            | Taking a bottle out of the new view to look at it: a state machine, a checked way out per bottle, an inspection transition where there is none, a panel. In no product screen.                                                                                                                                                                                                                                                                                      |
| 2B.2 — premium look, mobile cost               | done, merged (PR #73)            | A premium look for all 14 templates and the bottle (finer shared materials, shading written into the geometry, glass, labels) at a measured cost; a safe place for the panel on a narrow screen. In no product screen. **Testing on real phones is still owed** (protocol in the 2B.2 report) and is required before anything is switched on.                                                                                                                       |
| 2B.3 — product integration, safe preview       | done, merged (PR #84)            | The cellar's 3D view uses the new storage view for places with a template, with real bottles, labels and details, behind a server gate of its own (internal previews only, closed on production). Places from before templates keep the existing view. Read-only; no migration. **Device validation and an owner decision are still required before it is switched on for anyone.**                                                                                 |
| 3 — Rack Builder                               | done, merged (PR #87)            | A live 3D configurator for a place: all 14 templates (3 preview only while depth is off), size, look, zones, real bottles in the picture, safe create and edit; behind a server gate of its own, and writes only to a database known not to be production. See [`SPRINT-3-REPORT.md`](./SPRINT-3-REPORT.md).                                                                                                                                                        |
| **4 — placement, depth-aware movement, zones** | **done (2026-11-19), in review** | Placing, moving and swapping real bottles on whole spots (tap, choose, confirm; one conditional write; Undo only while nothing changed since), temperature zones on screen as settings, a 2D picker that works without WebGL. Behind a server gate of its own; writes only to a database known not to be production. Depth is built and tested against disposable databases only: live depth writes stay blocked. See [`SPRINT-4-REPORT.md`](./SPRINT-4-REPORT.md). |
| 5 — placement advice                           | planned                          | A deterministic, explained suggestion for where a bottle goes (builds on sprint 4's placement rules).                                                                                                                                                                                                                                                                                                                                                               |

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
- [`ADR-003-bottle-showcase.md`](./ADR-003-bottle-showcase.md): the decisions of sprint 2B.1: what may happen to a
  bottle that is taken out, and how it may leave its place.
- [`SPRINT-2B1-REPORT.md`](./SPRINT-2B1-REPORT.md): what sprint 2B.1 built, the hard cases, the pictures, the
  measurements, and the checklist for testing on real devices.
- [`ADR-004-premium-look.md`](./ADR-004-premium-look.md): the decisions of sprint 2B.2: how the view came to look
  like furniture and glass without a new renderer, a light or a shadow pass more.
- [`SPRINT-2B2-REPORT.md`](./SPRINT-2B2-REPORT.md): what sprint 2B.2 built, before and after, the measurements
  against the merged baseline, and the protocol for validating on real devices.
- [`ADR-005-smart-cellar-api.md`](./ADR-005-smart-cellar-api.md): the decisions of sprint 1C: new routes next to the
  old ones, read through the domain, one transaction per layout, switched per deployment, never writing on production.
- [`SPRINT-1C-REPORT.md`](./SPRINT-1C-REPORT.md): what sprint 1C built, the contracts, the compatibility guarantees,
  export version 2, the authorization results, and what production needs before any of it is switched on.
- [`ADR-006-product-integration.md`](./ADR-006-product-integration.md): the decisions of sprint 2B.3: a gate of its
  own decided on the server, one row of places, the existing view for places from before templates, what is said
  when something fails.
- [`SPRINT-2B3-REPORT.md`](./SPRINT-2B3-REPORT.md): what sprint 2B.3 built, the pictures, the measurements against
  the gallery, how to try a preview, the device protocol, and what production activation still needs.
- [`ADR-007-rack-builder.md`](./ADR-007-rack-builder.md): the decisions of sprint 3: one draft and the domain's
  rules, the existing renderer, bottles as facts, saves that cannot reach production, stale drafts detected.
- [`SPRINT-3-REPORT.md`](./SPRINT-3-REPORT.md): what sprint 3 built, the workflows, the pictures, the guarantees, the
  measurements, the open issues and what production activation and sprint 4 need.
- [`ADR-008-index-aware-movement-and-zones.md`](./ADR-008-index-aware-movement-and-zones.md): the decisions of
  sprint 4: one slot identity, versioned move and swap endpoints, one conditional write per move, depth blocked live,
  zones read-only in daily use.
- [`SPRINT-4-REPORT.md`](./SPRINT-4-REPORT.md): what sprint 4 built, the contracts and guarantees, the pictures, the
  tests and measurements, the legacy audit, and what production and sprint 5 need.
- [`PROPOSAL-layout-compare-and-swap.md`](./PROPOSAL-layout-compare-and-swap.md): the migration that would make a
  stale save impossible inside the database (proposed, not applied).
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

All in `apps/web`. Nothing under `supabase/`, `packages/domain` or `src/app/api` changed; `src/server/env.ts` gained one
function (the gallery's gate).

| File                                                     | What                                                                                                                                                                  |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/features/cellar/storage3d/parts.ts`, `families.ts`  | A place as plain numbers: parts and poses for the grid, bins and wall families, and the neutral picture.                                                              |
| `…/storage3d/palette.ts`                                 | What the catalogue's named looks are, as surfaces.                                                                                                                    |
| `…/storage3d/model.ts`                                   | Which renderer a place gets, where each bottle goes, camera framing, the levels of detail.                                                                            |
| `…/storage3d/resources.ts`                               | The three.js side: merged furniture, the shared bottle kit, ownership and release.                                                                                    |
| `…/storage3d/template-scene.tsx`                         | The React Three Fiber scene. Refuses a place from before templates.                                                                                                   |
| `…/storage3d/layout-cells.ts`, `layout-map.tsx`          | The read-only flat picture, as data and as a component.                                                                                                               |
| `…/storage3d/fixtures.ts`                                | Made-up places and bottles for the gallery and the tests.                                                                                                             |
| `src/features/design/cellar-gallery*.ts(x)`              | The gallery and its state (what the address may ask for).                                                                                                             |
| `src/app/design/cellar-3d/page.tsx`                      | The route. `next dev` and Vercel previews that ask for it; closed everywhere else.                                                                                    |
| `src/lib/cellar-gallery-gate.ts`                         | The gallery's own gate (stricter than `/design`'s), asked through `server/env.ts`.                                                                                    |
| `e2e/storage-gallery.spec.ts`                            | The gallery in a browser: 34 tests on a desktop and a phone profile, against a test server that declares itself a Vercel preview (`playwright.config.ts`, port 3102). |
| `e2e/visual-storage3d.spec.ts`, `perf-storage3d.spec.ts` | The photographer and the measuring bench (run only when asked for).                                                                                                   |

**Not changed:** `three/scene.tsx` and everything else in `three/`, `rack-grid.tsx`, `cellar-3d-view.tsx`, placing,
swapping and dragging, every service and route, the database. **No product screen mounts the new view.**

## What sprint 2B.1 added (bottle showcase)

All in `apps/web`. Nothing under `supabase/`, `packages/domain`, `src/server`, `src/lib` or `src/app/api` changed.

| File                                                       | What                                                                                                    |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `…/storage3d/showcase-machine.ts`                          | What may happen to a bottle that is taken out: a pure state machine.                                    |
| `…/storage3d/showcase-plan.ts`                             | How a bottle leaves its place: a checked physical path, or an inspection transition and why.            |
| `…/storage3d/showcase-film.ts`                             | The movement as one function of progress; where the bottle stands on display.                           |
| `…/storage3d/hero-kit.ts`                                  | The one bottle on display: geometry, materials and look, made once per scene.                           |
| `…/storage3d/showcase-hero.tsx`                            | Plays the film inside the view; the picture of the place behind it; hand-off measurement; warm-up.      |
| `…/storage3d/inspectable-storage.tsx`                      | What a screen mounts: the view, the picture, the panel, taps, Escape and focus.                         |
| `…/storage3d/template-scene.tsx` (extended)                | An optional `inspection`: hides the bottle that is out, locks the camera, mounts the bottle on display. |
| `src/features/design/cellar-gallery*.ts(x)`                | The gallery takes bottles out; a link can name a bottle to take out; the hard cases, one link each.     |
| `e2e/storage-showcase.spec.ts`, `e2e/storage3d.ts`         | The showcase in a browser, and what the gallery specs share.                                            |
| `e2e/visual-showcase3d.spec.ts`, `perf-showcase3d.spec.ts` | The photographer and the measuring bench (run only when asked for).                                     |

Two things of sprint 2A were corrected on the way: the counters of the neutral picture lost their places when the
level of detail changed (they are made anew with it now), and a wall rail's tip was 8 hundredths too tall for a
bottle to be lifted over it.

**Not changed:** everything in `three/` (the existing view and its showcase), `rack-grid.tsx`, `cellar-3d-view.tsx`,
placing, moving and swapping, every service and route, the database, the gallery's gate.

## What sprint 2B.2 added (premium look)

All in `apps/web`. Nothing under `supabase/`, `packages/domain`, `src/server`, `src/lib` or `src/app/api` changed.

| File                                                                 | What                                                                                                                                                  |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `…/storage3d/textures.ts`                                            | The fine pictures of the premium look, drawn once per page on canvases and shared by every scene.                                                     |
| `…/storage3d/bottle-look.ts`                                         | What a bottle is made of, as numbers, read by the rack's bottles and the bottle on display alike.                                                     |
| `…/storage3d/fine-label.ts`                                          | The label of the bottle on display on paper with a grain (the existing drawing and size; the grain is one small tile).                                |
| `…/storage3d/palette.ts` (extended)                                  | `Fidelity` (`classic`, `premium`), the premium finishes and tones, the light of two zones.                                                            |
| `…/storage3d/resources.ts` (extended)                                | Premium geometry (grain by the part's own measure, a tone per board), shading written into the corners, the glow and the ground shadow, wall shadows. |
| `…/storage3d/families.ts`, `model.ts` (extended)                     | Plinth and cornice for the classic rack, hardware for wall rails (premium only; no spot moves); three more switches per level of detail.              |
| `…/storage3d/inspectable-storage.tsx`, `showcase-film.ts`            | A third panel layout, `sheet`, for a narrow screen that gives the panel no place below the picture.                                                   |
| `…/storage3d/hero-kit.ts`, `showcase-hero.tsx`, `template-scene.tsx` | The bottle on display and the scene read the look; one more shader is warmed up.                                                                      |
| `src/features/design/cellar-gallery*.ts(x)`                          | Look (before/after), studio (light/dark) and panel place, all in the link.                                                                            |
| `e2e/storage-premium.spec.ts`, `…/storage3d/premium-look.test.ts`    | What the look may and may not change, in a browser and in unit tests.                                                                                 |
| `e2e/visual-premium3d.spec.ts`, `e2e/perf-fidelity3d.spec.ts`        | The photographer and the measuring bench (run only when asked for).                                                                                   |

**Not changed:** everything in `three/`, `rack-grid.tsx`, `cellar-3d-view.tsx`, the showcase state machine, placing,
moving and swapping, every service and route, the database, the template catalogue, the gallery's gate.

## What sprint 1C added (Smart Cellar API)

Nothing under `supabase/migrations` or `supabase/gated-migrations` changed. No product screen changed.

| File                                                                                   | What                                                                                                                                                                 |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/domain/src/smart-cellar.ts`                                                  | The API's views, `indexMeaningOf` (never "depth" where the arrangement is not known), `layoutChangeProblem`, `legacyEditProblem`, `DEPTH_PLACEMENT_ENABLED = false`. |
| `packages/domain/src/export-v2.ts`                                                     | Export version 2 (version 1, `export.ts`, untouched).                                                                                                                |
| `apps/web/src/lib/smart-cellar-gate.ts`, `server/env.ts`                               | `CELLR_SMART_CELLAR`: off, read, write; writes never on production.                                                                                                  |
| `apps/web/src/server/smart-cellar/*`                                                   | Repository (AS the user, one RPC per write, narrow schema check) and service (reads through `resolveStorage`).                                                       |
| `apps/web/src/app/api/v1/smart-cellar/**`                                              | The new routes.                                                                                                                                                      |
| `apps/web/src/server/cellar/repository.ts`                                             | The old edit of a place refuses what would make a templated place inconsistent, tied to the template it checked.                                                     |
| `apps/web/src/server/export/*`, `app/api/v1/export/route.ts`                           | `?version=2`; version 1 unchanged.                                                                                                                                   |
| `apps/web/src/features/cellar/storage3d/from-api.ts`                                   | From the API's views to the new view's `ResolvedStorage` and `StoredBottle`s.                                                                                        |
| `apps/web/e2e/smart-cellar-api.spec.ts`, `supabase/tests/99_smart_cellar_api.test.sql` | Through the app to the real PostgREST and Postgres; and the database rules the API leans on, pinned.                                                                 |

## What sprint 2B.3 added (product integration)

Nothing under `supabase/` changed. No write was added. The existing 3D view stays the default.

| File                                                                                           | What                                                                                                                                                |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/lib/smart-cellar-renderer-gate.ts`, `server/env.ts`, `app/(app)/cellar/page.tsx` | `CELLR_SMART_CELLAR_3D`: decided on the server, passed to the screen as a boolean; never open on production or where the deployment cannot be told. |
| `apps/web/src/features/cellar/smart-cellar-hooks.ts`                                           | Capabilities, places, one place's bottles, through the existing API client and query cache.                                                         |
| `apps/web/src/features/cellar/smart-cellar-3d.tsx`                                             | The product's 3D cellar with the new view for places with a template; loaded lazily, only where the gate is open.                                   |
| `apps/web/src/features/cellar/storage3d/product-details.ts`                                    | From a real bottle to what the inspection says and wears (pure, tested).                                                                            |
| `apps/web/src/features/cellar/cellar-3d-view.tsx`                                              | The existing view can show one place chosen from outside (`only`); unchanged otherwise.                                                             |
| `apps/web/src/features/cellar/storage3d/inspectable-storage.tsx`                               | The panel takes real actions from its host (the link to the wine's page).                                                                           |
| `packages/domain/src/smart-cellar.ts`, `server/smart-cellar/repository.ts`                     | A placement carries region, country and the bottle's own label photo reference (read-only).                                                         |
| `apps/web/e2e/smart-cellar-3d.spec.ts`                                                         | 22 browser scenarios with a real household in the local stack, desktop and phone.                                                                   |
| `apps/web/e2e/visual-product3d.spec.ts`, `perf-product3d.spec.ts`                              | The photographer and the bench (run only when asked for).                                                                                           |
| `apps/web/e2e/smart-cellar-3d-old-db.spec.ts`, `scripts/local-stack/up.sh`                     | The same screen on a real database that stops before 0043 (`STACK_MIGRATIONS_BEFORE`, optional; run by hand).                                       |

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
10. The template gallery is never open on a production deployment, whatever is set there
    (`lib/cellar-gallery-gate.ts`), nor in any production build that does not prove it is a Vercel preview: do not
    add a switch for "a local production build", and do not route it back through `/design`'s gate. In the flat picture a position
    stands for its front bottle only: a press never reaches a bottle behind a free front.
11. The new 3D view never draws a place from before templates, and the existing view is not replaced until parity
    and speed are shown on real devices (ADR-002). An index in a pile is drawn as "one more bottle in the pile",
    never as a place in it.
12. A bottle is only shown being drawn out along a path that was checked to touch nothing
    (`showcase-plan.ts`). Where there is none, it is shown without a path, and the person is told so. Looking at a
    bottle never changes its address, and a pile is never given positions.
13. The look never decides what is there. A level of detail and a fidelity change how a place is drawn; the spots,
    the bottles on them and what a tap takes are decided before either is chosen (`premium-look.test.ts`,
    `storage-premium.spec.ts`). The view shows how a cabinet's zones are lit, never a temperature.
14. The pictures a material is made of belong to no scene (`textures.ts`): a scene never frees them, and their number
    has a ceiling. What a scene makes, it gives back when it closes.
15. Nothing of the new view is switched on in the product before it has been measured on real phones (the protocol
    in the 2B.2 report). Software-rendered frame times are for comparing builds, not for promising a frame rate.
16. The Smart Cellar API never writes on production by configuration alone (`lib/smart-cellar-gate.ts`): opening
    it is a reviewed code change after an owner decision. Every write of a layout is one `save_storage_layout` call;
    no route writes zone rows directly. Reading goes through `resolveStorage` and never writes back.
17. The product's new 3D renderer has a gate of its own (`lib/smart-cellar-renderer-gate.ts`), decided on the server:
    it never opens on production by configuration. A place from before templates is always drawn by the existing
    view; nothing gives it a template by reading it. With the gate closed the screen asks for nothing new and
    downloads none of the new view's code (a browser test holds each of these).
18. No migration is run against production from here. Since 2026-11-18 production holds 0043–0045 (all 46
    migrations, `docs/MIGRATIONS.md`). Depth placement is off there (`depth_placement = false` in
    `private.cellar_settings`), and `bottles_slot_unique` is kept. Switching depth on is a new migration; the index
    drop is the gated file (`supabase/gated-migrations/`). Each needs its own owner decision.

# ADR-007 — The Rack Builder: one draft, the existing renderer, saves that cannot reach production

Status: accepted (sprint 3, 2026-11-19). Builds on ADR-001 (templates, slot identity), ADR-002 (renderer), ADR-004
(look), ADR-005 (API, `save_storage_layout`), ADR-006 (product integration). No migration.

## The question

The catalogue, the layout engine, the renderer and an atomic layout save all exist. A person still cannot choose
what their storage IS. How does the app let someone design a place, see it change live, and save it, without a
second definition of any rule, without a second 3D engine, without moving a single bottle, and without any way
for a test deployment to write to the production database?

## Audit: what is reused, unchanged

| Need                                                        | Existing piece                                                                                                                                       |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Templates, limits, palettes, doors, lighting, zones presets | `STORAGE_TEMPLATES`, `STORAGE_PALETTES` (domain)                                                                                                     |
| What may be written                                         | `StorageConfigSchema`, `StorageStructureSchema`, `StorageAppearanceSchema`, `unsupportedStyle`, `checkZones`, `defaultZones`, `defaultStorageConfig` |
| Whether a change is safe for the bottles in it              | `layoutChangeProblem`, `DEPTH_PLACEMENT_ENABLED`                                                                                                     |
| Reading a place in new terms (also a draft)                 | `resolveStorage`                                                                                                                                     |
| Drawing                                                     | `buildModel` → `InspectableStorage` (`TemplateScene`) — premium look of 2B.2                                                                         |
| Real bottles in the picture                                 | `GET …/storage/:id/bottles` → `from-api.ts` → `placeBottles`                                                                                         |
| Flat picture (no WebGL)                                     | `LayoutMap`                                                                                                                                          |
| Saving layout, look and zones together                      | `PUT /api/v1/smart-cellar/storage/:id/layout` → `save_storage_layout` (one transaction)                                                              |
| Making a place                                              | `POST /api/v1/storage` (unchanged)                                                                                                                   |
| Renaming                                                    | `PATCH /api/v1/storage/:id` (rename is always allowed for a templated place)                                                                         |

## Decisions

1. **A route of its own, behind a gate of its own.** `/cellar/builder` (new place) and `/cellar/builder/:id`
   (existing place). `CELLR_SMART_CELLAR_BUILDER=1`, decided on the server with the renderer gate's rule
   (`next dev` or a Vercel preview, never production, never an unknown deployment) and only where the Smart
   Cellar API reads. Closed: the page is "not found" and no entry point is rendered, so nothing of the builder is
   downloaded. Independent of the gallery gate, of the 3D-cellar gate and of the API's write permission.
2. **Saving is a second, separate question, answered on the server.** The builder may be open while saving is not
   (preview-only mode: no Save button that would predictably fail). Saving needs the API's `write` level, which
   now also needs a **verified write target** (decision 6).
3. **One draft, pure functions, the domain decides.** `features/cellar/builder/draft.ts` holds the draft
   (template, size, bottles per cell, look, zones, name) and the operations on it. Every limit, palette, default
   and check is the domain's; the draft only reconciles (a material change keeps the colour if the new material
   has it, else takes the template's default colour) and reports what it reconciled. Whether a configuration can be
   saved today is `templateSavable` / `cellCapacitySavable` in the domain (depth off ⇒ one bottle per cell).
   A template that needs more than one bottle per cell is **preview only**: selectable, drawn, never quietly
   reduced to one.
4. **One canvas, the existing renderer.** The preview is the one `InspectableStorage` of 2B.1/2B.2, fed a model
   built from the draft through `resolveStorage` → `buildModel`. The catalogue cards are static snapshots taken
   from the gallery with the same renderer, so fourteen cards cost fourteen small images, not fourteen scenes. The
   scene now re-frames the camera only when the size of the place changes, not when its colour does.
5. **Bottles are facts, the draft is a proposal.** In an existing place the preview draws the real bottles on their
   real spots; a bottle that the draft would leave without a spot is listed as a blocker and Save is refused (the
   same `layoutChangeProblem` as the server, which the database checks again). Nothing is moved, renumbered or
   dropped. A place from before templates and a place whose stored template is not understood are never given a
   template by being opened: the draft starts as a suggestion, and only Save writes.
6. **Writes need a database that is known not to be production.** `lib/smart-cellar-write-target.ts`: the host the
   server itself connects to must be a loopback address (the local stack) or exactly the host named in
   `CELLR_SMART_CELLAR_WRITE_DATABASE`, and it must not be a known production database (a list in code: an
   environment variable cannot take a host off it). Anything else — unparseable, undeclared, production — keeps
   writes closed. Enforced inside the API's gate, so the route refuses (403) whatever the browser does.
7. **Stale drafts are detected; races are not claimed away.** A place carries a `revision` (its `updated_at`). The
   builder sends it as `If-Match`; the server refuses a save whose revision is no longer current (409). Between that
   check and the RPC another save can still land: the RPC is last-write-wins under the place's row lock. Closing that
   needs the revision compared inside the transaction: a migration, proposed separately (report §11), not applied.
8. **Making a place is two calls, said so.** `POST /storage` makes a basic place; `PUT …/layout` gives it its
   design. If the second fails the builder says that a basic place exists, keeps its id (and moves the address to
   it, so a reload does not make another), and offers "Try again" against that id. Nothing is deleted to hide an
   error. An atomic create is a future API (report §11).

## Consequences

- No new rule, renderer, material system or database object.
- One additive field on the read model (`revision`); one optional request header on the layout save.
- Writes become stricter: a preview that points at production can no longer save a layout, whatever it sets.

# Smart Cellar 3D

More kinds of places for bottles (racks, cubes, diamond bins, crates, wall pegs and rails, coolers with zones), a look
that can be chosen, depth, and later advice on where a bottle should go. Built in sprints; each one ships switched
off and leaves every existing place and bottle as it is.

## Where it stands

| Sprint                           | Status                             | What it is                                                                                 |
| -------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------ |
| 0 — audit and architecture       | done (2026-11-14, no files)        | What exists, what to reuse, the plan.                                                      |
| **1A — domain foundation**       | **done (2026-11-14), in review**   | Template catalogue, logical layout engine, configuration schemas, adapter for what exists. |
| 1B — database and API            | not started; needs owner decisions | Columns, index, triggers, zones table, RPCs, API fields. See the requirements document.    |
| 2 — renderer and 2D on layouts   | not started                        | The 3D view and the racks grid read a layout; the bins and wall families are drawn.        |
| 3 — builder                      | not started                        | Choosing a template, sizing it, the look, a live preview.                                  |
| 4 — depth and zones in daily use | not started                        | Placing, moving and swapping with an index; zones on screen.                               |
| 5 — placement advice             | not started                        | A deterministic, explained suggestion for where a bottle goes.                             |

## Documents

- [`ADR-001-templates-and-slot-identity.md`](./ADR-001-templates-and-slot-identity.md): the decisions of sprint 1A.
  Read this first.
- [`SPRINT-1B-DATABASE-REQUIREMENTS.md`](./SPRINT-1B-DATABASE-REQUIREMENTS.md): what the database and the server must
  enforce, what must keep working, and the decisions the owner has to take. Nothing in it has been built.

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

**Not changed:** `placement.ts`, the storage schemas in `cellar.ts`, every service, repository and route, the 3D
view, the racks view, the database, the generated types.

Nothing in the app calls the new modules yet. That is the point of the sprint: the next ones build on something that
is already tested against what exists.

## Rules for whoever continues

1. A released template id never changes kind, family or slot semantics (pinned in `storage-templates.test.ts`).
2. A spot without an index is index 1. An index in a bin is a counter, not a place: never show it as one.
3. A temperature on a zone is a setting. No measured value is stored with a zone.
4. Reading never throws and never reads a bottle's spot away; writing refuses what it does not know.
5. While a place has no template it is drawn exactly as today (`legacy-parity.test.ts` is the gate).
   A place whose template is unknown, or belongs to another kind, is not drawn as any template's furniture
   (`arrangementKnown` is false): cells and counts only.
6. A feature flag hides a screen. It does not protect data: constraints, triggers and RLS do.

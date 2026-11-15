# ADR-005 — The Smart Cellar API: additive, switched, read through the domain

Status: accepted (sprint 1C, 2026-11-15). Builds on ADR-001 (templates and slot identity), the 1B database
foundation (migrations 0043-0045), ADR-002 (the renderer that consumes `ResolvedStorage`).

## The question

The database can hold a template, bottles per cell, an index, an appearance and temperature zones; the domain can
read all of it (`resolveStorage`) and the new 3D view can draw it. The server still speaks only the two-coordinate
language of every client of today. How does the new structure reach clients without changing what the old ones
get, without switching anything on in production, and without a second backend architecture?

## Decisions

### 1. New routes next to the old ones, under one prefix

`/api/v1/smart-cellar/…` is new; `/api/v1/storage`, `/api/v1/racks` and `/api/v1/bottles` are unchanged in path
and response shape (pinned by browser tests). No existing response gained or lost a field. The new routes use the
existing building blocks only: `authed` (session or bearer, origin check), `readJson` with a domain schema,
`uuidParam`, a service from `servicesFor(ctx)`, a repository running AS the user, `DomainError` → HTTP status.

| Method and path                                | Answers                                                                                                                                                                                |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/smart-cellar`                     | `SmartCellarCapabilities`: `{ version: 1, reads, writes, depthPlacement: false, schema: "ready" \| "missing", catalogVersion, appearanceVersion, exportVersions: [1, 2] }`             |
| `GET /api/v1/smart-cellar/storage`             | `SmartStorageUnitView[]`, every place of the active household                                                                                                                          |
| `GET /api/v1/smart-cellar/storage/:id`         | `SmartStorageUnitView`                                                                                                                                                                 |
| `GET /api/v1/smart-cellar/storage/:id/bottles` | `{ unit: SmartStorageUnitView, placements: SmartPlacementView[] }`                                                                                                                     |
| `PUT /api/v1/smart-cellar/storage/:id/layout`  | body `StorageConfig` = `{ structure: { template, rows, cols, cellCapacity, zones }, appearance: { v: 1, material, color, lighting, door } }`; answers the saved `SmartStorageUnitView` |
| `GET /api/v1/export?version=2`                 | `CellrExportV2`. Without `version` (or `version=1`): version 1, unchanged                                                                                                              |

`SmartStorageUnitView` (packages/domain/src/smart-cellar.ts): `id, label, kind, templateId` (as stored; an
unknown id is returned as it is), `layoutTemplateId` (the template the place is drawn with: its own, or the kind's
default standing in), `family, rows, cols, cellCapacity` (as stored, never narrowed), `slotSemantics` (as
stored), `indexMeaning` (what a reader may rely on), `appearance` (versioned), `zones`, `capacity, occupied, free`,
`legacy, arrangementKnown, fallbacks`.

`SmartPlacementView`: `bottleId, locationId, row, col, index` (the whole spot), `vintageId, wineId, producer,
wineName, year, type`. That is everything the new view's `StoredBottle` needs (`features/cellar/storage3d/
from-api.ts` maps it; its shape is derived from the type of wine, as the gallery does).

Status codes: 401 not signed in; 404 not switched on, not this household's, no such place, or (with a message)
the database lacks the Smart Cellar step; 403 writing not switched on here; 422 not a valid configuration (unknown
template, size outside it, a look it does not offer, zones that do not split the shelves, unknown fields such as a
`kind` or `semantics` sent along); 409 a layout that would take a bottle's spot, a change of what an index means
under bottles, more than one bottle per position, or writers that ran into each other (`retryable: true`).

### 2. All reading goes through `resolveStorage`; the server adds counts and nothing else

The repository passes every stored field to `resolveStorage` untouched (kind, rows, cols, template, cell capacity,
stored meaning of the index, zone rows, raw appearance). No fallback rule is repeated on the server. On top the
server adds what only it can know (how many bottles are in the place) and one rule of saying: `indexMeaningOf`,
which never calls an index a depth where the arrangement is not known (the domain's `layout.semantics` keeps the
stand-in template's meaning, for drawing; an API must not present that as a fact). Reading never writes: a test
compares the stored row before and after every kind of read.

`slotSemantics` is passed through as stored so that a client reading the view with the same `resolveStorage`
reaches the same result as the server (tested); the look and the zones a server had to replace cannot be read
again, so the server's `fallbacks` travel with the view.

### 3. One write, one transaction: `save_storage_layout`

A layout is a row of `cellar_locations` plus up to three zone rows that only make sense together. The only write is
one call of the existing `save_storage_layout` (SECURITY INVOKER, so RLS and column grants apply): place and zones
replaced together, or nothing. No route writes zone rows directly (a direct zone write is refused at once while the
place is locked, by design of 0044, and the API never risks that). There is therefore no separate "save zones"
endpoint: zones are saved with the shelves they split. A zones-only write would have to send back layout values the
client did not choose, and could undo a layout saved in between; the PUT sends the whole layout explicitly instead.

The template decides `kind` and `slot_semantics`; neither is accepted from the request (a strict schema refuses
them). Before the call the service checks what the database will check (`layoutChangeProblem`: depth off, a bottle
would lose its spot, meaning of the index under bottles), so the person is told plainly; the database stays the
final authority and its answers are mapped to the same refusals.

Two saves of one place at once: the database takes them one after the other (the place's row lock); the result is
one of them, whole. There is no compare-and-set in this sprint: the RPC has no expected-version argument, and adding
one is a migration (see the report, next steps).

### 4. Depth stays off, in three places

`DEPTH_PLACEMENT_ENABLED = false` in the domain: any layout with more than one bottle per cell is refused before the
database is asked (including every bins template, which start at two). The database refuses it too
(`private.cellar_settings`, only the database owner can change it), and the legacy unique index
`bottles_slot_unique` still allows one bottle per (place, row, col). No route moves a bottle to an index.

### 5. Switched on per deployment, writes never on production

`CELLR_SMART_CELLAR` (server only): unset/`off` → 404 everywhere; `read` → reads and export version 2; `write` →
also layout saves, but only in `next dev` and on a Vercel preview (`lib/smart-cellar-gate.ts`, the gallery gate's
rule). A production deployment, marked or unmarked, can at most read, whatever is set. Opening writes in production
is a code change, reviewed: the separate owner decision this sprint was asked to leave open. The database having the
columns switches nothing on.

A closed API answers 404 before it looks at the request (a PUT with a garbage body is still 404 when closed, 403
when reads are open and writes are not).

### 6. Knowing whether the database has the step, narrowly

`GET /api/v1/smart-cellar` reports `schema: "ready" | "missing"` from three `limit(0)` probes. Only "no such column"
(42703, PGRST204), "no such table" (42P01, PGRST205, PGRST200) and "no such function" (PGRST202) mean missing. A
permission error, a timeout or any other failure is thrown as what it is, never read as "missing". Any Smart Cellar
read or write that meets those codes answers 404 "The Smart Cellar isn't set up on this server yet."

### 7. The old edit of a place keeps a templated place consistent

`PATCH /api/v1/storage/:id` (label, kind, rows, cols) is unchanged for places without a template. For a place with
one, a kind other than the template's is refused (409), a size outside the template is refused (422), and a template
this server does not know allows only a rename (409). The check and the update are tied together: the update only
applies while `template` is still what was checked (`.is("template", null)` / `.eq("template", …)`); a template
saved in between makes the update match nothing, which is answered 409 retryable. On a database without the column
the check is skipped (only "no such column" counts) and the update is exactly the old one. Zones are the database's
to check (a change of shelves that leaves them without a split is refused at commit, 422).

### 8. Export version 2 is a second document, not a change of the first

`EXPORT_VERSION = 1` and `CellrExport` are untouched; version 1's keys, order and query are pinned by tests.
`CellrExportV2` adds per place `template, arrangement (legacy | known | unknown), bottlesPerPosition, capacity,
indexMeaning, look, zones (setToC: a setting), fallbacks`, and per bottle `index` (null exactly without a place).
Bottles and their indexes come from ONE read; a placed bottle without its index is an error, never a guess of 1.
Version 2 is offered only where the Smart Cellar API reads; any other version is refused (422), not answered with
version 1. Import is unchanged: it reads version-1-like files from Wijnkelder; an import of version 2 is future
work (report, next steps).

### 9. Security

Every route needs a session; every read and write runs as the person (no service role anywhere in this sprint); a
place of another household is 404 exactly like one that does not exist; `save_storage_layout` called directly
through PostgREST with another household's id answers `not_found` (RLS). Friends: `friend_racks` and
`friend_cellar` are unchanged and return the fields they always did (pinned in SQL and in a browser test); no
policy lets a friend read `cellar_location_zones` or the new columns; the new API serves only the caller's own
active household. Temperatures (settings) never leave the household.

## Consequences

- Clients can read the new structure and the full slot identity today; nothing in the product uses it yet.
- The old API and the old export are byte-for-byte what they were for every place without a template; for a place
  with one, the old edit refuses what would make it inconsistent.
- No migration. The API rests on 0043-0045 as merged; their production state is not assumed (capability check).
- Writes in production need a code change and an owner decision; depth needs a migration and an owner decision.

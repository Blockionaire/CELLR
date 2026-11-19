# ADR-006 — The new storage view in the product: a gate of its own, the existing view where nothing is known

Status: accepted (sprint 2B.3, 2026-11-18). Builds on ADR-002 (the renderer), ADR-003 (the showcase), ADR-004 (the
look) and ADR-005 (the API). Nothing here writes, migrates or changes what production shows.

## The question

The new storage view draws a place from its layout, and the Smart Cellar API reads a place in those terms. The
product's 3D cellar still draws every place as a grid of its kind. How does the new view reach the product's
screen for real bottles without being switched on for anyone, without misdrawing a single place that exists today,
and without a second cellar experience next to the first?

## Decisions

### 1. A gate of its own, decided on the server

`CELLR_SMART_CELLAR_3D=1` (`lib/smart-cellar-renderer-gate.ts`). The cellar page asks on the server and hands the
screen one boolean (`smart3d`); the browser reads no setting.

| Deployment                                                                 | Result                                |
| -------------------------------------------------------------------------- | ------------------------------------- |
| not set, or anything but exactly `1`                                       | off                                   |
| `next dev` (and the environment does not say production)                   | on                                    |
| Vercel preview (`VERCEL_ENV=preview`, no custom target)                    | on                                    |
| Vercel production, or `VERCEL_TARGET_ENV=production`                       | **off, whatever is set**              |
| a production build with no Vercel marker, a custom environment, a test run | **off** (its identity cannot be told) |

It is independent of the design gallery's gate (neither opens the other) and of the API's permission to write (the
renderer only reads). It needs the API to read (`CELLR_SMART_CELLAR` = `read` or `write`): its data comes from
there. Opening it for real users is a reviewed change to that file after an owner decision and device validation,
never a variable.

With the gate closed the screen is the screen of before: `Cellar3DView` is mounted exactly as it was, no Smart
Cellar request is made and none of the new view's code is downloaded (`smart-cellar-3d.tsx` is a lazy chunk that
only loads when the flag is on AND the 3D view is opened; three.js and the storage view inside it load only when a
place with a template is opened). The `3d` view mode and its cookie are untouched.

### 2. One 3D cellar, one row of places; which view draws a place is the domain's answer

With the gate open, `SmartCellar3D` shows one row of places and one scene at a time:

| The place, as `GET /api/v1/smart-cellar/storage` reports it                       | Drawn by                                                                                                               |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `legacy: true` (no template, one bottle per cell)                                 | **the existing view** (`Cellar3DView`, now able to show one place chosen from outside), with its own panel and actions |
| a template, arrangement known                                                     | the new view (`InspectableStorage`)                                                                                    |
| a template the app cannot trust (unknown, wrong kind, wrong meaning of the index) | the new view's **neutral picture**, and a sentence saying the arrangement is not known                                 |

The rule is not repeated in the product: `legacy` and `arrangementKnown` come from `resolveStorage` through the API
(ADR-005), and the model is built by `from-api.ts` → `buildModel`. A legacy place is never given a template by being
looked at; a test compares the stored row before and after.

Bottles on a spot the place does not have (a place made smaller around every check) are not drawn elsewhere and not
dropped: they are counted and listed under the picture, each with a link to its wine.

### 3. When the new API cannot answer

| What happened                                                                    | What the person sees                                                                                                                       |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| The database lacks the Smart Cellar step (`schema.reads: "missing"`, ADR-005 §6) | The existing 3D view, whole. Nothing is said: nothing is wrong.                                                                            |
| No places at all                                                                 | The existing view's own invitation to build a cellar.                                                                                      |
| No connection, not signed in, a server error                                     | An alert that says so in words, with "Try again", and the existing view under it so the cellar stays usable. Never taken for "not set up". |
| One place cannot be read                                                         | An alert for that place with "Try again"; the other places open as usual.                                                                  |
| A refresh fails while a place is on screen                                       | What was last known stays; a line says it could not be refreshed.                                                                          |
| The graphics context is lost                                                     | The existing "the 3D view has paused" message; "Show 3D again" starts a fresh scene with the same bottles.                                 |

### 4. Data: three small queries, the existing client and cache

`smart-cellar-hooks.ts`, with `api` and TanStack Query as every other screen: capabilities (once a visit), the list
of places, and the bottles of the ONE place on screen (`GET …/storage/:id/bottles`), keyed by place. No bottle of a
legacy place is asked of the new API, and no wine's details are asked up front.

- **Stable while refreshed.** A refresh that changes nothing returns the same objects (the cache shares
  structure), so the model, the bottles and a bottle that is out stay as they are (tested: a refresh during an
  inspection leaves it inspecting).
- **Not stale.** Everything under `["smart-cellar","storage"]` is invalidated wherever the racks are (bottle
  added, moved, opened, removed; place made, changed, deleted; label photo changed). The place on screen is also
  re-checked whenever it is come back to (`staleTime: 0`): someone else in the household may have changed it.
- **A selection belongs to its place.** The chosen bottle is `{unitId, bottleId}` and counts only if that place is
  on screen and still holds that bottle (`selectedIn`); the cache is per place.

The placements read was extended (read-only, additive) with `region`, `countryCode` and `image` (the bottle's own
label photo reference, of this household only), so the view needs no second source to join.

### 5. What the inspection says and wears: only what the record holds

`product-details.ts` (pure): the panel shows wine, producer, vintage, kind, origin; the wine's appellation and how
many bottles of the vintage there are arrive with the existing `useVintageDetail`, asked for when a bottle is
taken out, once per vintage. Where the bottle is, is worded by what the index MEANS (`whereOf`): shelf and position;
"at the front" / "place n from the front" only where depth is known; a compartment without a position for a bin;
and "CELLR doesn't know how this place is arranged" where it does not.

The label is the bottle's own photo (the straightened label where there is one), through the existing
`/api/v1/images/:id` and its authorization; the back label is the vintage's own photo of it when the details bring
one. Without a photo the label is DRAWN from the wine's names and year by the existing label drawing: that is the
fallback, and it imitates no real label. Nothing is fetched from another server and nothing is generated.

### 6. Read-only: what the new panel does not do yet

The new view's panel has "Wine details" (a real link to the wine's page, where every action is) and "Put it back".
It does NOT have the existing panel's "Open this bottle" and "Move". Those are writes, and this sprint was to stay
read-only; they belong with the movement work (Sprint 4, where a move must name an index). No user loses anything:
places with a template cannot exist in production yet, and every place from before templates keeps the existing
view and its actions. It is listed as a requirement before activation.

### 7. Phones

On a narrow screen the panel goes into a slot directly under the picture (the gallery's tested layout), the bottle
has the whole picture, and the picture is scrolled back into view when a bottle is taken out. The existing view's
full-screen takeover was not copied: it would resize the canvas at the very moment the bottle leaves, and the
zero-drift hand-over is measured against a camera that stands still.

## Consequences

- Production is byte-for-byte what it was: the gate cannot open there, and with it closed nothing new loads.
- An internal preview shows the real cellar in the new view, place by place, truthfully.
- `Cellar3DView` gained one optional prop (`only`); `InspectableStorage` one optional slot (`actions`). Their
  behaviour without them is unchanged, and their existing tests still pass.
- Two write actions are missing from the new panel (decision 6).

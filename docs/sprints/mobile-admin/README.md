# Mobile Admin Portal 2.0

The whole admin portal (`/admin`, 17 page variants) works on an iPhone: daily checks, wine management, corrections,
insights, architecture and health, without a desktop. The desktop keeps its sidebar, tables, and map with panel.
One pull request, frontend only: no schema, RLS, authorisation, API, engine, monitoring or environment change.

## Audit (phase A), before the sprint

Measured at 320 and 390 px against the local stack, signed in as the test admin, on `main` at `ed3e529`.
"Overflow" is how far the page scrolled sideways at 320 px. "Wide tables" counts sideways-scrolling tables inside
the page at 390 px. A detail page was audited with whatever local data existed.

| Route                                 | Overflow at 320 px | Wide tables at 390 px | What did not work on a phone                                                      |
| ------------------------------------- | -----------------: | --------------------: | --------------------------------------------------------------------------------- |
| shared layout                         |                  — |                     — | horizontally scrolling nav as the only navigation; no back; no safe areas         |
| `/admin`                              |              24 px |                     0 | no status at a glance; large tiles; values too wide for 320 px                    |
| `/admin/wines`                        |                  0 |                     1 | 9-column table cut off; 8 filters always open above the list; 36 px controls      |
| `/admin/wines/[id]`                   |              70 px |                     2 | fixed 12rem label column, 288–384 px inputs, file input, sticky nav under header  |
| `/admin/bottle-photos`, `/[id]`       |                  0 |                     1 | table cut off; fixed 10rem label column                                           |
| `/admin/catalog`                      |              25 px |                     1 | a select wider than the screen; table cut off; 20 px sort links                   |
| `/admin/catalog/[id]`                 |                  0 |                     2 | four tables cut off                                                               |
| `/admin/catalog/corrections`, `/[id]` |                  0 |                     1 | 8-column table; proposed and confirmed values in one run-on string; 28 px buttons |
| `/admin/sources`                      |                  0 |                     0 | a 16rem minimum squeezed a label to one letter per line                           |
| `/admin/users`, `/[id]`               |                  0 |                     2 | tables cut off                                                                    |
| `/admin/product`, `/admin/ai`         |              24 px |                   1–2 | KPI values too wide; tables cut off                                               |
| `/admin/feedback`                     |                  0 |                     1 | the message squeezed into a table column                                          |
| `/admin/system`                       |                  0 |                     1 | a 67-component map at 13 %: unreadable; tabs scroll sideways; 760 px register     |
| `/admin/system/health`                |                  0 |                     0 | no filters; problems not first; counts in a line                                  |

Inputs were 14 px, so iOS Safari zoomed the page whenever one got focus.

## What changed (phases B–D)

**Shared foundation.**

- `features/admin/nav-model.ts`: the structure, in one place, with page titles and "back" targets.
  Unit-tested in `nav-model.test.ts`.
- `features/admin/admin-shell.tsx`: below 1024 px, a sticky header and a tab bar. The header shows the area, the
  title, back on detail pages and a menu with every page. The tab bar has Overview, Wine, Insights and System; a
  multi-page area opens a sheet. Both pad for the notch and the home indicator. The existing `ui/sheet.tsx`
  (native `<dialog>`: focus trap, Escape, scroll lock, focus return) is reused.
- `app/admin/_ui.tsx` `Table`: below 768 px the same markup becomes cards (CSS only, one DOM).
  - The primary cell is the title; other cells show their label above the value.
  - Sorting moves to a row of sort links.
  - `wideOnPhone` gives long text the full width; `hideOnPhone` is available.
  - Explicit table roles keep screen readers reading a table.
- Controls are 44 px on a phone (40 px inside table rows). Inputs use 16 px text, so iOS does not zoom. Selects and
  inputs never exceed their container.
- `features/admin/phone-disclosure.tsx`: filters folded behind one button with the number of active filters. They
  stay inside the page's form; desktop shows them open.
- `features/admin/submit-button.tsx` ("Measuring…" while an action runs).
- `features/admin/confirm-button.tsx`: tap twice for irreversible removals ("Delete label", "Remove picture").
- These client components live in `features/admin/`, because `admin-pages.test.ts` keeps `app/admin/` server-only.

**Pages.**

- Overview: a CELLR status card (newest health, its age, monitor state, never healthy when unknown), the work queue
  as rows, seven quick actions, then the metrics.
- Wine Master Database: search with the search key, a filter panel, sort links, and cards that open the wine.
  Back returns to the same search.
- Wine and photo details: label/value lists stack on a phone; forms and file inputs fit; the section jump bar sits
  under the header.
- Corrections: proposed and confirmed values field by field, a full-width review form, and the result as
  "Done. / Not done." messages.
- Every other page: the shared changes above, and inline "← list" links hidden where the header has back.

**Architecture.**

- On a phone the Map view is a searchable list of components, grouped by layer. Each row shows the summary,
  status, health (when measured), uses/used-by counts and risks.
- A tap opens the details in a sheet: the same `DetailPanel` with trace, impact, paths, evidence and risks, plus
  "Show on the map".
- The drawing is its own mode (`#m=map`). It fills the screen, has pinch, drag, fit-all, fit-to-highlight and 44 px
  zoom buttons, and shows a card for the selection with "Details".
- The other tabs fit as a 3×2 grid, and the register becomes cards with sort chips.
- Deep links (`#c=…`), the hash and history keep working. The desktop is unchanged.

**Health.**

- A summary card with four counts (glyph, word, number) and the monitor state.
- A "Needs attention" list linking to failed or degraded checks.
- Filters All, Problems, Healthy and Unknown, with problems sorted first in every group.
- Each check says "no measurement" when it has none.
- "Measure now" shows that it is working. No new way to start rounds was added.

## Tests (phase E)

- `e2e/admin-mobile.spec.ts`:
  - phone project:
    - every page at 390 and 320 px: 200, a heading, the header and tab bar, no sideways scroll;
    - navigation: tab bar, sheets, menu, current page, focus return, back, history and direct links;
    - wine search, filter panel and sorting;
    - a correction reviewed and saved, then checked in the database;
    - a bottle photo approved, then checked in the database;
    - architecture: list, search, details sheet, map mode, a touch pinch that zooms the map and not the page,
      fit-all, deep link, register cards;
    - health: counts, the unknown rule, filters, details;
    - overview: status card, quick actions, `no-store`;
    - axe on six pages and the open menu;
    - a non-admin gets a 404 and no navigation;
  - desktop project: sidebar, breadcrumbs, real table headers, open filters, map with panel, no sheet.
- `e2e/admin-system.spec.ts` (phone test) and `e2e/sprint-u.spec.ts` ("Remove picture" now asks twice): updated to
  the new behaviour.
- Screenshots: `apps/web/test-results/shots/mobile-admin/` (local stack data only).

## Result, measured after the sprint

- Production build, local stack, signed in as the test admin.
- Every route at 320, 375, 390, 430, 768, 1024 and 1440 px (17 routes × 7 widths): HTTP 200 and no sideways page
  scroll, 119 of 119.
- iPhone landscape (844 × 390, touch): no sideways scroll on Overview, Wine Master Database, Corrections,
  Architecture and Health. The tab bar stays reachable; below 500 px of height it is lower and shows icons only.
- Desktop at 1440 px: sidebar, breadcrumbs, tables with sortable headers, map with its panel. Unchanged
  (`admin-mobile.spec.ts`, desktop project, and the existing `admin-system.spec.ts` desktop flow).
- E2E against the production build:
  - with 4 workers, `admin-mobile`, `admin-system`, `system-health`, `sprint-u`, `sprint-p` and `feedback`: all
    48 that run there pass;
  - with 1 worker, `catalog-learning`, `sources`, `sprint-q`, `sprint-t`, `admin-http`, `admin-sources`,
    `sprint-r` and `bottle-art-crop`: 23 of 23 pass.
- Known, and also seen on `main` before this sprint:
  - run with several workers, `catalog-learning`, `sources`, `sprint-q` and `sprint-t` can fail. They share the
    `catalog_learning` switch and the one test admin, whose sign-in codes overwrite each other.
  - `admin-mobile.spec.ts` signs in once per worker and retries a sign-in that lost that race.

## Not verifiable here: real iPhone and installed PWA

Everything above ran in Chromium with phone emulation (touch, 390/320 px, device scale 2). That is not iOS Safari:
safe-area insets are 0 in emulation, and WebKit's own behaviour (keyboard, `100dvh`, rubber-band scrolling, the
standalone app) was not exercised. Manual check on an iPhone, once on a preview deployment:

1. In Safari, open `/admin` and sign in as an admin.
2. Share → Add to Home Screen, then open CELLR from the home screen.
3. Overview:
   - the header sits under the notch and the tab bar sits above the home indicator;
   - nothing is hidden behind either.
4. Tab bar:
   - Wine opens a sheet; choose Corrections;
   - the tab stays marked;
   - the back swipe and the header's back button behave.
5. Wine Master Database:
   - tap the search field: the page does not zoom, and the keyboard's Search key submits;
   - open Filters, change one, Apply.
6. Open a correction and mark it Reviewed. The green "Done." message appears.
7. Architecture:
   - tap a component: the sheet opens, scrolls inside, and drags down to close;
   - Show on the map: pinch and drag move the map, not the page;
   - fit-all works.
8. Health:
   - filter Problems and Unknown;
   - unfold a check;
   - Measure now shows "Measuring…", then a result.
9. Turn the phone to landscape on two pages: no sideways scroll, and the tab bar stays reachable.
10. Close the app, reopen it from the home screen: the session holds. Sign out, reopen `/admin`: the sign-in page,
    no admin content.

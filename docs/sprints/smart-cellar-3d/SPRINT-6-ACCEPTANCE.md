# Smart Cellar 3D — Sprint 6: live preview, visual acceptance and release readiness

Branch `claude/adoring-cori-jn7num`, from `main` at `813fe48` (Sprint 5, PR #99). One PR; nothing merged, deployed or
switched on. **No production data was read or changed, no production setting or gate was changed, no migration was
added or run.**

**Verdict (§18): ready for INTERNAL PREVIEW. Not ready for a controlled beta, NO-GO for production.**

What this sprint added is not product functionality. It is a way for the owner to **see and use everything sprints
1–5 built**, safely: a repeatable demonstration environment on an isolated database, a premium demo cellar, browser
acceptance tests of the six workflows on that environment, and this report. Two small defects found while looking
were fixed (§12).

## Contents

1. Preview architecture
2. The database target, safely identified
3. Read-only mode and interactive isolated mode
4. Feature-flag status
5. Demo fixtures
6. Starting it and getting in
7. Desktop screenshots
8. Mobile screenshots
9. Workflow results
10. Physical-device tests (required, not done)
11. Performance
12. Bugs fixed
13. Remaining UX issues
14. Security and RLS
15. Production migration dependencies
16. Production activation dependencies
17. Rollback plan
18. GO / NO-GO

---

## 0. Readiness matrix (phase A)

Checked from the repository, its CI, its documentation and the tools available to this session. Values of secrets
were never read; the Vercel environment could not be read at all (below).

| Item                                                 | Finding                                                                                                                                                                                                                                                                                                    | Status                                     |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Latest code and CI                                   | `main` at `813fe48` (PR #99 merged), its CI green on the last commit `57e77a8`.                                                                                                                                                                                                                            | Ready                                      |
| Vercel Preview environment variables (names, scopes) | The Vercel connector answered **403** for this project's environment variables (team `jp-builds`). Nothing was read, nothing was changed, no access was requested.                                                                                                                                         | Requires owner approval (team access)      |
| Does Preview use production Supabase?                | **Yes, by documentation**: `docs/SETUP.md` §5 and the Sprint 2B.3/3 reports state that Preview shares Production's database. Not re-verified here (previous row). Treated as fact for safety: **a Vercel Preview is read-only for Smart Cellar**, and the code enforces it (§2).                           | Blocked for interactive testing            |
| An isolated test database                            | **None exists outside a developer machine.** The local stack (temporary Postgres 16 + PostgREST + fake Auth) is isolated and disposable and is what this sprint uses.                                                                                                                                      | Ready (local) / Requires approval (hosted) |
| Required migrations                                  | `0043`–`0045` (structure, zones, RPCs). The local stack applies **every** migration in the repository, the way CI does. Production has `0043`–`0046` recorded (`docs/MIGRATIONS.md`, 2026-11-18).                                                                                                          | Ready                                      |
| Flag dependencies                                    | `CELLR_SMART_CELLAR` (read/write) ← `_3D`, `_BUILDER`, `_PLACEMENT` ← `_ADVICE`. All closed on Production by code. §4.                                                                                                                                                                                     | Ready                                      |
| Template and renderer compatibility                  | All 14 templates render; 11 can be saved; 3 (double-depth rack, modular cubes, diamond bins) are preview-only while depth is off. A place from before templates keeps the existing 3D view.                                                                                                                | Ready                                      |
| Authentication and household isolation               | Real RLS in the local stack (same migrations as production), real PostgREST; only Auth is a local fake. Verified by the acceptance tests (§14).                                                                                                                                                            | Ready                                      |
| Preview access protection                            | Vercel Deployment Protection settings could not be read (403).                                                                                                                                                                                                                                             | Requires owner check                       |
| An externally reachable browser preview              | **Not possible from this cloud session**: it cannot publish a port. The demo runs on any Linux x64 machine (Codespaces included) and is reachable there; a phone needs port forwarding (Codespaces) or `DEMO_HOST` on a trusted network (§6). A hosted, durable preview needs a separate Supabase project. | Requires owner approval                    |

---

## 1. Preview architecture

```
   browser (desktop / phone)
        │  only ever talks to the Next.js app (cookies, /api/v1/…)
        ▼
   CELLR production build, `next start`, as a Vercel *preview* (VERCEL_ENV=preview)
     :3200  CELLR_SMART_CELLAR=write   + _3D _BUILDER _PLACEMENT _ADVICE = 1   (interactive)
     :3201  CELLR_SMART_CELLAR=read    + the same four                       (read-only)
        │  server side only
        ▼
   local stack on :54321 (scripts/local-stack)
     fake Auth (email code; never public) + gateway ─► PostgREST ─► temporary Postgres 16 on :54997
                                                                     every migration of the repository,
                                                                     RLS and functions as on production
```

- **Why the production build and the preview markers**: the gates are evaluated exactly as they would be on a Vercel
  Preview (`internalPreviewIn`), so what the owner sees is what a preview would serve, not a development server.
- **Why two servers**: one database, two modes side by side; the same household can be opened in both.
- The browser never talks to the database or to Auth directly (only the server and `proxy.ts` use the Supabase URL),
  so forwarding the app's port is enough to reach it from elsewhere; the fake Auth is never forwarded.
- **Alternative for a durable, hosted preview** (not built: billable, needs approval): a separate Supabase project
  (`docs/MIGRATIONS.md` §6: link, dry run, `db push --include-seed`), a Vercel environment or branch whose
  `NEXT_PUBLIC_SUPABASE_URL`/keys point at it, `CELLR_SMART_CELLAR_WRITE_DATABASE=<that host>`, the five gates, and
  Deployment Protection on. The demo seed (`scripts/demo/seed.mjs`) would need a non-localhost mode and real email
  sign-in for that; today it refuses anything but localhost, on purpose.

## 2. The database target, safely identified

- The demo's database is a **temporary Postgres 16 cluster** created by `scripts/lib/temp-cluster.sh` in a temporary
  directory, listening on `127.0.0.1:54997`, destroyed on `scripts/demo/down.sh`. It has **no production credentials,
  no production data, no photos**; every row comes from `scripts/demo/seed.mjs` or the tests.
- The app is given placeholder keys (`sb_publishable_localstack_…`, `sb_secret_localstack_…`); no real key exists
  anywhere in this setup.
- Writes are allowed only because `lib/smart-cellar-write-target.ts` sees a **loopback** database. The production host
  (`vvelgyhbjfmjvxkzekyz.supabase.co`) is named in that code as never writable: even `CELLR_SMART_CELLAR=write` with
  `CELLR_SMART_CELLAR_WRITE_DATABASE` set to it is refused (unit-tested since sprint 1C).
- `scripts/demo/seed.mjs` refuses to run unless both the app and the stack are on `localhost`/`127.0.0.1`. Its reset
  deletes only households **all** of whose members have `@demo.cellr.test` addresses, through the local stack's own
  test endpoint (which exists only in the local stack).

## 3. Read-only mode and interactive isolated mode

| Mode                  | Where                                                     | What works                                                                                                                                                                            | What is refused                                                                                   |
| --------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Read-only             | :3201 (and any Vercel Preview on the production database) | the 3D cellar, all templates, bottle inspection, zones, Smart Placement advice, the Rack Builder (designing and previewing)                                                           | saving a layout, moving, swapping, taking off (API **403**; the UI says "you can look, not move") |
| Interactive, isolated | :3200 on the local stack                                  | everything above, plus creating and editing places (Rack Builder save), placing, moving, swapping, taking off, Undo, following a recommendation; every view refreshes from the server | depth (index > 1): refused whatever is set                                                        |

No parallel mutation logic exists: the demo and the tests use the same API the product uses (`/api/v1/storage`,
`/smart-cellar/storage/:id/layout`, `/smart-cellar/bottles/:id/move`, `/swap`, `/recommendations`).

## 4. Feature-flag status

| Flag                                | Production (code)         | Vercel Preview (documented) | Demo :3200           | Demo :3201 |
| ----------------------------------- | ------------------------- | --------------------------- | -------------------- | ---------- |
| `CELLR_SMART_CELLAR`                | writes never; read if set | `read` recommended          | `write`              | `read`     |
| `CELLR_SMART_CELLAR_3D`             | closed whatever is set    | owner's choice              | `1`                  | `1`        |
| `CELLR_SMART_CELLAR_BUILDER`        | closed whatever is set    | owner's choice              | `1`                  | `1`        |
| `CELLR_SMART_CELLAR_PLACEMENT`      | closed whatever is set    | owner's choice              | `1`                  | `1`        |
| `CELLR_SMART_CELLAR_ADVICE`         | closed whatever is set    | owner's choice              | `1`                  | `1`        |
| `CELLR_SMART_CELLAR_WRITE_DATABASE` | production host refused   | unset (shares production)   | unset: loopback only | unset      |
| depth (`DEPTH_PLACEMENT_ENABLED`)   | `false` in code           | `false`                     | `false`              | `false`    |

The actual values on Vercel could not be read (§0). **Nothing about the production gating policy changed.**

## 5. Demo fixtures

`scripts/demo/seed.mjs`, through the app's own API as the signed-in demo person (RLS applies), deterministic:

- **"Demo cellar"** — `owner@demo.cellr.test`, with `partner@demo.cellr.test` as a second member.
  - 14 fictional wines (no real producer or label): red, white, rosé, sparkling, orange, dessert, fortified; vintage
    and non-vintage; several bottles of one vintage; no photos (the drawn label is used — no label image was
    downloaded or redistributed).
  - **12 places**, one of each of the **11 templates that can be saved**, each with its own look and occupancy:
    warm walnut rack (6 × 8, warm light, 25 bottles), black metal wall system, **premium dual-zone cooler** (graphite,
    glass door, warm light; serving zone shelves 1–3 at 8 °C with 8 bottles, keeping zone 4–8 at 12 °C with 7 long-term
    bottles placed by the move API), kitchen cooler (stainless, cool light, a zone without a set temperature),
    undercounter cooler (black lacquer, serving 7 °C), open oak shelves, mahogany glass cabinet, pine crates, brass wall
    pegs, wall rails, an **empty** white studio rack, and an **"Old fridge" from before templates** (existing view).
  - 86 bottles, 5 of them without a place (to try placement and advice).
- **"Demo neighbours"** — `neighbour@demo.cellr.test`, a small rack and 5 bottles of their own: a second household
  for isolation checks.
- **The three depth templates** (double-depth rack, modular cubes, diamond bins) are **not** in the database: they
  cannot be saved while depth is off. They are fully visible in the Rack Builder, labelled "Preview only", with no
  Save button and the reason said. Nothing pretends they persist.
- Cleanup: `node scripts/demo/seed.mjs --reset` removes every demo household (and every acceptance-test household,
  which also use `@demo.cellr.test`) and seeds again; `down.sh` destroys the whole database.

## 6. Starting it and getting in

**Requirements**: Linux x64 (the local stack downloads the static Linux PostgREST), PostgreSQL 16 server binaries
(`/usr/lib/postgresql/16/bin`, or `PGBIN=…`), Node 22 and pnpm, `pnpm install` done. GitHub Codespaces satisfies
this after `sudo apt-get install -y postgresql-16` (not tried in a Codespace in this sprint: unverified).
macOS is not supported by the local stack today.

```bash
bash scripts/demo/up.sh              # first time builds the app (a few minutes), starts everything, seeds the demo
bash scripts/demo/up.sh --rebuild    # the same after pulling new code
node scripts/demo/seed.mjs --reset   # a fresh demo cellar on the running environment (DEMO_FIXED_OTP must match)
bash scripts/demo/down.sh            # stop everything; the database is gone afterwards
```

| Open        | URL                                                                     | Sign in as (code `246810`, or `DEMO_FIXED_OTP`)                                   |
| ----------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Interactive | `http://localhost:3200`                                                 | `owner@demo.cellr.test` · `partner@demo.cellr.test` · `neighbour@demo.cellr.test` |
| Read-only   | `http://localhost:3201`                                                 | the same (localhost shares the sign-in between ports)                             |
| Then        | Cellar → **3D**; Cellar → Racks → **Design a new place** (Rack Builder) |                                                                                   |

The fixed code works **only** for `@demo.cellr.test` addresses and only in the fake Auth, which listens on localhost.

**From a phone** (`localhost` on a phone is the phone itself, so the URLs above do not work there):

- **Codespaces (recommended)**: in the Ports panel, forward **3200** (and 3201) with visibility **Private** and open
  the forwarded `https://…-3200.app.github.dev` address on the phone, signed in to GitHub. **Do not forward or make
  public 54321 (fake Auth) or 54997 (database)**; if Codespaces forwards them automatically, stop forwarding them.
  `up.sh` detects the Codespace and prints both addresses. Sign-in through the forwarded port needed a fix (§12.4):
  the port forward delivers requests with the internal host (`localhost:3200`), so the same-origin check refused
  the external origin with 403. Each demo app now accepts exactly the forwarded address of its own port, built from
  `CODESPACE_NAME` and `GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN`, which Codespaces sets in the machine.
- **Own Linux machine on a trusted Wi-Fi**: `DEMO_HOST=0.0.0.0 bash scripts/demo/up.sh`, then
  `http://<the machine's LAN address>:3200` on the phone. Anyone on that network can then sign in to the demo
  (synthetic data only). Not on public or shared networks.
- **Hosted (durable)**: needs the separate Supabase project and Vercel changes of §1, which need owner approval.

## 7. Desktop screenshots (1440 × 900, software rendering)

- [`screens/6-places-desktop.jpg`](./screens/6-places-desktop.jpg) — all 12 places of the demo cellar.
- [`screens/6-journey-desktop.jpg`](./screens/6-journey-desktop.jpg) — the cellar, a bottle taken out, the dual-zone
  cooler with its two zones, advice (keep / shown in 3D / serve soon), the read-only mode.
- [`screens/6-builder-desktop.jpg`](./screens/6-builder-desktop.jpg) — the Rack Builder: catalogue, a dual-zone
  cooler being designed, a preview-only template.

Made by `apps/web/e2e-demo/tour.spec.ts` (`DEMO_TOUR=1`), which only looks (it opens panels and cancels).

## 8. Mobile screenshots (iPhone 13 viewport in Chromium; not a real iPhone)

- [`screens/6-places-phone.jpg`](./screens/6-places-phone.jpg)
- [`screens/6-journey-phone.jpg`](./screens/6-journey-phone.jpg)
- [`screens/6-builder-phone.jpg`](./screens/6-builder-phone.jpg)

## 9. Workflow results

`apps/web/e2e-demo/acceptance.spec.ts` against the running demo (production build, preview gates, isolated
database), every test with its own new synthetic person and household, on **desktop (1440 × 900) and phone (iPhone 13
emulation)**: **36 of 36 passed** (18 × 2). Persistence is checked through the API as that person, never assumed from
the screen.

| Workflow / scenario                       | What is verified                                                                                                                                                    | Desktop | Phone  |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------ |
| W1 Design my cellar                       | template → name, size, colour, light → live preview follows → save → stored template, size and look → the place in the 3D cellar                                    | passed  | passed |
| W2 Organise my cellar                     | a bottle without a place → advice → the first recommendation is in the cooler's keeping zone → followed → stored on **exactly** that spot; nothing moved by looking | passed  | passed |
| W3 Reorganise                             | a placed bottle → another place → stored there, source count −1, destination +1 → Undo → back on its original spot                                                  | passed  | passed |
| W4 Build a wine cooler                    | dual-zone, split moved (1–3 / 4–8), keeping zone set to 13.0 °C → saved zones exactly → the zone legend in the cellar                                               | passed  | passed |
| W5 Mobile                                 | W1–W4 and W6 run on the phone project                                                                                                                               | —       | passed |
| W6 Recover: request never arrives         | "The bottle didn't move", the bottle still on its spot                                                                                                              | passed  | passed |
| W6 Recover: answer lost                   | a fresh read decides; "now at …" only because it really moved; no Undo (not attributable)                                                                           | passed  | passed |
| W6 Recover: conflicting destination       | the advised spot taken meanwhile → refused, said ("just taken"), nothing placed elsewhere, advice asked again                                                       | passed  | passed |
| The demo's fixed sign-in code             | accepted for a `@demo.cellr.test` address, refused for any other (also `…@demo.cellr.test.example.com`)                                                             | passed  | passed |
| First-time user                           | no bottles, no places: no 3D view offered                                                                                                                           | passed  | passed |
| Empty cellar (bottles, no place)          | "Build your cellar first"                                                                                                                                           | passed  | passed |
| Returning user                            | signed out and in: the same cellar and view                                                                                                                         | passed  | passed |
| Household isolation / permission failures | another household's bottle, move, place and advice: **404** ×4; their bottle untouched; nothing of theirs on screen                                                 | passed  | passed |
| Household switching                       | each household shows only its own places                                                                                                                            | passed  | passed |
| Read-only deployment                      | move **403**; "you can look, not move"; no confirm button; nothing changed                                                                                          | passed  | passed |
| WebGL unavailable                         | the flat picture; a bottle chosen there is moved and stored                                                                                                         | passed  | passed |
| WebGL context lost                        | "The 3D view has paused" → "Show 3D again" → drawn again                                                                                                            | passed  | passed |
| Reduced motion                            | a bottle out and back; **the Move button does not shift while details load** (regression test for §12.1)                                                            | passed  | passed |
| Slow rendering (CPU 4× slower)            | the view draws and a bottle can be inspected                                                                                                                        | passed  | passed |
| The seeded demo                           | each of the 11 templated places draws; the old fridge uses the existing view                                                                                        | passed  | passed |
| Large collection                          | covered by the benchmarks (§11): 40 / 200 / 900 / 1,200 bottles                                                                                                     | §11     | §11    |

Run: `bash scripts/demo/up.sh`, then in `apps/web`:
`pnpm exec playwright test -c playwright.demo.config.ts acceptance`, then `node scripts/demo/seed.mjs --reset`.
The existing suites (`placement.spec.ts`, `advice.spec.ts`, `rack-builder.spec.ts`, `smart-cellar-3d.spec.ts`)
cover the same flows in more depth on the local stack and still pass (§9a).

### 9a. Regression run of the existing suites

On the local stack with the main Playwright configuration (production build), the Smart Cellar suites
`placement`, `advice`, `rack-builder`, `smart-cellar-3d`, `smart-cellar-3d-old-db`, `smart-cellar-api` and
`cellar3d`, desktop and phone: **217 passed, 4 failed, 47 skipped** (skipped: tests of the other project).

| Failure                                    | Outcome                                                                                                                      |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `cellar3d.spec.ts:171` (desktop and phone) | fails again when run alone; **fails the same way on `main`**, reported since sprint 2B.3 (the existing 3D view; not touched) |
| `smart-cellar-3d.spec.ts:466` (phone)      | passed when run again; a known load-time flake (Sprint 5 report)                                                             |
| `smart-cellar-3d.spec.ts:599` (desktop)    | passed when run again; it failed before the panel opened (the 3D stage not loaded within the test's 5 s)                     |

Also: `pnpm format:check`, `pnpm lint` (the one warning that exists on `main`), `pnpm typecheck`, `pnpm test`
(domain 1,007, web 1,347 + 13 skipped, scripts 244 — all passed), `pnpm architecture:inventory` (unchanged),
`scripts/check-bundle-secrets.sh`, `pnpm migrations:check`, `scripts/db-test.sh` (1,648 passed).

## 10. Physical-device tests (required, NOT done)

No physical device was used in this sprint. Everything above ran in headless Chromium with **software rendering**
(SwiftShader), including the phone viewport. **Real-device testing is required before any beta.** The protocol, per
device (iPhone with Safari, Android with Chrome, a desktop with Chrome), on the demo (§6, from a phone through
Codespaces or `DEMO_HOST`):

| #   | Check                                                                                                                                                | iPhone Safari | Android Chrome | Desktop Chrome |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | -------------- | -------------- |
| 1   | Sign in (code 246810); the session survives closing and reopening the tab; signing out works                                                         | ☐             | ☐              | ☐              |
| 2   | Loading: Cellar → 3D shows the walnut rack within a few seconds; note the time on a cold start                                                       | ☐             | ☐              | ☐              |
| 3   | Rotate with one finger, pinch to zoom, two fingers to slide; the page itself does not scroll while turning; nothing scrolls sideways                 | ☐             | ☐              | ☐              |
| 4   | Touch targets: place chips, Place, Move, Put it back, Undo, the picker's spots are easy to hit with a thumb (no wrong taps in 20 tries)              | ☐             | ☐              | ☐              |
| 5   | Tap a bottle: it comes out, the label reads, it turns with a drag; Put it back returns it to the same spot                                           | ☐             | ☐              | ☐              |
| 6   | Every place of the demo opens; the dual-zone cooler shows both zones "set to …"; the old fridge shows the existing view                              | ☐             | ☐              | ☐              |
| 7   | Placement: Move → another place → a spot → confirm → toast → Undo; a bottle without a place → advice → Show → Place here                             | ☐             | ☐              | ☐              |
| 8   | Advice cards readable in Dutch and English (long lines, wrapping), VoiceOver / TalkBack read the reasons in order                                    | ☐             | ☐              | ☐              |
| 9   | Rack Builder: choose a cooler, change size, colour, light, zones; the preview follows within a moment; save; see it in the cellar                    | ☐             | ☐              | ☐              |
| 10  | Airplane mode just before confirming a move: "The bottle didn't move", nothing moved; back online, try again works                                   | ☐             | ☐              | ☐              |
| 11  | Rotate the phone with a panel open: nothing hidden under the notch or the home indicator, no sideways scrolling                                      | ☐             | ☐              | ☐              |
| 12  | Memory and stability: switch between all 12 places three times, take out 20 bottles: no blank picture, no reload, no "paused" message                | ☐             | ☐              | ☐              |
| 13  | Heat and battery: 10 minutes of normal use; note the battery drop and whether the phone gets warm; at rest (nothing touched) nothing should be drawn | ☐             | ☐              | ☐              |
| 14  | Frame rate only from the device's own tools (Safari Web Inspector timeline, Chrome remote debugging), never from this report                         | ☐             | ☐              | ☐              |
| 15  | Read-only (:3201): the same views; Move says it can't move here                                                                                      | ☐             | ☐              | ☐              |

Record: device model, OS and browser versions, pass/fail per row, screenshots of any failure.

## 11. Performance

Re-run on this branch's production build, same machine as sprints 2B.3–5 (4 cores, **SwiftShader software
rendering**, headless Chromium 153, local stack), with the gated benches already in the repository. **No frame rate
on a real device is claimed**; these numbers compare builds on one machine. "1,200" is 899 bottles in the measured
place plus 300 elsewhere (one place cannot hold more while depth is off). Raw results are not committed.

**Smart Placement (advice)** — `PERF_ADVICE=1 … perf-advice --workers=1`, desktop / phone:

|                                                   | 40           | 200          | 900          | 1,200        | Sprint 5 (40 → 1,200) |
| ------------------------------------------------- | ------------ | ------------ | ------------ | ------------ | --------------------- |
| API, median of 7                                  | 107 / 98 ms  | 106 / 111 ms | 117 / 114 ms | 170 / 151 ms | 66–109 ms             |
| Response size                                     | 1.7 kB       | 1.7 kB       | 2.4 kB       | 3.1 kB       | the same              |
| Place tapped → advice on screen, median of 3      | 663 / 480 ms | 755 / 616 ms | 912 / 835 ms | 999 / 834 ms | 450–908 ms            |
| Show tapped → picture with the ring               | 24 / 22 ms   | 34 / 31 ms   | 55 / 57 ms   | 61 / 52 ms   | 17–55 ms              |
| Advice requests while showing options (9 taps)    | 0            | 0            | 0            | 0            | 0                     |
| Furniture built, before → after                   | 1 → 1        | 1 → 1        | 1 → 1        | 1 → 1        | the same              |
| Pictures in 3 s at rest (advice open / after)     | 0 / 0        | 0 / 0        | 0 / 0        | 0 / 0        | the same              |
| Geometries / textures / programs after each round | 28/7/32 ×3   | 26/4/29 ×3   | 26/4/9 ×3    | 26/4/9 ×3    | identical             |

The advice API is **30–60 ms slower** than the Sprint 5 measurement at every size, with the same number of database
requests and the same responses. Sprint 5's review corrections (two reads changed from inner to left joins) were
merged after that measurement, which is the likely cause; it was **not profiled** in this sprint. It stays well under
the time the panel takes to appear and grows mildly with size; worth a look before a beta.

**Placement (moves)** — `PERF_PLACEMENT=1 … perf-placement --workers=1`, 10 confirmed moves per size, desktop / phone:

|                                                 | 40           | 200          | 900              | 1,200 (899 + 300) |
| ----------------------------------------------- | ------------ | ------------ | ---------------- | ----------------- |
| Navigation → first picture with all bottles     | 5.2 / 6.3 s  | 5.8 / 5.2 s  | 5.7 / 6.1 s      | 6.5 / 6.4 s       |
| Draw calls / triangles at rest                  | 16 / 32,310  | 12 / 79,592  | 12 / 355,480     | 12 / 355,480      |
| Bottle out, median                              | 637 / 393 ms | 864 / 427 ms | 1,141 / 1,075 ms | 1,327 / 1,018 ms  |
| Move → panel with the picker, median            | 2.0 / 1.2 s  | 3.1 / 1.2 s  | 3.9 / 3.6 s      | 4.7 / 3.9 s       |
| Destination chosen → target ring                | 27 / 25 ms   | 28 / 26 ms   | 58 / 47 ms       | 67 / 64 ms        |
| Confirm → bottle drawn on its new spot, median  | 1.9 / 5.4 s  | 3.2 / 5.5 s  | 4.2 / 3.9 s      | 5.0 / 4.2 s       |
| API requests per confirmed move                 | 6            | 6            | 6                | 6                 |
| Geometries / textures / programs after 5 rounds | 35/8/32 ×5   | 32/6/29 ×5   | 32/6/29 ×5       | 32/6/29 ×5        |
| Furniture built (start → after 10 moves)        | 1 → 1        | 1 → 1        | 1 → 1            | 1 → 1             |
| Pictures in 3 s at rest, after 10 moves         | 0            | 0            | 0                | 0                 |
| Lost taps in 80 moves                           | 0            | 0            | 0                | 0                 |

Against Sprint 4 (same bench): the picture is identical (calls, triangles, held resources), nothing is rebuilt,
nothing is drawn at rest, and the times are within that report's range. **One API request more per move (6 against 5)**, constant at every size (not a growth); most likely a refresh added with Sprint 5's advice (the bench server has
advice on), **not investigated** in this sprint. The multi-second times are pictures drawn in software (about a second per picture at 900 bottles), as Sprint
4 explained; real GPUs are to be measured on devices (§10).

**The 3D cellar (inspection)** — `PERF_PRODUCT3D=1 … perf-product3d`, desktop, product view against the gallery:

|                                                     | 40             | 200            | 900             |
| --------------------------------------------------- | -------------- | -------------- | --------------- |
| Draw calls / triangles at rest                      | 16 / 33,122    | 12 / 79,980    | 12 / 355,868    |
| Programs, all warmed before the first tap           | 31             | 28             | 28              |
| Pictures in 3 s at rest                             | 0              | 0              | 0               |
| First tap → bottle moves / later taps               | 40 / 20 ms     | 38 / 24 ms     | 58 / 38 ms      |
| Held after 5 inspections (geo/tex/prog)             | 43/8/31        | 32/6/28        | 40/6/28         |
| Placements API (time, size)                         | 134 ms, 2.2 kB | 111 ms, 6.8 kB | 104 ms, 26.6 kB |
| Turning, median between pictures: product / gallery | 567 / 483 ms   | 800 / 583 ms   | 983 / 1,050 ms  |

Identical to Sprint 2B.3 in every count (calls, triangles, programs, held resources, nothing at rest). The turning
times are not comparable with 2B.3's like-for-like table: this run drew the product at its natural 974 × 542 against
the gallery's 758 × 542 (software rendering scales with pixels).

**Rack Builder** — `PERF_BUILDER=1 … perf-builder --project=desktop`: navigation → first picture 1,527 ms (Sprint 3:
1,510); one shelf more → picture 375 ms median (280); another colour 314 ms (294); another template 460 ms median
(485); 17/8/8 held after four rounds of six switches (identical); nothing at rest; one canvas; no layout shift; an
existing place of 900 bottles: colour → picture 1,988 ms (1,897). Within the noise of one run on this machine,
except the shelf change (+95 ms), which is drawing in software and not investigated further.

**The demo environment itself** (12 places, 86 bottles; not a bench): every place drew within the acceptance tests'
limits on desktop and phone, including with the CPU slowed 4× (§9).

## 12. Bugs fixed

1. **The bottle panel's buttons jumped while its details loaded** (found by the acceptance run: a click on Move landed
   while the panel grew by one line and did nothing — on a phone the same tap could land beside the button or on
   "Wine details" and leave the page). The "In your cellar" line, which arrives with the wine's details, is now held
   open with "…" while they load, so the buttons stay where they are. `features/cellar/smart-cellar-3d.tsx`;
   regression test in the acceptance suite (Move's position is the same before and after the details arrive, with
   the details deliberately slowed). The appellation line, shown only for wines that have one, can still add a line
   when it arrives (§13).
2. **The 3D hint wrapped to two lines on a phone and covered the foot of the furniture** (visible on every place in
   the phone screenshots). A shorter hint on narrow screens: "Drag to turn · pinch to zoom · tap a bottle" ("Sleep om
   te draaien · knijp om te zoomen · tik op een fles"); the full one from `sm` up.
3. Demo realism (not a product bug): the dual-zone cooler's long-term bottles were filled into the serving zone by the
   app's top-down add; the seed now places them in the keeping zone with the move API.

4. **Sign-in through a private Codespaces port forward was refused (403 `FORBIDDEN`)**, reported by the owner. Cause:
   the CSRF check compares the browser's `Origin` (`https://<codespace>-3200.app.github.dev`) with the request's
   `X-Forwarded-Host`/`Host`, and the port forward delivers the internal `localhost:3200` in both. Fix
   (`lib/demo-origins.ts`, `server/http.ts`, `scripts/demo/up.sh`): a server may name exact extra origins in its own
   environment (`CELLR_DEMO_ORIGINS`). The check accepts one only when the origin is exactly in that set and the
   request arrived on a loopback host. Rules: no patterns or wildcards; never on Vercel Production; no header is
   trusted for it. `up.sh` sets one origin per app, for its own port, only inside a Codespace. Unit tests cover:
   the reported 403 without the setting; the configured origin accepted; another codespace, the other port, `http`,
   look-alikes, a trailing slash and `null` refused; a non-loopback or spoofed host refused; Production ignoring
   it; wildcard and path entries ignored. Verified in Chromium (desktop and phone) through an emulated private
   forward: HTTPS on the external name, internal `Host` and `X-Forwarded-Host`. Sign-in, the 3D cellar and a move
   with Undo all worked. Not run inside a real Codespace from this session.

## 13. Remaining UX issues (not fixed; for the owner's review)

| #   | Issue                                                                                                                                                            | Severity | Suggestion                                                                                      |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------- |
| 1   | Brass wall pegs: the whole back board takes the brass colour, which reads as a heavy gold slab with a bright reflection, unlike the delicate pegs                | medium   | a neutral or wood board with brass pegs; a look decision, so not changed here                   |
| 2   | The appellation line appears when the wine's details arrive (only for wines that have one), moving the panel's buttons down one line once                        | low      | reserve it when the placement data says the wine has an appellation (needs a field in that API) |
| 3   | The place chips scroll sideways with no visible cue on a phone beyond the cut-off chip                                                                           | low      | a fade at the edge                                                                              |
| 4   | The read-only mode shows the full advice ("Place here" is hidden, "Show" works) — correct, but a first-time viewer may not see at once why nothing can be placed | low      | the existing one-line notice could sit above the options instead of under them                  |
| 5   | Software-rendered screenshots are softer and darker than a GPU renders; colour and light should be judged on devices (§10)                                       | info     | —                                                                                               |

## 14. Security and RLS

- **Isolation verified in the browser and the API** (§9): another household's bottle, place, move and advice are
  **404** (not 403: nothing reveals that they exist), their data is untouched, nothing of theirs is drawn; household
  switching shows only the active household's places. The database suite (`scripts/db-test.sh`, RLS on every table)
  passes (§9a).
- **Read-only is enforced by the server** (403 on the move API), not only hidden in the UI.
- **The Codespaces exception is narrow** (§12.4): exact origins from the server's own environment, accepted only
  on a loopback host, ignored on Vercel Production. The normal same-origin rule and the bearer-token exemption are
  unchanged.
- **The fake Auth is never public**: it binds to localhost; the demo apps bind to 127.0.0.1 unless `DEMO_HOST` is
  set; the fixed code (`DEMO_FIXED_OTP`) is honoured only for `@demo.cellr.test` and only when that variable is set
  (the Playwright suites never set it). The production Supabase Auth is not involved anywhere.
- **No secrets**: placeholder keys only; `scripts/check-bundle-secrets.sh` passes on the build.
- **The seed cannot reach anything but localhost** (it exits otherwise) and writes only through the authorized API.
- The demo's database lives in a temporary directory and is destroyed by `down.sh`.

## 15. Production migration dependencies

- The Smart Cellar features need `0043`–`0045`; production has them (recorded 2026-11-18, `docs/MIGRATIONS.md`).
- **No migration was added in this sprint**, and none is needed to activate sprints 2B.3–5.
- Depth (back spots) remains a future, separately reviewed migration (index drop, `move_bottle_v2`) and an owner
  decision; nothing in this sprint touches it.
- Unrelated to Smart Cellar: `0047_system_health` is in the repository; whether it is applied in production is tracked
  by `docs/MIGRATIONS.md` §2 (dry run), not by this sprint.

## 16. Production activation dependencies (each is the owner's decision)

1. **Physical-device validation** (§10) on iPhone Safari and Android Chrome, plus the open device checks of sprints
   2B.2–5 (their reports, "device protocol").
2. **A hosted isolated preview** for testers who are not on a developer machine: a separate Supabase project and a
   Vercel environment pointing at it (billable; needs approval).
3. **The decision to allow Smart Cellar writes on production's database.** Today the code refuses it; allowing it is
   a reviewed code change (the sprint 1C/3/4 checklist), not a setting.
4. **Enabling the gates on Production**: today closed by code whatever is set; opening them is a reviewed code change
   with its own rollout plan (e.g. per household or per account).
5. Review of the advice weights with real cellars (ADR-009 §3) on a preview.
6. The look issues of §13 decided (keep or change).
7. Monitoring of the move/advice endpoints' errors after any activation (runtime logs), and a support answer for
   "my bottle is not where the app says".

## 17. Rollback plan

- **This PR**: demo tooling, tests, documentation, and two small UI changes behind the 3D gate (§12). Reverting the
  merge commit removes all of it; no data, schema or setting depends on it.
- **The demo**: `bash scripts/demo/down.sh` (everything gone); `node scripts/demo/seed.mjs --reset` (a clean demo).
- **A future preview activation**: unset the Smart Cellar variables on Preview; the existing 3D view returns.
- **A future production activation** (not part of this sprint): the gates are server-side; closing them restores the
  existing views at once. Bottles moved through the new API are ordinary bottle positions, valid for the existing
  views; layouts and zones are additional columns that the existing views ignore. Nothing to migrate back.

## 18. GO / NO-GO

| Classification                 | Decision  | Why                                                                                                                                                                                                                                              |
| ------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Ready for internal preview** | **GO**    | Everything built in sprints 1–5 runs together on an isolated database, interactively and read-only, on desktop and phone viewports; the six workflows and the failure scenarios pass in a production build; demo and reset are one command each. |
| Ready for controlled beta      | **NO-GO** | No physical-device test yet (§10); no hosted isolated environment for testers off a developer machine; Preview shares production's database, where Smart Cellar must stay read-only; the look issues of §13 undecided.                           |
| Ready for production           | **NO-GO** | All of the above, plus: production writes are refused by code by design, depth is off, the activation and monitoring plan (§16) is not made. Automated checks passing is not a reason to ship.                                                   |

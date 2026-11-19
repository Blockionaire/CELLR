# System Intelligence — Sprint 1 plan: Architecture Control Center

Status: executed (2026-11-19). Epic: [README.md](README.md). Decisions: [ADR-001](ADR-001-architecture-registry.md).

## Starting point (inspected on `main` @ e2e05e9)

- Admin portal: `apps/web/src/app/admin/**`, server-rendered, every page and layout checks `getAdminSession()`
  (allowlist `CELLR_ADMIN_USER_IDS`, confirmed with the auth server) and answers `notFound()` otherwise; the proxy
  already answers `/admin` with a 404 for a signed-in non-admin. `src/app/admin/admin-pages.test.ts` pins this:
  page count, the session check in every page, no `"use client"` under `app/admin`, no API route reaching admin data.
- Interactive client code lives in `features/**` (e.g. `features/admin/admin-nav.tsx`); `features` may not import
  `@/server/*` (lint error).
- Styling: design tokens in `app/globals.css` (`light-dark()` for the Maison/Noir skins), admin helpers in
  `app/admin/_ui.tsx`. CSP: nonce for `<style>`, inline style attributes allowed.
- Repository facts worth automating: `server/db/database.types.ts` (generated, CI-checked: 58 tables, 121
  functions, foreign keys), 46 migrations, 7 Storage buckets and 2 `pg_cron` jobs in migrations, 80 route handlers
  under `app/api`, `vercel.json` cron, `.github/workflows/ci.yml` jobs, `FEATURES` in `@cellr/domain`.
- The reference visualisation (`CELLR_architectuur_interactief_v2.html`, 18-11-2026) has 51 nodes and 105 edges.
  Its edges are hand-drawn and carry no evidence; several do not match the code (e.g. "Sommelier reads the
  intelligence tables directly": it reads the cellar and taste through those services; "Tonight is a separate
  service": it is `cellar.tonight()` over the domain rules). Two Storage buckets (`tasting-images`, `wine-labels`)
  exist in migrations but are used by no code; the reference does not show that.

## Scope

1. `/admin/system`: a new, admin-only module, linked from the admin sidebar ("System" → "Architecture").
2. A versioned component register (curated, server-only TypeScript) whose every claim is checked against the
   repository in CI: source paths exist, every confirmed edge has evidence (a file that contains a given text),
   every table / bucket / cron job / API route / server module is owned by a component, every gate exists.
3. A generated repository inventory (`pnpm architecture:inventory`) with drift detection in `pnpm test`.
4. Pure graph functions in `@cellr/domain` (validation, neighbours, transitive tracing, shortest path, impact):
   Sprint 3's impact analysis reuses them server-side.
5. A native React/TypeScript control center: SVG map with deterministic layered layout, zoom/pan (wheel, drag,
   pinch, keyboard), search, edge-kind / layer / status filters, dependency tracing (direct, upstream, downstream,
   transitive with depth), path finding, detail panel (sources, responsibility, inputs/outputs, dependencies with
   evidence, risks, tables, routes, gates), deep links, plus Register, Flows, Data, Review and Checks views; usable
   on a phone.

Out of scope (later sprints): live health, incidents, alerts. The map holds no live state and needs none.

## Checkpoints

| #   | Checkpoint                                | Verification                                                |
| --- | ----------------------------------------- | ----------------------------------------------------------- |
| C1  | Domain types, validation, graph tracing   | unit tests in `packages/domain`                             |
| C2  | Inventory generator, registry, repo check | `registry.test.ts` (fails on any unproven claim or drift)   |
| C3  | Admin page, nav, boundary tests           | `admin-pages.test.ts`, `admin-nav.test.ts`, typecheck, lint |
| C4  | Control center UI                         | layout unit tests, Playwright (desktop + phone), axe        |
| C5  | Hardening                                 | `pnpm check`, `pnpm build`, bundle secret scan, review      |

## Risks considered up front

- **Leaking architecture risks to non-admins.** (Revised after the security review: the repository is public, so
  the register is written as public information; see ADR-001 §1.) The register (with its risk notes) is `server-only` and reaches
  the browser only as props of a page that rendered after the admin check; a test asserts no client file imports it.
- **A register that rots.** Mitigated by making CI fail on drift (new table, route, bucket, cron job or server
  module without an owner; a moved file; evidence text that disappeared).
- **Claiming more than the code shows.** Status vocabulary separates `implemented`, `gated` (code present behind a
  server switch whose value in a deployment is unknown here), `unverified` (outside the repository) and `planned`.
  Nothing on this page says "operational".
- **Bundle and performance.** No new dependency; SVG with ~70 nodes and ~150 edges renders in one pass; layout is
  memoised and computed once per data set.

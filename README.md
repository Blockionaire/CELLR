# CELLR

Your personal intelligent wine cellar: it knows what you own, what you like, when each bottle should be opened
and what to drink tonight. A mobile-first PWA now; architected so a native app can reuse the same backend.

> **Complex underneath, effortless on the surface.**

## Status

**Phase 0 (foundation) is built:** database with a tested permission model, email-code sign-in, households and
invites, the design system and app shell, installable PWA with an offline page, CI.
Next: Phase 1 (the cellar itself). → [`docs/00-architecture-plan.md`](docs/00-architecture-plan.md) · [`docs/SETUP.md`](docs/SETUP.md)

## Layout

```
apps/web/            Next.js app (routes, UI, server services, /api/v1)
packages/domain/     pure TypeScript: contracts, rules — no I/O, reusable by a native client
supabase/            migrations, seed, SQL permission suite, auth email template
scripts/             db tests, type generation, local no-Docker backend, icon/offline-page generators
docs/                architecture plan, setup guide, spikes (evidence for the plan)
```

## Everyday commands

```bash
pnpm install
pnpm check            # format · lint · types · unit tests · database permission suite
pnpm e2e              # whole app in a real browser, against a local backend (run `pnpm build` first)
pnpm db:test          # migrations + 239 permission assertions on a throwaway Postgres
pnpm db:types         # regenerate database types from the migrations
bash scripts/local-stack/up.sh   # Postgres + PostgREST + fake Auth on :54321 — no Docker, no account
```

## Principles that are enforced, not just written down

- The **database** decides who sees what (row-level security); the app never "remembers to check".
- **Layers**: UI → API → services → repositories → Supabase. Violations are lint errors with their own tests.
- **Secrets** never reach the browser: lint rules, a bundle scanner in CI, and a secret scan on every commit.
- **AI will explain, never invent**: recommendations are chosen by deterministic code from bottles that exist;
  AI-estimated facts are always distinguishable from verified ones.

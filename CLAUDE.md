# CELLR — working agreements for Claude Code

Node 22.18 or newer (type stripping; `engines` in package.json). pnpm monorepo: `apps/web` (Next.js App Router, Supabase) and `packages/domain` (pure TypeScript). Run everything from
the repository root. Communicate with the owner in Dutch; code, comments and docs in English.

## Before you finish any change

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test
```

Also `pnpm db:types:check` after a migration. End-to-end tests run on `main`, nightly and by hand, not on pull requests.

## Architecture impact: every sprint, by default

The architecture register (`apps/web/src/server/system/registry.ts`, shown on `/admin/system`) is updated **in the
same pull request** as the code. Do this without being asked:

1. `pnpm architecture:inventory` — regenerate the inventory from the code; commit it.
2. `pnpm architecture:impact` — see what changed structurally against `origin/main`. Mention notable changes in the
   PR description.
3. `pnpm --filter @cellr/web exec vitest run src/server/system` — fix every gap it names in `registry.ts`: owners of
   files, tables, routes, jobs, workflows, env vars, hosts and dependencies; an edge for every new import or table
   access between components, with **code** evidence (`{ path, contains }`: an import line, a `.from("…")`, an RPC).
4. The tests only see imports, literal `.from("…")` calls, env names, `https://` literals and dependencies. Check by
   hand what they cannot see: RPC calls, hosts built at run time, external configuration, whether each edge's kind
   and label are right, and edges or risks the change made obsolete.
5. Something you cannot prove from the code (an external account, a hosted setting, an intended relation) is
   `planned` or `unverified`, never confirmed. Never weaken a check to get green.
6. Bump the register's `version` and `reviewedOn`.

How-to, and exactly what is detected, enforced or left to judgement: `docs/sprints/system-health/REGISTRY-GUIDE.md`.

## Hard rules

- The repository is public. No secrets, tokens, production URLs or observations, user data or monitor ids in code,
  docs or the register. Environment variables are named, never valued.
- Live health (`server/health/`, migration 0047) is an overlay; the register never reads it and it never decides
  structure.
- Existing migrations are immutable (`docs/MIGRATIONS.md`); a change is a new migration.
- No merge, deploy, production migration or credential change without the owner's explicit approval.

# Keeping the architecture register true

The map on `/admin/system` is only as good as `apps/web/src/server/system/registry.ts`. CI keeps it honest on every
pull request (`registry.test.ts`, in `pnpm test` and in the CI job **Architecture · register matches the code**); this
page says what to do when it turns red. The register is updated **in the same pull request** as the code change.

## The routine, every pull request

1. `pnpm architecture:inventory` — refreshes `inventory.generated.json` from the code.
2. `pnpm architecture:impact` — lists what changed structurally against `origin/main` (CI posts the same list in the
   job summary). Informational; it never blocks.
3. `pnpm --filter @cellr/web exec vitest run src/server/system` — names every gap it can see; fill it as in the
   tables below.
4. Review what the tests cannot see (section 3 below), then commit the inventory and the register with the code.

## When you change the code

| You added or changed…                                    | Then                                                                                             |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| a migration (table, function, bucket, pg_cron job)       | `pnpm db:types`, then `pnpm architecture:inventory`; give each new table / bucket / job an owner |
| a route handler under `app/api`                          | `pnpm architecture:inventory`; add the path to the owning component's `routes`                   |
| a directory or top-level file under `src/server`         | `pnpm architecture:inventory`; add it to a component's `sources` (or a new component)            |
| a dependency between services, or a new table read/write | add an edge with evidence (below)                                                                |
| a feature switch in `CELLR_FEATURES`                     | `pnpm architecture:inventory`; name it in the component's `gates`                                |
| any new source file (app or domain package)              | it must fall under some component's `sources` (a directory prefix ending in `/`, or the file)    |
| an import from one component's files into another's      | an edge between them with the import as evidence (not needed into a `foundation` component)      |
| a `.from("table")` outside the table's owner             | a `data-read` or `data-write` edge to the owner, with that call as evidence                      |
| an environment variable                                  | exactly one component names it: in `env`, or in `gates` (kind `env`) when it switches behaviour  |
| an `https://` host in code                               | the component that calls it lists it in `hosts` (an external one also gets an `external-call`)   |
| a runtime dependency in `package.json`                   | the component that is the reason for it lists it in `packages`                                   |
| a GitHub Actions workflow                                | a component's `sources` includes the workflow file                                               |
| moved or renamed a file                                  | update `sources` and every `evidence.path` that pointed at it                                    |

Then bump `version` (minor for new components or edges, patch for wording) and set `reviewedOn` to today.

## Edges and evidence

An edge reads **"from uses to"**. Pick the kind that says what the code does:

| Kind            | Use for                                                                               |
| --------------- | ------------------------------------------------------------------------------------- |
| `request`       | a call or dependency injection between components                                     |
| `data-read`     | reads from a data group (and writes nothing there)                                    |
| `data-write`    | writes to a data group (it may read too)                                              |
| `external-call` | a call to a system outside CELLR (OpenAI, Web Push, Supabase Auth admin)              |
| `control`       | authentication, authorisation, configuration or a switch that decides behaviour       |
| `ops`           | hosting, schedules, backups, where tables live                                        |
| `verifies`      | CI or a rehearsal exercising it outside production (not a runtime dependency)         |
| `feedback`      | stored data that comes back and changes later behaviour                               |
| `planned`       | a proposed relation with no code yet (no evidence; only edge kind a planned part has) |

Evidence is `{ path, contains }`: a repository file and a short, stable text in it that proves the claim — an RPC or
table name in a repository (`'.rpc("save_storage_layout"'`), the wiring in `server/services.ts`, an import. Prefer
the line that proves the _kind_ too: for a write, the RPC that writes or the `.insert`/`.update` call, not a select.
When the text disappears, CI fails and the relation must be confirmed again.

Evidence is code, never prose: a Markdown file proves nothing about what runs, and CI refuses it for a confirmed edge,
as it refuses a `contains` shorter than six characters. **What cannot be proven from the code is never confirmed:** a
relation that is intended but not built is a `planned` edge (no evidence); a part that lives outside the repository
and cannot be checked here (a hosted setting, an external account) is `unverified` or `planned`. An edge to or from
an `unverified` part proves CELLR's side only; its label says what is configured elsewhere. Every edge touching a `planned` component must itself be `planned`.

## Foundation components

`foundation: true` marks shared plumbing that every part may import without an edge: request context and database
clients (`request-context`), configuration and logging (`runtime-config`), the UI kit, i18n and small helpers
(`web-foundation`). A foundation component has no routes, tables or jobs. Imports _out of_ a foundation component
still need an edge. Use it sparingly: anything with behaviour of its own is a normal component.

## Status words

`implemented` · `gated` (code behind a switch whose production value is unknown here; name the switch) ·
`unverified` (lives outside the repository) · `planned`. Never "operational": that is measured (sprint 2), not
declared.

## The repository is public

The register is shown only to admins but is readable by anyone on GitHub. Write only what the code already shows:
no production numbers, no detail of an open weakness, no customer data. Live and sensitive observations go into the
database-backed monitoring (sprint 2).

## What is automatic, what is enforced, what needs judgement

Three different things. Do not read the first two as the third.

### 1. Detected automatically (the inventory and `pnpm architecture:impact`)

`inventory.generated.json` is read from the repository by `scripts/architecture/inventory-builder.ts`. It is plain
text matching, not a compiler, and sees only these, in **non-test `.ts`/`.tsx` files under `apps/web/src/`** unless
stated otherwise:

| Fact                  | How it is found (and what it misses)                                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| tables, foreign keys  | `database.types.ts`                                                                                                         |
| functions, migrations | `database.types.ts`, `supabase/migrations/`                                                                                 |
| buckets, pg_cron jobs | literal SQL in the migrations                                                                                               |
| route handlers        | `route.ts` files under `app/api` and their exported methods                                                                 |
| server modules        | directories and top-level files under `src/server`                                                                          |
| workflows, CI jobs    | `.github/workflows/*.yml` (job ids only)                                                                                    |
| feature switches      | `packages/domain/src/features.ts`                                                                                           |
| env var names         | `process.env.X`, `env.X`, `env["X"]`, and `X: z.` keys in files that read `process.env`; a name built at run time is missed |
| external hosts        | `https://` literals; not `http://`, not hosts built from variables or hidden in an SDK; `server/system/` is skipped         |
| runtime dependencies  | `dependencies` of `apps/web` and `packages/domain`; not devDependencies, not the tools under `scripts/`                     |
| table access per area | literal `.from("table")`; **not** `.rpc(...)`, not a table name in a variable; `server/system/` is skipped                  |
| imports between areas | static, dynamic and side-effect imports through `@/` or relative paths; type-only imports and package imports are left out  |

`pnpm architecture:impact` diffs these facts against the base branch and CI writes the result to the job summary. It
reports; it never blocks, and it says nothing about whether the register is right.

### 2. Enforced by CI (`registry.test.ts`, blocking once the job is a required check)

- The committed inventory equals a fresh build.
- The register validates without errors or warnings; every source path exists; every evidence text is found in its
  file; every switch it names is real; it holds no secret, e-mail address or user id; it is `server-only` and only
  the admin service imports it.
- **Exactly one owner** for every table, bucket, pg_cron job, route, server module, workflow, env var name, external
  host and runtime dependency in the inventory, and an owning component for every non-test source file of the app and
  the domain package.
- **An edge exists** for every runtime import from one component's app file into another component (except into a
  `foundation` component), and a `data-read` or `data-write` edge for every literal `.from("table")` outside the
  table's owner.
- A confirmed edge cites code: no Markdown evidence, no `contains` shorter than six characters. Every edge touching a
  `planned` component is itself `planned`.
- The register, its service and the inventory builder import nothing that reads live data (health, privileged or
  database modules, Supabase, the services): structure and the live health overlay stay apart.

CI checks that an edge **exists**, not that it is **right**: it accepts `data-read` where the code writes, any label,
and any of several components as owner. It does not notice an edge that is no longer needed while its evidence text
still exists, and it checks imports only in the app, not inside the domain package.

### 3. Needs human review or Claude Code (every pull request)

- Relations the inventory cannot see: RPC calls, calls to hosts built from variables or made by an SDK, tables named
  in variables, anything configured outside the repository (hosting, cron schedules, Better Stack).
- Whether each edge has the right kind (read or write), direction and label, and whether the owner chosen is the
  sensible one.
- Status words: `gated` when the production switch value is unknown, `unverified` for anything outside the
  repository, `planned` for what is not built. Never upgrade a status from a claim alone.
- Removing edges, components and risks that the change made obsolete, and updating flows and risks.
- Whether the impact report matches the PR description: anything structural that it lists and the description does
  not explain deserves a question in review.

## External monitoring (Better Stack)

`better-stack` is `unverified`: the owner configured it in Better Stack (liveness, readiness, the scheduled round
trigger, the dead man's switch heartbeat and alerts), and none of that configuration is in the repository, so CI
cannot see it. Its edges prove CELLR's side only:

- `health-monitor → better-stack` (`external-call`): the ping after every recorded round, in `server/health/round.ts`;
- `health-monitor → better-stack` (`ops`): the endpoints that answer Better Stack's checks; the schedule itself is
  configured there, which the label says.

Incident handling inside CELLR (thresholds, deduplication, impact, audit trail) is not built: `plan-incident-engine`
and its edges stay `planned`. Never put monitor ids, heartbeat URLs, tokens or alert contacts in the register or the
docs: the repository is public. When a monitor is added, removed or moved to another endpoint, update the component
text in the same pull request. Setup steps: [OPERATIONS.md](OPERATIONS.md).

## The health catalogue (sprint 2)

`apps/web/src/server/health/catalogue.ts` declares what the live monitor measures, per register component.
`src/server/system/health-catalogue.test.ts` keeps it true, and fails when:

- a probe names a component the register does not have;
- a probe does not say what it does not prove;
- the catalogue's buckets or pg_cron jobs differ from what the migrations create;
- the server records an AI task (`task: "…"`) that no probe watches.

So:

- **A new bucket or pg_cron job:** add it to `EXPECTED_BUCKETS` / `EXPECTED_CRON_JOBS` too.
- **A new AI task:** add it to `AI_TASKS`, with the components whose feature it serves.
- **Renaming or removing a component a probe speaks for:** move the probe with it.

Measurements themselves never go in the repository. They live in the database (migration 0047) and are shown only
to admins.

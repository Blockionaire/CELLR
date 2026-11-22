# Keeping the architecture register true

The map on `/admin/system` is only as good as `apps/web/src/server/system/registry.ts`. CI keeps it honest on every
pull request (`registry.test.ts`, in `pnpm test` and in the CI job **Architecture · register matches the code**); this
page says what to do when it turns red. The register is updated **in the same pull request** as the code change.

## The routine, every pull request

1. `pnpm architecture:inventory` — refreshes `inventory.generated.json` from the code.
2. `pnpm architecture:impact` — lists what changed structurally against `origin/main` (CI posts the same list in the
   job summary). Informational; it never blocks.
3. `pnpm --filter @cellr/web exec vitest run src/server/system` — names every gap; fill it as in the tables below.
4. Commit the inventory and the register with the code.

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
and cannot be checked here (a hosted setting, an external account) is `unverified` or `planned`, and its edges say so
in the label. Every edge touching a `planned` component must itself be `planned`.

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

## What CI checks

The inventory is current; the register validates without errors or warnings; every source path exists; every
evidence text is found; every table, bucket, pg_cron job and route has exactly one owner; every server module belongs
to a component; every switch named is real; no secrets, e-mail addresses or user ids; only the admin service imports
the register, and it is `server-only`.

Since register 1.3.0 also: every source file of the app and the domain package and every workflow belongs to a
component; every import between components and every table access outside the owner is a confirmed edge; every
environment variable (by name, never its value), external host and runtime dependency has exactly one owner;
confirmed edges carry code evidence; the register, its service and the inventory builder import nothing that reads
live data (health, privileged or database modules, Supabase, the services), so the live health overlay stays a
separate layer on top of the structure.

What the checks do **not** prove: that an edge's label is the best description, that a `gated` switch is on in
production, or that an `unverified` part behaves as described. Those stay human judgement, made visible in review.

## External monitoring (Better Stack)

`better-stack` is a `planned` component: liveness (`/api/health`), readiness (`/api/health/ready`, with the ready
token), the scheduled round trigger (`/api/cron/health`), the dead man's switch ping (`CELLR_HEALTH_PING_URL`) and
alerts to the owner. Its edges stay `planned` until it is configured. Then, in one pull request: set its status to
`unverified` (the account and monitors live outside the repository and cannot be checked here), turn the edge
`health-monitor → better-stack` into an `external-call` with the ping code as evidence, and keep
`better-stack → health-monitor` unverified in its label. Never put monitor ids, URLs with tokens or alert contacts in
the register: the repository is public. Setup steps: [OPERATIONS.md](OPERATIONS.md).

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

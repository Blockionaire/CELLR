# Keeping the architecture register true

The map on `/admin/system` is only as good as `apps/web/src/server/system/registry.ts`. CI keeps it honest
(`registry.test.ts`, part of `pnpm test`); this page says what to do when it turns red.

## When you change the code

| You added or changed…                                    | Then                                                                                             |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| a migration (table, function, bucket, pg_cron job)       | `pnpm db:types`, then `pnpm architecture:inventory`; give each new table / bucket / job an owner |
| a route handler under `app/api`                          | `pnpm architecture:inventory`; add the path to the owning component's `routes`                   |
| a directory or top-level file under `src/server`         | `pnpm architecture:inventory`; add it to a component's `sources` (or a new component)            |
| a dependency between services, or a new table read/write | add an edge with evidence (below)                                                                |
| a feature switch in `CELLR_FEATURES`                     | `pnpm architecture:inventory`; name it in the component's `gates`                                |
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

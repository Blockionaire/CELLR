# ADR-001 — An evidence-checked architecture register, separate from live monitoring

Status: accepted (sprint 1, 2026-11-19).

## The question

The admin portal needs a map of how CELLR actually works, which later sprints (health, incidents, impact
analysis) build on. Where does the map's data live, how do we keep it true, and how do we keep it apart from
monitoring data?

## Decisions

### 1. A curated register in server-only TypeScript, plus a generated inventory

- `apps/web/src/server/system/registry.ts` (`import "server-only"`) holds the components, edges, flows and risks.
  The repository is public, so the register is not confidential: it holds only what the code already shows (no
  production numbers, no detail of an open weakness). Live and sensitive observations belong in the database-backed
  monitoring of sprint 2, behind the admin session.
  TypeScript gives literal-typed ids, so an edge to a misspelt component is a type error.
- `apps/web/src/server/system/inventory.generated.json` holds facts read from the repository by
  `pnpm architecture:inventory` (tables and foreign keys from `database.types.ts`, function names, migrations,
  Storage buckets and `pg_cron` jobs from the migrations, route handlers with their HTTP methods, server modules,
  CI jobs, Vercel crons, feature switches). It is never edited by hand.
- Considered: JSON/YAML register (no type checking of ids), a register inside `@cellr/domain` (the risk notes
  would then be importable by client code and could end up in a public JS chunk), deriving everything from the
  import graph (finds imports, not meaning: it cannot tell a read from a write, nor see dependency injection in
  `server/services.ts`).

### 2. Every claim is checked against the code in CI

`registry.test.ts` fails when:

- a component's source path does not exist;
- a non-planned edge has no evidence, or an evidence file does not contain its text (`{ path, contains }`);
- a table, Storage bucket, `pg_cron` job, Vercel cron, API route or `src/server/*` module is owned by no
  component, or by more than one (tables, routes), or a component names one that does not exist;
- a named feature gate is not a real switch;
- the committed inventory differs from what the repository says now;
- the register contains something that looks like a secret, an e-mail address or a user id.

So adding a table or a route without updating the register is a red build, and so is deleting the code an edge
claims.

### 3. Status vocabulary

`implemented` (code present, not behind a switch) · `gated` (code present behind a server switch; whether it is on
in a deployment is not knowable from the repository) · `unverified` (outside the repository: hosting settings,
backups, external accounts) · `planned` (not built). Edges are `confirmed` by evidence or `planned`. The page never
says "operational": that is what Sprint 2 measures.

### 4. Pure graph functions in `@cellr/domain`

Validation, neighbours, transitive tracing with depth and kind filters, shortest path and impact are pure
functions in `packages/domain/src/system-architecture.ts`, used by the browser (tracing on the map), by the server
(validation shown on the page) and later by Sprint 3 (incident impact), without duplicating graph code.

### 5. Separation from live monitoring

The register describes structure only; it has no status, timestamps or metrics. Sprint 2 will key health by
component id in its own tables and pass it to the page as an optional, separate overlay. The map renders from the
register alone, so it keeps working when monitoring (or the database) is unavailable: the page reads nothing from
the database at all today.

### 6. Layout is computed, not stored

Columns come from the layer, rows from the register order; a long layer wraps into several columns. Adding a
component never needs coordinates, and the layout is deterministic (unit-tested), so screenshots are comparable.

### 7. No new dependency

SVG + React. A graph library (React Flow, Cytoscape, d3) was considered: ~70 nodes do not need one, and each adds
bundle weight, a CSP review and an upgrade path.

## Consequences

- Updating the register is part of the definition of done for any change that adds a table, route, bucket, cron
  job or server module; CI says exactly what is missing.
- Evidence strings are short, stable texts (an RPC name, a table name, an import). A refactor that renames them
  breaks the test, on purpose: the relationship must be re-confirmed.

## Addendum (2026-11-22): the register stays current by itself

Sprint 1 checked what the register _named_ against the repository. It did not notice what the register _left out_:
an import between services, a table read outside its owner, a new environment variable, host or dependency. Decided:

1. **The inventory covers relations, not just parts.** It also records workflows, environment variable names (never
   values), `https://` hosts in code, runtime dependencies, `.from(table)` per area and imports between areas. Still
   Node built-ins only, deterministic, no network.
2. **What the inventory sees is checked file by file.** Every source file belongs to a component; every
   cross-component import and every literal table access outside the owner must be an edge; every variable, host and
   dependency found has exactly one owner. A change that adds any of these fails CI until the register is updated in
   the same pull request. What the inventory cannot see (RPCs, hosts built at run time, external configuration) is
   left to review: REGISTRY-GUIDE.md separates the three.
3. **Foundation components** (request context, configuration, UI kit) may be imported without an edge, so the graph
   shows architecture rather than every helper call. Imports out of them still need one.
4. **Proof is code.** Confirmed edges may not cite Markdown, and evidence texts must be specific. What cannot be
   proven from the repository is `planned` or `unverified`, never confirmed.
5. **Structure and health stay apart.** A test forbids the register, its service and the inventory builder from
   importing anything that reads live data. Health is an overlay on the map; it never changes the structure.
6. **An impact report, not an AI review.** `pnpm architecture:impact` diffs the inventory against the base branch
   and CI writes it to the job summary. It informs the reviewer; the tests decide. No AI calls, no new dependency.

Limits, accepted: a relation made without an import or a literal `.from("…")` (an RPC, a table name in a variable, a
call to a URL built at run time) is not detected; it is added by hand, with evidence. CI proves that an edge exists,
not that its kind, label or owner is right; that remains human judgement.

# ADR-002 — Provider rights, the import lifecycle and the off switch

Status: accepted (WI-01, 2026-11-13) · Builds on ADR-001 and migration `…0037_catalog_search.sql`

## Context

Sprint 004A gave every provider a rights status, a search scope and an audited rights function, and separated pilot
data from people's search. WI-01 had to answer four things the brief asks for and 004A left open:

1. A rights decision **per intended use**, not one `licensed = true`.
2. What stops a real LWIN file from being imported through an adapter that was written from an assumption.
3. What a half-finished import looks like, and whether it can damage a later, complete one.
4. How a provider is switched off quickly when rights are withdrawn, and what stays visible.

## Decisions

### 1. Three independent gates before a provider record can reach a person

| Gate            | Where                                                            | Fails closed how                                                                                                                                                                              |
| --------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The file**    | `inspectProviderFile` + `importBlocker` (`catalog-providers.ts`) | wrong layout or separator, a column named twice, a row with too many or too few fields, an unclosed quote, no rows, mis-decoded text, repeated ids, mostly unmappable rows → nothing imported |
| **The adapter** | `ADAPTERS[x].layoutVerified`, `fixtureSha256`                    | an adapter written from an assumed layout reads exactly one file: CELLR's own fixture, recognised by its SHA-256, whatever provider it is offered for                                         |
| **The rights**  | `catalog_providers` row + `catalog_import_run_start` (database)  | blocked → no run at all; unverified → pilot run only, never in production; public needs verified + commercial                                                                                 |

A fourth, unchanged gate is the tool's target check (local, or an approved staging ref; production always refused).
Passing one gate says nothing about another: a perfectly valid file of a blocked provider is still not imported.

### 2. Rights are recorded per use in the register, enforced coarsely in the database

The database keeps what it can enforce mechanically: `may_store`, `may_display`, `commercial_use`, `rights_status`,
`search_scope`, with evidence and a log. The finer distinctions the brief lists (combine, AI inference, training,
retention after termination) live in `SOURCE_RIGHTS_REGISTER.md`, one row per use. They are enforced by construction
rather than by a flag:

- **AI inference:** no provider field is ever placed in a model prompt. Every prompt in the app takes the wine's
  identity as the household or the canonical catalogue holds it. If a provider is later cleared for display but not
  for AI use, nothing has to be switched off.
- **Training:** not done anywhere.
- **Combine / enrich:** a provider record never writes a CELLR wine; a verified link only says "this record is that
  canonical wine" and hides the duplicate.
- **Retention:** nothing is derived from provider records, so switching a provider off leaves nothing behind in
  household or canonical data.

No new `may_ai` column was added: a flag nobody reads is a false assurance. If a provider is ever to be used in a
prompt, that is a schema change with its own ADR.

### 3. The import lifecycle (migration `20261115000038_wi01_provider_lifecycle.sql`)

**Rule, enforced by the database: a provider has at most one open import run.**

```text
start run B ──► any run of the provider still open (A) is closed as "abandoned: superseded by run B"
run open    ──(batches, idempotent)──► finished          (may withdraw records it did not see)
            └─(the tool fails)───────► abandoned, with the reason (withdraws nothing)
closed run  ──► can import nothing, withdraw nothing, and cannot be closed again
```

- **Defect closed.** In the merged foundation, `catalog_import_run_finish(run, withdraw_missing = true)` withdrew every
  record whose last run was not this run. A run that crashed and was finished later — after a newer, complete run —
  would have withdrawn everything the newer run imported, and the older run could keep writing old batches over newer
  data. With one open run per provider neither can happen: the open run is always the newest.
- **How it is enforced.** A partial unique index (`… where finished_at is null`) guarantees the rule;
  `catalog_import_run_start` locks the provider and closes what was open; a trigger on `catalog_external_records`
  refuses any write whose run is not open (and not of that provider), and its shared lock makes closing a run wait
  for batches still being written; `catalog_import_run_finish` locks the run before it withdraws.
- **Under real concurrency** (`pnpm db:test:imports`, separate sessions): a new run waits for the old run's batch in
  flight and then closes it; a run finishing with a withdrawal and a newer run importing happen one after the other
  and the newer run's record ends active; ten simultaneous starts leave exactly one open run.
- **The tool** (`scripts/catalog-tools/import.ts`) abandons its run when it fails, never withdraws from a partial
  file (`--limit`), from a file with far fewer records than the provider has active (unless `--allow-shrink`), or
  when the database refused any record of the run.
- A provider is "complete as of" its newest finished, not abandoned run. Withdrawn records are kept (history,
  decisions), hidden from search, and come back as the same row when a later file lists them again.

### 4. The off switch

`admin_catalog_provider_disable(provider, reason, actor, block)` sets the scope to `off` (and the rights to `blocked`
when asked) in one audited call. It exists because the table's own checks rightly refuse half-steps — a provider
cannot be `blocked` or un-verified while it is still `public` — and an emergency is the wrong moment to learn which
two fields must change together. It can only narrow. Going back on is `admin_catalog_provider_rights` with evidence.

Effect, verified by SQL tests: the next search and the next provenance request return none of its records; the
catalogue and every household's wines are untouched; a canonical wine with a verified provider record is still found,
once, as the catalogue's own.

### 5. Links: what an import may suggest

Unchanged rule, now pinned by tests: a link is **suggested** only when exactly one canonical wine has the same
normalised producer, the same name or verified alias, a compatible type and a non-conflicting country. A region never
forces or forbids a link. A similar name, another bottling, another colour, another country, a differently spelt
producer, or two fitting wines suggest nothing. Only an admin verifies or rejects; a decision can be reversed and both
decisions stay in the audit; re-importing never resurrects a suggestion over a decision.

`identityRelation` (`catalog-identity.ts`) explains to a reviewer **why** two records are or are not the same
(`same`, `variant`, `uncertain`, `different_cuvee`, …). It is advice for people and for grouping identical candidates;
it never creates, verifies or changes a link. It errs towards "different" and "uncertain": only articles, word order,
"Cuvée" and the producer's own name repeated as a phrase are waved away; a single letter, a number, a colour, a
qualifier, "Clos", "Estate", stars and other signs are not.

**Known limit of the import's suggestion (unchanged from 004A):** it compares normalised text, and normalising drops
signs. "Riesling Auslese \*" and "Riesling Auslese \*\*" are one identity to it. It is only ever a suggestion; the
review screen shows the names as written and `identityRelation` marks such a pair `uncertain`.

### 6. LWIN codes

`parseLwin` reads only what Liv-ex's public FAQ documents (7 / 11 / 16 / 18 digits; vintage, pack size, bottle size
in millilitres). The value `1000` in the vintage position is reported as a placeholder and is **not** interpreted as
"non-vintage": that meaning is not on Liv-ex's public pages (register, question L8). A longer code is never a
different wine than its first seven digits, and no code is ever assigned to a wine by matching names.

## Consequences

- A real LWIN import needs, in this order: written answers (register L1–L5), a lawfully obtained file, the layout
  verified against it and `layoutVerified` flipped in a reviewed commit, the provider's rights set by the owner.
- Imports stay manual and owner-run. No recurring import is scheduled anywhere.
- The admin page (WI-06) lists open and abandoned runs and offers the off switch. Until it exists, both are
  database functions only.

## Alternatives rejected

- **Per-use boolean columns** (`may_combine`, `may_infer`, `may_train`): unenforceable flags; see decision 2.
- **Auto-abandon of stale runs by a timer:** hides a failure that a person should see.
- **Deleting a provider's records on disable:** destroys the audit trail and review decisions; scope `off` already
  removes them from every people-facing path at once.

# Staging for external wine data (Sprint 004B)

## State on 2026-11-19

| Question                                               | Answer                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does CELLR have an approved, isolated staging project? | **No.** `scripts/catalog-tools/approved-targets.json` lists none.                                                                                                                                                                                                                                  |
| Projects on the Supabase account (read-only listing)   | `vvelgyhbjfmjvxkzekyz` = **production** (always refused by the tools); `dqwkbtsstvakcvlnwvwk` "Blockionaire's Project", created 2026-05-12, eu-central-1, Postgres 17. Nothing in the repository or its documents identifies it as CELLR staging, so it was **not used, not opened, not queried**. |
| Where this sprint imported                             | a throwaway local **Postgres 17.12** (the production major version), marked `staging` by its owner, deleted after the run: `scripts/catalog-tools/staging-rehearsal.sh`                                                                                                                            |

## What the staging route enforces (unchanged code from 004A / WI-01, plus the new read-only check)

1. **The tools refuse production** in every form (`PRODUCTION_PROJECT_REFS`), and any remote database whose ref is not
   in `approved-targets.json` or whose URL does not name that project (`lib.ts`, `assertSafeTarget`).
2. **The database must say what it is.** `private.catalog_settings` holds `environment` and `project_ref`; only the
   database owner can write it (no API role, not even the service role). No row = `production` = refused.
3. **Pilot data never reaches people,** in any environment: people's `catalog_search` returns `public` sources only;
   `catalog_search_pilot` is service-role only and refuses outside `pilot` / `staging` databases.
4. **`staging-check.ts`** (new, read-only) verifies a target before an import: identity, schema (by migration history
   where there is one, else by the objects), that people cannot run the pilot, rights or import functions, that only
   the owner can mark the database, the pilot-scope trigger, RLS on every catalogue table, and the providers' state.

## Owner steps to activate a real staging project (none taken by this sprint)

Each step is the owner's, on their own machine, with their own credentials.

| #   | Step                                                                                                                                                                           | Note                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | **Decide** whether to create a new project. The organisation is on the Pro plan (`RELEASE_CHECKLIST.md`); a further project normally adds compute cost.                        | **Paid infrastructure: needs your explicit approval.** Not created by this sprint. Alternatively, confirm in writing that `dqwkbtsstvakcvlnwvwk` may be wiped and used as CELLR staging. |
| S2  | Create it in `eu-central-1`, name it e.g. `cellr-staging`. Never copy production data or users into it.                                                                        | Sign-up closed; no real accounts.                                                                                                                                                        |
| S3  | Build the schema on the **empty** project: `docs/MIGRATIONS.md` §6 (`db push --linked --dry-run`, then `--include-seed`).                                                      | Records the migration history at the same time.                                                                                                                                          |
| S4  | In its SQL editor, as the owner: `insert into private.catalog_settings (environment, project_ref, set_by) values ('staging', '<ref>', '<your name>');`                         | The only way to mark it; the API roles cannot.                                                                                                                                           |
| S5  | Add `<ref>` to `scripts/catalog-tools/approved-targets.json` **in a reviewed PR**.                                                                                             | The tool refuses it until then; production can never be added (unit-tested).                                                                                                             |
| S6  | `pnpm --filter @cellr/catalog-tools exec tsx staging-check.ts --db "$STAGING_URL" --expect staging --staging-project <ref>`                                                    | Must print `"ok": true`. Uses the session pooler or direct URL of the staging project.                                                                                                   |
| S7  | Register the providers and set rights exactly as in `staging-rehearsal.sh` §3 (X-Wines stays `unverified`, scope `pilot`), then import with `--pilot --staging-project <ref>`. | The same commands as the rehearsal, with `--staging-project`.                                                                                                                            |
| S8  | Re-run S6; keep its JSON with the release record.                                                                                                                              | —                                                                                                                                                                                        |

What staging adds over the local rehearsal: Supabase's own roles and network, PostgREST, real latency through the
API. What it does not change: the rights. A source in staging is still `unverified` and shown to nobody.

## Reproduce the rehearsal

```bash
bash scripts/catalog-tools/staging-rehearsal.sh /path/to/XWines_Full_100K_wines.csv
```

It uses Postgres 17 when `/usr/lib/postgresql/17/bin` exists (as here), else 16. Results go to
`docs/sprints/sprint-004b/results/`. The X-Wines file is the official one, checksum-verified before import.

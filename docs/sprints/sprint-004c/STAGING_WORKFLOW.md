# Staging catalogue workflow (`.github/workflows/staging-catalog.yml`)

This runs the X-Wines pilot on the separate Supabase project **`cellr-staging`**, from GitHub Actions. It exists because Claude's cloud container cannot open database connections, only HTTPS.

The workflow uses the existing tools unchanged (`import.ts`, `quality.ts`, `benchmark.ts`, `recognition.ts`, `perf.ts`, `staging-check.ts`), in the order of `staging-rehearsal.sh`.

## Safeguards (all of them, every run)

| Safeguard                                                                                                                                                                                                                                                                             | Where                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Started by hand only (`workflow_dispatch`); no schedule, no push trigger                                                                                                                                                                                                              | workflow `on:`                                                                                                     |
| Reviewed code only: the job runs on `refs/heads/main`, and the environment allows only `main`                                                                                                                                                                                         | workflow `if:`, plus the environment's deployment-branch rule                                                      |
| Every run waits for the owner's approval                                                                                                                                                                                                                                              | the GitHub Environment `cellr-staging` with a required reviewer                                                    |
| Staging credentials only, as environment secrets; never production's                                                                                                                                                                                                                  | `STAGING_DB_URL` (secret), `STAGING_PROJECT_REF` (variable). Production's ref in either is refused before checkout |
| The person starting the run types the project ref; it must equal the configured one                                                                                                                                                                                                   | first step, and `staging-guard.ts`                                                                                 |
| Before every write: a manual run of `main` in the environment; the ref approved in `approved-targets.json` (a reviewed file); the URL names that project; the database itself says `staging` with that ref                                                                            | `staging-guard.ts`, then `target.ts` on every connection of every tool                                             |
| Before the schema exists (`migrate`): the database has no users, no CELLR tables and no foreign migration history                                                                                                                                                                     | `staging-guard.ts --phase migrate`                                                                                 |
| X-Wines stays `unverified`, scope `pilot`. The run stops if the provider row says otherwise                                                                                                                                                                                           | `staging-pilot.sh import`                                                                                          |
| People can never see X-Wines. The run stops if a person sees a provider row, or may call the pilot search                                                                                                                                                                             | the pilot-separation step; `scan` mode                                                                             |
| No dataset content or secret leaves the run: tool output goes to files, the log gets counts, and artifacts are reduced to counts and ranks (`redact-results.ts`). The URL is masked. The X-Wines file comes from its official source, is checksum-verified, and is deleted at the end | `staging-pilot.sh`, workflow steps                                                                                 |

## One-time setup

1. **Create the project.** `cellr-staging`, eu-central-1, Micro compute (about $10/month extra). Never copy production data or users into it.
   - In its dashboard: Authentication → sign-ups off.
   - Settings → Database: note the password (it never goes into chat or a file in the repository).
2. **Create the GitHub Environment.** Repository → Settings → Environments → **New environment** `cellr-staging`:
   - **Required reviewers:** you. Leave "Prevent self-review" off if you are the only reviewer.
   - **Deployment branches and tags:** "Selected branches and tags" → `main`.
   - **Environment secret** `STAGING_DB_URL`: the staging project's **session pooler** connection string (Supabase → Connect → Session pooler). The user is `postgres.<ref>` and the password is filled in.
   - **Environment variable** `STAGING_PROJECT_REF`: the staging ref.
3. **Approve the ref in a reviewed PR:** add it to `scripts/catalog-tools/approved-targets.json`. A unit test makes production impossible there.
4. **Schema:** Actions → _Staging catalogue (manual)_ → Run workflow on `main`, mode **migrate**, with the ref typed. Approve the run.
5. **Staging marker** (the owner's act, once): in the staging project's SQL editor, or by Claude through the Supabase connector on **that** project only:

   ```sql
   insert into private.catalog_settings (environment, project_ref, set_by) values ('staging', '<ref>', '<name>');
   ```

6. **Run:** mode **check**, then **import**, then **scan**. Approve each run.

## What each mode proves

- **`check`:** identity, schema (migration history = repository), gates, RLS (including R-27 once 0050 is there) and providers. Read-only.
- **`import`:**
  - complete: 100,646 records, 0 invalid;
  - idempotent: the second run is all unchanged;
  - a non-pilot import is refused;
  - quality counts; 0 CELLR wines written;
  - pilot separation;
  - benchmark: top 1/3/8;
  - recognition: 0 wrong identities, 0 safety violations;
  - performance, measured over the network from GitHub's runner (expect higher numbers than the local ones): pilot c1 and c8, and people's c8, through the session pooler, which is limited to its pool size (`STAGING_POOL_CLIENTS`, 15 on Micro; a higher concurrency is refused, never reduced); pilot c16 and people's c16 through the same pooler in transaction mode (port 6543), each search in its own transaction with `set local role`, as PostgREST does;
  - the staging check again.
- **`perf-ladder`:** READ-ONLY. The pilot search (the same `private.catalog_search_impl` as people's search, over the
  100,646 X-Wines records) at 1, 2, 4, 8 and 16 concurrent searches, each search in a read-only transaction, many
  households, a documented query mix; concurrency measured inside PostgreSQL (`ladder.ts`). It refuses unless X-Wines
  is pilot and the synthetic source is not shown, checks that the state is unchanged afterwards, and fails only when
  the measurement is not valid (a failed search, the concurrency not reached, too few searches). The proposed release
  gate is reported, not enforced. Method, local results and the proposal: `docs/sprints/ratings/PERF-LADDER.md`.
- **`scan`:** a fictitious public source is created, a person finds it, X-Wines stays invisible, and R-27 keeps the origin and refuses X-Wines. All in one transaction that is rolled back.

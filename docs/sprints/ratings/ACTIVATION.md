# Activation: X-Wines catalogue, ratings and the CELLR community (production)

Every step is the **owner's** unless it says Claude, and each has a GO. Nothing becomes visible to people until
steps 8–10. Every step can be undone without data loss (the last column).

| #   | Step                                                                                                                                                                                                                               | Who                                                                             | Done when                                                                                           | Undo                                                                                     |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 0   | **Rights on paper.** Record the exact terms of the written permission in `SOURCE_RIGHTS_REGISTER.md` §1b, in a reviewed PR (no names or addresses)                                                                                 | Owner; Claude writes the PR from what the owner gives                           | The table in §1b is filled                                                                          | —                                                                                        |
| 1   | **Merge** PRs 1–4 in order (#137, #138, PR 3, PR 4). Production gets code only: every route answers 404 without its switch, and the new database functions do not exist yet                                                        | Owner merges                                                                    | CI green on `main`; the deploy is healthy                                                           | Revert the merge                                                                         |
| 2   | **Staging first.** Run the staging workflow: `migrate` (0051–0053), then `ratings` (pilot)                                                                                                                                         | Owner approves the runs; Claude starts them and reads the results               | Ratings run 1 inserts 1,008,593 units; run 2 leaves them all unchanged; the separation check passes | Staging is rebuildable                                                                   |
| 3   | **Backup.** Check the latest production backup in Supabase (Database → Backups)                                                                                                                                                    | Owner                                                                           | Its date noted                                                                                      | —                                                                                        |
| 4   | **Migrations in production**, route A (`docs/MIGRATIONS.md` §2): `db push` from `main`, whose dry run must list exactly 0051, 0052 and 0053                                                                                        | Owner                                                                           | `migration list` equals the repository                                                              | Additive. Nothing is shown while sources are off and the switches are unset; fix forward |
| 5   | **Rights in the database**, the logged admin step, with the evidence reference from step 0: `rights_status: verified`, `commercial_use: true`, `may_store`, `may_display`, `may_display_ratings: true`, **`search_scope: off`**    | Owner (SQL editor: `admin_catalog_provider_rights('xwines', …, reason, actor)`) | A row in `catalog_provider_rights_log`                                                              | `admin_catalog_provider_disable`                                                         |
| 6   | **The production environment.** GitHub → Settings → Environments → `cellr-production-catalog`: required reviewer = owner, branch `main` only, admin bypass off, secret `PRODUCTION_DB_URL` (session pooler, `postgres.<ref>` user) | Owner                                                                           | Settings saved                                                                                      | Delete the secret                                                                        |
| 7   | **The production workflow**, in order: `preflight` → `dry-run` → `import` → `verify` (each approved in the environment)                                                                                                            | Owner approves each run; Claude starts and reads them                           | `verify`: 100,646 records, 1,008,593 rating units, 20,857,044 ratings, all PASS                     | `admin_catalog_provider_disable`; a new run reimports idempotently                       |
| 8   | **Search and wine cards.** Scope `public` (logged admin step), then `CELLR_FEATURES` on Vercel production + `wine_search,scan_resolver,sources_panel,catalog_ratings`                                                              | Owner                                                                           | A signed-in phone shows ratings on a known wine                                                     | Remove the switch; scope `off`                                                           |
| 9   | **Community reviews.** Add `community_reviews` to `CELLR_FEATURES`; assign a moderator (an admin) and check `/admin/reviews`                                                                                                       | Owner                                                                           | A test review can be published, reported and moderated                                              | Remove the switch (reviews are kept, hidden)                                             |
| 10  | **Watch 72 hours.** Health page, runtime errors, `/admin/reviews`, rate-limit hits, ratings read latency                                                                                                                           | Claude reports; owner decides                                                   | No errors attributable to ratings                                                                   | Steps 8–9 back                                                                           |

## What is checked where

- **Production route**: only through `scripts/catalog-tools/production.ts`. Its run checks guard against
  accidents; the control is the URL itself, an environment secret released per run by the owner's approval. It
  accepts a run only when all of these hold:
  - it is a manual run of `main`, inside `cellr-production-catalog`;
  - the typed ref matches;
  - the URL names the project;
  - the database says it is production.

  Every other tool still refuses production. The URL may carry no query parameter but `sslmode`, and through the
  pooler only port 5432.

- **Imports**:
  - The records import is idempotent; a run withdraws what a complete file no longer has.
  - The ratings import always runs a dry run first. The database refuses to finish a run that does not add up.
  - Pilot runs are impossible in production.
- **Logs** (this repository is public, so are its Actions logs): they show pass/fail and the provider's catalogue
  counts only. No artifact is uploaded.

## Costs

- **Database:** about 0.25 GB more in production (rating aggregates 241 MB live after vacuum; records about 180 MB,
  already measured in Sprint 004B), within the plan's 8 GB.
- **No new paid service.** Actions minutes: about 15 minutes per production import run.
- **Staging** stays at about $10/month until you pause it.

## Performance

| Measurement                               | Where             | Result                                                                                |
| ----------------------------------------- | ----------------- | ------------------------------------------------------------------------------------- |
| Ratings read                              | Local Postgres 17 | p95 0.26 ms per record                                                                |
| Reviews read                              | —                 | Uses the partial indexes (review of PR 2)                                             |
| People's search at 16 concurrent searches | —                 | **Still open** (`sprint-004c/GO_LIVE.md` A3): to be measured on staging before step 8 |

## Undo, honestly

- **Hiding:** `admin_catalog_provider_disable` hides the source's records and ratings at once; nothing is deleted.
- **Removing:** the imported rows can be deleted with the provider's runs. That needs a reviewed migration, or the
  owner's SQL in the editor; it is never a workflow mode.
- **Restoring the whole database** from a backup is the last resort. A restore of the hosted project has not been
  observed yet (register risk R-BAK-1): rehearse it before you depend on it.

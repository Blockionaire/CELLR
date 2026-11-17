# Runbook: the isolated Wine Intelligence database release (migrations 0037–0042 only)

**Status 2026-11-17: prepared and rehearsed. Nothing in this runbook has been run against production**, apart from the
read-only checks in §2. Every step that writes is the owner's, with the owner's credentials (§8). `docs/MIGRATIONS.md`
stays the rulebook; this runbook applies it to one release. Where they disagree, `MIGRATIONS.md` wins and this file
must be corrected.

**Recommendation: CONDITIONAL GO.** The release may go ahead when every preflight check in §4 passes, and only from
the isolated checkout of §3. The CI exceptions it relies on, with their scope and evidence, are in
[`CI_EXCEPTIONS_0042.md`](CI_EXCEPTIONS_0042.md).

## 1. What this release is, and what it is not

| In this release (exactly these six files, in this order) | sha256                                                             |
| -------------------------------------------------------- | ------------------------------------------------------------------ |
| `20261114000037_catalog_search.sql`                      | `b0f62cafbbc96e07e497fac81db08852e09ff643423b06200449f8e4f8944e70` |
| `20261115000038_wi01_provider_lifecycle.sql`             | `e9e5510262d7f8c23dbd865e6afe35faf160e966791362a5db7e98ed2866cf34` |
| `20261116000039_wi04_profile_research_claim.sql`         | `16b219745311defc643f56b569d4069b3e62a2fa37eb9429b5d9c110112115d8` |
| `20261117000040_wi05_wine_source_notices.sql`            | `e855d7e05d25f2ddf0d80c83adfdacddf104afbc5316b2ca9daf20b8e2a8b333` |
| `20261118000041_wi06_admin_sources.sql`                  | `55e942dbcd65563459317d6d07a27912baacf78fe47b6556e9b1555d40e02104` |
| `20261119000042_hardening_search_scope_link_review.sql`  | `88c75373c06f290cc3a3b8223871c3e32ba1953c5eaf983b3d27f4329a65138b` |

**Not in this release, and they must not be applied with it:** `0043`–`0045` (Smart Cellar 3D, sprint 1B) and
**`0046` (Sommelier V1: kept conversations and answer ratings)**. `0046` was merged into `main` with PR #75 on
2026-11-17, so `main` now holds all four.

**`supabase db push` from `main` would apply 0037–0046, all ten.** The CLI runs every migration that is missing from
the history, in order, and cannot stop after a given version. So this release runs only from a checkout that holds
exactly 0001–0042: commit `248206af159b9b0f8ff8ec7faee557441e3d193f` (`248206a`). That is the last commit of `main`
before `0043`. Its 42 migration files are byte-identical to `main` (checked in §4 P3, and by the rehearsal).

**What changes for people:** nothing visible. Every Wine Intelligence feature stays off (`CELLR_FEATURES` unset). The
app is not redeployed. The app on `main` is already in production and copes with every one of these objects missing.
With the switches off it was tested on a database without 0037–0042 (`progress/WI-08-hardening.md` §6) and on one
with them (CI). On a database at 0042 it was tested on 2026-11-17 (§2).

Once the release has run, four things are live even with every switch off:

- **Admin → External sources** works. It shows no source to people.
- **The research claim.** Two simultaneous first requests for a shared wine profile research it once (0039).
- **`GET /api/v1/catalog/search` answers** instead of saying "unavailable". The route has no feature switch of its own.
  It is signed-in only, rate-limited (600 per hour), under RLS, at most 20 results, and it shows no external record:
  every provider's `search_scope` is `off` until the owner changes it.
- **The search index follows** every write to `wines`, `producers` and `wine_aliases`. These are 0037's triggers, the
  only change on existing tables. The backfill indexes the existing wines once (43 at the audit) and is instant.

No migration in this release rewrites existing rows. 0038 and 0041 update only tables that 0037 creates, which are
empty.

## 2. Evidence (2026-11-17)

**Production, read-only.** Only `SELECT` statements, through the Supabase MCP:

- **Plan:** organisation plan `pro`. Daily backups, the last 7 days. They are physical backups, because the project
  runs Postgres 17.11 (Supabase docs, "Database Backups"). PITR is not enabled; on Pro it is a paid add-on. Whether
  today's backup is listed is for the owner to see in the dashboard (P1).
- **Migration history:** exactly `0001`–`0036`, 36 versions, the newest `20261113000036`. The owner recorded it
  between 2026-11-15, when there was no history, and 2026-11-17.
- **Schema:** the fingerprint (`fingerprint.sql`) was compared with a reference built from the repository at 0036. All
  380 object groups outside the accepted deviations are identical (aggregate md5 `245424fad4c44b7e07d79bb5b46ed85a` on
  both sides), and all 13 deviations in `production-accepted.txt` are at their pinned hashes.
- **Preflight:** `release-0042-preflight.sql` reports all five rows `ok`:
  - history is exactly 0001–0036;
  - no object of 0037–0046 exists;
  - `pg_trgm` and `unaccent` are present;
  - pg_cron has only `catalog-scan-reads-purge`, and it is active;
  - 43 wines, 39 producers, 0 aliases.

**Rehearsal** (`bash scripts/migration-audit/rehearse-release-0042.sh`, 31 s, on `main` at `21186f6`):

- **The production-like database:** built from the release checkout, with production's row counts (39 producers, 43
  wines, plus 2 aliases so the alias trigger has rows too) and the history 0001–0036. The preflight passes and the
  database is equivalent to the repository at 0036.
- **The release:**
  - the dry run with `--skip-vault` lists exactly 0037–0042;
  - the push applies those six;
  - the history then holds 42 versions and the dry run says the database is up to date.
- **Post-checks:** all `ok` and equivalent to 0042 (445 groups). 43 of 43 wines and 2 of 2 aliases are indexed, no
  provider is shown, and nothing of 0043–0046 exists.
- **The new triggers on existing rows:** a renamed producer is found under its new name; deleting wines leaves no
  entries behind.
- **Test suites:** the permission suite of `248206a` passes 1327/1327. The later push from `main` lists and applies
  exactly 0043–0046, the result is equivalent to `main` (477 groups), and `main`'s suite passes 1591/1591.

**The check files catch the wrong states** (checked on throwaway databases):

- Before the history exists, the preflight errors.
- With 0043–0046 applied too, the preflight and post-check report `STOP` on the history and on the 0043–0046 objects.
- The pg_cron row says `ok` only for exactly `catalog-scan-reads-purge:true`. It reports `STOP` for no jobs, for an
  inactive job and for 0046's second job.
- The read-only session refuses writes.

**A migration that fails during `db push`** (CLI 2.120.0, checked on a throwaway database):

- the files before it stay applied and recorded;
- the failing file is rolled back entirely and not recorded;
- the files after it are not attempted.

**The app on `main` with the database at exactly 0042** (local stack, desktop, switches off, `--retries=0`): the
app's build at `21186f6`, with a database built from 0001–0042 only. 0043–0046 were left out of the stack for the run;
nothing was committed that way.

- **Result:** **130 passed, 0 failed, 0 skipped** in 5.4 min.
- **Specs:** `smoke`, `acceptance`, `cellar`, `flows`, `detail`, `scan`, `scan-api`, `purchase-intel`, `wine-search`,
  `sources`, `admin-sources`, `catalog`, `catalog-learning`, `sommelier`, `tonight` and `wishlist`.
- **What that covers:** sign-in to the end, adding and editing wines and bottles (0037's triggers), scanning, Koopcheck,
  catalogue search and its API, sources and admin sources, the sommelier without 0046, Tonight, and the wishlist.

## 3. Roles, window and prerequisites

- **Who:** the owner runs every command, on their own machine. No coding agent writes to production.
- **When:** one sitting of about 45 minutes, at a quiet moment. The push itself takes seconds. During the window there
  are no merges to `main`, no Vercel deploys and no other database work.
- **Tools:**
  - `git`, `pnpm` and `psql` (Postgres client 16 or newer);
  - Postgres 16 server binaries for the comparison tool (`PGBIN`, default `/usr/lib/postgresql/16/bin`; with Homebrew,
    for example `export PGBIN=/opt/homebrew/opt/postgresql@16/bin`);
  - Python 3.
- **Two checkouts:**
  - **`$MAIN`:** a clone of the repository on `main` that contains this runbook, with `pnpm install` done. That is
    `main` after this PR is merged, or the PR branch before. It holds the check files and the pinned Supabase CLI
    (2.120.0).
  - **`$REL`:** the release checkout of `248206a`, created in P2. **Every `db push` of this release runs from `$REL`,
    never from `$MAIN`.**
- **The connection string:** Supabase → Connect → **Session pooler** (port 5432; not the transaction pooler). The user
  name contains the project ref, `postgres.vvelgyhbjfmjvxkzekyz`. The password must be percent-encoded.

## 4. Preflight (read-only). Every check must pass, or stop: §6

**P0. Go-ahead.** The owner has decided GO (§8 A1), knows the CI exceptions ([`CI_EXCEPTIONS_0042.md`](CI_EXCEPTIONS_0042.md))
and holds the window.

**P1. Backup.** In Supabase → Database → **Backups** (Scheduled), a completed daily backup from the last 24 hours is
listed. The Pro plan keeps the last 7 days. Restoring one restores the **whole** project to that moment (§7.5).

An extra logical dump of your own is optional. If you want one, use `docs/sprints/sommelier-v1/RELEASE.md` §4 step 0a,
which is three `db dump` commands. It puts production data (accounts, cellars) on your machine, so keep it encrypted
and out of git and chats.

**P2. The release checkout.**

```bash
export MAIN=~/CELLR REL=~/cellr-release-0042
```

```bash
git -C "$MAIN" fetch origin main
```

```bash
git -C "$MAIN" worktree add --detach "$REL" 248206af159b9b0f8ff8ec7faee557441e3d193f
```

```bash
ln -s "$MAIN/node_modules" "$REL/node_modules"
```

**P3. The files that will run are the tested ones.**

```bash
git -C "$REL" rev-parse HEAD
```

This must print `248206af159b9b0f8ff8ec7faee557441e3d193f`.

```bash
ls "$REL"/supabase/migrations/*.sql | wc -l
```

```bash
ls "$REL"/supabase/migrations | tail -1
```

These must print `42` and `20261119000042_hardening_search_scope_link_review.sql`.

```bash
git -C "$MAIN" diff --quiet 248206af159b9b0f8ff8ec7faee557441e3d193f origin/main -- $(cd "$REL" && ls supabase/migrations/*.sql) && echo "0001-0042 identical to main"
```

This must print `0001-0042 identical to main`. Then check the hashes of the six files (Linux: `sha256sum --check`):

```bash
cd "$REL/supabase/migrations" && shasum -a 256 --check <<'EOF'
b0f62cafbbc96e07e497fac81db08852e09ff643423b06200449f8e4f8944e70  20261114000037_catalog_search.sql
e9e5510262d7f8c23dbd865e6afe35faf160e966791362a5db7e98ed2866cf34  20261115000038_wi01_provider_lifecycle.sql
16b219745311defc643f56b569d4069b3e62a2fa37eb9429b5d9c110112115d8  20261116000039_wi04_profile_research_claim.sql
e855d7e05d25f2ddf0d80c83adfdacddf104afbc5316b2ca9daf20b8e2a8b333  20261117000040_wi05_wine_source_notices.sql
55e942dbcd65563459317d6d07a27912baacf78fe47b6556e9b1555d40e02104  20261118000041_wi06_admin_sources.sql
88c75373c06f290cc3a3b8223871c3e32ba1953c5eaf983b3d27f4329a65138b  20261119000042_hardening_search_scope_link_review.sql
EOF
```

All six must say `OK`. Optionally, rehearse once more on the day. It needs no connection string and builds its own
database:

```bash
cd "$MAIN" && bash scripts/migration-audit/rehearse-release-0042.sh
```

It must end with `RESULT: the isolated release of 0037-0042 rehearsed; then the rest applies cleanly on top`.

**P4. The connection is production, read-only.** Paste the session-pooler string when prompted; it stays out of the
shell history:

```bash
read -rs DATABASE_URL && export DATABASE_URL
```

```bash
case "$DATABASE_URL" in *vvelgyhbjfmjvxkzekyz*) echo "project vvelgyhbjfmjvxkzekyz";; *) echo "STOP: not the CELLR production project";; esac
```

```bash
PGOPTIONS='-c default_transaction_read_only=on' psql "$DATABASE_URL" -X -Atc "select current_user, split_part(version(), ' ', 2)"
```

This must print `postgres|17.…`.

**P5. Preflight SQL.**

```bash
PGOPTIONS='-c default_transaction_read_only=on' psql "$DATABASE_URL" -X -At -F ' | ' -v ON_ERROR_STOP=1 -f "$MAIN/scripts/migration-audit/release-0042-preflight.sql"
```

Every row must start with `ok`:

- history is exactly 0001–0036;
- no object of 0037–0046 exists;
- `pg_trgm` and `unaccent` are present;
- pg_cron has only `catalog-scan-reads-purge`, and it is active;
- the row counts. Note them for V3.

`STOP`, `skip` or an error means stop.

**P6. The schema is the repository at 0036.** Run this from `$REL`, so the reference is built from its files:

```bash
cd "$REL" && bash scripts/migration-audit/reference.sh --skip 20261114000037 --skip 20261115000038 --skip 20261116000039 --skip 20261117000040 --skip 20261118000041 --skip 20261119000042 > /tmp/ref-0036.txt
```

```bash
cd "$REL" && bash scripts/migration-audit/compare.sh --target "$DATABASE_URL" --reference /tmp/ref-0036.txt --accept scripts/migration-audit/production-accepted.txt
```

This must print `RESULT: equivalent`, with only the deviations of `production-accepted.txt` listed as accepted.

**P7. What the CLI sees.**

```bash
cd "$REL" && pnpm exec supabase migration list --db-url "$DATABASE_URL"
```

`0001`–`0036` must show on both sides, and `0037`–`0042` local only. There are 42 local files and no version newer
than 0042.

**P8. The app's switches.** In Vercel → project `cellr` → Settings → Environment Variables, `CELLR_FEATURES` is
**unset or empty** for Production and Preview. Nothing is changed there in this release. Then, under Deployments, no
deploy is running.

## 5. Release (the only writing step)

**R1. Dry run, from `$REL`.**

```bash
cd "$REL" && pnpm exec supabase db push --db-url "$DATABASE_URL" --dry-run --skip-vault
```

It must list **exactly** these six, in this order, and nothing else:

1. `20261114000037_catalog_search.sql`
2. `20261115000038_wi01_provider_lifecycle.sql`
3. `20261116000039_wi04_profile_research_claim.sql`
4. `20261117000040_wi05_wine_source_notices.sql`
5. `20261118000041_wi06_admin_sources.sql`
6. `20261119000042_hardening_search_scope_link_review.sql`

Anything listed after `20261119000042` (above all `20261123000046_sommelier_conversations.sql`) is a **NO-GO**. It
means the wrong checkout; stop.

**R2. Push, from `$REL`.** `--skip-vault`: the CLI otherwise first writes the Vault secrets of `supabase/config.toml`.
There are none, and this release writes nothing but the migrations.

```bash
cd "$REL" && pnpm exec supabase db push --db-url "$DATABASE_URL" --skip-vault
```

The CLI lists the migrations again and asks for confirmation. Answer `y` only if the list is the same six. Expected
output: `Applying migration …` six times, then `Finished supabase db push.` A write to `wines`, `producers` or
`wine_aliases` waits for those few seconds while 0037 adds its triggers.

If it stops with an error: §7.2. Do not run it again.

## 6. Verify (read-only)

**V1. History.**

```bash
cd "$REL" && pnpm exec supabase migration list --db-url "$DATABASE_URL"
```

`0001`–`0042` must show on both sides. Then:

```bash
cd "$REL" && pnpm exec supabase db push --db-url "$DATABASE_URL" --dry-run --skip-vault
```

It must say the remote database is up to date.

**V2. The schema is the repository at 0042.**

```bash
cd "$REL" && bash scripts/migration-audit/compare.sh --target "$DATABASE_URL" --accept scripts/migration-audit/production-accepted.txt
```

This must print `RESULT: equivalent`.

**V3. Post-check SQL.**

```bash
PGOPTIONS='-c default_transaction_read_only=on' psql "$DATABASE_URL" -X -At -F ' | ' -v ON_ERROR_STOP=1 -f "$MAIN/scripts/migration-audit/release-0042-postcheck.sql"
```

Every row must start with `ok`:

- history is exactly 0001–0042;
- every checked object of 0037–0042 exists;
- **no object of 0043–0046 exists**;
- `private.catalog_environment()` is `production`;
- no external source is shown;
- the search index covers every wine and alias: the counts of P5, for example `43/43`;
- pg_cron still has only `catalog-scan-reads-purge`.

**V4. What is still to come, read-only, from `$MAIN`.**

```bash
cd "$MAIN" && pnpm exec supabase migration list --db-url "$DATABASE_URL"
```

`0001`–`0042` must show on both sides, and `0043`–`0046` local only. **Never run `db push` from `$MAIN` in this
release.**

**V5. Smoke (the app, still the same deployment):**

1. Sign in and open the cellar.
2. Add a bottle of a **new** wine. That writes `wines` (and `producers`) through 0037's triggers.
3. Edit a wine's name.
4. Scan a label, open a wine page, run a Koopcheck and ask the sommelier something.
5. Admin → **External sources**: the page loads, no longer says "The database step for this page … has not been
   run yet", and lists no source that is shown.
6. Vercel → Logs (Production) for 15 minutes: no new 5xx and no new errors. Supabase → Logs → Postgres: no `ERROR`
   that mentions `catalog_`, `shared_profile` or `wine_source`.

**V6. Close.**

```bash
git -C "$MAIN" worktree remove "$REL"
```

Then unset `DATABASE_URL`, and record the release in a docs PR:

- `MIGRATIONS.md` §3, with 0037–0042 applied on date X;
- `EPIC.md`'s resume block.

The 0043–0046 release is a separate decision, with its own runbook.

## 7. Recovery and incident response

The rules: migrations are forward-only (`MIGRATIONS.md` §1–2). **Never:**

- `migration repair` to "undo" a migration;
- `db push` from `$MAIN`;
- `db push --include-all`;
- editing an applied migration file;
- dropping objects or running SQL by hand outside §7.4.

Write down what you saw (commands, output, times) for the incident note.

**7.1 A preflight or dry-run check fails (before R2).** Nothing has changed. Do not push. Keep the failing output.
Typical causes:

| Cause                                          | Next step                                        |
| ---------------------------------------------- | ------------------------------------------------ |
| Wrong checkout (R1 lists more than six)        | Redo P2 and P3                                   |
| Wrong project (P4)                             | Use the right connection string                  |
| History or schema not as expected (P5, P6, P7) | `MIGRATIONS.md` §5, then a new decision          |
| No recent backup (P1)                          | Wait for the next one, or make the optional dump |

**7.2 `db push` stops with an error during R2.** The CLI applies each file in its own transaction, together with its
history row (see §2):

- the files before the failing one are applied and recorded;
- the failing one is rolled back completely;
- the later ones are not attempted.

Steps:

1. Do not retry. Run V1 and V3 to see the state: which versions are recorded, which objects exist.
2. The app keeps working. Every call of the app into these objects copes with the object missing, one function at a
   time. So any prefix of 0037–0042 is a safe state to stay in.
3. Find the cause from the CLI's error (for example a lock timeout or a missing privilege). If it is transient (a lock,
   a dropped connection) and V1, V3 and V2 (`compare.sh`) show nothing unexpected, the owner may decide to run R1 and
   R2 again from `$REL`. The dry run then lists only the files not yet applied.
4. If the cause is in a migration file itself, the file must not be edited, because it is on `main`. Fix forward with a
   new migration (§7.4). Until then, stay at the prefix.

**7.3 A post-check fails (V1–V4) but the app works.** No rollback. Keep the output, and do not switch any feature on.

| Case                              | Next step                                                                                                                                                                                                                                                                    |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `compare.sh` differs              | Attribute it with `inventory.sh` (`MIGRATIONS.md` §5)                                                                                                                                                                                                                        |
| The search index count is off     | Report it. Search is not shown to people while `wine_search` is off                                                                                                                                                                                                          |
| **An object of 0043–0046 exists** | **Incident**: 0043–0046 were applied after all. They are additive and the app on `main` supports them, so the app works. Do not revert. Check `cron.job` (0046 adds `sommelier-conversations-purge`), and decide about 0046's data (kept conversations) before people use it |

**7.4 Something in production breaks after R2.** Severity 1 means wine, bottle or producer writes fail. Severity 2 means
one new path fails: external sources, catalog search, or the research claim.

1. **Triage (≤ 15 min).** Use Vercel runtime logs and Supabase Postgres logs to find the failing statement and flow.
   The only existing write paths that changed are inserts, updates and deletes on `wines`, `producers` and
   `wine_aliases`, through 0037's triggers. A Severity 1 points there.
2. **Rolling back the app does not help.** The deployment is the same before and after this release.
3. **Fix forward (preferred, both severities).** Add a new migration in a reviewed PR, with CI green on its own jobs,
   and apply it with the same procedure: a checkout that holds 0001–0042 plus the fix, its own dry run listing only
   the fix.
   - **Give it a version between `20261119000042` and `20261120000043`**, so that the later push of 0043–0046 stays in
     order. A version after 0046 would force `--include-all` later, which `MIGRATIONS.md` forbids.
   - This ordering decision is the owner's, in that PR.
4. **Break-glass, Severity 1 only, owner decision, written down.** If the fix cannot wait for a PR, disable only the
   failing 0037 trigger. It is one of `wines_catalog_search`, `producers_catalog_search` and
   `wine_aliases_catalog_search`. For example:

   ```sql
   alter table public.wines disable trigger wines_catalog_search;
   ```

   Writes work again; the search index stops following those rows. It is a deliberate drift: `compare.sh` shows it (`enabled=D`). The fix-forward migration of step 3 re-enables
   the trigger and re-indexes (`select private.catalog_search_refresh_wine(id) from public.wines`).

5. **Tell people.** If people were affected for more than 15 minutes, tell the beta testers what happened and when it
   was fixed.

**7.5 Data damage (not expected: no migration here rewrites existing rows).** Restoring the daily backup (Supabase →
Database → Backups → Restore) brings the **whole project** back to that backup's moment:

- every write since then is lost, the migration history included;
- the project is offline during the restore;
- Storage files are not part of it.

Use it only when the damage is worse than losing those hours, and only by the owner's decision. Afterwards run §4 P5
again: the history should be back to 0001–0036.

## 8. GO / NO-GO and approvals

**GO only if all of these hold:**

| #   | Criterion                                                                                                       | Where  |
| --- | --------------------------------------------------------------------------------------------------------------- | ------ |
| G1  | A completed daily backup from the last 24 hours is listed                                                       | P1     |
| G2  | `$REL` is `248206a`, holds exactly 42 files, 0001–0042 identical to `main`, the six sha256 match                | P2, P3 |
| G3  | The connection is project `vvelgyhbjfmjvxkzekyz`                                                                | P4     |
| G4  | The preflight SQL is all `ok`                                                                                   | P5     |
| G5  | `compare.sh` against the repository at 0036: `RESULT: equivalent`                                               | P6     |
| G6  | The dry run from `$REL` lists exactly the six files of §1                                                       | P7, R1 |
| G7  | `CELLR_FEATURES` is unset or empty; no deploy or other database work in progress                                | P8     |
| G8  | `main`'s CI fails only on the items in `CI_EXCEPTIONS_0042.md`, within their scope; every database job is green | CI     |

**NO-GO if any of these holds:**

- one of G1–G8 fails;
- the dry run lists `0043`–`0046` or anything else;
- the history holds anything other than 0001–0036;
- a deviation outside `production-accepted.txt` appears;
- an incident is open;
- the window is not quiet.

**The release is done (success)** when V1–V4 pass and the V5 smoke shows nothing new for 15 minutes.

| #   | Action                                                  | Kind             | Who              |
| --- | ------------------------------------------------------- | ---------------- | ---------------- |
| A1  | Decide GO for 0037–0042 only, knowing the CI exceptions | decision         | owner            |
| A2  | Optional extra logical dump (P1)                        | data handling    | owner (password) |
| A3  | R2: `db push --skip-vault` from `$REL`                  | production write | owner (password) |
| A4  | §7.4 break-glass or §7.5 restore, if ever needed        | production write | owner            |
| A5  | The docs PR after the release (V6)                      | docs PR review   | owner            |

Everything else in this runbook is read-only.

# Production backup & recovery sprint: test report

2026-11-16, branch `feature/production-backup-recovery`. Procedure and commands: [`docs/BACKUP-RECOVERY.md`](../../BACKUP-RECOVERY.md).

## Summary

|                             | Result                                                                                                                                                                            |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IMPLEMENTED                 | Storage backup / verify / restore / archive tool (`scripts/storage-backup`); database restore helpers and rehearsal (`scripts/db-backup`); CI job; documentation                  |
| TESTED                      | 73 automated tests (mock Storage API), 10/10 deliberate defects caught by them; 18/18 checks against real Supabase Storage; 6/6 checks of the database dump-and-restore rehearsal |
| PRODUCTION BACKUP           | **Not performed.** No production file was downloaded. Waits for the owner's GO (`BACKUP-RECOVERY.md` §9)                                                                          |
| RESTORE VERIFIED            | **Yes on local Supabase stacks with synthetic data** (Storage and database). **Not** against a hosted project; never against production                                           |
| BLOCKERS for production use | None in the code. Owner actions: a dedicated secret key, an approved destination, the GO list. Windows run not yet done (see "Not validated")                                     |

## Environment

Linux container; Node 22.23.4; pnpm 10.28.0; Supabase CLI 2.120.0 (the repository's pinned version); local stack
images `supabase/postgres:17.11.0.004`, `storage-api:v1.79.36`, `gotrue:v2.197.0`, `kong:2.8.1`; `age` 1.x.
Production runs Postgres 17.11 (read from the project's metadata).

## What production was asked (read-only)

Through the connected Supabase integration, `SELECT` statements on catalogue and metadata only, **aggregated** — no
object paths, no file contents, no user data were returned or stored:

- columns of `storage.buckets` / `storage.objects` (to learn the current Storage schema: versioning columns exist);
- per bucket: type, public flag, size limit, MIME types, versioning status, object count, bytes, how many ETags are
  plain MD5 / multipart / missing, how many names fall outside `[A-Za-z0-9._/-]`, maximum depth and name length,
  case-insensitive duplicates, object-vs-folder name clashes, rows with owner or user metadata, rows without `version`;
- totals, analytics/vector buckets, orphan rows, whether `supabase_migrations.schema_migrations` exists.

Result: 7 standard private buckets, versioning disabled, 199 objects, 56,528,862 bytes; 199/199 single-part MD5 ETags,
0 unusual names, max depth 3, no collisions, no user metadata, every row with `version` and `cacheControl`;
no migration history table. Nothing was written, no setting was changed, no key was created.

## Behaviour of the real Storage API (probed on the local stack, synthetic files)

These observations shaped the code and the mock; each is a test:

| Observation                                                                                                                     | Consequence in the tool                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Errors are HTTP **400** with the real status in the body (`{"statusCode":"403"}`, `"404"`, `"409"`)                             | `errorFromResponse` reads both; a 400/403 is an auth failure, not a generic error                    |
| A **publishable key** lists `[]` with HTTP 200                                                                                  | Refused before any request; a project without buckets fails the backup                               |
| An object and a folder can share a name (`h1` and `h1/a.jpg`); keys differing only in case coexist                              | Collision-free local paths (`~<hash>`)                                                               |
| Keys may contain space `& $ @ = ; : + , ! ' * ( ) ?`, a trailing dot, `CON`; Unicode, `#`, `%`, `\` are rejected (this version) | Encoded file names; Unicode handled anyway (mock tests)                                              |
| `%2E%2E` in a URL is collapsed by the gateway (the request reaches another key)                                                 | Keys with `.`/`..` segments are never requested; the URL is checked not to be rewritten              |
| ETag = MD5 of the content for single-part uploads                                                                               | Transport integrity proven per file                                                                  |
| A `storage.objects` row without its file returns **500** (not 404)                                                              | Restore treats a persistent 500 as "row without a file" (`--fill-missing`), a connection error never |
| `x-upsert: true` on such a row writes the file and it is readable afterwards                                                    | `--fill-missing` works after a database restore                                                      |
| Duplicate upload: 400 with `"statusCode":"409"`                                                                                 | Never overwritten; compared instead                                                                  |

## Automated tests (`pnpm --filter @cellr/storage-backup test`): 73 passed

Required scenarios (sprint brief §8) and where they are covered:

| Scenario                              | Test(s)                                                                                                                                                                 | Status |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Successful multi-bucket backup        | `backup › backs up every bucket, verifies it, and writes the manifest…` (also `sha256sum -c`)                                                                           | PASS   |
| Empty buckets                         | same test (2 empty buckets); `an empty bucket is fine; a project without any bucket fails unless expected`                                                              | PASS   |
| Private files                         | the mock rejects any request without the right key; `refuses keys that cannot see private buckets`                                                                      | PASS   |
| Nested paths and special characters   | `handles nested paths, special characters, case and object/folder collisions`; `paths.test.ts`                                                                          | PASS   |
| Interrupted transfers                 | `retries an interrupted transfer and a dropped connection`; `a transfer that keeps breaking fails…`; `a body shorter than its Content-Length…`                          | PASS   |
| Expired or invalid credentials        | `a wrong or expired key stops the run with exit 3`; `a key that expires halfway…`; expired JWT refused                                                                  | PASS   |
| Retryable and non-retryable failures  | `retries 503 and 429 (Retry-After honoured)`; `does not retry a plain 400`; `gives up after the configured attempts`                                                    | PASS   |
| Corrupt downloads                     | `detects corrupt downloads by MD5: retried, and a persistent mismatch fails`                                                                                            | PASS   |
| Incorrect file counts / sizes         | `a size that does not match the listing…`; verify `compares with an independent database count`                                                                         | PASS   |
| Changes during export                 | created / deleted / changed before download / changed after download (4 tests)                                                                                          | PASS   |
| Path traversal                        | `never downloads a key with a path-traversal segment`; `refuses a manifest edited to point outside…`; `resolveInside`                                                   | PASS   |
| Manifest and checksum verification    | verify: intact; changed byte, missing and planted file; edited `SHA256SUMS`; FAILED backup                                                                              | PASS   |
| Repeat runs without overwriting       | `repeat runs make new folders and never touch an earlier backup` (incl. same-second refusal)                                                                            | PASS   |
| Restoration into an isolated location | restore: dry run writes nothing; full restore with read-back; resume; conflict; `--fill-missing`; ghost rows; production and source refused; damaged backup; one bucket | PASS   |

Also covered: the read-mode allowlist (every write route blocked, also when called directly), restore-mode upsert rule,
redaction of keys/JWTs/signed URLs/connection-string passwords, key-file permissions, Git-ignored and cloud-synced
destination checks, Ctrl+C, the disk re-read, objects without an MD5 ETag, the encrypted archive (decrypt and compare),
and the CLI's exit codes with a check that no key appears in any output or written file.

**Mutation check.** Ten safety checks were disabled one at a time (allowlist, second inventory, MD5, Content-Length,
SHA-256 in verify, path collisions, restore overwrite rule, production guard, publishable key, disk re-read). The suite
failed for each one. Three of them were not caught at first; tests were added until they were.

## Against real Supabase Storage (`pnpm --filter @cellr/storage-backup real-stack`): 18/18

Two local stacks, synthetic files (22 seeded, plus earlier probe files: 33 and 55 objects in the two runs, up to a
3.5 MB file), run twice: with an existing target stack, and with the target created by the script (the CI path).

Seeded · backup VERIFIED · every seeded file in the manifest · every file proven by MD5 · `sha256sum -c` · verify with
the database count (the SQL from §4.4) and live drift · dry run writes nothing · restore VERIFIED · independent
read-back of every object · bucket names and settings identical · second restore changes nothing · different content
not overwritten (exit 1) · `--overwrite` · row without a file detected and left alone (exit 1) · `--fill-missing`
writes it, read back · production refused before any key is read (exit 4) · restore into the source refused (exit 4) ·
encrypted archive decrypts to the full backup.

## Database dump and restore rehearsal (`bash scripts/db-backup/rehearse-restore.sh`): 6/6

Local source stack (all 45 migrations, seed, two synthetic Auth users and households, 55 files) → the official
three-part `supabase db dump` → a second, **empty** local stack → restore → proof.

| Finding                                                                                                                                                                                                                                                                                                                                                                      | Severity                                                                | Resolution                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **F1.** The official restore (`roles.sql`, `schema.sql`, `data.sql`) succeeds without errors but **widens privileges**: ~180 functions and tables gain `anon`/`authenticated` privileges CELLR never grants, e.g. `EXECUTE` on the service-role-only `admin_*` security-definer functions (would expose admin data such as beta feedback) and all privileges on `households` | **High** (a restored project would be less secure than production)      | `scripts/db-backup/pre-restore.sql` (migration 0001's default-privilege statements) runs first. Proven: fingerprint equivalent afterwards |
| **F2.** CELLR's RLS policies on `storage.objects` and triggers on `auth.users` are **not in the dump** (Supabase-managed schemas)                                                                                                                                                                                                                                            | High (no photo access, no profile on sign-up)                           | `scripts/db-backup/export-platform-objects.sql` (read-only) exports them; run last                                                        |
| **F3.** The pg_cron job `catalog-scan-reads-purge` is **not in the dump**                                                                                                                                                                                                                                                                                                    | Medium (scan readings would no longer be purged)                        | Exported by the same file                                                                                                                 |
| **F4.** The CLI strips lines starting with `--` from the dump, also inside function bodies (3 comment lines in `admin_wine_master_search`)                                                                                                                                                                                                                                   | Low (comments only; would matter for a string literal with such a line) | Accepted with its exact hash in `restore-accepted.txt`                                                                                    |
| **F5.** One CHECK constraint is re-parsed with flattened parentheses                                                                                                                                                                                                                                                                                                         | None (same rule)                                                        | Accepted with its exact hash                                                                                                              |

With the fix: logical restore in one transaction without errors · fingerprint **equivalent** (466 object groups,
privileges, policies and triggers included; the two accepted deviations) · row counts equal in **all 99 tables**
(cron run history excepted) · Storage files restored on top with `--fill-missing`: 55/55 filled and read back.
Without `pre-restore.sql` the same comparison failed (380 differing lines), so the check does detect the flaw.

## Not validated (and why)

| Item                                                                                                    | Why not                                                                                 | Risk / what would validate it                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A production backup**                                                                                 | Needs the owner's GO, key and destination (sprint rule)                                 | §9 checklist                                                                                                                                                   |
| **Restore into a hosted Supabase project**                                                              | Creating a project or branch is a cost decision for the owner                           | §5 with a free or test project. Hosted Storage uses S3; behaviour verified on the local file backend                                                           |
| **Windows** (PowerShell, `icacls`, hidden prompt in Windows Terminal, `tar.exe`, `age.exe`, long paths) | No Windows machine in this session                                                      | One `inventory` + `backup` + `verify` run on the owner's laptop before relying on it. The code avoids POSIX-only calls; `icacls` is best effort with a warning |
| Hosted `sb_secret_` key headers                                                                         | Only local stack; the headers mirror `supabase-js` (`apikey` + `Authorization: Bearer`) | The first production `inventory` (read-only) proves it                                                                                                         |
| Hosted rate limits (429)                                                                                | Mocked only                                                                             | Low at 199 objects; concurrency 4 by default                                                                                                                   |
| Large projects (100k+ objects)                                                                          | Tested up to 55 objects; the listing is kept in memory (~300 bytes per object)          | Fine for years at CELLR's size; revisit at ~1M objects                                                                                                         |
| Multipart (non-MD5) ETags on the real server                                                            | Production has none; mock tested                                                        | Reported as "remote equivalence not verified", never as a failure                                                                                              |
| Logical dump of **production** and its restore with production data                                     | Owner action; contains personal data                                                    | §6.4, §6.6 on the owner's machine                                                                                                                              |
| The CI job on GitHub's runners                                                                          | Cannot run Actions from here                                                            | Its first run on the pull request                                                                                                                              |

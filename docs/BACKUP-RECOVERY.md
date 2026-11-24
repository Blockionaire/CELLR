# Backup and recovery

The one place that says how CELLR's data is backed up, how a backup is proven, and how it is restored. Written
2026-11-16 (sprint "production backup & recovery"). `MIGRATIONS.md`, `BETA-OPERATIONS.md` and the release checklists
point here for backups.

> **Status on 2026-11-16**
>
> |                           |                                                                                                                                                                                                                                  |
> | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | Storage backup tool       | **Implemented and tested** (`scripts/storage-backup`, 75 automated tests, 19-check round trip against real Supabase Storage)                                                                                                     |
> | Production Storage backup | **NOT performed.** Waits for the owner's GO (§9)                                                                                                                                                                                 |
> | Restore verified          | **Yes, on two local Supabase stacks with synthetic files.** Not yet against a hosted test project, never against production                                                                                                      |
> | Database                  | Supabase Pro daily physical backups (dashboard). Logical dump + restore: procedure **proven on local stacks** (§6.6, it found and fixed a privilege-widening flaw in the official procedure); **not yet run** against production |
>
> Test evidence: [`docs/sprints/backup-recovery/TEST-REPORT.md`](sprints/backup-recovery/TEST-REPORT.md).
>
> **Update 2026-11-18** (the table above is as of 2026-11-16):
>
> - **Production Storage backup: still NOT performed.** The owner plans the first run for **Saturday 21 November
>   2026**, by §9. Until it has run and verified, the photos in Storage have no backup.
> - **Database:** production now holds all 46 migrations (0001–0046), with a migration history of 46 versions
>   (`MIGRATIONS.md`). No logical dump of production is documented here; whether one was taken around the releases
>   is the owner's record. The daily physical backups remain the database backup.
> - Since 0046 production has a second pg_cron job, `sommelier-conversations-purge`. `export-platform-objects.sql`
>   exports every named job, so a logical dump taken now includes both (§6.4).

## 1. What has to survive, and what covers it

| Data                                                                                                                 | Lives in                                | Covered by                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Tables (cellars, bottles, wines, tastings, feedback, catalogue, ...), `private` schema (sign-up allowlist, settings) | Postgres                                | Supabase daily physical backup (7 days on Pro); optional logical dump (§6)                                                                     |
| Auth users, identities, hashed passwords                                                                             | Postgres, `auth` schema                 | Same as above                                                                                                                                  |
| Storage **metadata** (`storage.buckets`, `storage.objects` rows)                                                     | Postgres, `storage` schema              | Same as above                                                                                                                                  |
| Storage **files** (photos, avatars, bottle art)                                                                      | Supabase Storage (S3), **not** Postgres | **Only this tool** (§3–§5). Supabase's database backups do not contain them                                                                    |
| Schema, functions, policies                                                                                          | Postgres + `supabase/migrations`        | The repository (migrations) + the database backups                                                                                             |
| App code, configuration                                                                                              | GitHub, Vercel                          | Git; Vercel keeps previous deployments. Vercel environment variables are **not** backed up by anything here: keep them in the password manager |

Supabase's own words: _"Database backups do not include objects you store via the Storage API, as the database only
includes metadata about these objects. Restoring an old backup does not restore objects you deleted after that
backup."_ (supabase.com/docs/guides/platform/backups). A deleted photo is gone unless the Storage tool has a copy.

Production baseline: a read-only metadata count was taken on 2026-11-16 (no paths, no contents): only private buckets,
versioning off, every object with a single-part MD5 ETag, a `version` and a `cacheControl`. The buckets are the ones
the migrations create (`bottle-images`, `bottle-submissions`, `bottle-art`, `user-avatars`, `catalog-labels`,
`tasting-images`, `wine-labels`). Object and byte counts are kept by the owner, not in the repository. Take your own
baseline with `pnpm storage-backup inventory` (§4.2); it is not an expected value: the backup recounts everything,
and §4.3 compares it with the database.

## 2. The Storage tool in one page

`pnpm storage-backup <command>` (code: `scripts/storage-backup`, Node 22, no dependencies beyond the repository's).

| Command                                 | Does                                                                                      | Writes to the project?            |
| --------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------- |
| `inventory`                             | Counts objects and bytes per bucket                                                       | No (read-only client)             |
| `backup --out <folder>`                 | Downloads every object of every bucket into `<folder>/<UTC time>/`, verifies it           | No (read-only client)             |
| `verify <backup>`                       | Re-hashes every file; optionally compares with a database count and with the live project | No                                |
| `restore <backup> --url <test project>` | Plans (default) or performs (`--execute`) a restore into another project                  | Only the target, never production |
| `archive <backup>`                      | `tar` + `age` encrypted copy next to the folder                                           | No                                |

Exit codes: **0** verified · **1** failed, incomplete or inconsistent · **2** wrong arguments · **3** key refused
(expired, revoked, wrong project) · **4** refused for safety.

What makes it safe:

- **It cannot write during a backup.** Every request passes an allowlist before it leaves the process. In read mode
  only `GET /storage/v1/bucket`, `POST /storage/v1/object/list/<bucket>` (a read-only search) and
  `GET /storage/v1/object/authenticated/<bucket>/<key>` exist. Delete, move, copy, upload, signed URLs, the REST API and
  everything else are blocked, also when a bug asks for them. Redirects are refused, so the key cannot be sent elsewhere.
  The restore dry run uses the same read-only client.
- **It never reads file contents from Postgres.** Files come only from the Storage API.
- **It refuses the wrong key or project before the first request.** A publishable or anon key is refused (it would see
  no private bucket and "succeed" with an empty backup). The URL's project ref must equal `--project-ref`. A
  `service_role` JWT for another project is refused. A project without any bucket fails the backup.
- **Keys are never arguments** (they would land in shell history): environment variable, a key file with owner-only
  permissions, or a hidden prompt. Every line the tool prints, and every file it writes, is redacted for keys, JWTs,
  signed-URL tokens and connection-string passwords; a test checks this.
- **It never overwrites.** Each backup gets a new folder (refused if it exists). Restore never replaces an existing
  object without `--overwrite`, and refuses production (its project ref is hard-coded as protected in
  `scripts/storage-backup/src/config.ts`, checked before any key is read) and the source project.
- **It will not put private photos where they leak.** The destination is refused inside a Git working tree unless Git
  ignores it, and refused in a folder that looks cloud-synced (OneDrive, Dropbox, Google Drive, iCloud, ...) unless
  `--allow-synced-folder`. Folders are created `0700`, files `0600`; on Windows the backup folder's ACL is reduced to
  your account (best effort, `icacls`).

### 2.1 What "VERIFIED" means

A backup is VERIFIED only when **all** of these hold; otherwise it is FAILED, with exit code 1 and the reasons in
`VERIFICATION.md`:

1. every object of the first inventory was downloaded; its byte count equals both `Content-Length` and the listed size;
2. the MD5 of the bytes equals the server's ETag (single-part uploads: the ETag is the content's MD5). A mismatch is
   retried, then fails. `--md5 off` disables this comparison and the report then says that remote content equivalence
   was **not** verified; there is no mode that accepts a mismatch;
3. a **second complete inventory**, taken after the downloads, is identical to the first (same keys, ids, sizes, ETags,
   timestamps, buckets and bucket settings). Anything created, deleted or changed while the backup ran fails it;
4. the ETag served with each download equals the listed one (the object did not change between listing and download);
5. every file is re-read from disk and its SHA-256 and size equal what was recorded;
6. no error, no unsafe key, no interruption.

**Limitation, stated in every manifest:** Storage has no snapshot. The tool brackets the downloads with two inventories
and compares every ETag; a change that is made _and undone_ between the two inventories cannot be seen. Run the backup
at a quiet moment (§9) and repeat it if it fails on a change.

"Local integrity" (SHA-256 on disk) and "remote content equivalence" (MD5 against the server's ETag) are reported
separately. In production every object currently has an MD5 ETag, so both are proven for every file.

### 2.2 The backup folder

```
<out>/2026-11-16T21-04-05Z/
  STATUS                    VERIFIED | FAILED | IN_PROGRESS (an interrupted run)
  manifest.json             machine-readable: source, buckets (+ settings), every object (exact bucket and key,
                            local path, size, SHA-256, MD5, content type, cache control, ETag, timestamps), errors,
                            consistency findings, verification, limitations
  SHA256SUMS                sha256sum -c compatible
  verification-report.json  the verdict, consistency findings and errors
  VERIFICATION.md           the same, readable (names failed objects: keep it with the backup)
  SUMMARY.md                counts only, no paths or keys: the one file that may be shared
  RESTORE.md                how to restore this backup
  objects/<bucket>/<encoded key>
```

File names under `objects/` are **encoded, not the keys**: characters outside `A-Z a-z 0-9 . _ -` become `%XX` (UTF-8),
Windows device names (`CON`, `NUL`, ...) and trailing dots are escaped, and keys that would collide on a
case-insensitive disk (`A.jpg` / `a.jpg`) or with a folder (`h1` next to `h1/x.jpg`) get `~<hash>` added. CELLR's own
keys (`<uuid>/<uuid>.jpg`) stay readable. The manifest holds the exact key; restore uses the manifest only. `verify`
recomputes every path from its key, so an edited manifest cannot point outside the folder.

## 3. Credentials

The tool needs a key that can read private buckets: a **secret key** (`sb_secret_...`, recommended) or the legacy
`service_role` key. Both bypass row-level security and can write; the tool's allowlist is what keeps a backup
read-only, so treat the key as a production secret.

Owner, once per backup session (these are account settings, the agent does not change them):

1. Supabase → Project Settings → **API Keys** → _Create new secret key_, name it `cellr-backup-<date>`. A separate key
   can be revoked without touching the app's key.
2. Use it (§4). Do not paste it into chat, a ticket, a file in the repository or a shell command line.
3. **Revoke it** when the backup and its verification are done.

A restore target (a test project) has its own key, read from `CELLR_RESTORE_SERVICE_KEY`, never from the source's
variable, so a restore cannot pick up the production key by accident.

Not used, on purpose: **S3 access keys** (would need S3 access switched on and new long-lived credentials, and give no
narrower access), **signed URLs** (a short-lived secret per object that ends up in logs), and **SQL** (file contents are
not in Postgres).

## 4. Running a Storage backup

### 4.1 Prerequisites

- The repository at the commit that has this tool, `pnpm install` done, Node 22.18+.
- The production project ref, written `<production-ref>` below: Supabase → Project Settings → General → Project ID
  (also the subdomain of `NEXT_PUBLIC_SUPABASE_URL`). It is not written in this public repository's docs.
- A destination **outside the repository and outside any cloud-synced folder**, on an encrypted disk (BitLocker,
  FileVault, LUKS), with at least 3× the project's Storage size free (files + archive).
- Optional, for the encrypted copy: [`age`](https://age-encryption.org) (Windows: `winget install FiloSottile.age`;
  macOS: `brew install age`; Linux: `apt install age`). `tar` ships with Windows 10+.

### 4.2 Windows (PowerShell)

From the repository folder. The key is asked for without echo when the variable is not set:

```powershell
pnpm storage-backup inventory --url https://<production-ref>.supabase.co --project-ref <production-ref>
```

```powershell
pnpm storage-backup backup --url https://<production-ref>.supabase.co --project-ref <production-ref> --out D:\CELLR-backups\storage
```

To avoid typing the key twice in one session, set it for this PowerShell window only (it is not saved), and clear it
afterwards:

```powershell
$env:CELLR_BACKUP_SERVICE_KEY = Read-Host "Secret key" -MaskInput
```

```powershell
Remove-Item Env:CELLR_BACKUP_SERVICE_KEY
```

Keep the `--out` path short (`D:\CELLR-backups\storage`): Windows paths over 260 characters need long-path support.
Check single files without the repository with `Get-FileHash -Algorithm SHA256 <file>` against `SHA256SUMS`.

### 4.3 macOS / Linux (bash)

```bash
pnpm storage-backup backup --url https://<production-ref>.supabase.co --project-ref <production-ref> --out ~/cellr-backups/storage
```

### 4.4 An independent count from the database

The tool's own two inventories go through the same API. As an independent check, count from Postgres — **metadata
only, no file contents** — in the Supabase SQL Editor, right before or after the backup, and download the result as CSV
(`Export → CSV`):

```sql
select b.id as bucket, count(o.id) as objects, coalesce(sum((o.metadata->>'size')::bigint), 0) as bytes
from storage.buckets b left join storage.objects o on o.bucket_id = b.id
group by b.id order by b.id;
```

Then:

```powershell
pnpm storage-backup verify D:\CELLR-backups\storage\2026-11-16T21-04-05Z --db-inventory D:\CELLR-backups\db-inventory.csv
```

Every bucket must match in objects and bytes, or `verify` fails. Add `--remote --url ... --project-ref ...` to also
compare with the live project (read-only); right after the backup it should say _still identical_.

### 4.5 The encrypted copy and where backups live

```powershell
age-keygen -o D:\keys\cellr-backup-identity.txt
```

The file holds the **private** key: move it into the password manager (or onto an offline medium) and delete it from
the disk. Its first line, `# public key: age1...`, is the recipient. Then:

```powershell
pnpm storage-backup archive D:\CELLR-backups\storage\2026-11-16T21-04-05Z --recipient age1...
```

This verifies the backup first and writes `<folder>.tar.age` and `<folder>.tar.age.sha256` next to it. With the identity
at hand, add `--check-identity <identity file>` to decrypt it once and compare its contents with the manifest. Without
a key pair, `--passphrase` makes `age` ask for a passphrase in the terminal (store it in the password manager).

Keep two copies of the encrypted archive on two different media (for example the encrypted laptop disk and an external
disk kept elsewhere). Uploading archives to a cloud service is a separate decision for the owner (not part of this
sprint). The plain folder may be deleted once the archive has been checked with `--check-identity`.

To read it again:

```bash
age -d -i cellr-backup-identity.txt 2026-11-16T21-04-05Z.tar.age | tar -xf - -C <empty folder>
```

On Windows (cmd): `age -d -i cellr-backup-identity.txt 2026-11-16T21-04-05Z.tar.age > backup.tar`, then
`tar -xf backup.tar -C <empty folder>`, then `verify` the extracted folder.

### 4.6 When a backup fails

| Exit                                                     | Read                                                                 | Do                                                                              |
| -------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1 + "changed / created / deleted during the backup"      | Someone used the app while it ran                                    | Run again at a quieter moment; the failed folder stays as it is                 |
| 1 + "could not be backed up", "gave up after N attempts" | Network or Storage trouble                                           | Run again; check status.supabase.com. `--concurrency 2 --retries 8` is gentler  |
| 1 + "do not match the server's MD5 ETag"                 | Corruption in transit, or a non-MD5 ETag                             | Run again; if it persists for the same object, investigate before anything else |
| 3                                                        | Key refused, expired or revoked                                      | Create a new secret key (§3)                                                    |
| 4                                                        | Destination refused (exists, in Git, synced folder) or a safety rule | Read the message; choose another `--out`                                        |
| `STATUS` says `IN_PROGRESS`                              | The run was killed (second Ctrl+C, power loss)                       | Treat the folder as unusable and run again                                      |

A FAILED backup is kept, not deleted: in an emergency its intact files can still be restored
(`restore --allow-unverified-backup`), but it never counts as a backup for the GO/NO-GO list.

## 5. Isolated restore test

Proves that a backup can be brought back. **Never against production**: the tool refuses it, and the procedure must
not try.

Target: a project that holds nothing of value — a local stack (`supabase start`, free) or a hosted test project.
Creating a hosted project or branch costs money and is an owner decision.

```bash
pnpm storage-backup restore <backup folder> --url https://<test-ref>.supabase.co --project-ref <test-ref>
```

The dry run (default) reads the target and lists what would happen: buckets to create, objects to upload, objects that
are already identical, rows without a file, and different content. Nothing is written; the client is read-only. Then:

```bash
pnpm storage-backup restore <backup folder> --url https://<test-ref>.supabase.co --project-ref <test-ref> --execute
```

The restore first re-verifies the whole backup (it refuses a damaged one), creates missing buckets with the same
settings (public flag, size limit, MIME types), uploads each object with its content type and cache control using
`x-upsert: false`, and then **reads every object back** and compares its SHA-256 with the manifest, and checks that the
target's metadata row (size, type, MD5 ETag) describes the restored file. Rows at the target that the backup cannot
explain (a row without a file) are reported. Every run gets its **own** report folder in
`<backup root>/restore-reports/` (outside the backup), created before anything is read from or written to the target;
a second run in the same second gets `-2` added, never an earlier run's folder. A run that cannot create its report
folder stops before writing anything. The `RESULT` line names the folder.

Existing objects at the target:

| Found at the target                                            | Default                           | With `--fill-missing` | With `--overwrite` |
| -------------------------------------------------------------- | --------------------------------- | --------------------- | ------------------ |
| nothing                                                        | uploaded                          | uploaded              | uploaded           |
| same SHA-256                                                   | counted as restored               | same                  | same               |
| a row without a readable file (what a database restore leaves) | reported, exit 1                  | **file written**      | file written       |
| different content                                              | reported, exit 1, **not touched** | not touched           | **replaced**       |

**After a partial or failed restore**, run the same command again: identical objects are skipped, the rest is
retried. Nothing has to be cleaned up first. If an object keeps failing, its error is in the report.

Not restored through the API: `owner`/`owner_id` of an object (the API sets the uploader; CELLR's storage policies are
path-based, `storage.foldername(name)`, and do not use it), and custom user metadata (production has none).

## 6. Database: backups and recovery

### 6.1 Is there a recent backup?

Supabase → Database → **Backups** → _Scheduled backups_: there must be one from the last 24 hours. Programmatically,
with a personal access token (Account → Access Tokens; keep it out of history and revoke it afterwards):

```bash
curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" https://api.supabase.com/v1/projects/<production-ref>/database/backups
```

Write the time of the newest backup in the run log (§9): it is the database half of the recovery point.

### 6.2 Retention and limits (Supabase docs, checked 2026-11-16)

- **Pro: the last 7 days of daily backups.** Point-in-Time Recovery (PITR) is a paid add-on (from about $100/month for
  7 days, needs at least a Small compute add-on) with a recovery point of about two minutes; with PITR enabled, daily
  backups stop. Not enabled for CELLR; a decision for the owner when the beta grows.
- A restore replaces the **whole project database** with the chosen backup: everything written after it is lost, and
  the project is **unavailable** while it restores. There is no restore of one table or one household.
- **Physical backups cannot be downloaded.** Only Supabase holds them; deleting the project deletes them too. An
  off-site copy needs a logical dump (§6.4).
- Passwords of custom roles are not in the backup (CELLR has none with LOGIN; the platform roles are managed by
  Supabase).
- Replication slots and subscriptions must be dropped before and re-created after a restore (CELLR has none besides
  Realtime's, which Supabase handles).
- **Storage files are not in it**, and restoring an old database brings back `storage.objects` rows for files that
  may have been deleted since — rows without files. §7 handles that.

### 6.3 What a database backup includes and excludes

| Included                                                                                                                                                                                                                                                                                                   | Not included                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every schema: `public`, `private`, `auth` (users, identities, hashed passwords, MFA factors), `storage` (buckets and object **rows**), `cron` (the jobs `catalog-scan-reads-purge` and, since 0046, `sommelier-conversations-purge`), `supabase_migrations` (the migration history), `extensions`, `vault` | Storage **files**                                                                                                                                           |
| Roles and grants, RLS policies, functions, triggers (also on `auth.users`), the `ensure_rls` platform event trigger                                                                                                                                                                                        | Custom role passwords                                                                                                                                       |
|                                                                                                                                                                                                                                                                                                            | Project settings: API keys, JWT secret / signing keys, Auth providers and redirect URLs, SMTP, custom domain, network restrictions                          |
|                                                                                                                                                                                                                                                                                                            | Edge Functions, Vercel deployments and environment variables (`OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CELLR_ADMIN_USER_IDS`, `CELLR_FEATURES`, ...) |

### 6.4 Optional: a supplementary logical dump

A logical dump is an off-site, downloadable copy that survives the project itself. It contains **personal data and
hashed passwords**: it is as sensitive as the photos. Same rules: outside the repository, not in a synced folder,
encrypted with `age`, key elsewhere.

Prerequisites: Docker Desktop running (the CLI runs `pg_dump` in a container), the database password (Supabase →
Connect; reset it there if unknown, which does not affect the app: it uses API keys). Use the **session pooler**
connection string. To keep the password out of shell history, put the connection string in an environment variable
for this window only (PowerShell: `$env:CELLR_DB_URL = Read-Host "Connection string" -MaskInput`; bash:
`read -rs CELLR_DB_URL && export CELLR_DB_URL`).

The official three-part dump (supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore). Run the
commands from the repository folder and point every `-f` (and the `>` below) at a new dated folder **outside** the
repository, for example `-f D:\CELLR-backups\db\2026-11-16T21-30Z\roles.sql`. In PowerShell write
`$env:CELLR_DB_URL` where the commands say `"$CELLR_DB_URL"`.

```bash
pnpm exec supabase db dump --db-url "$CELLR_DB_URL" -f roles.sql --role-only
```

```bash
pnpm exec supabase db dump --db-url "$CELLR_DB_URL" -f schema.sql
```

```bash
pnpm exec supabase db dump --db-url "$CELLR_DB_URL" -f data.sql --use-copy --data-only -x "storage.buckets_vectors" -x "storage.vector_indexes"
```

A fourth file is needed for CELLR, because `supabase db dump` leaves out the Supabase-managed schemas and CELLR has
objects inside them (found in the restore rehearsal, §6.6): the row-level security policies on `storage.objects`, the
triggers on `auth.users` (profile creation, sign-up allowlist) and the pg_cron jobs (`catalog-scan-reads-purge`;
since 0046 also `sommelier-conversations-purge`; the export takes every named job). Run
`scripts/db-backup/export-platform-objects.sql` — read-only, catalogue tables only — in the SQL Editor (or with psql in
a read-only session) and save its `statement` column as `platform-objects.sql`:

```bash
psql "$CELLR_DB_URL" -X -q -A -t -v ON_ERROR_STOP=1 -c "set default_transaction_read_only = on" -f scripts/db-backup/export-platform-objects.sql > platform-objects.sql
```

And the **migration history**. Production has one: 0001–0036 since the bootstrap (2026-11-17), 42 versions after the
release of 0037–0042, and **46 versions (0001–0046) since 2026-11-18**. Without it a restored project looks as if no
migration ever ran, and the next `db push` would try all of them again (`MIGRATIONS.md` §1–§2). The official
"Preserving migration history" commands:

```bash
pnpm exec supabase db dump --db-url "$CELLR_DB_URL" -f history_schema.sql --schema supabase_migrations
```

```bash
pnpm exec supabase db dump --db-url "$CELLR_DB_URL" -f history_data.sql --use-copy --data-only --schema supabase_migrations
```

Then, in the dated folder, `sha256sum *.sql > SHA256SUMS` (PowerShell: `Get-FileHash *.sql`), and encrypt the folder
with `tar` + `age` as in §4.5. **All six files together** are the backup:

- `schema.sql` alone is **not a backup**: it has no rows. A schema-only dump (as in `MIGRATIONS.md` §4 step 1) is a
  reference for comparing structure, nothing more.
- `data.sql` alone cannot be restored without the schema and roles.
- Without `platform-objects.sql` a restored project has **no photo access** (no storage policies) and new sign-ups
  get **no profile**, and the purge jobs are gone.
- Without the two history files the restored project's `migration list` is empty while its schema is at 0046: a
  `db push` would then try 0001 again. With them, `migration list` shows exactly what production had.

### 6.5 Parts that need special attention when restoring a database

| Part                                    | Why                                                                                                                              | What to do                                                                                                                           |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Auth                                    | Users and hashed passwords are in `auth` and come back; sessions do not survive a move to a **new** project (different JWT keys) | People sign in again. Re-enter Auth settings (redirect URLs, SMTP, providers) in the new project                                     |
| Roles                                   | `roles.sql` holds custom roles; platform roles exist already                                                                     | Errors on `supabase_admin` ownership or `cli_login_postgres` grants: follow the troubleshooting notes on the Supabase page above     |
| `private` schema                        | Holds the sign-up allowlist and settings; not exposed through the API                                                            | Included in `schema.sql`/`data.sql`; verify with the fingerprint (`scripts/migration-audit`)                                         |
| Shared racks (0052, once applied)       | Five `private` tables; placements point at bottles of several households; history refuses update, delete and truncate            | Same dump and same moment as `bottles`: restore whole, into an empty database (data loads with triggers off); never alone            |
| Storage metadata                        | Rows come back with the database, files do not                                                                                   | Restore the files afterwards (§7, `--fill-missing`)                                                                                  |
| Migration history                       | In `supabase_migrations`, **not** in the three-file dump; production has 46 versions (0001–0046) since 2026-11-18                | `history_schema.sql` + `history_data.sql` (§6.4), run last; then `migration list` must equal the source. Never `db push` to catch up |
| `pg_cron` jobs                          | `catalog-scan-reads-purge` and `sommelier-conversations-purge` (0046); **not** in the CLI dump                                   | Re-created by `platform-objects.sql`; check `select jobname, active from cron.job`: both, active                                     |
| Storage policies, `auth.users` triggers | **Not** in the CLI dump (Supabase-managed schemas)                                                                               | `platform-objects.sql` (§6.4), run last                                                                                              |
| Privileges                              | A new project's default privileges would widen them                                                                              | `pre-restore.sql` first, then the fingerprint comparison (§6.6)                                                                      |
| Triggers during load                    | `data.sql` must load without firing triggers                                                                                     | The official restore sets `session_replication_role = replica` (below)                                                               |

### 6.6 Restoring a logical dump, and testing that it restores

**The order matters, and the official three-file restore is not enough for CELLR.** In the rehearsal of 2026-11-16 the
documented `psql … roles.sql schema.sql data.sql` restore succeeded without a single error, and produced a database
that was **less secure than its source**: about 180 functions and tables got privileges for `anon` and `authenticated`
that CELLR never grants — for example `EXECUTE` on the service-role-only `admin_*` functions (security definer, so RLS
does not protect them) and every table privilege on `households`. Cause: a new Supabase project grants those by default
on every new object in `public`; CELLR's migration 0001 revokes the defaults; pg_dump writes `ALTER DEFAULT PRIVILEGES`
at the **end** of `schema.sql`, after the objects were already created with the platform defaults. The storage policies,
`auth.users` triggers and cron job were also missing (§6.4).

The restore that is proven equivalent, into an **empty** project or local stack only:

```bash
psql --single-transaction --variable ON_ERROR_STOP=1 --file scripts/db-backup/pre-restore.sql --file roles.sql --file schema.sql --command 'SET session_replication_role = replica' --file data.sql --command 'SET session_replication_role = origin' --file platform-objects.sql --file history_schema.sql --file history_data.sql --dbname "$TARGET_DB_URL"
```

`pre-restore.sql` is migration 0001's four default-privilege statements, run first. The history files are run last;
they create `supabase_migrations` only if it does not exist (an empty project has none). Afterwards **always** prove the
result before using it: fingerprint the source and the restore (`scripts/migration-audit/fingerprint.sql`, read-only on
both) and compare them:

```bash
bash scripts/migration-audit/compare.sh --reference source-fingerprint.txt --target-file restored-fingerprint.txt --accept scripts/db-backup/restore-accepted.txt
```

It must print `RESULT: equivalent`. The two accepted deviations are cosmetic and explained in `restore-accepted.txt`
(Postgres re-parses one CHECK with flattened parentheses; the CLI strips three comment lines from one function body).
Also compare row counts per table (counts only), check the cron job exists (`select jobname from cron.job`), and
that `select version from supabase_migrations.schema_migrations order by 1` is the same list as the source.

**Rehearsal, local and free** (Docker; synthetic data; never production):

```bash
bash scripts/db-backup/rehearse-restore.sh
```

It backs up the repository's local stack (Storage tool + the six-file dump), starts a second, empty local stack,
restores into it as above, compares the fingerprints, the row count of every table and the migration history, then
restores the Storage files on top with `--fill-missing` and reads them back. On 2026-11-18: 7/7 checks passed (466
object groups equivalent, 99 tables with equal counts, 45 history versions identical, every file filled and verified).
CI runs it on every pull request (§8).

A rehearsal **with a copy of production data** (to measure duration and catch data-specific issues) needs the
production dump on the owner's machine and an empty target there; same commands, the target a local stack, then
`supabase stop --no-backup` and delete the folder: it holds personal data.

## 7. Recovery procedure

Database and Storage are restored separately, **database first**: the database brings the `storage.objects` rows, the
Storage backup brings the bytes.

1. **Decide what is lost and when.** Pick the database backup (daily, before the incident) and the Storage backup
   (the newest VERIFIED one). Write both timestamps down; anything after them is lost.
2. **Rehearse in isolation first**, if there is any time: the same steps into a test project or local stack (§5, §6.6).
3. **Database.** Restore into a **new** project (Supabase: _Restore to a new project_ / duplicate project) or a local
   stack, not in place, unless the owner decides that downtime and losing everything after the backup point is
   acceptable. From a logical dump: exactly §6.6, including the fingerprint comparison. Then `MIGRATIONS.md` §5 for the
   migration history, and the checks in §6.5.
4. **Storage**, into that same new project:

   ```bash
   pnpm storage-backup restore <backup> --url https://<new-ref>.supabase.co --project-ref <new-ref>
   ```

   Read the plan: after a database restore most objects show as _rows without a file_. Then the same with
   `--execute --fill-missing`. The report must say VERIFIED: every object read back with the right SHA-256, every
   metadata row consistent. Rows reported "without a file and not in this backup" are files the Storage backup never
   had (uploaded after it, or deleted before it): list them for the owner.

5. **Switch the app** to the new project (Vercel environment variables, Auth settings) only after step 4 is VERIFIED.
6. **Afterwards:** a fresh backup of the new production (§9), and a note of what was lost.

**A partial restore** (stopped, network, quota) is resumed by running the same command again. A restore that fails on
an object repeatedly leaves the others intact; fix the cause (bucket size limit, MIME type, quota) and run again.

### 7.5 Restoring files into the existing production project

Not automated, on purpose: the tool refuses the production ref, and a test cannot remove that guard. Recovering into
production (for example a few photos deleted by mistake, with the rest of production healthy) is an owner decision with
its own reviewed change: a separate pull request that adds a production-recovery path with an explicit key list,
dry run, no overwrite, and review. Until then the safe route is §7 into a new project.

## 8. Tests

| What                                                                                                                                                                                                                                                                                                                   | Command                                          | Where it runs                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------- |
| 75 unit and integration tests against an in-process mock of the Storage API                                                                                                                                                                                                                                            | `pnpm --filter @cellr/storage-backup test`       | `pnpm test`, CI on every pull request             |
| Storage round trip against two real local Supabase stacks: backup → verify (+ database count, live drift) → restore → independent read-back → conflict (exit 1, content kept) → conflict with the report name taken → `--overwrite` (content replaced) → row without a file → refusals → encrypted archive (19 checks) | `pnpm --filter @cellr/storage-backup real-stack` | CI job _Backup & recovery_, on every pull request |
| Database logical dump → restore into an empty stack → fingerprint, row-count and migration-history equivalence → Storage files on top (7 checks)                                                                                                                                                                       | `bash scripts/db-backup/rehearse-restore.sh`     | Same CI job                                       |

All with synthetic data only. The mock's behaviour (errors as HTTP 400 with the status in the body, `id: null`
folders, MD5 ETags, `x-upsert`, the 500 for a row without a file) was taken from the real Storage server, not from
assumptions. Details, and what is **not** validated:
[`TEST-REPORT.md`](sprints/backup-recovery/TEST-REPORT.md).

## 9. Production run: checklist and GO / NO-GO

Nothing in this list has been executed against production by the coding agent. Every step is the owner's, on the
owner's machine. **State on 2026-11-18:** not run yet; the owner plans the first run for Saturday 21 November 2026.

**GO only when every line holds:**

| #   | Condition                                                                                                        | How to check                                  |
| --- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| G1  | The owner approved this run and its destination (folder, disk)                                                   | Written down, with date                       |
| G2  | The destination is outside the repository, not cloud-synced, on an encrypted disk, with 3× the Storage size free | Look; the tool refuses Git and synced folders |
| G3  | `pnpm --filter @cellr/storage-backup test` passes on this machine at this commit                                 | Exit 0                                        |
| G4  | A dedicated secret key `cellr-backup-<date>` exists and is not stored anywhere but the password manager          | Supabase → API Keys                           |
| G5  | A recent Supabase database backup exists (< 24 h) and its time is noted                                          | §6.1                                          |
| G6  | A quiet moment: no tester expected to upload in the next 15 minutes                                              | Admin → product activity                      |
| G7  | `inventory` runs, exits 0 and shows 7 buckets and an object count close to the baseline in §1                    | Read-only                                     |
| G8  | The SQL count (§4.4) has been exported as CSV                                                                    | File exists                                   |

**NO-GO** (stop, do not start or do not count the run) when: any G line fails; `inventory` shows 0 buckets or far fewer
objects than the database count; the key was ever pasted into a chat, ticket or file in the repository (revoke and
create a new one); the disk is a OneDrive/Dropbox/Google Drive folder; Supabase reports an incident.

**Run:**

1. `backup` (§4.2). Must end `RESULT: VERIFIED`, exit 0.
2. `verify <folder> --db-inventory <csv> --remote ...`. Must be VERIFIED, every bucket matching the database count,
   and _still identical_.
3. `archive <folder> --recipient age1... --check-identity <identity>`. Must say _decryption checked_. Then move the
   identity file off the disk.
4. Copy the `.tar.age` and its `.sha256` to the second medium; check the hash there.
5. **Revoke the secret key.**
6. Record in the run log: backup id, `SUMMARY.md` counts, database backup time (G5), archive SHA-256, where the copies
   are. `SUMMARY.md` has no personal data and may be pasted into the log.

**Success** = steps 1–5 green. A FAILED run is not a backup: fix the cause and run again.

**Restore verification against a hosted project** (recommended once, before relying on the backups): needs a test
project (free tier or a paid branch: owner decision), then §5 with `--execute`, and the report must say VERIFIED. Until
then restore is verified on local stacks only.

## 10. Not in this sprint (decisions for the owner)

- **Scheduling.** Backups are run by hand. A scheduled job needs a machine that holds the key and a place for the
  output; both are security decisions.
- **Off-site cloud copies** of the encrypted archive.
- **PITR** (§6.2) when losing up to a day of data is no longer acceptable.
- **A least-privilege key.** Supabase has no read-only Storage key; a custom role with only `select` policies on
  `storage.objects` would need RLS changes in production.
- **A logical dump of production** (§6.4) and its restore test with production data (§6.6): documented and rehearsed
  on synthetic data, not run on production.

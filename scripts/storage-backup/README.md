# @cellr/storage-backup

Backs up, verifies and restores every Supabase Storage object of CELLR through the official Storage API. Read-only
against the source; restores only into an isolated project. The procedure, the database part, Windows instructions and
the production GO/NO-GO list are in [`docs/BACKUP-RECOVERY.md`](../../docs/BACKUP-RECOVERY.md).

```bash
pnpm storage-backup --help
```

| File                           | Role                                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------------------- |
| `cli.ts`                       | Commands, argument checks, exit codes, Ctrl+C handling                                       |
| `src/http.ts`                  | The only network code: allowlist per mode, timeouts, bounded retries, Storage's error format |
| `src/config.ts`                | URL/ref/key checks, the protected production ref, key loading (never from arguments)         |
| `src/storage-client.ts`        | Bucket list, recursive listing, streaming download with SHA-256/MD5, upload (restore only)   |
| `src/paths.ts`                 | Object key → portable, collision-free local path; traversal guards                           |
| `src/backup.ts`                | Two inventories around the downloads, re-read from disk, verdict, output files               |
| `src/verify.ts`                | Re-checks an existing backup; database count; live drift                                     |
| `src/restore.ts`               | Plan / execute / read back into an isolated target                                           |
| `src/archive.ts`               | `tar` + `age` encrypted copy                                                                 |
| `test/mock-storage.ts`         | In-process Storage server with fault injection (synthetic data only)                         |
| `test/real-stack-roundtrip.ts` | The same against two real local Supabase stacks                                              |

```bash
pnpm --filter @cellr/storage-backup test
```

```bash
pnpm --filter @cellr/storage-backup real-stack
```

The second needs a running `pnpm exec supabase start` in the repository; it starts and stops a second, empty stack
itself.

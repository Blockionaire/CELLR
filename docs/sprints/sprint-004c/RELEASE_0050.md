# Release: migration 0050 (R-27, wine origins). Dry run done, NOT applied.

**Production:** `vvelgyhbjfmjvxkzekyz`. Procedure: `docs/MIGRATIONS.md` §2. Apply only after the owner's explicit go-ahead.

## 1. Dry run (2026-11-20, read-only)

| Check                                                      | Result                                                                                                                                                                                                            |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production migration history (Supabase, `list_migrations`) | 0001–**0047** recorded. 0047 `system_health` **is applied**, so the earlier "0047 pending" assumption is outdated                                                                                                 |
| Pending against the repository (004C branch)               | exactly **`20261128000050_r27_wine_record_origins`**                                                                                                                                                              |
| `public.merge_wines(uuid, uuid)`, which 0050 replaces      | identical to the repository's definition. MD5 of `pg_get_functiondef` with line endings normalised: `7db49efe…cdb5bc` on both sides. Production stores it with CRLF line endings, so only the line endings differ |
| `private.my_household_ids()`, which 0050 relies on         | identical (`aa143a54…2515`)                                                                                                                                                                                       |
| Objects 0050 creates                                       | none exist yet: no `wine_record_origins`, no `record_wine_origin` / `unlink_wine_origin` / `wine_origin_notices`                                                                                                  |
| Catalogue state in production                              | 0 providers, 0 external records, no `catalog_settings` row (so it counts as production)                                                                                                                           |
| The same chain locally                                     | 0001–0047 + 0050 on Postgres 16 and 17: `db:test` 1661/0 (004C branch)                                                                                                                                            |

So 0050 runs on exactly what it was written for. It adds one table, three functions and one index set, replaces `merge_wines` (the same body plus the origin carry-over), and **changes no existing data**.

### Final dry run (2026-11-20, after #101 was merged as e27e533; read-only)

- Production history: still 0001–0047. `main` now ends at 0050, so a `db push` from `main` applies exactly 0050.
- `merge_wines` and `my_household_ids` are unchanged (the same MD5s as above). No R-27 object exists.
- Production runs e27e533. The app treats the missing R-27 functions as "no origin", and there were no runtime errors after the deploy.
- `verify-0050.sql` run against production **before** the apply: checks 1, 3 and 10 are false (0050 is not there yet), and 2 and 15 are true. On a local Postgres 17 with 0050 applied, all 15 checks are true.
- Data baseline at that moment: 45 wines, 57 bottles, 4 households, 41 producers, 0 providers, 0 external records. The production app is in use, so the baseline is taken again right before applying.

## 2. Apply (owner, after the go-ahead)

On a machine with the repository at the merged `main` (which then ends at 0050), with the production database password at hand.

Link the project:

```bash
pnpm exec supabase link --project-ref vvelgyhbjfmjvxkzekyz
```

Every version must show on both sides except 0050:

```bash
pnpm exec supabase migration list --linked
```

The dry run must list exactly 0050 and nothing else:

```bash
pnpm exec supabase db push --linked --dry-run --skip-vault
```

Apply it:

```bash
pnpm exec supabase db push --linked --skip-vault
```

**Why not via the Supabase MCP `apply_migration`:** it records the migration under a new, generated version. Production's history would then no longer match the repository's `20261128000050`, and repairing that is forbidden outside `MIGRATIONS.md` §4/§5.

**Order:** the app of #101 works with or without 0050. A missing R-27 function is treated as "no origin" (tested). The migration can therefore come before or after the deploy. The procedure prefers migration first.

## 3. Verification after applying (Claude, read-only)

Run [`verify-0050.sql`](verify-0050.sql) (only `SELECT`s): all 15 rows must be `ok = true`. Then compare its data counts with the baseline taken just before. In more detail:

1. `list_migrations` shows 0050, and nothing else changed.
2. **Objects:**
   - the table `wine_record_origins` has RLS on, and its select policy is for household members;
   - no privileges for `anon`; for `authenticated` only `SELECT`;
   - the three functions are `SECURITY DEFINER` with `search_path=''`, executable by `authenticated` and `service_role`, not by `anon`;
   - the partial unique index is per household.
3. `merge_wines` equals the repository's 0050 definition (MD5 as above).
4. **Existing data untouched** (the same counts before and after): wines (provisional / canonical), bottles, households, `catalog_providers` (0), `catalog_external_records` (0), and `wine_record_origins` (0).
5. **Security advisors:** no new findings.
6. **App:** the production health endpoint, and a signed-in smoke test of adding a wine and viewing a wine page (the sources panel shows no origin, because no source is public).

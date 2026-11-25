# Release: migration 0050 (R-27, wine origins)

**State:** applied to production by the owner with the Supabase CLI (route A below), as the owner reported; this repository does not hold production observations (CLAUDE.md, public repository). **Production:** the production project (`<production-ref>` below: Supabase → Project Settings → General → Project ID). Procedure: `docs/MIGRATIONS.md` §2.

## 1. Dry run before the apply (read-only)

What was checked against production before the apply. The results matched what 0050 was written for; the observations themselves are kept by the owner, not in this repository.

| Check                                                    | Expected                                                                                                         |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Production migration history (`supabase migration list`) | Every repository migration up to 0047 recorded; only `20261128000050_r27_wine_record_origins` pending            |
| `public.merge_wines(uuid, uuid)`, which 0050 replaces    | The repository's definition (MD5 of `pg_get_functiondef`, line endings normalised)                               |
| `private.my_household_ids()`, which 0050 relies on       | The repository's definition                                                                                      |
| Objects 0050 creates                                     | None exist yet: no `wine_record_origins`, no `record_wine_origin` / `unlink_wine_origin` / `wine_origin_notices` |
| Catalogue state                                          | No external source shown, no staging marker (so it counts as production)                                         |
| `verify-0050.sql` before the apply                       | Checks 1, 3 and 10 false (0050 not there yet); 2 and 15 true                                                     |
| The same chain locally                                   | 0001–0047 + 0050 on Postgres 16 and 17: `db:test` 1661/0 (004C branch); all 15 `verify-0050.sql` checks true     |

0050 adds one table, three functions and one index set, replaces `merge_wines` (the same body plus the origin carry-over), and **changes no existing data**. The app of #101 treats missing R-27 functions as "no origin" (tested), so code and migration could go in either order.

## 2. Apply (owner, after the go-ahead)

On a machine with the repository at the merged `main` (which then ends at 0050), with the production database password at hand.

Link the project:

```bash
pnpm exec supabase link --project-ref <production-ref>
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

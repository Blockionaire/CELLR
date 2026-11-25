/**
 * Read-only checks before (and after) a production catalogue import (`.github/workflows/production-catalog.yml`).
 *
 *   tsx production-preflight.ts --db <url> --production <ref> --confirm <ref> --provider xwines
 *     --backup-checked <YYYY-MM-DD> [--phase before|after] [--expect-records N --expect-units N --expect-ratings N]
 *
 * before: the run is a production run (production.ts), the database's migration history equals the repository's
 *   (ratings 0051–0053 included), the provider's rights were recorded by the owner (verified, store, display,
 *   commercial, ratings), and the owner states a backup was checked today or yesterday (the hosted backup cannot be
 *   seen from here: it is the owner's statement, printed as such).
 * after: the provider's active records and rating units add up to what the file holds.
 * Prints counts of the provider's catalogue only: never anything about people. Writes nothing. Exit 0 = go.
 */
import { readdirSync } from "node:fs";
import type { Client } from "pg";
import { parseArgs, str } from "./lib";
import { connectToProduction } from "./production";

export function backupProblem(checked: string, today: Date = new Date()): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checked)) return "--backup-checked must be a date (YYYY-MM-DD)";
  const day = Date.parse(`${checked}T00:00:00Z`);
  const now = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const age = (now - day) / 86_400_000;
  if (Number.isNaN(day) || age < 0 || age > 1)
    return "the backup must have been checked today or yesterday (Supabase → Database → Backups)";
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const provider = str(args, "provider");
  const phase = str(args, "phase", "before");
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
  const add = (name: string, ok: boolean, detail = "") => checks.push({ name, ok, detail });
  const backup = backupProblem(str(args, "backup-checked"));
  add(
    "backup checked by the owner (stated, not verifiable here)",
    backup === null,
    backup ?? str(args, "backup-checked"),
  );

  const client: Client = await connectToProduction(str(args, "db"), args);
  try {
    add("database says it is production", true);
    // read-only, enforced by the database for the rest of this session
    await client.query("set session characteristics as transaction read only");
    // the history is read as the connecting owner role; the provider as the service role
    await client.query("reset role");
    const repo = readdirSync(new URL("../../supabase/migrations/", import.meta.url))
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.slice(0, 14))
      .sort();
    const history = (
      await client.query<{ version: string }>(
        "select version from supabase_migrations.schema_migrations order by 1",
      )
    ).rows.map((r) => r.version);
    const missing = repo.filter((v) => !history.includes(v));
    const extra = history.filter((v) => !repo.includes(v));
    add(
      "migration history equals the repository",
      missing.length === 0 && extra.length === 0,
      `missing ${missing.join(",") || "none"}; extra ${extra.join(",") || "none"}`,
    );
    await client.query("set role service_role");
    const p = (
      await client.query<Record<string, unknown>>(
        `select rights_status, may_store, may_display, commercial_use, may_display_ratings, search_scope
           from public.catalog_providers where id = $1`,
        [provider],
      )
    ).rows[0];
    add("provider registered", p !== undefined, provider);
    if (p) {
      add(
        "rights recorded by the owner: verified, store, display, commercial, ratings",
        p.rights_status === "verified" &&
          p.may_store === true &&
          p.may_display === true &&
          p.commercial_use === true &&
          p.may_display_ratings === true,
        JSON.stringify(p),
      );
      add(
        "search scope (off until the owner switches it on after verify)",
        true,
        String(p.search_scope),
      );
    }
    const counts = (
      await client.query<{ active: string; withdrawn: string; units: string; ratings: string }>(
        `select (select count(*) from public.catalog_external_records where provider_id = $1 and status = 'active') as active,
                (select count(*) from public.catalog_external_records where provider_id = $1 and status = 'withdrawn') as withdrawn,
                (select count(*) from public.catalog_rating_aggregates where provider_id = $1) as units,
                (select coalesce(sum(rating_count), 0) from public.catalog_rating_aggregates where provider_id = $1) as ratings`,
        [provider],
      )
    ).rows[0]!;
    add("catalogue counts (this provider only)", true, JSON.stringify(counts));
    if (phase === "after") {
      const want = (k: string) => Number(str(args, k));
      add(
        "records as in the file",
        Number(counts.active) === want("expect-records"),
        counts.active,
      );
      add(
        "rating units as in the file",
        Number(counts.units) === want("expect-units"),
        counts.units,
      );
      add(
        "ratings as in the file",
        Number(counts.ratings) === want("expect-ratings"),
        counts.ratings,
      );
    }
  } finally {
    await client.end().catch(() => undefined);
  }
  for (const c of checks)
    console.log(`${c.ok ? "PASS" : "FAIL"} ${c.name}${c.detail ? `: ${c.detail}` : ""}`);
  if (checks.some((c) => !c.ok)) process.exit(1);
}

if (process.argv[1]?.endsWith("production-preflight.ts"))
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });

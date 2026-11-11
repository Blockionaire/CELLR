/**
 * Imports one provider file into the STAGING catalogue (catalog_external_records) of a local or staging database.
 *
 *   pnpm --filter @cellr/catalog-tools import --db <url> --provider xwines --file XWines_Full_100K_wines.csv \
 *     --sha256 <expected> --dataset-version "X-Wines 1.0 (2023-01)" --source-url https://… --retrieved-at 2026-11-11
 *     [--apply] [--pilot] [--search-scope pilot] [--withdraw-missing] [--limit N] [--out report.json]
 *
 * Dry run unless --apply. Idempotent: the same file again reports everything `unchanged`. Never writes CELLR wines.
 * Licensing is enforced by the database: a provider whose rights are not verified can only be imported with --pilot,
 * a blocked provider not at all, and this tool never sets a provider's search scope to "public" (an owner decision,
 * made with the rights evidence, never by an import).
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
  ADAPTERS,
  csvObjects,
  PROVIDERS,
  type ProviderId,
  type ProviderRecord,
} from "@cellr/domain";
import { actAsService, assertSafeTarget, connect, parseArgs, sha256, str } from "./lib";

const BATCH = 500;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = str(args, "db");
  assertSafeTarget(db, args);
  const providerId = str(args, "provider") as ProviderId;
  const provider = PROVIDERS[providerId];
  if (!provider) throw new Error(`unknown provider ${providerId}`);
  const file = str(args, "file");
  const bytes = readFileSync(file);
  const hash = sha256(bytes);
  if (typeof args.sha256 === "string" && args.sha256 !== hash)
    throw new Error(`checksum mismatch: expected ${args.sha256}, file is ${hash}`);
  const apply = args.apply === true;
  const limit = typeof args.limit === "string" ? Number(args.limit) : Infinity;

  const adapter = ADAPTERS[providerId];
  const rows = csvObjects(bytes.toString("utf8"), adapter.columns);
  const records: ProviderRecord[] = [];
  const skipped: Record<string, number> = {};
  for (const row of rows.slice(0, limit)) {
    const r = adapter.map(row);
    if (r.ok) records.push(r.record);
    else skipped[r.reason] = (skipped[r.reason] ?? 0) + 1;
  }

  const scope = str(args, "search-scope", "off");
  if (scope !== "off" && scope !== "pilot")
    throw new Error("--search-scope may only be off or pilot");
  const retrievedAt = str(args, "retrieved-at");
  if (Number.isNaN(Date.parse(retrievedAt))) throw new Error("--retrieved-at must be a date");

  const client = await connect(db);
  await actAsService(client);
  const started = performance.now();
  try {
    await client.query("select public.catalog_provider_upsert($1::jsonb)", [
      JSON.stringify({ ...provider, search_scope: scope }),
    ]);
    let run: string | null = null;
    if (apply) {
      const r = await client.query<{ id: string }>(
        "select public.catalog_import_run_start($1, $2, $3, $4, $5, $6, $7) as id",
        [
          providerId,
          str(args, "dataset-version", "unversioned"),
          args["source-url"] ?? null,
          hash,
          `${records.length} records from ${file.split("/").pop()}`,
          retrievedAt,
          args.pilot === true,
        ],
      );
      run = r.rows[0]!.id;
    }
    const totals = {
      inserted: 0,
      updated: 0,
      unchanged: 0,
      invalid: 0,
      possible_duplicates: 0,
      suggested_links: 0,
    };
    const problems: unknown[] = [];
    for (let i = 0; i < records.length; i += BATCH) {
      const r = await client.query<{ j: Record<string, number> & { problems: unknown[] } }>(
        "select public.catalog_external_import($1, $2, $3::jsonb, $4) as j",
        [providerId, run, JSON.stringify(records.slice(i, i + BATCH)), apply],
      );
      const j = r.rows[0]!.j;
      for (const k of Object.keys(totals) as Array<keyof typeof totals>) totals[k] += j[k] ?? 0;
      if (problems.length < 20) problems.push(...j.problems.slice(0, 20 - problems.length));
    }
    let finish: unknown = null;
    if (apply && run)
      finish = (
        await client.query("select public.catalog_import_run_finish($1, $2, $3::jsonb) as j", [
          run,
          args["withdraw-missing"] === true,
          JSON.stringify({ ...totals, adapter_skipped: skipped }),
        ])
      ).rows[0];
    const report = {
      provider: providerId,
      file: file.split("/").pop(),
      sha256: hash,
      applied: apply,
      pilot: args.pilot === true,
      retrieved_at: retrievedAt,
      license: provider.license,
      rights_status: provider.rights_status,
      run,
      rows: Math.min(rows.length, limit),
      adapter_records: records.length,
      adapter_skipped: skipped,
      ...totals,
      problems,
      finish,
      seconds: Math.round((performance.now() - started) / 100) / 10,
    };
    console.log(JSON.stringify(report, null, 2));
    if (typeof args.out === "string")
      writeFileSync(args.out, JSON.stringify(report, null, 2) + "\n");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

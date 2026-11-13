/**
 * Imports one provider file into the STAGING catalogue (catalog_external_records) of a local or staging database.
 *
 *   pnpm --filter @cellr/catalog-tools import --db <url> --provider xwines --file XWines_Full_100K_wines.csv \
 *     --sha256 <expected> --dataset-version "X-Wines 1.0 (2023-01)" --source-url https://… --retrieved-at 2026-11-11
 *     [--apply] [--pilot] [--withdraw-missing] [--limit N] [--out report.json] [--staging-project <ref>]
 *
 * Dry run unless --apply. Idempotent: the same file again reports everything `unchanged`. Never writes CELLR wines.
 * Licensing is enforced by the database: a provider whose rights are not verified can only be imported with --pilot,
 * a blocked provider not at all. This tool never registers a provider or changes its licence, rights or scope: that is
 * an admin action in provider.ts (logged). The provider must already be registered.
 * Targets: a local pilot database, or an approved staging project (target.ts); production is always refused.
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
  ADAPTERS,
  decodeUtf8,
  importBlocker,
  inspectProviderFile,
  type ProviderId,
  type ProviderRecord,
} from "@cellr/domain";
import { parseArgs, sha256, str } from "./lib";
import { connectToTarget } from "./target";

const BATCH = 500;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = str(args, "db");
  const providerId = str(args, "provider") as ProviderId;
  if (!Object.hasOwn(ADAPTERS, providerId))
    throw new Error(`no adapter for provider ${providerId}`);
  const file = str(args, "file");
  const bytes = readFileSync(file);
  const hash = sha256(bytes);
  if (typeof args.sha256 === "string" && args.sha256 !== hash)
    throw new Error(`checksum mismatch: expected ${args.sha256}, file is ${hash}`);
  const apply = args.apply === true;
  const limit = typeof args.limit === "string" ? Number(args.limit) : Infinity;

  // The whole file is looked at before anything is written: layout, separator, encoding, unique ids. A file with a
  // fatal problem, or an adapter whose layout was never verified against the provider's real file, imports nothing.
  const text = decodeUtf8(bytes);
  if (text === null) throw new Error("the file is not valid UTF-8 text: nothing imported");
  const inspection = inspectProviderFile(text, providerId);
  const blocker = importBlocker(providerId, inspection, hash);
  if (blocker) throw new Error(`${blocker}: nothing imported`);
  const records: ProviderRecord[] = inspection.records.slice(0, limit);
  // "Withdraw what this file no longer has" is only true of the whole file.
  const withdraw = args["withdraw-missing"] === true;
  if (withdraw && limit !== Infinity)
    throw new Error(
      "--withdraw-missing cannot be combined with --limit: a part of a file says nothing about the rest",
    );
  const skipped = inspection.skipped;
  const rows = { length: inspection.rows };

  if (args["search-scope"] !== undefined)
    throw new Error(
      "--search-scope is not an import option: a provider's scope is managed with provider.ts",
    );
  const retrievedAt = str(args, "retrieved-at");
  if (Number.isNaN(Date.parse(retrievedAt))) throw new Error("--retrieved-at must be a date");

  const client = await connectToTarget(db, args);
  const started = performance.now();
  try {
    // read-only: the reviewed licence and rights as the database holds them (never the static configuration)
    const registered = await client.query<{ license: string; rights_status: string }>(
      "select license, rights_status from public.catalog_providers where id = $1",
      [providerId],
    );
    if (registered.rows.length === 0)
      throw new Error(
        `provider ${providerId} is not registered: an admin registers it and sets its rights (provider.ts)`,
      );
    // A full file that suddenly holds far fewer records than the provider has now is more likely a damaged export
    // than a provider that withdrew most of its catalogue: refused unless someone says so explicitly.
    if (apply && withdraw && args["allow-shrink"] !== true) {
      const active = Number(
        (
          await client.query<{ n: string }>(
            "select count(*) as n from public.catalog_external_records where provider_id = $1 and status = 'active'",
            [providerId],
          )
        ).rows[0]!.n,
      );
      if (active > 0 && records.length < active * 0.8)
        throw new Error(
          `the file holds ${records.length} records but ${active} are active: refusing to withdraw ${active - records.length} records (pass --allow-shrink if the provider really removed them)`,
        );
    }
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
    try {
      for (let i = 0; i < records.length; i += BATCH) {
        const r = await client.query<{ j: Record<string, number> & { problems: unknown[] } }>(
          "select public.catalog_external_import($1, $2, $3::jsonb, $4) as j",
          [providerId, run, JSON.stringify(records.slice(i, i + BATCH)), apply],
        );
        const j = r.rows[0]!.j;
        for (const k of Object.keys(totals) as Array<keyof typeof totals>) totals[k] += j[k] ?? 0;
        if (problems.length < 20) problems.push(...j.problems.slice(0, 20 - problems.length));
      }
    } catch (error) {
      // A run that failed half-way is closed as such, with the reason: never left looking like one still running,
      // and never finished as if it were complete.
      if (run)
        await client
          .query("select public.catalog_import_run_abandon($1, $2)", [
            run,
            `import failed: ${error instanceof Error ? error.message : "error"}`.slice(0, 300),
          ])
          .catch(() => {});
      throw error;
    }
    // Records the database refused are missing from this run: withdrawing "what the run did not see" would then
    // withdraw records the file does hold. The run is finished without withdrawing, and says so.
    const withdrawNow = withdraw && totals.invalid === 0;
    let finish: unknown = null;
    if (apply && run)
      finish = (
        await client.query("select public.catalog_import_run_finish($1, $2, $3::jsonb) as j", [
          run,
          withdrawNow,
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
      license: registered.rows[0]!.license,
      rights_status: registered.rows[0]!.rights_status,
      run,
      rows: Math.min(rows.length, limit),
      schema: inspection.schema,
      layout_verified: inspection.layoutVerified,
      adapter_records: records.length,
      adapter_skipped: skipped,
      unmapped_types: inspection.unmappedTypes,
      implausible_vintage_rows: inspection.implausibleVintageRows,
      warnings: [
        ...inspection.warnings,
        ...(withdraw && !withdrawNow
          ? [`${totals.invalid} record(s) were refused by the database: nothing was withdrawn`]
          : []),
      ],
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

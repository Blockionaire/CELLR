/**
 * Coverage and matching benchmark (Sprint 004A).
 *
 *   pnpm --filter @cellr/catalog-tools benchmark --file XWines_Full_100K_wines.csv --set ../../eval/catalog/benchmark.json
 *     [--db <url> --user <uuid> --household <uuid>] [--out <dir>]
 *
 * 1. Coverage, from the provider's own file (nothing else): for each benchmark wine, the provider records of that
 *    producer and how well their names fit. exact = exactly one record with this producer and wine name (and no
 *    contradicting type); ambiguous = more than one such record; partial = the producer with a close but not equal
 *    name, or the name with another type; producer-only; missing. The thresholds are the scan matcher's own
 *    similarity (packages/domain/src/scan.ts) and are heuristics: every match is written out for review.
 * 2. Search quality (with --db): the benchmark query through public.catalog_search, as a signed-in household member;
 *    where the covered record ranks, and that no provider result is ever marked verified.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import {
  ADAPTERS,
  csvObjects,
  nameSimilarity,
  normalizeText,
  type ProviderRecord,
} from "@cellr/domain";
import { actAs, connect, parseArgs, str } from "./lib";

interface Entry {
  id: string;
  segment: string;
  query: string;
  expect: { producer: string; wine: string; type: string; country: string };
  vintage: string;
  variant: string;
}
type Coverage = "exact" | "ambiguous" | "partial" | "producer-only" | "missing";

const STRONG = 0.9;
const CLOSE = 0.6;
const PRODUCER = 0.85;

const words = (s: string) =>
  normalizeText(s)
    .split(" ")
    .filter((w) => w.length >= 3);
const key4 = (w: string) => w.slice(0, 4);

export function classify(entry: Entry, byKey: Map<string, ProviderRecord[]>) {
  const keys = new Set(words(entry.expect.producer).map(key4));
  const seen = new Set<ProviderRecord>();
  for (const k of keys) for (const r of byKey.get(k) ?? []) seen.add(r);
  const scored = [...seen]
    .map((r) => ({
      r,
      producer: nameSimilarity(entry.expect.producer, r.producer),
      // a grand vin is often listed under the estate's name, or as "Grand Vin"
      name: Math.max(
        nameSimilarity(entry.expect.wine, r.name),
        entry.expect.wine === entry.expect.producer &&
          /^(grand vin|premier grand cru classe)$/i.test(r.name)
          ? 1
          : 0,
      ),
    }))
    .filter((s) => s.producer >= PRODUCER);
  const typeOk = (r: ProviderRecord) => r.wine_type === null || r.wine_type === entry.expect.type;
  const exact = scored.filter((s) => s.name >= STRONG && typeOk(s.r));
  const partial = scored.filter(
    (s) => (s.name >= CLOSE && s.name < STRONG) || (s.name >= STRONG && !typeOk(s.r)),
  );
  const coverage: Coverage =
    exact.length === 1
      ? "exact"
      : exact.length > 1
        ? "ambiguous"
        : partial.length > 0
          ? "partial"
          : scored.length > 0
            ? "producer-only"
            : "missing";
  const show = (list: typeof scored) =>
    list
      .sort((a, b) => b.name - a.name || b.producer - a.producer)
      .slice(0, 5)
      .map((s) => ({
        external_id: s.r.external_id,
        producer: s.r.producer,
        name: s.r.name,
        type: s.r.wine_type,
        country: s.r.country_code,
        vintages: s.r.vintages.length,
        non_vintage: s.r.non_vintage,
        producer_sim: Math.round(s.producer * 100) / 100,
        name_sim: Math.round(s.name * 100) / 100,
      }));
  return {
    coverage,
    exact: show(exact),
    partial: show(partial),
    producer_records: scored.length,
    target_ids: (exact.length > 0 ? exact : partial).map((s) => s.r.external_id),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const set = JSON.parse(readFileSync(str(args, "set"), "utf8")) as { entries: Entry[] };
  const text = readFileSync(str(args, "file"), "utf8");
  const adapter =
    ADAPTERS[(typeof args.provider === "string" ? args.provider : "xwines") as "xwines"];
  const records = csvObjects(text, adapter.columns).flatMap((row) => {
    const r = adapter.map(row);
    return r.ok ? [r.record] : [];
  });
  const byKey = new Map<string, ProviderRecord[]>();
  for (const r of records)
    for (const k of new Set(words(r.producer).map(key4))) {
      const list = byKey.get(k) ?? [];
      list.push(r);
      byKey.set(k, list);
    }

  const results = set.entries.map((e) => ({ ...e, ...classify(e, byKey) }));

  // ---- search quality, through the real function ------------------------------------------------------------------
  const search: Record<
    string,
    { rank: number | null; top: string[]; verifiedProvider: boolean; ms: number }
  > = {};
  if (typeof args.db === "string") {
    const client = await connect(args.db);
    // people cannot read provider ids: map them once with the service role, then search as the person
    await client.query("set role service_role");
    const map = new Map(
      (
        await client.query<{ id: string; external_id: string }>(
          "select id, external_id from public.catalog_external_records",
        )
      ).rows.map((r) => [r.id, r.external_id]),
    );
    await client.query("reset role");
    await actAs(client, str(args, "user"));
    for (const e of results) {
      const t0 = performance.now();
      const rows = (
        await client.query<{
          record_id: string | null;
          producer: string;
          name: string;
          source: string;
          match: string;
          verified: boolean;
        }>("select * from public.catalog_search($1, $2, null, null, null, 8)", [
          str(args, "household"),
          e.query,
        ])
      ).rows;
      const ms = performance.now() - t0;
      const ext = rows.map((r) => (r.record_id ? (map.get(r.record_id) ?? null) : null));
      const idx = ext.findIndex((x) => x !== null && e.target_ids.includes(x));
      search[e.id] = {
        rank: idx === -1 ? null : idx + 1,
        top: rows
          .slice(0, 3)
          .map(
            (r) =>
              `${r.producer} — ${r.name} [${r.source}/${r.match}${r.verified ? "/verified" : ""}]`,
          ),
        verifiedProvider: rows.some((r) => r.source === "provider" && r.verified),
        ms: Math.round(ms * 10) / 10,
      };
    }
    await client.end();
  }

  // ---- summary ------------------------------------------------------------------------------------------------------
  const classes: Coverage[] = ["exact", "ambiguous", "partial", "producer-only", "missing"];
  const segments = [...new Set(results.map((r) => r.segment))];
  const count = (list: typeof results, c: Coverage) => list.filter((r) => r.coverage === c).length;
  const lines = [
    `| Segment | Wines | ${classes.join(" | ")} |`,
    `| --- | --: | ${classes.map(() => "--:").join(" | ")} |`,
    ...segments.map((s) => {
      const l = results.filter((r) => r.segment === s);
      return `| ${s} | ${l.length} | ${classes.map((c) => count(l, c)).join(" | ")} |`;
    }),
    `| **all** | **${results.length}** | ${classes.map((c) => `**${count(results, c)}**`).join(" | ")} |`,
  ];
  const covered = results.filter((r) => r.target_ids.length > 0);
  const ranked = covered.map((r) => search[r.id]?.rank ?? null);
  const searchSummary =
    Object.keys(search).length === 0
      ? null
      : {
          queries: results.length,
          with_covered_record: covered.length,
          top1: ranked.filter((r) => r === 1).length,
          top3: ranked.filter((r) => r !== null && r <= 3).length,
          top8: ranked.filter((r) => r !== null).length,
          not_found: ranked.filter((r) => r === null).length,
          provider_marked_verified: Object.values(search).filter((s) => s.verifiedProvider).length,
          empty_results: Object.values(search).filter((s) => s.top.length === 0).length,
        };
  const summary = {
    provider_records: records.length,
    coverage: Object.fromEntries(classes.map((c) => [c, count(results, c)])),
    search: searchSummary,
  };
  console.log(lines.join("\n"));
  console.log(JSON.stringify(summary, null, 2));
  if (typeof args.out === "string") {
    mkdirSync(args.out, { recursive: true });
    writeFileSync(`${args.out}/coverage-table.md`, lines.join("\n") + "\n");
    writeFileSync(
      `${args.out}/benchmark-results.json`,
      JSON.stringify(
        { summary, entries: results.map((r) => ({ ...r, search: search[r.id] ?? null })) },
        null,
        1,
      ) + "\n",
    );
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

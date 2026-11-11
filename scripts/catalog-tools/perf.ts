/**
 * Search load test (Sprint 004A): what a debounced autocomplete would send, against a local database.
 *
 *   pnpm --filter @cellr/catalog-tools perf --db <url> --user <uuid> --household <uuid>
 *     --set ../../eval/catalog/benchmark.json [--mode pilot|public] [--concurrency 8] [--rounds 3] [--out perf.json]
 *
 * Each benchmark query is "typed": its first 3, 5 and 8 characters and the whole query, as separate searches
 * (what a 250 ms debounce sends for a person typing at a normal pace), plus each query with a filter. Every search
 * runs through the same search implementation:
 *   --mode pilot  (default) public.catalog_search_pilot as the service role, so pilot-scope provider records (the 100k
 *                 evaluation set) are searched; pilot or staging databases only;
 *   --mode public public.catalog_search as the signed-in person (row-level security and the membership check apply);
 *                 only 'public' providers are searched, so in a pilot database this measures CELLR's own wines only.
 * One warm-up pass is not counted. Latency is measured at the client: database time plus the local round trip, not
 * the network or the API layer.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { actAs, parseArgs, percentile, shuffled, str } from "./lib";
import { connectToTarget } from "./target";

interface Entry {
  query: string;
  expect: { type: string; country: string };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = str(args, "db");
  const user = str(args, "user");
  const household = str(args, "household");
  const concurrency = Number(str(args, "concurrency", "8"));
  const rounds = Number(str(args, "rounds", "3"));
  const entries = (JSON.parse(readFileSync(str(args, "set"), "utf8")) as { entries: Entry[] })
    .entries;

  type Q = { q: string; type: string | null; country: string | null; bucket: string };
  const base: Q[] = [];
  for (const e of entries) {
    for (const n of [3, 5, 8])
      if (e.query.length > n)
        base.push({ q: e.query.slice(0, n), type: null, country: null, bucket: `prefix-${n}` });
    base.push({ q: e.query, type: null, country: null, bucket: "full" });
    base.push({
      q: e.query,
      type: e.expect.type,
      country: e.expect.country,
      bucket: "full+filters",
    });
  }
  // the household's own synthetic wines, and very common words (the widest candidate sets)
  for (const q of [
    "synthetic cuv",
    "chateau",
    "domaine",
    "reserva",
    "cabernet sauvignon",
    "pinot noir",
    "riesling",
    "brut",
  ])
    base.push({ q, type: null, country: null, bucket: "common-words" });

  const mode = str(args, "mode", "pilot");
  if (mode !== "pilot" && mode !== "public") throw new Error("--mode pilot|public");
  const fn = mode === "pilot" ? "public.catalog_search_pilot" : "public.catalog_search";
  // every connection is checked against the allowed targets and the database's own identity
  const clients = await Promise.all(
    Array.from({ length: concurrency }, () => connectToTarget(db, args)),
  );
  if (mode === "public")
    await Promise.all(
      clients.map(async (c) => {
        await c.query("reset role");
        await actAs(c, user);
      }),
    );
  const run = async (list: Q[]) => {
    const times: Array<{ ms: number; bucket: string; rows: number }> = [];
    let next = 0;
    await Promise.all(
      clients.map(async (c) => {
        while (next < list.length) {
          const item = list[next++]!;
          const t0 = performance.now();
          const r = await c.query(`select * from ${fn}($1, $2, $3, $4, null, 8)`, [
            household,
            item.q,
            item.type,
            item.country,
          ]);
          times.push({ ms: performance.now() - t0, bucket: item.bucket, rows: r.rows.length });
        }
      }),
    );
    return times;
  };
  await run(base); // warm-up
  const all: Array<{ ms: number; bucket: string; rows: number }> = [];
  const started = performance.now();
  for (let r = 0; r < rounds; r++) all.push(...(await run(shuffled(base, 4004 + r))));
  const seconds = (performance.now() - started) / 1000;
  await Promise.all(clients.map((c) => c.end()));

  const stats = (list: typeof all) => {
    const ms = list.map((t) => t.ms).sort((a, b) => a - b);
    const round = (n: number) => Math.round(n * 10) / 10;
    return {
      n: ms.length,
      p50: round(percentile(ms, 50)),
      p95: round(percentile(ms, 95)),
      p99: round(percentile(ms, 99)),
      max: round(ms[ms.length - 1] ?? NaN),
      mean: round(ms.reduce((s, x) => s + x, 0) / ms.length),
      empty: list.filter((t) => t.rows === 0).length,
    };
  };
  const buckets = [...new Set(all.map((t) => t.bucket))];
  const report = {
    mode,
    concurrency,
    rounds,
    searches: all.length,
    throughput_per_s: Math.round(all.length / seconds),
    overall: stats(all),
    by_bucket: Object.fromEntries(
      buckets.map((b) => [b, stats(all.filter((t) => t.bucket === b))]),
    ),
  };
  console.log(JSON.stringify(report, null, 2));
  if (typeof args.out === "string") writeFileSync(args.out, JSON.stringify(report, null, 2) + "\n");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

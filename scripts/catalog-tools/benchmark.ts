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
 * 2. Search quality (with --db): the benchmark query through public.catalog_search_pilot (the same search, including
 *    pilot-scope providers; service role, pilot or staging databases only — people's search never shows pilot data),
 *    for the test household: where the covered record ranks, and that no provider result is ever marked verified.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import {
  ADAPTERS,
  csvObjects,
  nameSimilarity,
  normalizeText,
  searchableQuery,
  type ProviderRecord,
} from "@cellr/domain";
import { parseArgs, str } from "./lib";
import { connectToTarget } from "./target";

type Kind = "positive" | "perturbation" | "filter" | "generic" | "adversarial";
interface Expect {
  producer: string;
  wine: string;
  type: string;
  country: string;
}
interface Entry {
  id: string;
  /** Absent = "positive" (every Sprint 004A entry). */
  kind?: Kind;
  segment: string;
  query: string;
  /** The identity meant (positive, perturbation). */
  expect?: Expect;
  vintage?: string;
  variant: string;
  /** perturbation: the entry whose record this misspelt query must still find. */
  base?: string;
  /** positive (near twin): the sibling wine's name that must not be offered before the wine asked for. */
  decoy?: string;
  /** filter: what every returned row must satisfy. */
  filter?: { type?: string; country?: string };
}
const kindOf = (e: Entry): Kind => e.kind ?? "positive";
type Coverage = "exact" | "ambiguous" | "partial" | "producer-only" | "missing";

const STRONG = 0.9;
const CLOSE = 0.6;
const PRODUCER = 0.85;

const words = (s: string) =>
  normalizeText(s)
    .split(" ")
    .filter((w) => w.length >= 3);
const key4 = (w: string) => w.slice(0, 4);

export function classify(entry: { expect: Expect }, byKey: Map<string, ProviderRecord[]>) {
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

  // Coverage is decided from the provider's file by `classify` (letter-pair similarity on names, in TypeScript); the
  // search under test ranks with pg_trgm in SQL. The two share no code, so the search is never its own oracle.
  const NONE = {
    coverage: "missing" as Coverage,
    exact: [],
    partial: [],
    producer_records: 0,
    target_ids: [] as string[],
  };
  const positives = new Map(
    set.entries
      .filter((e) => kindOf(e) === "positive")
      .map((e) => [e.id, classify({ expect: e.expect! }, byKey)]),
  );
  const results = set.entries.map((e) => {
    const k = kindOf(e);
    // a misspelt query must find the record of the entry it was derived from, whatever its own spelling
    const c =
      k === "positive"
        ? positives.get(e.id)!
        : k === "perturbation"
          ? (positives.get(e.base!) ?? NONE)
          : NONE;
    return { ...e, ...c };
  });

  // ---- search quality, through the real function ------------------------------------------------------------------
  const search: Record<
    string,
    {
      rank: number | null;
      top: string[];
      verifiedProvider: boolean;
      ms: number;
      rows: number;
      /** the query as the API would search it; null = too short to be a search (never reaches the database) */
      searched: string | null;
      error: string | null;
      /** filter: rows that contradict the filter */
      filterViolations: number;
      /** near twin: the sibling was offered before the wine asked for */
      decoyFirst: boolean | null;
      /** two or more rows that are exactly the same producer, name and type */
      duplicates: number;
    }
  > = {};
  if (typeof args.db === "string") {
    const client = await connectToTarget(args.db, args);
    const map = new Map(
      (
        await client.query<{ id: string; external_id: string }>(
          "select id, external_id from public.catalog_external_records",
        )
      ).rows.map((r) => [r.id, r.external_id]),
    );
    for (const e of results) {
      const k = kindOf(e);
      // exactly what the API does before it asks the database (packages/domain/src/catalog-search.ts)
      const searched = searchableQuery(e.query);
      const t0 = performance.now();
      type Row = {
        record_id: string | null;
        producer: string;
        name: string;
        source: string;
        match: string;
        verified: boolean;
        wine_type: string | null;
        country_code: string | null;
      };
      let rows: Row[] = [];
      let error: string | null = null;
      if (searched !== null)
        try {
          rows = (
            await client.query<Row>(
              "select * from public.catalog_search_pilot($1, $2, $3, $4, null, 8)",
              [str(args, "household"), searched, e.filter?.type ?? null, e.filter?.country ?? null],
            )
          ).rows;
        } catch (err) {
          error = err instanceof Error ? err.message.slice(0, 200) : "error";
        }
      const ms = performance.now() - t0;
      const ext = rows.map((r) => (r.record_id ? (map.get(r.record_id) ?? null) : null));
      const idx = ext.findIndex((x) => x !== null && e.target_ids.includes(x));
      const decoyAt = e.decoy
        ? rows.findIndex((r) => normalizeText(r.name) === normalizeText(e.decoy!))
        : -1;
      const keys = rows.map(
        (r) => `${normalizeText(r.producer)}|${normalizeText(r.name)}|${r.wine_type ?? ""}`,
      );
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
        rows: rows.length,
        searched,
        error,
        filterViolations:
          k === "filter"
            ? rows.filter(
                (r) =>
                  (e.filter?.type !== undefined && r.wine_type !== e.filter.type) ||
                  (e.filter?.country !== undefined && r.country_code !== e.filter.country),
              ).length
            : 0,
        decoyFirst: e.decoy ? decoyAt !== -1 && (idx === -1 || decoyAt < idx) : null,
        duplicates: keys.length - new Set(keys).size,
      };
    }
    await client.end();
  }

  // ---- summary ------------------------------------------------------------------------------------------------------
  const classes: Coverage[] = ["exact", "ambiguous", "partial", "producer-only", "missing"];
  const positive = results.filter((r) => kindOf(r) === "positive");
  const segments = [...new Set(positive.map((r) => r.segment))];
  const count = (list: typeof results, c: Coverage) => list.filter((r) => r.coverage === c).length;
  const lines = [
    `| Segment | Wines | ${classes.join(" | ")} |`,
    `| --- | --: | ${classes.map(() => "--:").join(" | ")} |`,
    ...segments.map((s) => {
      const l = positive.filter((r) => r.segment === s);
      return `| ${s} | ${l.length} | ${classes.map((c) => count(l, c)).join(" | ")} |`;
    }),
    `| **all** | **${positive.length}** | ${classes.map((c) => `**${count(positive, c)}**`).join(" | ")} |`,
  ];
  const searched = Object.keys(search).length > 0;
  /** Rank statistics of the entries that have a covered record. */
  const ranks = (list: typeof results) => {
    const covered = list.filter((r) => r.target_ids.length > 0);
    const ranked = covered.map((r) => search[r.id]?.rank ?? null);
    return {
      queries: list.length,
      with_covered_record: covered.length,
      top1: ranked.filter((r) => r === 1).length,
      top3: ranked.filter((r) => r !== null && r <= 3).length,
      top8: ranked.filter((r) => r !== null).length,
      not_found: ranked.filter((r) => r === null).length,
      not_found_ids: covered.filter((r) => (search[r.id]?.rank ?? null) === null).map((r) => r.id),
      not_first_ids: covered
        .filter((r) => (search[r.id]?.rank ?? null) !== null && search[r.id]!.rank !== 1)
        .map((r) => r.id),
    };
  };
  const of = (k: Kind) => results.filter((r) => kindOf(r) === k);
  const all = Object.values(search);
  const original = positive.filter((r) => Number(r.id.slice(1)) <= 127);
  const twins = positive.filter((r) => r.decoy);
  const searchSummary = !searched
    ? null
    : {
        // the same 127 queries as Sprint 004A, for a like-for-like comparison
        sprint_004a_set: ranks(original),
        all_positive: ranks(positive),
        new_positive: ranks(positive.filter((r) => Number(r.id.slice(1)) > 127)),
        perturbation: ranks(of("perturbation")),
        near_twins: {
          queries: twins.length,
          sibling_offered_first: twins.filter((r) => search[r.id]?.decoyFirst).map((r) => r.id),
        },
        filter: {
          queries: of("filter").length,
          rows_contradicting_the_filter: of("filter").reduce(
            (n, r) => n + (search[r.id]?.filterViolations ?? 0),
            0,
          ),
        },
        generic: of("generic").map((r) => ({
          query: r.query,
          rows: search[r.id]?.rows ?? 0,
          ms: search[r.id]?.ms ?? null,
        })),
        adversarial: {
          queries: of("adversarial").length,
          not_a_search: of("adversarial").filter((r) => search[r.id]?.searched === null).length,
          errors: of("adversarial")
            .filter((r) => search[r.id]?.error)
            .map((r) => r.id),
          over_the_limit: of("adversarial").filter((r) => (search[r.id]?.rows ?? 0) > 8).length,
        },
        provider_marked_verified: all.filter((s) => s.verifiedProvider).length,
        errors: all.filter((s) => s.error).length,
        queries_with_duplicate_rows: all.filter((s) => s.duplicates > 0).length,
        empty_results: all.filter((s) => s.searched !== null && s.rows === 0).length,
      };
  const summary = {
    provider_records: records.length,
    entries: results.length,
    coverage: Object.fromEntries(classes.map((c) => [c, count(positive, c)])),
    coverage_sprint_004a_set: Object.fromEntries(classes.map((c) => [c, count(original, c)])),
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

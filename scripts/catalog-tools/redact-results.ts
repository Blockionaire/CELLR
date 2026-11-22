/**
 * Result files that may be committed (Sprint 004B/004C rule: no real external dataset content in the repository).
 *
 *   pnpm --filter @cellr/catalog-tools exec tsx redact-results.ts <file.json>…
 *
 * The benchmark, recognition and quality reports name records of the provider they ran against (for X-Wines: wine and
 * winery names from the dataset). This rewrites each file IN PLACE to what the conclusions rest on: every summary and
 * count, and per benchmark query or reading only CELLR's own id, its class and the rank or status it got. Record
 * names, record ids, search hits, suggestions and example groups are removed. Run it after the tools that read the
 * full files (recognition.ts reads benchmark-results.json), before anything is committed.
 */
import { readFileSync, writeFileSync } from "node:fs";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
const count = (v: Json | undefined): number =>
  Array.isArray(v) ? v.length : v && typeof v === "object" ? Object.keys(v).length : 0;
const pick = (o: { [k: string]: Json }, keys: string[]) =>
  Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]!]));

/** Benchmark entries: the query's own id and class, how many provider records cover it, and the rank it got. */
function benchmark(r: { [k: string]: Json }) {
  const entries = (r.entries as Array<{ [k: string]: Json }>).map((e) => {
    const s = (e.search ?? {}) as { [k: string]: Json };
    return {
      ...pick(e, ["id", "kind", "base", "segment", "vintage", "variant", "decoy", "coverage"]),
      exact: count(e.exact),
      partial: count(e.partial),
      producer_records:
        typeof e.producer_records === "number" ? e.producer_records : count(e.producer_records),
      targets: count(e.target_ids),
      search: pick(s, [
        "rank",
        "rows",
        "ms",
        "verifiedProvider",
        "filterViolations",
        "duplicates",
        "error",
      ]),
    };
  });
  return { summary: r.summary ?? null, entries, redacted: NOTE };
}

/** Recognition readings: which query, which kind of reading, the outcome and the rank, never a suggestion's text. */
function recognition(r: { [k: string]: Json }) {
  const readings = (r.readings as Array<{ [k: string]: Json }>).map((x) => ({
    ...pick(x, ["id", "reading", "status", "target", "ms", "seeded"]),
    exact_wine: x.exactWine ? true : false,
    suggestions: count(x.suggestions),
  }));
  return { summary: r.summary ?? null, readings, redacted: NOTE };
}

/** Quality: every count; each list of example names becomes its length. */
function quality(r: Json): Json {
  if (Array.isArray(r)) return r.map(quality);
  if (!r || typeof r !== "object") return r;
  return Object.fromEntries(
    Object.entries(r).map(([k, v]) => [k, k === "examples" ? count(v) : quality(v)]),
  );
}

const NOTE =
  "Redacted for the repository (scripts/catalog-tools/redact-results.ts): counts and ranks only; record names, ids, hits and examples removed.";

export function redact(file: string, data: { [k: string]: Json }): { [k: string]: Json } {
  if (data.redacted) return data;
  if (/benchmark-results\.json$/.test(file)) return benchmark(data);
  if (/recognition-results\.json$/.test(file)) return recognition(data);
  // an import report: its counts, never the refused records themselves
  if (/import-[\w-]+\.json$/.test(file))
    return { ...data, problems: count(data.problems), redacted: NOTE };
  if (/quality-[\w-]+\.json$/.test(file))
    return { ...(quality(data) as { [k: string]: Json }), redacted: NOTE };
  throw new Error(`${file}: not a result file this tool knows`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop()!)) {
  for (const file of process.argv.slice(2)) {
    const out = redact(file, JSON.parse(readFileSync(file, "utf8")));
    writeFileSync(file, JSON.stringify(out, null, 1) + "\n");
    console.log(`redacted ${file}`);
  }
}

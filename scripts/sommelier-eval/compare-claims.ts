/**
 * THE CLAIMS SIDE OF A PAIRED COMPARISON (P8 paid plan): v7 + check against v6, scenario by scenario, clustered by
 * dish, with stats.ts's own paired bootstrap. Reads the vector files `run.ts --engine v1plus-ai --vectors` wrote
 * (their rows carry `claims`, engines/v1plus-ai.ts), any number of runs per side.
 *
 *   pnpm --filter @cellr/sommelier-eval run compare-claims --a v7-1.json,v7-2.json --b v6-1.json,v6-2.json [--json out]
 *
 * Measures (each a share of scenarios; a scenario without a model answer in a run is left out of that measure):
 * - `shownClean`: the words shown had no claim the check's rules flag (for v6: the model's own words, nothing is
 *   checked; for v7: after the check);
 * - `rawClean`: the model's own words had none (before any check);
 * and, per side only: refs written as asked (v7), the check's outcomes, sentences removed, tokens per call.
 *
 * The flags are HEURISTICS (claims.ts), not ground truth: a difference here is "the code flags fewer claims", not
 * "the answers are more often right". The review sheet is where a person says how often a flag was right.
 * The bottle measures (first bottle right, no poor bottle, useful answer) come from compare.ts on the same files.
 */
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { checkSides } from "./compare";
import type { ClaimsRecord } from "./engines/v1plus-ai";
import { pairedProportion, type Interval, type ScenarioVector } from "./stats";
import type { VectorFile } from "./vectors";

type Row = ScenarioVector & { claims?: ClaimsRecord };
type Binary = "rawClean" | "shownClean";

/** The runs as stats.ts reads them, with the claim measure in the place of `first`; rows without it are left out. */
function runsFor(files: readonly VectorFile[], measure: Binary) {
  return files.map(
    (f) =>
      new Map(
        Object.entries(f.rows as Record<string, Row>).flatMap(([k, v]) => {
          const x = v.claims?.[measure];
          return x === null || x === undefined ? [] : [[k, { ...v, first: x }] as const];
        }),
      ),
  );
}

export function compareClaims(a: readonly VectorFile[], b: readonly VectorFile[]) {
  const measures = Object.fromEntries(
    (["shownClean", "rawClean"] as const).map((m) => [
      m,
      pairedProportion(runsFor(a, m), runsFor(b, m), "first"),
    ]),
  ) as Record<Binary, Interval>;
  const side = (files: readonly VectorFile[]) => {
    const rows = files.flatMap((f) => Object.values(f.rows as Record<string, Row>));
    const claims = rows.flatMap((r) => (r.claims ? [r.claims] : []));
    const calls = claims.flatMap((c) => c.calls);
    const share = (xs: ReadonlyArray<0 | 1 | null>) => {
      const known = xs.filter((x): x is 0 | 1 => x !== null);
      return known.length === 0 ? null : known.reduce<number>((s, x) => s + x, 0) / known.length;
    };
    const codes: Record<string, number> = {};
    for (const c of claims) for (const code of c.shownCodes) codes[code] = (codes[code] ?? 0) + 1;
    const rawCodes: Record<string, number> = {};
    for (const c of claims)
      for (const code of c.rawCodes) rawCodes[code] = (rawCodes[code] ?? 0) + 1;
    return {
      engine: files[0]?.engine ?? null,
      runs: files.length,
      answers: claims.length,
      refsAsAsked: share(claims.map((c) => c.refsAsAsked)),
      check: {
        kept: claims.filter((c) => c.check === "kept").length,
        trimmed: claims.filter((c) => c.check === "trimmed").length,
        replaced: claims.filter((c) => c.check === "replaced").length,
      },
      sentencesRemoved: claims.reduce((s, c) => s + c.removed, 0),
      scenariosFlaggedShown: codes,
      scenariosFlaggedRaw: rawCodes,
      calls: calls.length,
      tokensIn: calls.reduce((s, c) => s + c.tokensIn, 0),
      tokensOut: calls.reduce((s, c) => s + c.tokensOut, 0),
      maxTokensOutOfOneCall: calls.reduce((m, c) => Math.max(m, c.tokensOut), 0),
    };
  };
  return { measures, a: side(a), b: side(b) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values: args } = parseArgs({
    options: { a: { type: "string" }, b: { type: "string" }, json: { type: "string" } },
  });
  const load = async (list: string | undefined) =>
    Promise.all(
      (list ?? "")
        .split(",")
        .filter(Boolean)
        .map(async (p) => JSON.parse(await readFile(p, "utf8")) as VectorFile),
    );
  const a = await load(args.a);
  const b = await load(args.b);
  const problem = a.length && b.length ? checkSides(a, b) : "need --a and --b";
  if (problem) {
    console.error(problem);
    process.exit(2);
  }
  const result = compareClaims(a, b);
  const pts = (x: number) => `${x >= 0 ? "+" : ""}${Math.round(100 * x)}`;
  console.log(
    `Set "${a[0]!.set}": ${a[0]!.engine} − ${b[0]!.engine}. Flags are the check's heuristics, not ground truth.`,
  );
  for (const [name, r] of Object.entries(result.measures))
    console.log(
      `  ${name.padEnd(11)} ${pts(r.diff)} points [${pts(r.low)}, ${pts(r.high)}] over ${r.scenarios} scenarios of ${r.clusters} dishes`,
    );
  console.log(JSON.stringify({ a: result.a, b: result.b }, null, 2));
  if (args.json) await writeFile(args.json, JSON.stringify(result, null, 2) + "\n");
}

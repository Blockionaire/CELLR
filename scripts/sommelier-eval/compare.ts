/**
 * PAIRED COMPARISON OF TWO ENGINES, BY SCENARIO (S11). Reads the vector files `run.ts --vectors` wrote (any number
 * of runs per engine, of one set) and prints each measure's difference a − b with its 95% interval from the
 * paired cluster bootstrap of stats.ts: runs are averaged within a scenario, scenarios are resampled.
 *
 *   pnpm --filter @cellr/sommelier-eval run compare --a a1.json,a2.json --b d1.json,d2.json
 *
 * Files of different sets, different salts or different key types are refused, as is an incomplete run.
 */
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { pairedProportion, pairedRatio, type Interval, type ScenarioVector } from "./stats";
import type { VectorFile } from "./vectors";

/** Each side's runs must be of one engine: two engines mixed on one side would average into neither. */
export function checkSides(a: readonly VectorFile[], b: readonly VectorFile[]): string | null {
  for (const side of [a, b])
    if (new Set(side.map((f) => f.engine)).size > 1)
      return `one side mixes engines: ${[...new Set(side.map((f) => f.engine))].join(", ")}`;
  return checkVectorFiles([...a, ...b]);
}

/**
 * Scenarios a side has that the comparison leaves out: an engine that cannot attempt a scenario (or leaves it
 * unscored) has no row there, so the scenario is compared for neither. Said, so it is never silent.
 */
export function dropped(a: readonly VectorFile[], b: readonly VectorFile[]) {
  const all = [...a, ...b];
  const keys = (side: readonly VectorFile[]) => new Set(side.flatMap((f) => Object.keys(f.rows)));
  const common = new Set([...keys(all)].filter((k) => all.every((f) => k in f.rows)));
  return {
    a: [...keys(a)].filter((k) => !common.has(k)).length,
    b: [...keys(b)].filter((k) => !common.has(k)).length,
  };
}

export function checkVectorFiles(files: readonly VectorFile[]): string | null {
  if (files.length === 0) return "no files";
  const [f] = files;
  for (const g of files) {
    if (g.set !== f!.set) return `files of different sets: ${f!.set} and ${g.set}`;
    if (g.keyed !== f!.keyed || g.salt !== f!.salt) return "files keyed differently (another salt)";
    if (g.incomplete) return `a run of ${g.engine} stopped early: compare complete runs only`;
  }
  return null;
}

const runsOf = (files: readonly VectorFile[]) =>
  files.map((f) => new Map<string, ScenarioVector>(Object.entries(f.rows)));

export function compare(a: readonly VectorFile[], b: readonly VectorFile[]) {
  const ra = runsOf(a);
  const rb = runsOf(b);
  return {
    first: pairedProportion(ra, rb, "first"),
    noPoor: pairedProportion(ra, rb, "noPoor"),
    useful: pairedProportion(ra, rb, "useful"),
    poorOfOffered: pairedRatio(ra, rb, "poor"),
    goodOfOffered: pairedRatio(ra, rb, "good"),
  } satisfies Record<string, Interval>;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values: args } = parseArgs({ options: { a: { type: "string" }, b: { type: "string" } } });
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
  const pts = (x: number) => `${x >= 0 ? "+" : ""}${Math.round(100 * x)}`;
  console.log(
    `Set "${a[0]!.set}": ${a[0]!.engine} (${a.length} runs) − ${b[0]!.engine} (${b.length} runs), paired by scenario.`,
  );
  const left = dropped(a, b);
  if (left.a + left.b > 0)
    console.log(
      `  Left out (not in every run of both): ${left.a} scenarios of ${a[0]!.engine}, ${left.b} of ${b[0]!.engine}.`,
    );
  for (const [name, r] of Object.entries(compare(a, b)))
    console.log(
      `  ${name.padEnd(14)} ${pts(r.diff)} points [${pts(r.low)}, ${pts(r.high)}] over ${r.scenarios} scenarios`,
    );
}

/**
 * THE COST CRITERION ON REAL TOKENS, AFTER THE PAID RUNS (P8_MEASUREMENT_PLAN.md §9, rule d; owner decision
 * 2026-11-25): reads the committed results in results/p8-paid/ and checks, from the cost the provider reported for
 * every call (priced with pricing.ts):
 *
 * 1. a menu question made at most ONE model call;
 * 2. a menu question's real cost is at most 1.5 × the median real cost of an ordinary V1 (v6) question in the same
 *    named cellar (or, where the runs asked V1 nothing in that cellar, in all cellars, and it says so);
 * 3. the median real cost of an ordinary question with the parts (v7) is at most 1.10 × V1's (v6).
 *
 *   pnpm --filter @cellr/sommelier-eval run cost-check [--dir <results/p8-paid>] [--json <file>]   exit 1 when it fails
 *
 * Without the files it says "not measured" and passes nothing. The ratios are reported with their spread.
 */
import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import type { ClaimsRecord } from "./engines/v1plus-ai";
import type { MenuArmScenario } from "./menu-run";
import { MENU_SCENARIOS } from "./scenarios-menu";
import { scenariosOf } from "./sets";
import type { VectorFile } from "./vectors";

export const COST_LIMITS = { menuCalls: 1, menuTimesOrdinary: 1.5, ordinaryRatio: 1.1 } as const;
export const DEFAULT_DIR = new URL(
  "../../docs/sprints/sommelier-3-mega/results/p8-paid/",
  import.meta.url,
);
const RUNS = [1, 2, 3] as const;
const READABLE = ["main", "holdout-dev", "probe"] as const;

/** The value at floor(p·n) of the sorted values (the same definition as score.ts). */
const at = (sorted: readonly number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
export function spread(values: readonly number[]) {
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 0) return null;
  const r = (x: number) => Math.round(x * 1000) / 1000;
  return {
    n: s.length,
    min: r(s[0]!),
    median: r(at(s, 0.5)),
    p95: r(at(s, 0.95)),
    max: r(s.at(-1)!),
  };
}

type Row = { claims?: ClaimsRecord };

function readVectors(dir: URL, name: string): VectorFile | null {
  const url = new URL(name, dir);
  if (!existsSync(url)) return null;
  const f = JSON.parse(readFileSync(url, "utf8")) as VectorFile;
  return f.incomplete ? null : f;
}

/** Real cost per call of one arm, by named cellar (readable sets only: their keys are scenario ids). */
function costsByCellar(dir: URL, side: "v6" | "v7") {
  const by = new Map<string, number[]>();
  const all: number[] = [];
  let files = 0;
  for (const set of READABLE) {
    const cellarOf = new Map(scenariosOf(set).map((s) => [s.id, s.cellar]));
    for (const n of RUNS) {
      const f = readVectors(dir, `${set}-${side}-${n}.json`);
      if (!f) continue;
      files += 1;
      const claims = [
        ...Object.entries(f.rows as Record<string, Row>).map(([id, r]) => [id, r.claims] as const),
        ...Object.entries((f as { claims?: Record<string, ClaimsRecord> }).claims ?? {}),
      ];
      for (const [id, record] of claims)
        for (const c of record?.calls ?? []) {
          if (c.usdMicro === null) continue;
          all.push(c.usdMicro);
          const cellar = cellarOf.get(id);
          if (cellar) by.set(cellar, [...(by.get(cellar) ?? []), c.usdMicro]);
        }
    }
  }
  return { by, all, files };
}

const median = (xs: readonly number[]) =>
  xs.length === 0
    ? null
    : at(
        [...xs].sort((a, b) => a - b),
        0.5,
      );

export function costCheck(dir: URL = DEFAULT_DIR) {
  const v6 = costsByCellar(dir, "v6");
  const v7 = costsByCellar(dir, "v7");
  const menuFiles = RUNS.flatMap((n) => {
    const url = new URL(`menu-menu-${n}.json`, dir);
    if (!existsSync(url)) return [];
    const f = JSON.parse(readFileSync(url, "utf8")) as {
      incomplete: boolean;
      rows: MenuArmScenario[];
    };
    return f.incomplete ? [] : [f];
  });
  const measured = v6.files > 0 && v7.files > 0 && menuFiles.length > 0;
  if (!measured)
    return {
      measured: false as const,
      note: "not measured: awaits budget approval (no complete paid runs in results/p8-paid/)",
    };

  // 1. One call per menu question (and per follow-up turn).
  const tooMany = menuFiles.flatMap((f) =>
    f.rows.filter((r) => r.calls.length > r.questions * COST_LIMITS.menuCalls).map((r) => r.id),
  );
  // 2. The menu question's real cost against the same cellar's median V1 question.
  const overall = median(v6.all)!;
  const noSameCellar = new Set<string>();
  const ratios: number[] = [];
  for (const f of menuFiles)
    for (const r of f.rows) {
      const first = r.calls[0];
      if (!first || first.usdMicro === null) continue;
      const cellar = MENU_SCENARIOS.find((s) => s.id === r.id)?.cellar ?? "";
      const same = median(v6.by.get(cellar) ?? []);
      if (same === null) noSameCellar.add(cellar);
      ratios.push(first.usdMicro / (same ?? overall));
    }
  const menuSpread = spread(ratios);
  // 3. Ordinary questions: the median real cost with the parts against V1's.
  const ordinaryRatio = median(v7.all)! / overall;
  const failures = [
    ...(tooMany.length > 0
      ? [`a menu question made more than one model call (${tooMany.length} scenarios)`]
      : []),
    ...(menuSpread && menuSpread.max > COST_LIMITS.menuTimesOrdinary
      ? [
          `a menu question cost ${menuSpread.max} × the same cellar's median V1 question (limit ${COST_LIMITS.menuTimesOrdinary})`,
        ]
      : []),
    ...(ordinaryRatio > COST_LIMITS.ordinaryRatio
      ? [
          `ordinary questions' median real cost is ${Math.round(ordinaryRatio * 1000) / 1000} × V1's (limit ${COST_LIMITS.ordinaryRatio})`,
        ]
      : []),
  ];
  return {
    measured: true as const,
    passed: failures.length === 0,
    failures,
    menuCallsOver: tooMany,
    menuTimesSameCellarV1: menuSpread,
    cellarsWithoutV1Data: [...noSameCellar].sort(),
    ordinary: {
      v6MedianMicro: overall,
      v7MedianMicro: median(v7.all),
      ratio: Math.round(ordinaryRatio * 1000) / 1000,
      v7OverV6PerCall: spread(v7.all.map((x) => x / overall)),
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values: args } = parseArgs({
    options: { dir: { type: "string" }, json: { type: "string" } },
  });
  const dir = args.dir ? new URL(`file://${args.dir.replace(/\/?$/, "/")}`) : DEFAULT_DIR;
  const result = costCheck(dir);
  console.log(JSON.stringify(result, null, 2));
  if (args.json) await writeFile(args.json, JSON.stringify(result, null, 2) + "\n");
  if (result.measured && !result.passed) process.exitCode = 1;
}

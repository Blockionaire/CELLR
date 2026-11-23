/**
 * THE WHOLE P8 PAID PLAN, ESTIMATED (nothing is sent): every run of docs/sprints/sommelier-3-mega/P8_MEASUREMENT_PLAN.md
 * built by the app's own code with paid.ts `estimating()`, counted per run and in total: calls, the platform's
 * high estimate (`estimateCost`), and the reservation the guard would hold back call by call (`reservationFor`:
 * the worst case, what --max-usd and --total-usd must allow).
 *
 *   pnpm --filter @cellr/sommelier-eval run plan --estimate [--budget-usd 5] [--json <file>]
 *
 * It never opens or creates a budget file and refuses to run without --estimate.
 */
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { v1PlusAi } from "./engines/v1plus-ai";
import { estimateMenuArm, type MenuArm } from "./menu-run";
import { scenariosOf } from "./sets";

export const SETS = ["main", "holdout-dev", "holdout-test"] as const;

export interface PlannedRun {
  step: string;
  what: string;
  runs: number;
  /** Per run. */
  calls: number;
  highMicro: number;
  reservedMicro: number;
  /** The --max-usd for each of these runs: the reservation of one run, rounded up to a cent, plus a cent. */
  maxUsd: number;
  required: boolean;
}

/** One run of a set with these parts, as run.ts would ask it with --needs pairing,facts. */
export async function estimateSetRun(set: string, parts: string) {
  const run = v1PlusAi({ estimate: true, maxUsd: 1, parts, set });
  for (const s of scenariosOf(set).filter((x) =>
    x.needs.every((n) => n === "pairing" || n === "facts"),
  ))
    await run.engine.run(s);
  return {
    calls: run.meter.calls,
    highMicro: run.meter.usdMicro,
    reservedMicro: run.meter.reservationsMicro,
  };
}

const maxUsdFor = (reservedMicro: number) => Math.ceil(reservedMicro / 1e4) / 100 + 0.01;

export async function planRuns(runsPerArm = 3): Promise<PlannedRun[]> {
  const rows: PlannedRun[] = [];
  for (const [step, parts, what] of [
    ["1", "none", "V1 with AI, prompt v6 (no part): the baseline"],
    ["2", "check", "V1+ with check: prompt v7 and the check"],
  ] as const)
    for (const set of SETS) {
      const e = await estimateSetRun(set, parts);
      rows.push({
        step: `${step}-${set}`,
        what: `${what}; set ${set} (needs pairing,facts)`,
        runs: runsPerArm,
        ...e,
        maxUsd: maxUsdFor(e.reservedMicro),
        required: true,
      });
    }
  const arms: Array<[MenuArm, string, number, boolean]> = [
    ["v1", "Menu set, V1 without the part (its ordinary answer)", runsPerArm, true],
    ["menu", "Menu set, the menu part on", runsPerArm, true],
    ["check,menu", "Menu set, check and menu on (as it would ship)", 1, false],
    ["per-course", "Menu set, V1 asked once per course (cost and quality reference)", 1, false],
  ];
  for (const [arm, what, runs, required] of arms) {
    const e = await estimateMenuArm(arm);
    rows.push({
      step: `3-menu-${arm}`,
      what,
      runs,
      calls: e.calls,
      highMicro: e.highMicro,
      reservedMicro: e.reservedMicro,
      maxUsd: maxUsdFor(e.reservedMicro),
      required,
    });
  }
  return rows;
}

export function planTotals(rows: readonly PlannedRun[], budgetUsd: number) {
  const sum = (f: (r: PlannedRun) => number, only?: (r: PlannedRun) => boolean) =>
    rows.filter((r) => !only || only(r)).reduce((s, r) => s + r.runs * f(r), 0);
  const all = {
    calls: sum((r) => r.calls),
    highUsd: sum((r) => r.highMicro) / 1e6,
    reservedUsd: sum((r) => r.reservedMicro) / 1e6,
  };
  const required = {
    calls: sum(
      (r) => r.calls,
      (r) => r.required,
    ),
    highUsd:
      sum(
        (r) => r.highMicro,
        (r) => r.required,
      ) / 1e6,
    reservedUsd:
      sum(
        (r) => r.reservedMicro,
        (r) => r.required,
      ) / 1e6,
  };
  return {
    budgetUsd,
    all,
    required,
    fits: all.reservedUsd <= budgetUsd,
    requiredFits: required.reservedUsd <= budgetUsd,
    /** The margin left when every call costs its whole reservation. */
    marginUsd: Math.round((budgetUsd - all.reservedUsd) * 1e4) / 1e4,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values: args } = parseArgs({
    options: {
      estimate: { type: "boolean", default: false },
      "budget-usd": { type: "string", default: "5" },
      json: { type: "string" },
    },
  });
  if (!args.estimate) {
    console.error(
      "plan: only --estimate exists (nothing is sent). The runs themselves are in P8_MEASUREMENT_PLAN.md.",
    );
    process.exit(2);
  }
  const budget = Number(args["budget-usd"]);
  const rows = await planRuns();
  const totals = planTotals(rows, budget);
  const usd = (micro: number) => `$${(micro / 1e6).toFixed(4)}`;
  console.log("ESTIMATE ONLY, nothing was sent, no budget file was opened.");
  console.log(
    "| Step | Run | Runs | Calls per run | High estimate per run | Reserved per run | --max-usd per run | Required |",
  );
  console.log("| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |");
  for (const r of rows)
    console.log(
      `| ${r.step} | ${r.what} | ${r.runs} | ${r.calls} | ${usd(r.highMicro)} | ${usd(r.reservedMicro)} | ${r.maxUsd.toFixed(2)} | ${r.required ? "yes" : "optional"} |`,
    );
  console.log(
    `\nTotal, every run: ${totals.all.calls} calls, high estimate $${totals.all.highUsd.toFixed(4)}, reserved $${totals.all.reservedUsd.toFixed(4)}.`,
  );
  console.log(
    `Total, required runs only: ${totals.required.calls} calls, high estimate $${totals.required.highUsd.toFixed(4)}, reserved $${totals.required.reservedUsd.toFixed(4)}.`,
  );
  console.log(
    `Fits --total-usd ${budget} at the worst case (every call costing its whole reservation): ${totals.fits ? "yes" : "NO"}, margin $${totals.marginUsd.toFixed(4)}.`,
  );
  if (args.json) await writeFile(args.json, JSON.stringify({ rows, totals }, null, 2) + "\n");
}

/**
 * The sommelier benchmark: fixed scenarios with documented reference answers, run against an engine of the app.
 *
 *   pnpm sommelier:eval                         the V1 baseline (no AI)
 *   pnpm sommelier:eval --engine v3             Sommelier 3.0's engines
 *   pnpm sommelier:eval --failures              also list every failed check
 *   pnpm sommelier:eval --only pairing-hard     one category, or one scenario id
 *   pnpm sommelier:eval --set holdout            another scenario set (sets.ts)
 *   pnpm sommelier:eval --json out.json         write the per-scenario results (no timings: they vary per run)
 *   pnpm sommelier:eval --needs pairing,facts   only the scenarios that need no more than these capabilities
 *   pnpm sommelier:eval --engine v1-ai --estimate   what running V1 WITH its AI would cost; nothing is sent
 *
 * Nothing here calls a model or a network: the engines are run with fixed cellars and a fixed day. The one
 * exception is `--engine v1-ai` without `--estimate`, which calls the paid model and therefore refuses to run
 * without the owner's approval (paid.ts says how, and what is sent).
 * How the reference answers were made, and what the benchmark cannot show: docs/sprints/sommelier-3-mega/BASELINE.md.
 */
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { ENGINES } from "./engines";
import { v1Ai, type V1AiRun } from "./engines/v1-ai";
import { buildFixture } from "./fixtures";
import { formatQuality, qualityRow, qualityTotals, type QualityRow } from "./quality";
import { BudgetReached } from "./paid";
import { formatFailures, formatSummary } from "./report";
import { cardsOf, holdsBlind, scenariosOf } from "./sets";
import { scoreScenario, summarize, type ScenarioResult } from "./score";
import type { EvalAnswer } from "./types";
import { vectorKeyer, vectorOf, type VectorFile } from "./vectors";
import type { ScenarioVector } from "./stats";

const { values: args } = parseArgs({
  options: {
    engine: { type: "string", default: "v1-basic" },
    only: { type: "string" },
    json: { type: "string" },
    failures: { type: "boolean", default: false },
    /** The scenario set: "main" (the benchmark the engines were developed against) or another one of sets.ts. */
    set: { type: "string", default: "main" },
    /** With `--engine v1-ai`: build and count the prompts, send nothing. */
    estimate: { type: "boolean", default: false },
    /** Only scenarios that need nothing beyond these capabilities ("pairing,facts": what V1 can attempt). */
    needs: { type: "string" },
    /** With `--engine v1-ai` for real: stop once this much was spent (US dollars). */
    "max-usd": { type: "string", default: "2" },
    /**
     * Per-scenario outcomes for paired comparisons (compare.ts), written to this file. For a blind set the keys are
     * salted hashes (SOMMELIER_EVAL_BLIND_SALT) and the file must be outside the repository: it pairs runs, it
     * never names a scenario.
     */
    vectors: { type: "string" },
  },
});

let paid: V1AiRun | null = null;
const PAID_ENGINES = new Set(["v1-ai"]);
if (PAID_ENGINES.has(args.engine!)) {
  const maxUsd = Number(args["max-usd"]);
  if (!Number.isFinite(maxUsd) || maxUsd <= 0 || maxUsd > 25) {
    console.error("--max-usd must be a number of dollars between 0 and 25");
    process.exit(2);
  }
  try {
    paid = v1Ai({ estimate: args.estimate!, maxUsd });
  } catch (error) {
    console.error((error as Error).message);
    process.exit(2);
  }
}
const engine = paid === null ? ENGINES.find((e) => e.name === args.engine) : paid.engine;
if (!engine) {
  console.error(
    `unknown engine "${args.engine}"; known: ${ENGINES.map((e) => e.name).join(", ")}, ${[...PAID_ENGINES].join(", ")}`,
  );
  process.exit(2);
}
// A blind set is reported in totals only: nothing here names one of its scenarios.
const blind = holdsBlind(args.set!);
if (blind && (args.failures || args.only)) {
  console.error(
    `"${args.set}" holds the blind scenarios: it is measured in totals only (no --failures, no --only).`,
  );
  process.exit(2);
}
const within = args.needs ? new Set(args.needs.split(",")) : null;
const scenarios = scenariosOf(args.set!).filter(
  (s) =>
    (!args.only || s.category === args.only || s.id === args.only) &&
    (!within || s.needs.every((n) => within.has(n))),
);
const cards = cardsOf(args.set!);
const results: ScenarioResult[] = [];
const qualityRows: QualityRow[] = [];
const cellarOfScenario = new Map<string, string[]>();
const answers: EvalAnswer[] = [];
// Refuses, before anything is run, a blind set without a salt or a file inside the repository.
let keyOf: ReturnType<typeof vectorKeyer> | null = null;
try {
  keyOf = args.vectors ? vectorKeyer(args.set!, args.vectors, process.env) : null;
} catch (error) {
  console.error((error as Error).message);
  process.exit(2);
}
const vectors = new Map<string, ScenarioVector>();
// Once unmeasured, so module loading and the first call's warm-up are not counted as latency.
// (Never for the paid engine: a warm-up there is a call that costs money and is thrown away.)
if (scenarios[0] && !paid) await engine.run(scenarios[0]);
let stoppedAt: string | null = null;
for (const scenario of scenarios) {
  let run;
  try {
    run = await engine.run(scenario);
  } catch (error) {
    if (!(error instanceof BudgetReached)) throw error;
    stoppedAt = scenario.id;
    console.error(
      `Stopped before ${scenario.id}: ${error.message}. The results below are incomplete.`,
    );
    break;
  }
  // The meter also says so when the limit was reached inside the app's own call.
  if (paid?.meter.stopped) {
    stoppedAt = scenario.id;
    console.error(
      `Stopped at ${scenario.id}: the spending limit was reached. That scenario and the rest are not counted.`,
    );
    break;
  }
  answers.push(run.answer);
  const card = scenario.dish ? (cards.get(scenario.dish) ?? null) : null;
  const scored = scoreScenario(scenario, card, run.answer, run.ms);
  results.push(scored);
  const cellarKeys = buildFixture(scenario).wines.map((w) => w.key);
  cellarOfScenario.set(scenario.id, cellarKeys);
  const row = qualityRow(scenario, card, run.answer, scored, cellarKeys);
  if (row) qualityRows.push(row);
  // Clustered by dish (keyed like the scenario, so a blind set's dishes are not named either).
  if (row && keyOf)
    vectors.set(
      keyOf.key(scenario.id),
      vectorOf(row, scored, scenario.dish ? keyOf.key(`dish:${scenario.dish}`) : undefined),
    );
}
const quality = qualityTotals(
  qualityRows,
  (id) => cellarOfScenario.get(id) ?? [],
  (id) => {
    const dish = scenarios.find((x) => x.id === id)?.dish;
    return dish ? (cards.get(dish) ?? null) : null;
  },
);
if (paid?.mode === "estimate") {
  // No model answered, so there is nothing to score: only what asking would cost.
  const m = paid.meter;
  console.log(
    `ESTIMATE ONLY, nothing was sent. Set "${args.set}": ${scenarios.length} scenarios, of which the engine can attempt ${results.filter((r) => r.supported).length}; ${m.calls} model calls (${paid.model}).`,
  );
  console.log(
    `At most about ${m.inputTokens} tokens in and ${m.outputTokens} out: $${(m.usdMicro / 1e6).toFixed(4)} per run of this set (a high estimate: the full output allowance and one repair per call).`,
  );
  process.exit(0);
}
const summary = summarize(engine.name, results, answers);
console.log(formatSummary(summary, engine.describes));
console.log(`\n${formatQuality(quality)}`);
console.log(
  `\nLatency of the engine's own work per question (this machine, this run): p50 ${summary.latencyMs.p50.toFixed(2)} ms, p95 ${summary.latencyMs.p95.toFixed(2)} ms, max ${summary.latencyMs.max.toFixed(2)} ms.`,
);
console.log(
  `Model calls: ${summary.ai.calls}; tokens in/out: ${summary.ai.inputTokens}/${summary.ai.outputTokens}; cost: $${(summary.ai.usdMicro / 1e6).toFixed(4)}.`,
);
if (args.failures) console.log(`\nFailed checks:\n${formatFailures(results)}`);
if (args.vectors && keyOf) {
  const file: VectorFile = {
    set: args.set!,
    engine: engine.name,
    keyed: keyOf.keyed,
    salt: keyOf.fingerprint,
    incomplete: stoppedAt !== null,
    // Sorted by key: in run order a blind set's rows would line up with the scenario list in the repository.
    rows: Object.fromEntries([...vectors].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))),
  };
  keyOf.check();
  await writeFile(args.vectors, JSON.stringify(file) + "\n");
}
if (args.json) {
  const stable = {
    engine: engine.name,
    ...(paid
      ? {
          model: paid.model,
          servedModels: [...paid.meter.servedModels].sort(),
          ai: summary.ai,
          callsWithUnknownCost: paid.meter.unknownCost,
          incomplete: stoppedAt !== null,
        }
      : {}),
    scenarios: summary.scenarios,
    passed: summary.passed,
    supported: summary.supported,
    byCategory: summary.byCategory,
    measures: summary.measures,
    quality,
    ...(blind
      ? {}
      : {
          results: results.map((r) => ({
            id: r.id,
            pass: r.pass,
            supported: r.supported,
            failed: r.checks.filter((c) => !c.pass).map((c) => c.name),
          })),
          // By bottle, for the paired comparisons of S10 (only for sets that may be read scenario by scenario).
          labels: Object.fromEntries(qualityRows.map((q) => [q.id, q.labels])),
        }),
  };
  await writeFile(args.json, JSON.stringify(stable, null, 2) + "\n");
}

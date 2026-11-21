/**
 * The sommelier benchmark: fixed scenarios with documented reference answers, run against an engine of the app.
 *
 *   pnpm sommelier:eval                         the V1 baseline (no AI)
 *   pnpm sommelier:eval --engine v3             Sommelier 3.0's engines
 *   pnpm sommelier:eval --failures              also list every failed check
 *   pnpm sommelier:eval --only pairing-hard     one category, or one scenario id
 *   pnpm sommelier:eval --json out.json         write the per-scenario results (no timings: they vary per run)
 *
 * Nothing here calls a model or a network: the engines are run with fixed cellars and a fixed day.
 * How the reference answers were made, and what the benchmark cannot show: docs/sprints/sommelier-3-mega/BASELINE.md.
 */
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { DISHES } from "./dishes";
import { ENGINES } from "./engines";
import { formatFailures, formatSummary } from "./report";
import { SCENARIOS } from "./scenarios";
import { scoreScenario, summarize, type ScenarioResult } from "./score";
import type { EvalAnswer } from "./types";

const { values: args } = parseArgs({
  options: {
    engine: { type: "string", default: "v1-basic" },
    only: { type: "string" },
    json: { type: "string" },
    failures: { type: "boolean", default: false },
  },
});

const engine = ENGINES.find((e) => e.name === args.engine);
if (!engine) {
  console.error(`unknown engine "${args.engine}"; known: ${ENGINES.map((e) => e.name).join(", ")}`);
  process.exit(2);
}
const scenarios = SCENARIOS.filter(
  (s) => !args.only || s.category === args.only || s.id === args.only,
);
const cards = new Map(DISHES.map((d) => [d.id, d]));
const results: ScenarioResult[] = [];
const answers: EvalAnswer[] = [];
// Once unmeasured, so module loading and the first call's warm-up are not counted as latency.
if (scenarios[0]) await engine.run(scenarios[0]);
for (const scenario of scenarios) {
  const { answer, ms } = await engine.run(scenario);
  answers.push(answer);
  results.push(
    scoreScenario(scenario, scenario.dish ? (cards.get(scenario.dish) ?? null) : null, answer, ms),
  );
}
const summary = summarize(engine.name, results, answers);
console.log(formatSummary(summary, engine.describes));
console.log(
  `\nLatency of the engine's own work per question (this machine, this run): p50 ${summary.latencyMs.p50.toFixed(2)} ms, p95 ${summary.latencyMs.p95.toFixed(2)} ms, max ${summary.latencyMs.max.toFixed(2)} ms.`,
);
console.log(
  `Model calls: ${summary.ai.calls}; tokens in/out: ${summary.ai.inputTokens}/${summary.ai.outputTokens}; cost: $${(summary.ai.usdMicro / 1e6).toFixed(4)}.`,
);
if (args.failures) console.log(`\nFailed checks:\n${formatFailures(results)}`);
if (args.json) {
  const stable = {
    engine: engine.name,
    scenarios: summary.scenarios,
    passed: summary.passed,
    supported: summary.supported,
    byCategory: summary.byCategory,
    measures: summary.measures,
    results: results.map((r) => ({
      id: r.id,
      pass: r.pass,
      supported: r.supported,
      failed: r.checks.filter((c) => !c.pass).map((c) => c.name),
    })),
  };
  await writeFile(args.json, JSON.stringify(stable, null, 2) + "\n");
}

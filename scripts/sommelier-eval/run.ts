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
 *   pnpm sommelier:eval --engine v1plus-ai --parts check --estimate   the same with V1+ parts on (prompt v7)
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
import { v1PlusAi, type ClaimsRecord, type V1PlusAiRun } from "./engines/v1plus-ai";
import { keptSample, removedSheet } from "./review-sheet";
import { execFileSync } from "node:child_process";
import {
  DEFINITIVE_NOTE,
  DEFINITIVE_SET,
  definitiveRefusal,
  EXPLORATORY_NOTE,
  EXPLORATORY_SET,
  isDefinitive,
  onlyResultsSince,
  readFrozen,
  readScored,
  readSeal,
  recordScoring,
} from "./human-holdout-series";
import { buildFixture } from "./fixtures";
import { formatQuality, qualityRow, qualityTotals, type QualityRow } from "./quality";
import { BudgetReached, Ledger, paidAllowed } from "./paid";
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
    /** With `--engine v1-ai` for real: this run never sends a call that could take it past this (US dollars). */
    "max-usd": { type: "string", default: "2" },
    /**
     * With `--engine v1-ai` for real, both required: a JSON file outside the repository that keeps the total spent
     * over every run, and that total (US dollars). A call that could pass it is never sent.
     */
    "budget-file": { type: "string" },
    "total-usd": { type: "string" },
    /**
     * Per-scenario outcomes for paired comparisons (compare.ts), written to this file. For a blind set the keys are
     * salted hashes (SOMMELIER_EVAL_BLIND_SALT) and the file must be outside the repository: it pairs runs, it
     * never names a scenario.
     */
    vectors: { type: "string" },
    /** With `--engine v1plus-ai`: the V1+ parts on, as CELLR_SOMMELIER ("none": V1 itself, prompt v6). */
    parts: { type: "string", default: "none" },
    /**
     * With `--engine v1plus-ai` for real, on a readable set: write every sentence the check removed or replaced, and
     * a sample of 100 kept sentences (<file>-kept-sample.csv), for a person to judge. Every verdict column is empty.
     */
    "review-sheet": { type: "string" },
    /** The blind definitive holdout: only with this flag and --frozen-at (human-holdout-series.ts). */
    definitive: { type: "boolean", default: false },
    /** The commit the build was frozen at, as recorded in results/p8-build-frozen.json. */
    "frozen-at": { type: "string" },
  },
});

let paid: V1AiRun | null = null;
let plus: V1PlusAiRun | null = null;
let ledger: Ledger | null = null;
const PAID_ENGINES = new Set(["v1-ai", "v1plus-ai"]);
if (PAID_ENGINES.has(args.engine!)) {
  const maxUsd = Number(args["max-usd"]);
  if (!Number.isFinite(maxUsd) || maxUsd <= 0 || maxUsd > 25) {
    console.error("--max-usd must be a number of dollars between 0 and 25");
    process.exit(2);
  }
  try {
    // An estimate spends nothing and never opens (or creates) the budget file.
    // Nor does a run that may not spend: the refusal below comes first, and the file is left as it was.
    if (!args.estimate && args["budget-file"] && paidAllowed(process.env)) {
      const totalUsd = Number(args["total-usd"]);
      if (!Number.isFinite(totalUsd) || totalUsd <= 0 || totalUsd > 25)
        throw new Error("--total-usd must be a number of dollars between 0 and 25");
      ledger = Ledger.open(args["budget-file"], Math.round(totalUsd * 1e6));
    }
    if (args.engine === "v1plus-ai") {
      if (args["review-sheet"] && holdsBlind(args.set!))
        throw new Error(
          `"${args.set}" holds blind scenarios: no review sheet is written for it (totals only).`,
        );
      plus = v1PlusAi({
        estimate: args.estimate!,
        maxUsd,
        ledger,
        parts: args.parts!,
        set: args.set!,
      });
      paid = plus;
    } else paid = v1Ai({ estimate: args.estimate!, maxUsd, ledger });
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
// The blind definitive holdout: only with --definitive and the frozen build checked out, and only once per engine
// (the scoring is recorded before the run). Its dishes are refused in any other set.
if (args.set === DEFINITIVE_SET) {
  const head = (() => {
    try {
      return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    } catch {
      return "";
    }
  })();
  const frozen = readFrozen();
  const refusal = definitiveRefusal({
    definitive: args.definitive!,
    frozenAt: args["frozen-at"],
    head,
    onlyResultsSince: frozen ? onlyResultsSince(frozen.commit, process.cwd()) : false,
    frozen,
    scored: readScored(),
    sealSha256: readSeal("definitive")?.sha256 ?? null,
    engine: engine.name,
  });
  if (refusal) {
    console.error(refusal);
    process.exit(2);
  }
  // An estimate spends nothing and does not use the one scoring.
  if (paid?.mode === "paid")
    recordScoring({
      sealSha256: readSeal("definitive")!.sha256,
      engine: engine.name,
      frozenAt: args["frozen-at"]!,
      scoredOn: new Date().toISOString().slice(0, 10),
    });
} else if (scenarios.some((s) => isDefinitive(s.id))) {
  console.error(
    `"${args.set}" holds dishes of the blind definitive holdout: they are scored only in "${DEFINITIVE_SET}", once.`,
  );
  process.exit(2);
}
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
const vectors = new Map<string, ScenarioVector & { claims?: ClaimsRecord }>();
/** Claims of scenarios that have no vector (no dish to score): written apart, under `claims`. */
const unscored = new Map<string, ClaimsRecord>();
// Once unmeasured, so module loading and the first call's warm-up are not counted as latency.
// (Never for the paid engine: a warm-up there is a call that costs money and is thrown away.)
if (scenarios[0] && !paid) await engine.run(scenarios[0]);
let stoppedAt: string | null = null;
/** The stop rule that ended the run (stop-rules.ts), when one did. */
let stoppedRule: string | null = null;
for (const scenario of scenarios) {
  let run;
  try {
    run = await engine.run(scenario);
  } catch (error) {
    if (!(error instanceof BudgetReached)) throw error;
    stoppedAt = scenario.id;
    stoppedRule = "budget";
    console.error(
      `Stopped before ${scenario.id}: ${error.message}. The results below are incomplete.`,
    );
    break;
  }
  // The meter also says so when the limit was reached inside the app's own call.
  if (paid?.meter.stopped) {
    stoppedAt = scenario.id;
    stoppedRule = "budget";
    console.error(
      `Stopped at ${scenario.id}: the spending limit was reached. That scenario and the rest are not counted.`,
    );
    break;
  }
  // The stop rules of the paid plan: an invented fact or a contradicted serving claim shown, another served model,
  // too many failed calls. The answer that tripped it is not counted; a person reviews it.
  if (plus?.monitor.stopped) {
    stoppedAt = scenario.id;
    stoppedRule = plus.monitor.stopped.rule;
    console.error(
      `STOPPED: ${stoppedRule}${blind ? "" : ` (${plus.monitor.stopped.detail})`}. The run is incomplete; that answer goes to a person for review.`,
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
  if (row && keyOf) {
    const claims = plus?.records.get(scenario.id);
    vectors.set(keyOf.key(scenario.id), {
      ...vectorOf(row, scored, scenario.dish ? keyOf.key(`dish:${scenario.dish}`) : undefined),
      // V1+ paid plan: what the check's rules flag (heuristics), the refs, the check's outcome, tokens per call.
      ...(claims ? { claims } : {}),
    });
  } else if (keyOf && plus?.records.get(scenario.id)) {
    // A scenario without a dish to score (a serving question of the probe): its claims are still measured.
    unscored.set(keyOf.key(scenario.id), plus.records.get(scenario.id)!);
  }
}
// At the end: the share of failed calls over the whole run, however few calls there were.
if (plus && stoppedAt === null) {
  plus.monitor.end();
  if (plus.monitor.stopped) {
    stoppedAt = "the end of the run";
    stoppedRule = plus.monitor.stopped.rule;
    console.error(
      `STOPPED: ${stoppedRule} (${plus.monitor.stopped.detail}). The run is incomplete.`,
    );
  }
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
  console.log(
    `A run for real reserves before each call the most it can cost: $${(m.reservationsMicro / 1e6).toFixed(4)} for this set, call by call. A call is sent only while its reservation fits in what is left of --max-usd and --total-usd.`,
  );
  process.exit(0);
}
const summary = summarize(engine.name, results, answers);
// The human holdout's first series alone is never a release measurement: every report of it says so first.
const note =
  args.set === EXPLORATORY_SET
    ? EXPLORATORY_NOTE
    : args.set === DEFINITIVE_SET
      ? DEFINITIVE_NOTE
      : null;
if (note) console.log(`${note}\n`);
if (stoppedAt !== null)
  console.log(
    `INCOMPLETE RUN: stopped at ${blind ? "a scenario of a blind set" : stoppedAt}. The numbers below cover only the scenarios before it; they are not a baseline and compare.ts refuses its vectors.\n`,
  );
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
    ...(stoppedRule ? { stopped: stoppedRule } : {}),
    ...(plus ? { servedModels: [...plus.monitor.served].sort() } : {}),
    // Sorted by key: in run order a blind set's rows would line up with the scenario list in the repository.
    rows: Object.fromEntries([...vectors].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))),
    ...(unscored.size > 0
      ? {
          claims: Object.fromEntries(
            [...unscored].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)),
          ),
        }
      : {}),
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
          callsOverReservation: paid.meter.overReservation,
        }
      : {}),
    incomplete: stoppedAt !== null,
    ...(stoppedRule ? { stopped: stoppedRule } : {}),
    ...(note ? { part: args.set === DEFINITIVE_SET ? "definitive" : "exploratory", note } : {}),
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
if (plus && args["review-sheet"] && paid?.mode === "paid") {
  const runId = ledger?.run.id ?? "run";
  const answers = plus.sheet.map((a) => ({ ...a, run: runId }));
  await writeFile(args["review-sheet"], removedSheet(answers));
  await writeFile(
    args["review-sheet"].replace(/\.csv$/i, "") + "-kept-sample.csv",
    keptSample(answers),
  );
}
ledger?.end(stoppedAt === null);
if (ledger)
  console.log(
    `Budget file: $${(ledger.spentMicro() / 1e6).toFixed(4)} spent of the total, $${(ledger.remainingMicro() / 1e6).toFixed(4)} left (${ledger.path}).`,
  );
// A stopped run must not pass for a finished one in a script either.
if (stoppedAt !== null) process.exitCode = 3;

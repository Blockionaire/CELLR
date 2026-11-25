/**
 * THE P8 RUNBOOK AS ONE ENTRY POINT (P8_MEASUREMENT_PLAN.md §10). Everything in order, nothing paid without every
 * precondition met.
 *
 *   pnpm --filter @cellr/sommelier-eval run p8 --estimate        the whole runbook, dry: every command, every estimate, the
 *                                                                budget check; sends nothing, opens no budget file
 *   pnpm --filter @cellr/sommelier-eval run p8 --check           the preconditions only (what is still missing)
 *   pnpm --filter @cellr/sommelier-eval run p8 --freeze --by <role>   record the build frozen at the checked-out commit
 *   pnpm --filter @cellr/sommelier-eval run p8 --step 1          the v6 / v7 rounds on the three sets and the probe (paid)
 *   pnpm --filter @cellr/sommelier-eval run p8 --step 2          the menu set's arms (paid)
 *   pnpm --filter @cellr/sommelier-eval run p8 --step 3          after the runs: compare, cost check, results report (free)
 *   pnpm --filter @cellr/sommelier-eval run p8 --step 4 --forms <folder outside the repository>   the human forms (free)
 *
 * A paid step refuses unless: the owner's phrase is set (SOMMELIER_EVAL_PAID=owner-approved, after the owner's
 * written yes to §7), a key is provided through the environment's credential mechanism (OPENAI_API_KEY; never in the
 * repository), the budget file (SOMMELIER_EVAL_BUDGET_FILE) and the blind vectors' folder (SOMMELIER_EVAL_BLIND_DIR)
 * are outside the repository, the blind salt is set, the build is frozen (results/p8-build-frozen.json names the
 * checked-out commit) and the working tree is clean. A command that exits with an error (3: a stop rule or the budget)
 * stops the step at once: nothing after it is run.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { checkForms } from "./forms-check";
import {
  FROZEN_RECORD,
  onlyResultsSince,
  readFrozen,
  type FrozenRecord,
} from "./human-holdout-series";
import { PAID_ENV, PAID_PHRASE } from "./paid";
import { planRuns, planTotals, type PlannedRun } from "./plan-estimate";
import { holdsBlind } from "./sets";

const REPO = resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const TOTAL_USD = 5;
export const PAID_DIR = "docs/sprints/sommelier-3-mega/results/p8-paid";
const RUNS = [1, 2, 3] as const;

const inside = (path: string) => {
  const dir = resolve(path);
  const real = existsSync(dir)
    ? realpathSync(dir)
    : existsSync(dirname(dir))
      ? realpathSync(dirname(dir))
      : dir;
  const rel = relative(realpathSync(REPO), real);
  return !(rel.startsWith(`..${sep}`) || rel === "..");
};

export interface Situation {
  env: Record<string, string | undefined>;
  head: string;
  clean: boolean;
  frozen: FrozenRecord | null;
  /** Only results were committed since the frozen commit (the freeze record, the runs' files). */
  onlyResultsSince?: boolean;
}

/** What is still missing before a paid step may run (empty: everything is in place). Names, never values. */
export function preconditions(s: Situation): string[] {
  const missing: string[] = [];
  if (s.env[PAID_ENV] !== PAID_PHRASE)
    missing.push(
      `${PAID_ENV}=${PAID_PHRASE} (only after the owner's written yes to P8_MEASUREMENT_PLAN.md §7)`,
    );
  if ((s.env.OPENAI_API_KEY ?? "").trim() === "")
    missing.push(
      "OPENAI_API_KEY, provided through the environment's credential mechanism (never in the repository)",
    );
  const budget = s.env.SOMMELIER_EVAL_BUDGET_FILE ?? "";
  if (budget === "" || inside(budget))
    missing.push("SOMMELIER_EVAL_BUDGET_FILE: a budget file outside the repository");
  const blind = s.env.SOMMELIER_EVAL_BLIND_DIR ?? "";
  if (blind === "" || inside(blind) || !existsSync(blind))
    missing.push(
      "SOMMELIER_EVAL_BLIND_DIR: an existing folder outside the repository for the blind set's vectors",
    );
  if ((s.env.SOMMELIER_EVAL_BLIND_SALT ?? "").length < 16)
    missing.push("SOMMELIER_EVAL_BLIND_SALT: the P7 salt (never committed)");
  if (!s.frozen) missing.push("results/p8-build-frozen.json: the build frozen at a commit");
  else if (
    !s.head.startsWith(s.frozen.commit) &&
    !s.frozen.commit.startsWith(s.head) &&
    !s.onlyResultsSince
  )
    missing.push(`the checked-out commit is not the frozen build (${s.frozen.commit})`);
  if (!s.clean) missing.push("a clean working tree (nothing uncommitted)");
  return missing;
}

/** The exact commands of one planned run, for each of its rounds. `$B` / `$O` are the budget file and blind folder. */
export function commandsOf(r: PlannedRun): string[][] {
  const rounds = RUNS.slice(0, r.runs);
  if (r.kind === "menu")
    return rounds.map((n) => [
      "pnpm",
      "--filter",
      "@cellr/sommelier-eval",
      "run",
      "menu:run",
      "--arm",
      r.arm!,
      "--max-usd",
      r.maxUsd.toFixed(2),
      "--budget-file",
      "$B",
      "--total-usd",
      String(TOTAL_USD),
      "--out",
      `${PAID_DIR}/menu-${r.arm}-${n}.json`,
    ]);
  const blind = holdsBlind(r.set!);
  const dest = blind ? "$O" : PAID_DIR;
  return rounds.map((n) => [
    "pnpm",
    "sommelier:eval",
    "--engine",
    "v1plus-ai",
    "--parts",
    r.parts!,
    "--set",
    r.set!,
    "--needs",
    "pairing,facts",
    "--max-usd",
    r.maxUsd.toFixed(2),
    "--budget-file",
    "$B",
    "--total-usd",
    String(TOTAL_USD),
    "--vectors",
    `${dest}/${r.set}-${r.side}-${n}.json`,
    "--json",
    `${dest}/${r.set}-${r.side}-${n}.summary.json`,
    ...(r.side === "v7" && !blind
      ? ["--review-sheet", `${dest}/${r.set}-v7-${n}-removed.csv`]
      : []),
  ]);
}

/** The paid steps in the order they run: step 1 round by round (v6 then v7 per set), step 2 the menu arms. */
export function paidSteps(rows: readonly PlannedRun[]): Record<1 | 2, string[][]> {
  const sets = rows.filter((r) => r.kind === "set");
  const step1: string[][] = [];
  for (const n of RUNS)
    for (const set of [...new Set(sets.map((r) => r.set!))])
      for (const side of ["v6", "v7"] as const) {
        const r = sets.find((x) => x.set === set && x.side === side);
        if (r && n <= r.runs) step1.push(commandsOf(r)[n - 1]!);
      }
  const menus = rows.filter((r) => r.kind === "menu");
  const step2: string[][] = [];
  for (const n of RUNS) for (const r of menus) if (n <= r.runs) step2.push(commandsOf(r)[n - 1]!);
  return { 1: step1, 2: step2 };
}

/** Step 3 (free): the comparisons, the cost criterion and section 2 of the results, from the committed files. */
export const STEP3: string[][] = [
  // The blind set's vectors (salted keys, never a scenario name) are written outside every checkout; they are
  // copied in to be committed, as P7's were.
  [
    "sh",
    "-c",
    `cp "$SOMMELIER_EVAL_BLIND_DIR"/holdout-test-v6-?.json "$SOMMELIER_EVAL_BLIND_DIR"/holdout-test-v7-?.json ${PAID_DIR}/`,
  ],
  ["pnpm", "--filter", "@cellr/sommelier-eval", "run", "cost-check"],
  ["pnpm", "--filter", "@cellr/sommelier-eval", "run", "results-report", "--write"],
];

/** The whole runbook, dry: every command, every estimate, and whether the reservations fit the total. */
export async function dryRun() {
  const rows = await planRuns();
  const totals = planTotals(rows, TOTAL_USD);
  const steps = paidSteps(rows);
  return { rows, totals, steps, step3: STEP3, fits: totals.fits };
}

const show = (cmd: readonly string[]) => cmd.join(" ");

function situation(): Situation {
  const git = (args: string[]) => {
    try {
      return execFileSync("git", args, { cwd: REPO, encoding: "utf8" }).trim();
    } catch {
      return "";
    }
  };
  return {
    env: process.env,
    head: git(["rev-parse", "HEAD"]),
    clean: git(["status", "--porcelain"]) === "",
    frozen: readFrozen(),
    onlyResultsSince: (() => {
      const f = readFrozen();
      return f ? onlyResultsSince(f.commit, REPO) : false;
    })(),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values: args } = parseArgs({
    options: {
      estimate: { type: "boolean", default: false },
      check: { type: "boolean", default: false },
      step: { type: "string" },
      forms: { type: "string" },
      freeze: { type: "boolean", default: false },
      by: { type: "string" },
    },
  });
  if (args.freeze) {
    // Records the build as frozen at the checked-out commit; refused with uncommitted changes. Commit the record
    // next: a later commit that touches only results/ leaves the build frozen.
    const s = situation();
    if (!s.clean || s.head === "" || !args.by) {
      console.error("--freeze needs a clean working tree and --by <role> (never a name)");
      process.exit(2);
    }
    writeFileSync(
      FROZEN_RECORD,
      JSON.stringify(
        { commit: s.head, frozenOn: new Date().toISOString().slice(0, 10), by: args.by },
        null,
        2,
      ) + "\n",
    );
    console.log(`Build frozen at ${s.head}. Commit results/p8-build-frozen.json next.`);
    process.exit(0);
  }
  if (args.estimate) {
    const d = await dryRun();
    console.log("DRY RUN, nothing is sent and no budget file is opened.\n");
    console.log("Step 0. Preconditions (P8_MEASUREMENT_PLAN.md §10): run `p8 --check`.");
    for (const step of [1, 2] as const) {
      console.log(`\nStep ${step} (paid), in this order:`);
      for (const c of d.steps[step]) console.log(`  ${show(c)}`);
    }
    console.log("\nStep 3 (free):");
    for (const c of d.step3) console.log(`  ${show(c)}`);
    console.log("\nStep 4 (free): p8 --step 4 --forms <folder outside the repository>");
    console.log(
      `\nBudget: ${d.totals.all.calls} calls, high estimate $${d.totals.all.highUsd.toFixed(4)}, reserved $${d.totals.all.reservedUsd.toFixed(4)} of --total-usd ${TOTAL_USD}: ${d.fits ? "fits" : "DOES NOT FIT"}.`,
    );
    process.exit(d.fits ? 0 : 1);
  }
  if (args.check) {
    const missing = preconditions(situation());
    console.log(
      missing.length === 0 ? "Every precondition is met." : `Missing:\n- ${missing.join("\n- ")}`,
    );
    process.exit(missing.length === 0 ? 0 : 2);
  }
  const step = Number(args.step);
  if (step === 4) {
    if (!args.forms) {
      console.error("--forms <folder outside the repository> is required");
      process.exit(2);
    }
    const r = checkForms(args.forms);
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.complete ? 0 : 1);
  }
  if (step !== 1 && step !== 2 && step !== 3) {
    console.error("--estimate, --check, or --step 1|2|3|4");
    process.exit(2);
  }
  const commands = step === 3 ? STEP3 : paidSteps(await planRuns())[step];
  if (step !== 3) {
    const missing = preconditions(situation());
    if (missing.length > 0) {
      console.error(`Step ${step} is paid and refused. Missing:\n- ${missing.join("\n- ")}`);
      process.exit(2);
    }
  }
  const subst = (c: string) =>
    c === "$B"
      ? process.env.SOMMELIER_EVAL_BUDGET_FILE!
      : c.replace(/^\$O/, process.env.SOMMELIER_EVAL_BLIND_DIR ?? "$O");
  for (const c of commands) {
    const cmd = c.map(subst);
    console.log(`\n$ ${show(cmd)}`);
    const r = spawnSync(cmd[0]!, cmd.slice(1), { cwd: REPO, stdio: "inherit" });
    if (r.status !== 0) {
      console.error(
        `\nSTOPPED at: ${show(cmd)} (exit ${r.status}). Nothing after it was run. Exit 3 is a stop rule or the budget (P8_MEASUREMENT_PLAN.md §9): a person reviews it before anything else.`,
      );
      process.exit(r.status ?? 1);
    }
  }
}

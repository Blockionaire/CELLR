/**
 * THE MENU SET WITH THE MODEL (P8 paid plan): V1 answering the menu question its own way against V1 with the `menu`
 * part, scored per course (menu-score.ts), behind paid.ts's guard (engines/v1plus-ai.ts `paidModel`, unchanged).
 *
 *   pnpm --filter @cellr/sommelier-eval run menu:run --arm <arm> --estimate                   counts, sends nothing
 *   SOMMELIER_EVAL_PAID=owner-approved pnpm --filter @cellr/sommelier-eval run menu:run --arm <arm> \
 *     --max-usd 0.10 --budget-file <outside>/v1plus-budget.json --total-usd 5 --out <file>.json
 *
 * Arms (one call per turn, the scenarios in the set's order, so arms are paired by scenario):
 * - `v1`: no part, the menu question asked as V1 asks it (prompt v6): its ordinary answer, up to three cards;
 * - `menu`: the part on: one wine per course in the same one call;
 * - `check,menu`: the same with prompt v7 and the check;
 * - `per-course`: V1 asked once per course, in a fresh conversation ("Which wine should I open with <course>?"):
 *   N calls for N courses, the way a person without the part would ask (for the cost comparison, and its quality).
 *
 * Each scenario is scored two ways, and both are reported for every arm:
 * - strict (`scoreMenu`): course by course as drawn; an answer that is not drawn as a menu scores every course poor;
 * - by cards (`scoreCards`): for each course, the best of the answer's cards for it, as a person could read V1's
 *   ordinary answer ("open the Chablis for the oysters, the Barolo for the lamb"); for `per-course` the course's own
 *   first card. This is lenient on purpose: it tells whether V1 offered the right wines at all.
 * The labels are the dish cards' (AI-written, R-11); the menu set is not blind.
 */
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { costOf } from "@/server/ai/pricing";
import type { AiResult, LlmProvider } from "@/server/ai/types";
import { RunMonitor, type StopRule } from "./stop-rules";
import { paidModel, type CallRecord } from "./engines/v1plus-ai";
import { askMenuScenario, menuTotals, scoreCourse, scoreMenu, type ScoredMenu } from "./menu-score";
import { BudgetReached, Ledger, paidAllowed } from "./paid";
import { MENU_SCENARIOS, type MenuScenario } from "./scenarios-menu";

export const MENU_ARMS = ["v1", "menu", "check,menu", "per-course"] as const;
export type MenuArm = (typeof MENU_ARMS)[number];

const partsOf = (arm: MenuArm) => (arm === "v1" || arm === "per-course" ? "" : arm);

/** The question per course a person would ask without the part. */
export const perCourseQuestion = (said: string, lang: "en" | "nl") =>
  lang === "nl"
    ? `Welke wijn moet ik openen bij ${said}?`
    : `Which wine should I open with ${said}?`;

/** Lenient: for each course the best of the cards (right over acceptable over poor); none offered: as none. */
export function scoreCards(
  scenario: MenuScenario,
  cards: ReadonlyArray<string | null>,
): ScoredMenu {
  const rank = { right: 0, acceptable: 1, poor: 2 } as const;
  const courses = scenario.courses.map((c, i) => {
    const options = (cards.length > 0 ? cards : [null]).map((k) =>
      scoreCourse(scenario, i, k, c.said),
    );
    return options.reduce((best, x) => (rank[x.score] < rank[best.score] ? x : best));
  });
  const count = (s: "right" | "acceptable" | "poor") => courses.filter((c) => c.score === s).length;
  return {
    id: scenario.id,
    menuShown: false,
    courses,
    right: count("right"),
    acceptable: count("acceptable"),
    poor: count("poor"),
  };
}

/** A stop rule fired mid-run (stop-rules.ts): the run ends here, incomplete. */
export class StoppedByRule extends Error {
  constructor(readonly rule: StopRule) {
    super(`STOPPED: ${rule}`);
  }
}

export interface MenuArmScenario {
  id: string;
  /** The questions asked: one model call each at most (the cost criterion). */
  questions: number;
  strict: ScoredMenu;
  byCards: ScoredMenu;
  calls: CallRecord[];
}

/** One arm over the menu set with the given model (an estimate, a paid provider, or a test's fake). */
export async function runMenuArm(
  arm: MenuArm,
  llm: LlmProvider,
  monitor: RunMonitor | null = null,
): Promise<MenuArmScenario[]> {
  const out: MenuArmScenario[] = [];
  for (const s of MENU_SCENARIOS) {
    const calls: CallRecord[] = [];
    const counted: LlmProvider = {
      async generateObject(request) {
        const result = await llm.generateObject(request);
        calls.push({
          promptChars:
            request.system.length + request.user.length + JSON.stringify(request.jsonSchema).length,
          maxOutputTokens: request.maxOutputTokens,
          tokensIn: result.usage.tokensIn,
          tokensOut: result.usage.tokensOut,
          ok: result.ok,
          usdMicro: costOf(result.usage).usdMicro,
          servedModel: result.usage.servedModel ?? null,
        });
        monitor?.call(result as AiResult<unknown>);
        if (monitor?.stopped) throw new StoppedByRule(monitor.stopped.rule);
        return result;
      },
    };
    if (arm === "per-course") {
      const firsts: Array<string | null> = [];
      for (const c of s.courses) {
        const one: MenuScenario = { ...s, turns: [{ user: perCourseQuestion(c.said, s.lang) }] };
        const { answer, keyOf } = await askMenuScenario(one, "", counted);
        const first = answer.bottles[0]?.vintageId;
        firsts.push(first ? (keyOf(first) ?? "?") : null);
      }
      const courses = s.courses.map((c, i) => scoreCourse(s, i, firsts[i] ?? null, c.said));
      const scored: ScoredMenu = {
        id: s.id,
        menuShown: false,
        courses,
        right: courses.filter((c) => c.score === "right").length,
        acceptable: courses.filter((c) => c.score === "acceptable").length,
        poor: courses.filter((c) => c.score === "poor").length,
      };
      out.push({ id: s.id, questions: s.courses.length, strict: scored, byCards: scored, calls });
      continue;
    }
    const { answer, keyOf } = await askMenuScenario(s, partsOf(arm), counted);
    const firstCard = answer.bottles[0]?.vintageId ?? null;
    const strict = scoreMenu(s, { menu: answer.menu ?? null, firstCard }, keyOf);
    const cards = answer.bottles.map((b) => keyOf(b.vintageId) ?? "?");
    out.push({
      id: s.id,
      questions: s.turns.length,
      strict,
      byCards: s.followUp ? strict : scoreCards(s, cards),
      calls,
    });
  }
  return out;
}

export const armTotals = (rows: readonly MenuArmScenario[]) => ({
  strict: menuTotals(rows.map((r) => r.strict)),
  byCards: menuTotals(rows.map((r) => r.byCards)),
  calls: rows.reduce((n, r) => n + r.calls.length, 0),
  tokensIn: rows.reduce((n, r) => n + r.calls.reduce((m, c) => m + c.tokensIn, 0), 0),
  tokensOut: rows.reduce((n, r) => n + r.calls.reduce((m, c) => m + c.tokensOut, 0), 0),
});

/** What one arm would send and reserve: calls, the high estimate and the reservations, in micro-dollars. */
export async function estimateMenuArm(arm: MenuArm) {
  const paid = paidModel({ estimate: true, maxUsd: 1, engine: "menu:run" });
  await runMenuArm(arm, paid.llm);
  return {
    arm,
    calls: paid.meter.calls,
    inputTokens: paid.meter.inputTokens,
    outputTokensAllowance: paid.meter.outputTokens,
    highMicro: paid.meter.usdMicro,
    reservedMicro: paid.meter.reservationsMicro,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values: args } = parseArgs({
    options: {
      arm: { type: "string" },
      estimate: { type: "boolean", default: false },
      "max-usd": { type: "string", default: "0.10" },
      "budget-file": { type: "string" },
      "total-usd": { type: "string" },
      out: { type: "string" },
    },
  });
  const arm = MENU_ARMS.find((a) => a === args.arm);
  if (!arm) {
    console.error(`--arm must be one of: ${MENU_ARMS.join(", ")}`);
    process.exit(2);
  }
  const maxUsd = Number(args["max-usd"]);
  let ledger: Ledger | null = null;
  let paid;
  try {
    if (!Number.isFinite(maxUsd) || maxUsd <= 0 || maxUsd > 25)
      throw new Error("--max-usd must be a number of dollars between 0 and 25");
    // An estimate never opens (or creates) the budget file, nor does a run that may not spend.
    if (!args.estimate && args["budget-file"] && paidAllowed(process.env)) {
      const totalUsd = Number(args["total-usd"]);
      if (!Number.isFinite(totalUsd) || totalUsd <= 0 || totalUsd > 25)
        throw new Error("--total-usd must be a number of dollars between 0 and 25");
      ledger = Ledger.open(args["budget-file"], Math.round(totalUsd * 1e6));
    }
    paid = paidModel({ estimate: args.estimate!, maxUsd, ledger, engine: "menu:run" });
  } catch (error) {
    console.error((error as Error).message);
    process.exit(2);
  }
  let rows: MenuArmScenario[] = [];
  let incomplete = false;
  let stopped: StopRule | null = null;
  const monitor = new RunMonitor(paid.model, paid.mode === "paid");
  try {
    rows = await runMenuArm(arm, paid.llm, monitor);
  } catch (error) {
    if (error instanceof StoppedByRule) stopped = error.rule;
    else if (error instanceof BudgetReached) stopped = "budget";
    else throw error;
    incomplete = true;
    console.error(`STOPPED: ${stopped}. INCOMPLETE RUN: not a measurement.`);
  }
  monitor.end();
  if (monitor.stopped && !stopped) {
    stopped = monitor.stopped.rule;
    incomplete = true;
    console.error(
      `STOPPED: ${stopped} (${monitor.stopped.detail}). INCOMPLETE RUN: not a measurement.`,
    );
  }
  if (paid.meter.stopped) {
    incomplete = true;
    stopped ??= "budget";
  }
  const m = paid.meter;
  if (paid.mode === "estimate") {
    console.log(
      `ESTIMATE ONLY, nothing was sent. Menu set, arm "${arm}": ${m.calls} calls; high estimate $${(m.usdMicro / 1e6).toFixed(4)}; reserved call by call $${(m.reservationsMicro / 1e6).toFixed(4)}.`,
    );
    process.exit(0);
  }
  const totals = armTotals(rows);
  console.log(
    JSON.stringify({ arm, incomplete, stopped, ...totals, usd: m.usdMicro / 1e6 }, null, 2),
  );
  if (args.out)
    await writeFile(
      args.out,
      JSON.stringify(
        {
          set: "menu",
          arm,
          model: paid.model,
          servedModels: [...monitor.served].sort(),
          incomplete,
          stopped,
          totals,
          rows,
        },
        null,
        2,
      ) + "\n",
    );
  ledger?.end(!incomplete);
  if (incomplete) process.exitCode = 3;
}

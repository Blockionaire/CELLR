/**
 * WHAT A MENU COSTS (P8, free estimate): one menu question with the `menu` part against the same menu asked the V1
 * way, one ordinary question per course; and one ordinary question per part against V1. Built with the app's own
 * service and prompt code (bench-harness.ts), priced with its own price list (pricing.ts). Nothing is sent.
 *
 *   pnpm --filter @cellr/sommelier-eval run menu:cost [--json <file>]
 *
 * Two estimates per call:
 * - high: pricing.ts `estimateCost`, the platform's planning number: input at ~3 characters a token, the FULL output
 *   allowance (900 tokens; a new menu 900 + 70 a course, at most +600), two attempts;
 * - typical: one attempt, input at ~3 characters a token, and a typical answer's output: 180 tokens for an ordinary
 *   answer (four short sentences, three refs, the verdict, JSON keys) and 45 more per course for a menu (one entry:
 *   the course number, a 6-character ref and one short sentence of about 25 words, ~35 tokens, plus ~10 of JSON).
 *   This is an assumption, not a measurement: the paid plan records tokens in and out per call
 *   (engines/v1plus-ai.ts `CallRecord`, menu-run.ts) so the criterion below can be checked on real numbers.
 *
 * The proposed criterion for menus (`MENU_COST_CRITERION`) is a PROPOSAL for the owner; the general +10% per
 * ordinary answer is not relaxed by it.
 */
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { planCall } from "@/server/ai/models";
import { estimateCost, priceOf, PRICING_VERSION } from "@/server/ai/pricing";
import type { GenerateObjectRequest, LlmProvider } from "@/server/ai/types";
import { getAiEnv } from "@/server/env";
import { benchCellar, type BenchCellar } from "./bench-cellar";
import type { ChatMessage } from "@cellr/domain";
import { benchService, CONFIGS, fakeModel, messagesFor, QUESTIONS } from "./bench-harness";
import { promptRows, type PromptRow } from "./bench-prompt";
import { TYPICAL_OUTPUT } from "./bench-prompt";

export const MENU_DISHES = [
  "oysters",
  "smoked salmon",
  "mushroom risotto",
  "sole meunière",
  "duck breast with cherry sauce",
  "roast lamb",
  "aged Gouda",
  "crème brûlée",
] as const;

/** A menu of `n` courses, one per line, as a person would type it. */
export const menuQuestion = (n: number) =>
  `Our menu:\n${MENU_DISHES.slice(0, n)
    .map((d) => `- ${d}`)
    .join("\n")}\nWhat should we pour with each?`;
/** The same course asked the V1 way, alone. */
export const courseQuestion = (dish: string) => `Which wine should I open with ${dish}?`;

export interface CallCost {
  promptChars: number;
  tokensIn: number;
  maxOutputTokens: number;
  typicalTokensOut: number;
  highMicro: number;
  typicalMicro: number;
}

/** Every model call the service makes for one question (the fake model answers each at once). */
export async function requestsFor(
  cellar: BenchCellar,
  parts: string,
  text: string,
  history: readonly ChatMessage[] = [],
) {
  const seen: GenerateObjectRequest<unknown>[] = [];
  const fake = fakeModel();
  const provider: LlmProvider = {
    generateObject: (request) => {
      seen.push(request as GenerateObjectRequest<unknown>);
      return fake.generateObject(request);
    },
  };
  await benchService(cellar, parts, { llm: true, provider }).ask({
    messages: [...history, { role: "user", text }],
    mode: "chat",
  });
  return seen;
}

async function requestFor(
  cellar: BenchCellar,
  parts: string,
  text: string,
  history: readonly ChatMessage[] = [],
) {
  const seen = await requestsFor(cellar, parts, text, history);
  if (seen.length !== OWNER_MENU_CRITERION.calls)
    throw new Error(`${seen.length} calls for one question, expected one`);
  return seen[0]!;
}

function costOfCall(request: GenerateObjectRequest<unknown>, courses: number): CallCost {
  const env = getAiEnv();
  const plan = planCall(env, request);
  const price = priceOf(plan.model)!;
  const promptChars =
    request.system.length + request.user.length + JSON.stringify(request.jsonSchema).length;
  const tokensIn = Math.ceil(promptChars / 3);
  const planned = plan.maxOutputTokens > 900;
  const typicalTokensOut = TYPICAL_OUTPUT.base + (planned ? courses * TYPICAL_OUTPUT.perCourse : 0);
  return {
    promptChars,
    tokensIn,
    maxOutputTokens: plan.maxOutputTokens,
    typicalTokensOut,
    highMicro: estimateCost({
      model: plan.model,
      promptChars,
      images: 0,
      maxOutputTokens: plan.maxOutputTokens,
      webSearch: false,
    }),
    typicalMicro: Math.ceil(tokensIn * price.input + typicalTokensOut * price.output),
  };
}

const pct = (x: number, base: number) => Math.round((1000 * (x - base)) / base) / 10;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

export async function menuCostTable(sizes: readonly number[] = [25, 120, 500]) {
  const ordinary = [];
  const menus = [];
  for (const wines of sizes) {
    const cellar = benchCellar(wines);
    // (a) One ordinary question, per part and all parts, against V1.
    const v1 = costOfCall(await requestFor(cellar, "", QUESTIONS.pairing), 0);
    for (const c of CONFIGS) {
      const x =
        c.parts === "" ? v1 : costOfCall(await requestFor(cellar, c.parts, QUESTIONS.pairing), 0);
      ordinary.push({
        wines,
        config: c.name,
        ...x,
        vsV1: {
          highPct: pct(x.highMicro, v1.highMicro),
          typicalPct: pct(x.typicalMicro, v1.typicalMicro),
        },
      });
    }
    // (b, c, d) A menu of 2, 3, 5 and 8 courses: one call with the part, and N separate V1 questions.
    for (const n of [2, 3, 5, 8]) {
      const separate = await Promise.all(
        MENU_DISHES.slice(0, n).map(async (d) =>
          costOfCall(await requestFor(cellar, "", courseQuestion(d)), 0),
        ),
      );
      const sum = (f: (c: CallCost) => number) => separate.reduce((s, c) => s + f(c), 0);
      const perCourse = {
        calls: n,
        tokensIn: sum((c) => c.tokensIn),
        tokensOutMax: sum((c) => c.maxOutputTokens),
        tokensOutTypical: sum((c) => c.typicalTokensOut),
        highMicro: sum((c) => c.highMicro),
        typicalMicro: sum((c) => c.typicalMicro),
      };
      for (const parts of ["menu", "check,menu"]) {
        const one = costOfCall(await requestFor(cellar, parts, menuQuestion(n)), n);
        menus.push({
          wines,
          courses: n,
          parts,
          menu: { calls: 1, ...one },
          perCourseV1: perCourse,
          oneOrdinaryV1: { highMicro: v1.highMicro, typicalMicro: v1.typicalMicro },
          ratios: {
            highShareOfSeparate: r3(one.highMicro / perCourse.highMicro),
            typicalShareOfSeparate: r3(one.typicalMicro / perCourse.typicalMicro),
            highTimesOrdinary: r3(one.highMicro / v1.highMicro),
            typicalTimesOrdinary: r3(one.typicalMicro / v1.typicalMicro),
            highPerCourseMicro: Math.round(one.highMicro / n),
            typicalPerCourseMicro: Math.round(one.typicalMicro / n),
            separatePerCourseHighMicro: Math.round(perCourse.highMicro / n),
            separatePerCourseTypicalMicro: Math.round(perCourse.typicalMicro / n),
          },
        });
      }
    }
  }
  return { pricingVersion: PRICING_VERSION, typicalOutput: TYPICAL_OUTPUT, ordinary, menus };
}

/**
 * THE EARLIER PROPOSAL (P8 first round), kept as INFORMATION ONLY: the owner set another criterion on 2026-11-24
 * (`OWNER_MENU_CRITERION` below), which is the one tested. The general +10% for an ordinary answer stands. With `menu` on (with or without `check`), one menu question of N courses (2 to 8), on the app's high
 * estimate AND on the typical estimate:
 *
 * 1. it costs at most 70% of the same menu asked the V1 way, as N separate ordinary questions; and
 * 2. it costs at most (1.2 + 0.075 × N) times one ordinary V1 answer in the same cellar (1.35× for two courses,
 *    1.425× for three, 1.575× for five, 1.8× for eight).
 *
 * Measured (free estimate, cellars of 25, 120 and 500 wines): at most 64% of the separate questions (two courses, 25
 * wines, typical; three courses at most 45%, eight at most 21%) and at most 1.27× / 1.33× / 1.46× / 1.64× one
 * ordinary answer for 2 / 3 / 5 / 8 courses (25 wines, typical, check and menu). The margins (0.06 to 0.16) are for
 * real token counts, which the paid plan records per call so the criterion can be checked on them.
 */
export const MENU_COST_CRITERION = {
  maxShareOfSeparate: 0.7,
  timesOrdinary: { base: 1.2, perCourse: 0.075 },
} as const;
export const maxTimesOrdinary = (courses: number) =>
  MENU_COST_CRITERION.timesOrdinary.base + MENU_COST_CRITERION.timesOrdinary.perCourse * courses;

export function criterionMet(table: Awaited<ReturnType<typeof menuCostTable>>) {
  const over = table.menus.filter(
    (m) =>
      m.ratios.highShareOfSeparate > MENU_COST_CRITERION.maxShareOfSeparate ||
      m.ratios.typicalShareOfSeparate > MENU_COST_CRITERION.maxShareOfSeparate ||
      m.ratios.highTimesOrdinary > maxTimesOrdinary(m.courses) ||
      m.ratios.typicalTimesOrdinary > maxTimesOrdinary(m.courses),
  );
  return { met: over.length === 0, over };
}

// ---- The owner's provisional criterion (2026-11-24), the one tested -------------------------------------------

/**
 * THE OWNER'S PROVISIONAL MENU COST CRITERION (2026-11-24; a starting point, not an authorisation to spend): a menu
 * question of up to eight courses makes ONE model call, and its WORST-CASE cost (the app's high estimate,
 * `estimateCost`: the full output allowance, both attempts) is at most 1.5 times the worst-case cost of one ordinary
 * V1 answer (prompt v6, no part) to an ordinary question in the same cellar and the same conversation. For an
 * ordinary question the limit stays +10% (not relaxed).
 */
export const OWNER_MENU_CRITERION = {
  calls: 1,
  maxWorstCaseTimesOrdinary: 1.5,
  maxCourses: 8,
  ordinaryMaxIncreasePct: 10,
} as const;

export const OWNER_SIZES = [25, 120, 500, 3000] as const;
export const OWNER_COURSES = [2, 3, 4, 5, 6, 7, 8] as const;
/** The conversation before the question: none, or the 11 messages of the latency bench (12 with the question). */
const historyOf = (messages: 1 | 12): ChatMessage[] =>
  messages === 1 ? [] : messagesFor("pairing", 12).slice(0, -1);

/** The per-course output allowance (tokens) at which one cell's ratio would reach the limit exactly. */
function allowanceAtLimit(menu: CallCost, ordinaryHighMicro: number, courses: number) {
  const env = getAiEnv();
  const price = priceOf(
    planCall(env, { model: "chat", task: "sommelier_chat", maxOutputTokens: 900 }).model,
  )!;
  // estimateCost: two attempts of (input + the full output allowance), the same price list.
  const budget = (OWNER_MENU_CRITERION.maxWorstCaseTimesOrdinary * ordinaryHighMicro) / 2;
  const outTokens = (budget - menu.tokensIn * price.input) / price.output;
  return Math.floor((outTokens - 900) / courses);
}

export async function ownerCriterionTable() {
  const cells = [];
  for (const wines of OWNER_SIZES) {
    const cellar = benchCellar(wines);
    for (const messages of [1, 12] as const) {
      const history = historyOf(messages);
      const ordinary = costOfCall(await requestFor(cellar, "", QUESTIONS.pairing, history), 0);
      for (const courses of OWNER_COURSES)
        for (const parts of ["menu", "check,menu"]) {
          // requestFor throws unless the service made exactly one model call for the question.
          const menu = costOfCall(
            await requestFor(cellar, parts, menuQuestion(courses), history),
            courses,
          );
          let separateHigh = 0;
          for (const d of MENU_DISHES.slice(0, courses))
            separateHigh += costOfCall(
              await requestFor(cellar, "", courseQuestion(d), history),
              0,
            ).highMicro;
          const ratio = menu.highMicro / ordinary.highMicro;
          cells.push({
            wines,
            messages,
            courses,
            parts,
            calls: 1,
            menuTokensIn: menu.tokensIn,
            menuOutputCap: menu.maxOutputTokens,
            menuHighMicro: menu.highMicro,
            ordinaryHighMicro: ordinary.highMicro,
            ratio: r3(ratio),
            headroom: r3(OWNER_MENU_CRITERION.maxWorstCaseTimesOrdinary - ratio),
            /** Information only: the same menu as N separate V1 questions in the same conversation. */
            shareOfSeparate: r3(menu.highMicro / separateHigh),
            perCourseAllowanceAtLimit: allowanceAtLimit(menu, ordinary.highMicro, courses),
          });
        }
    }
  }
  const worst = cells.reduce((a, b) => (b.ratio > a.ratio ? b : a));
  return {
    criterion: OWNER_MENU_CRITERION,
    cells,
    maxRatio: worst.ratio,
    at: {
      wines: worst.wines,
      messages: worst.messages,
      courses: worst.courses,
      parts: worst.parts,
    },
    minHeadroom: r3(OWNER_MENU_CRITERION.maxWorstCaseTimesOrdinary - worst.ratio),
    over: cells.filter((c) => c.ratio > OWNER_MENU_CRITERION.maxWorstCaseTimesOrdinary),
    /** The largest per-course output allowance (the app's is 70) that keeps every cell within the limit. */
    perCourseAllowanceAtLimit: Math.min(...cells.map((c) => c.perCourseAllowanceAtLimit)),
  };
}

/** The +10% for ordinary questions, per part and for all parts, in the same cells: on cost (the criterion) and on characters (information). */
export async function ordinaryTable() {
  const rows: PromptRow[] = [];
  for (const wines of OWNER_SIZES)
    for (const messages of [1, 12] as const)
      rows.push(
        ...(await promptRows(wines, messages, ["pairing", "serving", "pairing-guests", "compare"])),
      );
  const pick = (f: (r: PromptRow) => number) => {
    const r = rows.reduce((a, b) => (f(b) > f(a) ? b : a));
    return {
      pct: f(r),
      wines: r.wines,
      messages: r.messages,
      question: r.question,
      config: r.config,
    };
  };
  return {
    rows: rows.map((r) => ({
      wines: r.wines,
      messages: r.messages,
      question: r.question,
      config: r.config,
      calls: r.calls,
      costPct: r.vsV1.highMicro,
      charsPct: r.vsV1.promptChars,
    })),
    maxCost: pick((r) => r.vsV1.highMicro),
    maxChars: pick((r) => r.vsV1.promptChars),
    overOnCost: rows.filter((r) => r.vsV1.highMicro > OWNER_MENU_CRITERION.ordinaryMaxIncreasePct)
      .length,
    overOnCharacters: rows.filter(
      (r) => r.vsV1.promptChars > OWNER_MENU_CRITERION.ordinaryMaxIncreasePct,
    ).length,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values: args } = parseArgs({ options: { json: { type: "string" } } });
  const t = await menuCostTable();
  const usd = (m: number) => `$${(m / 1e6).toFixed(5)}`;
  console.log(`ESTIMATE ONLY, nothing was sent (pricing ${t.pricingVersion}).\n`);
  console.log("(a) One ordinary pairing question, against V1:");
  console.log(
    "| Wines | Configuration | Tokens in | Output cap | High | Typical | Δ high | Δ typical |",
  );
  console.log("| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const r of t.ordinary)
    console.log(
      `| ${r.wines} | ${r.config} | ${r.tokensIn} | ${r.maxOutputTokens} | ${usd(r.highMicro)} | ${usd(r.typicalMicro)} | ${r.vsV1.highPct}% | ${r.vsV1.typicalPct}% |`,
    );
  console.log("\n(b-d) One menu question with the part against N separate V1 questions:");
  console.log(
    "| Wines | Courses | Parts | Menu: calls / tokens in / cap / typical out | Menu high | Menu typical | V1 per course: calls / tokens in / typical out | V1 per course high | V1 per course typical | Share of separate (high / typical) | × one ordinary V1 (high / typical) |",
  );
  console.log("| ---: | ---: | --- | --- | ---: | ---: | --- | ---: | ---: | --- | --- |");
  for (const m of t.menus)
    console.log(
      `| ${m.wines} | ${m.courses} | ${m.parts} | 1 / ${m.menu.tokensIn} / ${m.menu.maxOutputTokens} / ${m.menu.typicalTokensOut} | ${usd(m.menu.highMicro)} | ${usd(m.menu.typicalMicro)} | ${m.perCourseV1.calls} / ${m.perCourseV1.tokensIn} / ${m.perCourseV1.tokensOutTypical} | ${usd(m.perCourseV1.highMicro)} | ${usd(m.perCourseV1.typicalMicro)} | ${m.ratios.highShareOfSeparate} / ${m.ratios.typicalShareOfSeparate} | ${m.ratios.highTimesOrdinary} / ${m.ratios.typicalTimesOrdinary} |`,
    );
  const c = criterionMet(t);
  console.log(
    `\nProposed criterion (≤ ${MENU_COST_CRITERION.maxShareOfSeparate * 100}% of N separate V1 questions, ≤ (1.2 + 0.075 × N) × one ordinary V1 answer): ${c.met ? "met" : `NOT met in ${c.over.length} rows`}.`,
  );
  const owner = await ownerCriterionTable();
  console.log(
    `\nThe owner's provisional criterion (2026-11-24): one call, worst case at most ${OWNER_MENU_CRITERION.maxWorstCaseTimesOrdinary} x one ordinary V1 answer (same cellar and conversation).`,
  );
  console.log(`| Wines | Msgs | Parts | ${OWNER_COURSES.map((n) => `${n} courses`).join(" | ")} |`);
  console.log(`| ---: | ---: | --- | ${OWNER_COURSES.map(() => "---:").join(" | ")} |`);
  for (const wines of OWNER_SIZES)
    for (const messages of [1, 12])
      for (const parts of ["menu", "check,menu"]) {
        const ratios = OWNER_COURSES.map(
          (n) =>
            owner.cells.find(
              (x) =>
                x.wines === wines &&
                x.messages === messages &&
                x.parts === parts &&
                x.courses === n,
            )!.ratio,
        );
        console.log(`| ${wines} | ${messages} | ${parts} | ${ratios.join(" | ")} |`);
      }
  console.log(
    `Max ratio ${owner.maxRatio} (${owner.at.courses} courses, ${owner.at.wines} wines, ${owner.at.messages} msg, ${owner.at.parts}); headroom ${owner.minHeadroom}; cells over: ${owner.over.length}. Per-course output allowance at which the worst cell would reach the limit: ${owner.perCourseAllowanceAtLimit} tokens (the app's is 70).`,
  );
  const ordinary = await ordinaryTable();
  console.log(
    `Ordinary questions (pairing, serving, guests, comparison; each part and all parts; ${OWNER_SIZES.join(", ")} wines; 1 and 12 messages): max +${ordinary.maxCost.pct}% on cost (${ordinary.maxCost.question}, ${ordinary.maxCost.config}, ${ordinary.maxCost.wines} wines, ${ordinary.maxCost.messages} msg), ${ordinary.overOnCost} cells over +10% on cost. On characters, for information: max +${ordinary.maxChars.pct}% (${ordinary.maxChars.question}, ${ordinary.maxChars.config}, ${ordinary.maxChars.wines} wines, ${ordinary.maxChars.messages} msg), ${ordinary.overOnCharacters} cells over +10%.`,
  );
  if (args.json)
    await writeFile(
      args.json,
      JSON.stringify(
        { ...t, earlierProposal: { criterion: MENU_COST_CRITERION, met: c.met }, owner, ordinary },
        null,
        2,
      ) + "\n",
    );
}

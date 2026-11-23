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
import { benchService, CONFIGS, fakeModel, QUESTIONS } from "./bench-harness";
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

async function requestFor(cellar: BenchCellar, parts: string, text: string) {
  const seen: GenerateObjectRequest<unknown>[] = [];
  const fake = fakeModel();
  const provider: LlmProvider = {
    generateObject: (request) => {
      seen.push(request as GenerateObjectRequest<unknown>);
      return fake.generateObject(request);
    },
  };
  await benchService(cellar, parts, { llm: true, provider }).ask({
    messages: [{ role: "user", text }],
    mode: "chat",
  });
  if (seen.length !== 1) throw new Error(`${seen.length} calls for one question, expected one`);
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
 * PROPOSED COST CRITERION FOR A MENU (for the owner to accept or change; the general +10% for an ordinary answer
 * stands). With `menu` on (with or without `check`), one menu question of N courses (2 to 8), on the app's high
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
  if (args.json)
    await writeFile(
      args.json,
      JSON.stringify({ ...t, criterion: MENU_COST_CRITERION, met: c.met }, null, 2) + "\n",
    );
}

/**
 * THE MENU SET, FREE PART (V1+ P6, prepared in P8): a scorer for one menu answer, and what one paid run of the menu
 * set would send. Nothing here calls a model.
 *
 *   pnpm --filter @cellr/sommelier-eval run menu --estimate          what one run of the 18 menus would send and cost (nothing is sent)
 *   ... --json <file>                                                also as JSON
 *
 * Without `--estimate` it refuses: the paid menu run is not wired (it needs the owner's budget approval, D-51,
 * and the guard of paid.ts around it). The scorer is what that run will use.
 *
 * Scoring one course against scenarios-menu.ts (`menuExpectations`: the labels are the dish cards', AI-written):
 *
 * | The cellar has                 | The answer's wine for the course      | Score      |
 * | ------------------------------ | ------------------------------------- | ---------- |
 * | a good wine (level "good")     | a good one / an ok one / none or poor | right / acceptable / poor |
 * | only ok wines (level "ok")     | an ok one / none / a poor one         | right / acceptable / poor |
 * | nothing that suits ("none")    | none / any wine                       | right / poor |
 * | an unreadable course ("any")   | anything, as long as the course is said as the person said it | right |
 *
 * A course the answer leaves out (fewer courses than the menu), or says in other words than the person did, is
 * poor. A wine that is not in the scenario's cellar (it cannot be: checkMenuAnswer drops it) would be poor. A
 * follow-up scenario (`followUp`) is scored on the follow-up's first card, for that one course.
 */
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  normalizeText,
  parseSommelierParts,
  type CellarItem,
  type MenuAdvice,
} from "@cellr/domain";
import { planCall } from "@/server/ai/models";
import { PRICING_VERSION } from "@/server/ai/pricing";
import type { LlmProvider } from "@/server/ai/types";
import { aggregateInventory, buildTonight } from "@/server/cellar/service";
import { getAiEnv } from "@/server/env";
import { createSommelierService } from "@/server/sommelier/service";
import { buildFixture, NOW } from "./fixtures";
import { estimating, newMeter } from "./paid";
import { MENU_SCENARIOS, menuDishOf, menuExpectations, type MenuScenario } from "./scenarios-menu";

export type CourseScore = "right" | "acceptable" | "poor";

export interface ScoredCourse {
  course: number;
  said: string;
  level: "good" | "ok" | "none" | "any";
  /** The benchmark key of the wine the answer gave it; null: none; "?" a wine not in the cellar. */
  wine: string | null;
  score: CourseScore;
  /** Why, in a few words (for the report of a readable set). */
  because: string;
}

export interface ScoredMenu {
  id: string;
  /** The answer was drawn as a menu (one row per course). Always true for a follow-up scored on its card. */
  menuShown: boolean;
  courses: ScoredCourse[];
  right: number;
  acceptable: number;
  poor: number;
}

const same = (a: string, b: string) => normalizeText(a) === normalizeText(b);

/** One course: its expectation, and the wine the answer gave it. */
export function scoreCourse(
  scenario: MenuScenario,
  index: number,
  wine: string | null,
  said: string | null,
): ScoredCourse {
  const expected = menuExpectations(scenario)[index]!;
  const course = scenario.courses[index]!;
  const base = { course: index + 1, said: course.said, level: expected.level, wine };
  if (said === null) return { ...base, score: "poor", because: "course left out" };
  if (!same(said, course.said)) return { ...base, score: "poor", because: `said as "${said}"` };
  if (wine === "?") return { ...base, score: "poor", because: "a wine not in the cellar" };
  if (expected.level === "any")
    return { ...base, score: "right", because: "unreadable course, said as it was" };
  const card = menuDishOf(course.dish!);
  if (expected.level === "none")
    return wine === null
      ? { ...base, score: "right", because: "honestly none" }
      : { ...base, score: "poor", because: "a wine forced on a course nothing suits" };
  if (wine === null)
    return expected.level === "ok"
      ? { ...base, score: "acceptable", because: "none, where a wine would do" }
      : { ...base, score: "poor", because: "none, where a good wine is in the cellar" };
  if (card.good.includes(wine)) return { ...base, score: "right", because: "a good wine for it" };
  if (card.ok.includes(wine))
    return expected.level === "ok"
      ? { ...base, score: "right", because: "the best the cellar has" }
      : { ...base, score: "acceptable", because: "will do; a better wine is in the cellar" };
  return { ...base, score: "poor", because: "a poor wine for it" };
}

/**
 * One scenario's answer. `menu` is the answer's `MenuAdvice` (absent when it was not drawn as a menu), `firstCard`
 * the vintage of its first card (for a follow-up), `keyOf` the benchmark key of a vintage of the scenario's cellar.
 */
export function scoreMenu(
  scenario: MenuScenario,
  answer: { menu?: MenuAdvice | null; firstCard?: string | null },
  keyOf: (vintageId: string) => string | null,
): ScoredMenu {
  const key = (id: string | null | undefined) => (id ? (keyOf(id) ?? "?") : null);
  let courses: ScoredCourse[];
  let menuShown: boolean;
  if (scenario.followUp) {
    const i = scenario.followUp.course - 1;
    courses = [scoreCourse(scenario, i, key(answer.firstCard), scenario.courses[i]!.said)];
    menuShown = true;
  } else {
    const given = answer.menu?.courses ?? [];
    menuShown = given.length > 0;
    courses = scenario.courses.map((_, i) =>
      scoreCourse(scenario, i, key(given[i]?.vintageId), given[i]?.said ?? null),
    );
  }
  const count = (s: CourseScore) => courses.filter((c) => c.score === s).length;
  return {
    id: scenario.id,
    menuShown,
    courses,
    right: count("right"),
    acceptable: count("acceptable"),
    poor: count("poor"),
  };
}

export function menuTotals(scored: readonly ScoredMenu[]) {
  const courses = scored.flatMap((s) => s.courses);
  const n = courses.length;
  const of = (s: CourseScore) => courses.filter((c) => c.score === s).length;
  return {
    scenarios: scored.length,
    shownAsMenu: scored.filter((s) => s.menuShown).length,
    courses: n,
    right: of("right"),
    acceptable: of("acceptable"),
    poor: of("poor"),
    /** Every course right or acceptable. */
    scenariosWithoutPoor: scored.filter((s) => s.poor === 0).length,
  };
}

/**
 * A menu scenario put to the app's own service, turn by turn as the screen asks (each answer's words sent back
 * with the next question), with the fixture cellar of fixtures.ts. Returns the last answer and the cellar's keys.
 */
export async function askMenuScenario(
  scenario: MenuScenario,
  parts: string,
  llm: LlmProvider | null,
) {
  const fixture = buildFixture({ cellar: scenario.cellar });
  const items = (): CellarItem[] => aggregateInventory(fixture.rows, new Set(), [], NOW).items;
  const service = createSommelierService({
    cellar: async () => ({ items: items(), bottleCount: fixture.rows.length }),
    storage: async () => [],
    racks: async () => ({ units: [], unplaced: [] }),
    tonight: async (request, taste) =>
      buildTonight(fixture.rows, new Set(), [], request, NOW, taste ?? null),
    llm,
    parts: parseSommelierParts(parts),
    profiles: async () => new Map(),
    now: () => NOW,
    spend: async () => {},
    householdId: async () => "00000000-0000-4000-8000-0000000000aa",
    locale: async () => scenario.lang,
    recordUsage: async () => {},
  });
  const said: Array<{ role: "user" | "assistant"; text: string }> = [];
  let answer: Awaited<ReturnType<typeof service.ask>> | null = null;
  for (const turn of scenario.turns) {
    said.push({ role: "user", text: turn.user.slice(0, 800) });
    answer = await service.ask({ messages: said.slice(-12), mode: "chat" });
    said.push({ role: "assistant", text: (answer.text ?? "…").slice(0, 2000) });
  }
  return { answer: answer!, keyOf: (id: string) => fixture.keyOfVintage.get(id) ?? null };
}

/** What one run of the menu set would send with these parts on: built by the app, counted, never sent. */
export async function estimateMenuRun(parts: string) {
  const env = getAiEnv();
  const meter = newMeter();
  const llm = estimating(env, meter);
  let promptChars = 0;
  let maxOutput = 0;
  const counting: LlmProvider = {
    generateObject: (request) => {
      promptChars +=
        request.system.length + request.user.length + JSON.stringify(request.jsonSchema).length;
      maxOutput = Math.max(maxOutput, planCall(env, request).maxOutputTokens);
      return llm.generateObject(request);
    },
  };
  for (const s of MENU_SCENARIOS) await askMenuScenario(s, parts, counting);
  return {
    parts: parts === "" ? "(none: V1)" : parts,
    scenarios: MENU_SCENARIOS.length,
    turns: MENU_SCENARIOS.reduce((n, s) => n + s.turns.length, 0),
    calls: meter.calls,
    promptChars,
    inputTokens: meter.inputTokens,
    outputTokensAllowance: meter.outputTokens,
    largestOutputAllowance: maxOutput,
    highEstimateUsd: Math.round(meter.usdMicro) / 1e6,
    reservedUsd: Math.round(meter.reservationsMicro) / 1e6,
    sent: 0,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values: args } = parseArgs({
    options: { estimate: { type: "boolean", default: false }, json: { type: "string" } },
  });
  if (!args.estimate) {
    console.error(
      "The paid run of the menu set is not wired here: it needs the owner's budget approval (D-51). Run with --estimate (nothing is sent).",
    );
    process.exit(2);
  }
  const env = getAiEnv();
  const runs = [];
  for (const parts of ["", "menu", "check,menu", "check,annotate,quantities,menu"])
    runs.push(await estimateMenuRun(parts));
  console.log(
    `ESTIMATE ONLY, nothing was sent. Menu set: ${MENU_SCENARIOS.length} scenarios; model ${planCall(env, { model: "chat", task: "sommelier_chat", maxOutputTokens: 900 }).model}, pricing ${PRICING_VERSION}.`,
  );
  console.log(
    "| Parts | Calls | Prompt chars | Tokens in (chars/3) | Output allowance (sum) | Largest allowance | High estimate | Reserved by a paid run |",
  );
  console.log("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const r of runs)
    console.log(
      `| ${r.parts} | ${r.calls} | ${r.promptChars} | ${r.inputTokens} | ${r.outputTokensAllowance} | ${r.largestOutputAllowance} | $${r.highEstimateUsd.toFixed(4)} | $${r.reservedUsd.toFixed(4)} |`,
    );
  if (args.json)
    await writeFile(
      args.json,
      JSON.stringify({ pricingVersion: PRICING_VERSION, runs }, null, 2) + "\n",
    );
}

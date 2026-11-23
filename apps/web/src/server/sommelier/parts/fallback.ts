import "server-only";
import {
  BUDGET_EUROS,
  cellarQuestionKind,
  isCellarQuestion,
  readPlan,
  type AskSommelier,
  type CellarItem,
  type SommelierAnswer,
  type SommelierBottle,
} from "@cellr/domain";
import { FOOD, parseFood } from "@cellr/domain/intelligence";
import type { Planned, SommelierIntelligence } from "@/server/sommelier/intelligence";

/**
 * SOMMELIER V1+ PART `fallback` (P7). When V1 cannot put a question to its model (no key, the person's limit, the
 * model down, an answer that did not pass the check), the engines' plan answers instead of `plain()`. Only then:
 * with a model that answers, nothing here is ever called, so V1's choice is never replaced. The part stays off in
 * production until the knowledge is reviewed (D-49).
 *
 * The caller (the sommelier service) asks the fallback where it would otherwise answer with `plain()`, and answers
 * with `plain()` itself when the fallback returns null, exactly as it does today. The fallback returns null when:
 *
 * - the cellar is empty: the engines have nothing to offer, and with buying advice off they cannot say what to buy
 *   (the caller's own "nothing" answer stands; Tonight mode included);
 * - the question is one of fact (how many, where, which do I have): the counted facts answer it (`plainFacts`), never
 *   the engines. The caller decides this before it asks; the same test is repeated here so a call made anyway is
 *   still refused;
 * - the engines' own limit is spent (`spend` throws RATE_LIMITED), or anything else fails, or the engines take longer
 *   than `FALLBACK_DEADLINE_MS`: a failure of the engines is not the person's problem, and the plain answer is always
 *   there. No general timeout is raised for this: the deadline is the fallback's own, and short;
 * - the engines decline the question (a general question about wine: the plan is null);
 * - the plan decided nothing and asks nothing, or asks only what a buyer is asked (a budget, where to buy, a
 *   receiver's taste): buying advice is off, so such a question would lead nowhere;
 * - the plan is not one a kept conversation could draw again (`readPlan`), or it offers a wine that is not in the
 *   cellar the caller read: never a card the person does not own.
 *
 * A plan that is only a question back (`kind: "clarify"`, asking for the dish or the occasion) IS shown. Measured on
 * the main set (docs/sprints/sommelier-3-mega/results/p7-*.json, `v1-fallback` against `v1-fallback-plain`): it
 * happens for questions that are not about wine or food ("asdf qwerty", the weather, when the supermarket closes,
 * "🍽️?"), where `plain()` offers bottles ready to drink as if a wine had been asked for, and the question back is what
 * the reference answers expect (5 scenarios more pass, none fewer; no scenario about a dish changes). Without the
 * conversation's state (the model answered the earlier turns) a follow-up such as "not that one" also gets the
 * question back: no poor bottle offered, at the cost of asking for a dish that was said earlier.
 * `{ clarify: "plain" }` gives such a question to the plain answer instead; it exists so the evaluation can measure
 * the choice, and production uses the default.
 *
 * Never an unverified price: the engines are built without buying advice and without a retailer source
 * (`buying: false`, `offers: null`), and a plan that still carries styles with their price bands, offers or a buying
 * kind (a wiring mistake) is stripped of them, or declined when nothing else is left.
 *
 * The answer is the engines' answer as the service gives it with `sommelier_engine` on, with `reason` set, so the
 * screen says why it is not the AI's. With `sommelier_engine` on the engines were already asked before the model:
 * the caller must not ask them twice (they would decline again; see the tests).
 */

/** The fallback's own limit on the engines, in milliseconds. They take a few on a large cellar; this is for a stuck read. */
export const FALLBACK_DEADLINE_MS = 2_000;

export interface FallbackDeps {
  /** The engines (createSommelierIntelligence), built without buying advice and without a retailer source. */
  intelligence: Pick<SommelierIntelligence, "plan">;
  /** The engines' own limit (LIMITS.sommelierEngine): free of model cost, not free of CPU. Throws RATE_LIMITED. */
  spend: () => Promise<void>;
}

export interface FallbackInput {
  request: AskSommelier;
  /** The cellar the caller read for this question (it is not read again). */
  items: readonly CellarItem[];
  /** Why V1 has no model answer: carried on the answer, so the screen says it. */
  reason: NonNullable<SommelierAnswer["reason"]>; // "ai-off" | "ai-down" | "limit"
  /** Whether the person's own taste may steer (the caller's `request.personal !== false && !explore`). */
  personal: boolean;
  locale: string;
}

export interface FallbackOptions {
  /**
   * A plan that is only a question back: "ask" (default) shows the question back; "plain" leaves the question to the
   * plain answer. Only the evaluation passes "plain", to measure the choice.
   */
  clarify?: "ask" | "plain";
  /** Tests only: the deadline in milliseconds. */
  deadlineMs?: number;
}

export type SommelierFallback = (input: FallbackInput) => Promise<SommelierAnswer | null>;

/**
 * A question about the cellar itself, as the service reads it: answered from counted facts. "Which wine do I have
 * for the oysters?" asks what to open, not for an inventory, so a "which" question that names a dish is not one.
 */
export function isFactQuestion(question: string): boolean {
  if (!isCellarQuestion(question)) return false;
  const pairingInDisguise =
    cellarQuestionKind(question) === "selection" &&
    /\b(for|with|voor|bij|met)\b/i.test(question) &&
    parseFood(question.slice(0, 800), FOOD).main !== null;
  return !pairingInDisguise;
}

/**
 * The answer the fallback gives for a plan, or null when the plain answer is the better one (see the header). Pure:
 * no I/O, never throws on a well-formed `Planned`.
 */
export function fallbackAnswer(
  planned: Planned | null,
  reason: FallbackInput["reason"],
  items: readonly CellarItem[],
  options: Pick<FallbackOptions, "clarify"> = {},
): SommelierAnswer | null {
  if (!planned) return null;
  const read = readPlan(planned.plan);
  if (!read) return null;
  if (read.kind === "buying") return null;
  if (read.kind === "clarify") {
    if ((options.clarify ?? "ask") === "plain") return null;
    // Only a question that leads somewhere without buying advice: what is eaten, or for what occasion.
    if (read.ask !== "dish" && read.ask !== "occasion") return null;
  } else if (read.outcome === null && read.picks.length === 0) {
    // Decided nothing: no dish weighed, no wine offered.
    return null;
  }
  const plan = {
    ...read,
    // A question back about buying leads nowhere without buying advice.
    ask: read.ask === "dish" || read.ask === "occasion" ? read.ask : null,
    // Never a price: no style (each carries a price band), no offer. An empty buying part reads "not asked".
    styles: [],
    offers: [],
    offerCheck: "not-asked" as const,
    offersDropped: [],
  };
  const owned = new Map(items.map((i) => [i.vintageId, i]));
  if (plan.picks.some((p) => !owned.has(p.vintageId))) return null;
  const inCellar = (b: SommelierBottle) => owned.has(b.vintageId);
  const bottles = planned.bottles.filter(inCellar);
  // A pick without its card would be a wine drawn without a name.
  if (plan.picks.some((p) => !bottles.some((b) => b.vintageId === p.vintageId))) return null;
  const otherBottles = planned.otherBottles.filter(inCellar);
  return {
    source: "basic",
    text: null,
    basic: plan.picks.length > 0 ? "pairing" : "nothing",
    bottles,
    ...(otherBottles.length > 0 ? { otherBottles } : {}),
    reason,
    personal: planned.personal,
    plan,
  };
}

/** The engines' answer for a question V1 could not put to its model, or null when they have none (the caller then
 *  answers with plain(), exactly as today). Never throws: a failure of the engines is not the person's problem. */
export function createSommelierFallback(
  deps: FallbackDeps,
  options: FallbackOptions = {},
): SommelierFallback {
  const deadlineMs = options.deadlineMs ?? FALLBACK_DEADLINE_MS;
  return async ({ request, items, reason, personal, locale }) => {
    try {
      const question = request.messages?.at(-1)?.text;
      if (typeof question !== "string" || question.trim() === "") return null;
      if (items.length === 0 || isFactQuestion(question)) return null;
      const work = (async () => {
        await deps.spend();
        return deps.intelligence.plan({
          question,
          state: request.state,
          budgetEuros:
            request.budgetEuros ?? (request.budget ? BUDGET_EUROS[request.budget][1] : null),
          personal,
          locale,
          cellar: { items: [...items], bottleCount: items.reduce((sum, i) => sum + i.count, 0) },
        });
      })();
      // A late failure is not left unhandled; a late plan is not used.
      work.catch(() => {});
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), deadlineMs);
      });
      try {
        const planned = await Promise.race([work, late]);
        return fallbackAnswer(planned, reason, items, options);
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return null;
    }
  };
}

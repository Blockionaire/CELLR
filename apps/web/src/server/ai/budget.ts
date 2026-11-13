import "server-only";
import { estimateCost } from "./pricing";
import type { AiResult, AiTask, GenerateObjectRequest, LlmProvider } from "./types";

/**
 * Takes room in the platform budget for one call: a hold id, null when the budget is used up, or "" when no
 * budget is configured (nothing to hold). Throws when the budget cannot be checked.
 */
export type BudgetHolder = (task: string, estimateUsdMicro: number) => Promise<string | null>;

/**
 * What a task does when the platform budget CANNOT BE CHECKED (the database is down, the hold function is missing)
 * or when NO BUDGET IS CONFIGURED at all.
 *
 * - "open": the call goes ahead. The five paths that existed before the Wine Intelligence epic keep this, as
 *   documented: a broken guard must not switch scanning or the sommelier off for everyone. Each is still bounded
 *   per person by its own rate limit, which fails closed.
 * - "closed": the call is not made and answers `budget`, so the feature takes its no-AI path. EVERY TASK NOT LISTED
 *   HERE is closed: a new paid path cannot spend when its spending cannot be bounded (WI-00, R-18). Opening one is a
 *   deliberate edit of this list, in review.
 */
export const BUDGET_MODES: Record<AiTask, "open" | "closed"> = {
  label_extraction: "open",
  purchase_check: "open",
  wine_insight: "open",
  wine_valuation: "open",
  sommelier_chat: "open",
};
// The type makes the decision unavoidable: a task added to `AiTask` does not compile until its mode is written
// here. At run time anything not listed (a cast, a typo) is closed.
export const budgetModeOf = (task: string): "open" | "closed" =>
  Object.hasOwn(BUDGET_MODES, task) ? BUDGET_MODES[task as AiTask] : "closed";
export const BUDGET_FAIL_OPEN: ReadonlySet<string> = new Set(
  Object.entries(BUDGET_MODES)
    .filter(([, mode]) => mode === "open")
    .map(([task]) => task),
);

/**
 * The platform-wide AI budget around any provider. Before a call, its deliberately high estimate is held
 * against the daily and monthly limits (atomically, in the database); a call that would cross a limit is not
 * made and answers `budget`, so each feature takes its plain, no-AI path. The hold rides on the usage and is
 * released when the usage is recorded (with its real cost, or, when that is unknown, the hold's amount).
 *
 * If the budget cannot be checked (no database, a missing migration) a call of one of the EXISTING tasks goes
 * ahead: a broken guard must not switch AI off for everyone. That is the documented trade-off of an
 * application-level budget. Any other task (`budgetModeOf` = "closed") is refused instead, and is also refused when
 * no budget is configured: see `BUDGET_FAIL_OPEN`.
 */
export function withBudget(
  provider: LlmProvider,
  planOf: (request: GenerateObjectRequest<unknown>) => { model: string; maxOutputTokens: number },
  hold: BudgetHolder,
): LlmProvider {
  return {
    async generateObject<T>(request: GenerateObjectRequest<T>): Promise<AiResult<T>> {
      const { model, maxOutputTokens } = planOf(request as GenerateObjectRequest<unknown>);
      const estimate = estimateCost({
        model,
        promptChars: request.system.length + request.user.length,
        images: request.images?.length ?? 0,
        maxOutputTokens,
        webSearch: request.webSearch === true,
        ...(request.maxSearches !== undefined ? { searches: request.maxSearches } : {}),
      });
      const strict = budgetModeOf(request.task) === "closed";
      let holdId: string | null | undefined;
      try {
        holdId = await hold(request.task, estimate);
      } catch {
        // could not check: an existing task goes ahead without a hold; a new one is not made
        holdId = strict ? null : undefined;
      }
      // "" = no budget configured: nothing bounds a new paid path, so it is not made
      if (holdId === "" && strict) holdId = null;
      if (holdId === null)
        return {
          ok: false,
          kind: "budget",
          usage: { model, tokensIn: 0, tokensOut: 0, latencyMs: 0, notSent: true, reported: true },
        };
      const result = await provider.generateObject(request);
      if (holdId) result.usage.budgetHold = { id: holdId, estimateUsdMicro: estimate };
      return result;
    },
  };
}

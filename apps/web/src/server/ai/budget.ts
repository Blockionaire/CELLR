import "server-only";
import { estimateCost } from "./pricing";
import type { AiResult, GenerateObjectRequest, LlmProvider } from "./types";

/**
 * Takes room in the platform budget for one call: a hold id, null when the budget is used up, or "" when no
 * budget is configured (nothing to hold). Throws when the budget cannot be checked.
 */
export type BudgetHolder = (task: string, estimateUsdMicro: number) => Promise<string | null>;

/**
 * The platform-wide AI budget around any provider. Before a call, its deliberately high estimate is held
 * against the daily and monthly limits (atomically, in the database); a call that would cross a limit is not
 * made and answers `budget`, so each feature takes its plain, no-AI path. The hold rides on the usage and is
 * released when the usage is recorded (with its real cost, or, when that is unknown, the hold's amount).
 *
 * If the budget cannot be checked (no database, a missing migration) the call goes ahead: a broken guard must
 * not switch AI off for everyone. That is the documented trade-off of an application-level budget.
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
      let holdId: string | null | undefined;
      try {
        holdId = await hold(request.task, estimate);
      } catch {
        holdId = undefined; // could not check: go ahead without a hold
      }
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

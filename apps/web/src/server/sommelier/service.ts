import "server-only";
import {
  cellarDigest,
  checkSommelierAnswer,
  DomainError,
  detectIntent,
  toSommelierBottle,
  worthOpening,
  type AskSommelier,
  type CellarItem,
  type CellarView,
  type SommelierAnswer,
  type TonightRequest,
  type TonightView,
} from "@cellr/domain";
import type { AiErrorKind, AiUsage, LlmProvider } from "@/server/ai";
import {
  parseSommelier,
  SOMMELIER_SCHEMA,
  SOMMELIER_SYSTEM,
  sommelierUserMessage,
} from "@/server/ai/prompts/sommelier";

export interface SommelierDeps {
  cellar: () => Promise<CellarView>;
  /** The plain pairing engine, for when there is no AI to ask. */
  tonight: (request: TonightRequest) => Promise<TonightView>;
  /** Null = no AI configured. */
  llm: LlmProvider | null;
  /** Spends from the chat budget; throws RATE_LIMITED when it is gone. */
  spend: () => Promise<void>;
  householdId: () => Promise<string>;
  recordUsage: (entry: {
    householdId: string | null;
    task: string;
    status: "ok" | "error" | "timeout" | "invalid_output" | "rate_limited";
    usage: AiUsage;
  }) => Promise<void>;
}

const STATUS: Record<AiErrorKind, "error" | "timeout" | "invalid_output" | "rate_limited"> = {
  unavailable: "error",
  refused: "error",
  timeout: "timeout",
  invalid: "invalid_output",
  rate_limited: "rate_limited",
};

/**
 * Asks the sommelier. The model sees a compact list of the wines that exist and may only point at those; what
 * it says is checked in code. If there is no AI, the budget is spent, or the model fails, the same question is
 * answered by the plain pairing engine on the same cellar: never an error where an answer can be given.
 */
export function createSommelierService(deps: SommelierDeps) {
  async function plain(
    items: readonly CellarItem[],
    question: string,
    reason: NonNullable<SommelierAnswer["reason"]>,
  ): Promise<SommelierAnswer> {
    const { dish, occasion } = detectIntent(question);
    const byVintage = new Map(items.map((i) => [i.vintageId, i]));
    if (
      dish !== null ||
      occasion === "guests" ||
      occasion === "celebration" ||
      occasion === "weeknight"
    ) {
      const view = await deps.tonight({ dish, occasion });
      const bottles = view.picks.flatMap((p) => {
        const item = byVintage.get(p.vintageId);
        return item ? [toSommelierBottle(item)] : [];
      });
      if (bottles.length > 0)
        return { source: "basic", text: null, basic: "pairing", bottles, reason };
    }
    const worth = worthOpening(items);
    return {
      source: "basic",
      text: null,
      basic: worth.kind,
      bottles: worth.items.map(toSommelierBottle),
      reason,
    };
  }

  return {
    async ask(request: AskSommelier): Promise<SommelierAnswer> {
      const question = request.messages.at(-1)!.text;
      const { items } = await deps.cellar();
      // Nothing to talk about yet: no point paying for an answer that can only say so.
      if (items.length === 0)
        return { source: "basic", text: null, basic: "nothing", bottles: [], reason: null };
      if (!deps.llm) return plain(items, question, "ai-off");
      try {
        await deps.spend();
      } catch (error) {
        if (error instanceof DomainError && error.code === "RATE_LIMITED")
          return plain(items, question, "limit");
        throw error;
      }

      const digest = cellarDigest(items, question);
      const shown = digest.refs.size;
      const result = await deps.llm.generateObject({
        task: "sommelier_chat",
        model: "chat",
        system: SOMMELIER_SYSTEM,
        user: sommelierUserMessage(digest.text, shown, digest.total, request.messages),
        schemaName: "sommelier_answer",
        jsonSchema: SOMMELIER_SCHEMA,
        parse: parseSommelier,
        maxOutputTokens: 500,
        timeoutMs: 30_000,
      });
      await deps
        .recordUsage({
          householdId: await deps.householdId(),
          task: "sommelier_chat",
          status: result.ok ? "ok" : STATUS[result.kind],
          usage: result.usage,
        })
        .catch(() => {});
      if (!result.ok) return plain(items, question, "ai-down");

      const checked = checkSommelierAnswer(result.value, digest);
      if (!checked) return plain(items, question, "ai-down");
      return {
        source: "ai",
        text: checked.text,
        basic: null,
        bottles: checked.bottles,
        reason: null,
      };
    },
  };
}

export type SommelierService = ReturnType<typeof createSommelierService>;

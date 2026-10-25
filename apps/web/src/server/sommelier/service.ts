import "server-only";
import {
  cellarDigest,
  cellarFacts,
  cellarFactsText,
  isCellarQuestion,
  type CellarFacts,
  type RackView,
  type StorageUnitView,
  checkSommelierAnswer,
  DomainError,
  detectIntent,
  tasteContextFrom,
  tasteContextText,
  toSommelierBottle,
  wantsSomethingDifferent,
  worthOpening,
  type TasteContext,
  type TasteProfileView,
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
  /** Places with their room, and every bottle's spot: read only for a question about the cellar itself. */
  storage: () => Promise<StorageUnitView[]>;
  racks: () => Promise<RackView>;
  /** The plain pairing engine, for when there is no AI to ask (with the person's taste as a small nudge). */
  tonight: (request: TonightRequest, taste?: TasteContext | null) => Promise<TonightView>;
  /**
   * The signed-in person's own taste profile in the active household (their answers and their ratings only).
   * Read only for advice, never for a question of fact; left out, the sommelier is the general one.
   */
  taste?: () => Promise<TasteProfileView | null>;
  /** Null = no AI configured. */
  llm: LlmProvider | null;
  /** Spends from the chat budget; throws RATE_LIMITED when it is gone. */
  spend: () => Promise<void>;
  householdId: () => Promise<string>;
  /** The person's chosen app language ("en" | "nl"); the answer is written in it. */
  locale: () => Promise<string>;
  recordUsage: (entry: {
    householdId: string | null;
    task: string;
    status: "ok" | "error" | "timeout" | "invalid_output" | "rate_limited" | "budget_exhausted";
    usage: AiUsage;
  }) => Promise<void>;
}

const STATUS: Record<
  AiErrorKind,
  "error" | "timeout" | "invalid_output" | "rate_limited" | "budget_exhausted"
> = {
  unavailable: "error",
  refused: "error",
  timeout: "timeout",
  invalid: "invalid_output",
  rate_limited: "rate_limited",
  budget: "budget_exhausted",
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
    taste: TasteContext | null = null,
  ): Promise<SommelierAnswer> {
    const { dish, occasion } = detectIntent(question);
    const byVintage = new Map(items.map((i) => [i.vintageId, i]));
    if (
      dish !== null ||
      occasion === "guests" ||
      occasion === "celebration" ||
      occasion === "weeknight"
    ) {
      const view = await deps.tonight({ dish, occasion }, taste);
      const shown = view.picks.filter((p) => byVintage.has(p.vintageId));
      const bottles = shown.map((p) => toSommelierBottle(byVintage.get(p.vintageId)!));
      if (bottles.length > 0)
        return {
          source: "basic",
          text: null,
          basic: "pairing",
          bottles,
          reason,
          // Said only when the taste changed which bottles were picked, or their order.
          personal: taste !== null && view.personal === true,
        };
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

  /** The plain answer to a question about the cellar: the counts, and the wines it named (when few). */
  function plainFacts(facts: CellarFacts, reason: SommelierAnswer["reason"]): SommelierAnswer {
    const { kind, matches } = facts;
    const name = (m: CellarFacts["matches"][number]) =>
      `${m.item.producer} ${m.item.wineName}${m.item.year === null ? "" : ` ${m.item.year}`}`;
    // Cards: the wines a "which" question asks for (a few more of them), else the few that fit.
    const cards = matches.length <= (kind === "selection" ? 6 : 3) ? matches : [];
    return {
      source: "basic",
      text: null,
      basic: "facts",
      facts: {
        bottles: facts.bottles,
        wines: facts.wines,
        free: facts.free,
        matches: facts.asked ? matches.length : null,
        kind,
        // "How many": every matching vintage counts, so an unspecific name is summed, never one picked.
        matchedBottles: matches.reduce((s, m) => s + m.item.count, 0),
        names: kind === "selection" ? matches.slice(0, 12).map(name) : [],
        // "Where": the exact spots, but only for one wine; several make the answer ask which one is meant.
        located:
          kind === "location" && matches.length === 1
            ? matches.map((m) => ({
                vintageId: m.item.vintageId,
                wine: `${m.item.producer} ${m.item.wineName}`,
                year: m.item.year,
                count: m.item.count,
                spots: m.spots,
                unplaced: m.unplaced,
              }))
            : [],
      },
      bottles: cards.map((m) => toSommelierBottle(m.item)),
      reason,
    };
  }

  return {
    async ask(request: AskSommelier): Promise<SommelierAnswer> {
      const question = request.messages.at(-1)!.text;
      const { items } = await deps.cellar();
      const tonight = request.mode === "tonight";
      const nothing: SommelierAnswer = {
        source: "basic",
        text: null,
        basic: "nothing",
        bottles: [],
        reason: null,
      };
      // A question about the cellar itself is answered from counted facts: the places and spots are only read
      // for such a question, never for wine advice.
      const facts =
        !tonight && isCellarQuestion(question)
          ? cellarFacts(items, ...(await Promise.all([deps.storage(), deps.racks()])), question)
          : null;
      // The person's taste: only for advice (never for a question of fact, an empty cellar, or when they asked
      // for general advice), read at most once per question, and simply left out if it cannot be read.
      const explore = wantsSomethingDifferent(question);
      let tasteRead: Promise<TasteContext | null> | null = null;
      const taste = () =>
        (tasteRead ??=
          request.personal !== false && !facts && items.length > 0 && deps.taste
            ? deps
                .taste()
                .then(tasteContextFrom)
                .catch(() => null)
            : Promise.resolve(null));
      /** For the plain engine: asked for something different, the usual taste is not what to steer by. */
      const plainTaste = async () => (explore ? null : taste());
      // An empty cellar has nothing for the model to word: the counted facts say it all (and cost nothing).
      if (items.length === 0 && facts) return plainFacts(facts, null);
      // Nothing to talk about yet: no point paying for an answer that can only say so. (For tonight there is:
      // what to buy.)
      if (items.length === 0 && (!tonight || !deps.llm)) return nothing;
      if (!deps.llm)
        return facts
          ? plainFacts(facts, "ai-off")
          : plain(items, question, "ai-off", await plainTaste());
      try {
        await deps.spend();
      } catch (error) {
        if (error instanceof DomainError && error.code === "RATE_LIMITED")
          return items.length === 0
            ? nothing
            : facts
              ? plainFacts(facts, "limit")
              : plain(items, question, "limit", await plainTaste());
        throw error;
      }

      // Unknown language (the profile could not be read): English, as the app itself falls back.
      const [locale, personal] = await Promise.all([deps.locale().catch(() => "en"), taste()]);
      const digest = cellarDigest(
        items,
        question,
        facts ? new Set(facts.matches.map((m) => m.item.vintageId)) : undefined,
      );
      const refOf = new Map([...digest.refs].map(([ref, item]) => [item.vintageId, ref]));
      const shown = digest.refs.size;
      const result = await deps.llm.generateObject({
        task: "sommelier_chat",
        model: "chat",
        system: SOMMELIER_SYSTEM,
        user: sommelierUserMessage(digest.text, shown, digest.total, request.messages, {
          mode: request.mode ?? "chat",
          budget: request.budget ?? null,
          locale,
          facts: facts ? cellarFactsText(facts, (id) => refOf.get(id) ?? null) : null,
          taste: personal ? tasteContextText(personal, { explore }) : null,
        }),
        schemaName: "sommelier_answer",
        jsonSchema: SOMMELIER_SCHEMA,
        parse: parseSommelier,
        maxOutputTokens: 900,
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
      // The platform budget being used up reads to the person like any other limit.
      const why =
        !result.ok && result.kind === "budget" ? ("limit" as const) : ("ai-down" as const);
      const fallback = async () =>
        items.length === 0
          ? { ...nothing, reason: why }
          : facts
            ? plainFacts(facts, why)
            : plain(items, question, why, await plainTaste());
      if (!result.ok) return fallback();

      const checked = checkSommelierAnswer(result.value, digest);
      if (!checked) return fallback();
      // For a question about the cellar the wines it named get their cards (and links) whatever the model pointed
      // at, as long as there are few enough to be the answer; more means the model asks which one is meant.
      const named =
        facts && facts.matches.length > 0 && facts.matches.length <= 3
          ? facts.matches.map((m) => toSommelierBottle(m.item))
          : null;
      return {
        source: "ai",
        text: checked.text,
        basic: null,
        bottles: checked.bottles.length > 0 ? checked.bottles : (named ?? []),
        verdict: facts ? null : checked.verdict,
        buy: facts ? [] : checked.buy,
        reason: null,
        // Only when a taste was shown and the model says it shaped the answer.
        personal: personal !== null && checked.usedTaste,
      };
    },
  };
}

export type SommelierService = ReturnType<typeof createSommelierService>;

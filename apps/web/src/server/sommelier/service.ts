import "server-only";
import {
  cellarDigest,
  cellarFacts,
  cellarFactsText,
  hasAnyMention,
  withoutAnyMention,
  cellarQuestionKind,
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
  BUDGET_EUROS,
} from "@cellr/domain";
import type { SommelierIntelligence } from "@/server/sommelier/intelligence";
import type { GuardShadow } from "@/server/sommelier/v1-guard";
import type { AiErrorKind, AiUsage, LlmProvider } from "@/server/ai";
import {
  parseSommelier,
  SOMMELIER_SCHEMA,
  SOMMELIER_SYSTEM,
  sommelierUserMessage,
} from "@/server/ai/prompts/sommelier";

/** What a caller may hear about an answer besides the answer itself. */
export interface SommelierObserver {
  model?: (id: string) => void;
  guard?: (shadow: GuardShadow) => void;
}

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
  /**
   * Sommelier 3.0's engines, when the deployment has them switched on. They answer what they can decide (a dish
   * to pair, something to buy); everything else is answered as before. Absent: nothing changes.
   */
  intelligence?: SommelierIntelligence | null;
  /** Counts an answer of the engines against its own, generous limit; throws RATE_LIMITED when it is gone. */
  spendEngine?: () => Promise<void>;
  /**
   * Variant E in shadow mode (switch `sommelier_v1_guard`): judges the bottles V1 offered, after it answered, and
   * changes nothing (`v1-guard.ts`). Absent: nothing is judged.
   */
  guard?: ((userTexts: readonly string[], offered: readonly CellarItem[]) => GuardShadow) | null;
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

  const v1 = {
    /** Sommelier V1's answer. `seen` says what it was given and saw (for the shadow guard below). */
    async answer(
      request: AskSommelier,
      seen: { items: readonly CellarItem[]; facts: boolean },
      observe?: SommelierObserver,
    ): Promise<SommelierAnswer> {
      // With the social sommelier on, a friend's name is personal data that never leaves for a model: not in this
      // question, not in an earlier turn the screen sends along. A question that names someone is answered by
      // the engines or by the counted facts, or not at all; every other question is sent without the names.
      const social = deps.intelligence?.social === true;
      const asked = request.messages.at(-1)!.text;
      const namesSomeone = social && hasAnyMention(asked);
      const question = social ? withoutAnyMention(asked) : asked;
      // An earlier question that named someone, and the answer to it, are left out of what a model hears
      // altogether: the question was about a friend, also with the name taken out of it.
      const history = social
        ? request.messages
            .filter(
              (m, i, all) =>
                !(m.role === "user" && hasAnyMention(m.text)) &&
                !(
                  m.role === "assistant" &&
                  all[i - 1]?.role === "user" &&
                  hasAnyMention(all[i - 1]!.text)
                ),
            )
            .map((m) => ({ ...m, text: withoutAnyMention(m.text) || "…" }))
        : request.messages;
      const { items } = await deps.cellar();
      seen.items = items;
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
      // "Which wine do I have for the oysters?" asks what to open, not for an inventory: with the engines on, a
      // "which" question that names a dish is theirs. "How many" and "where" stay questions of fact.
      const pairingInDisguise =
        deps.intelligence !== undefined &&
        deps.intelligence !== null &&
        cellarQuestionKind(question) === "selection" &&
        // "...for the oysters", "...bij de vis": the dish is what the wine is for, not part of a producer's name.
        /\b(for|with|voor|bij|met)\b/i.test(question) &&
        deps.intelligence.readsDish(question);
      // "8 guests, roast lamb: do I have enough bottles?" reads like a count and asks for a judgement.
      const enoughForGuests = deps.intelligence?.asksEnoughFor(question) === true;
      const counted =
        !tonight && isCellarQuestion(question) && !pairingInDisguise && !enoughForGuests
          ? cellarFacts(items, ...(await Promise.all([deps.storage(), deps.racks()])), question)
          : null;
      // "Roquefort after dinner, which wine do I have?" names a dish and no wine, colour, year or place: it asks
      // what to open, not for a list of the cellar. With the engines on that is theirs.
      const facts =
        counted &&
        deps.intelligence &&
        counted.kind === "selection" &&
        // (the words of the dish are no wine of this cellar: nothing matched, and no colour or year was asked)
        (counted.asked === null ||
          (counted.matches.length === 0 &&
            counted.asked.type === null &&
            counted.asked.year === null)) &&
        deps.intelligence.readsDish(question)
          ? null
          : counted;
      seen.facts = facts !== null;
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
      // The engines first, for what they decide themselves: no model is asked and nothing is spent. A question
      // of fact never goes to them; a failure of theirs is not the person's problem (the old path answers).
      if (deps.intelligence && !facts) {
        // Free of model cost, not free of limits: a script must not turn the engines into a CPU tap.
        await deps.spendEngine?.();
        const planned = await deps.intelligence
          .plan({
            // The engines read the names themselves (and only they do): they get the question as it was asked.
            question: asked,
            // Their earlier questions, for whom the conversation is about; no answer of ours is sent along.
            earlier: social
              ? request.messages
                  .slice(0, -1)
                  .filter((m) => m.role === "user")
                  .map((m) => m.text)
              : [],
            state: request.state,
            budgetEuros:
              request.budgetEuros ?? (request.budget ? BUDGET_EUROS[request.budget][1] : null),
            personal: request.personal !== false && !explore,
            locale: await deps.locale().catch(() => "en"),
            cellar: { items, bottleCount: items.reduce((sum, i) => sum + i.count, 0) },
          })
          .catch(() => null);
        if (planned)
          return {
            source: "basic",
            text: null,
            basic: planned.plan.picks.length > 0 ? "pairing" : "nothing",
            bottles: planned.bottles,
            ...(planned.otherBottles.length > 0 ? { otherBottles: planned.otherBottles } : {}),
            reason: null,
            personal: planned.personal,
            plan: planned.plan,
          };
      }
      // A question that names a friend ends here: the engines could not answer it, and no model may see it.
      if (namesSomeone) return facts ? plainFacts(facts, null) : nothing;
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
        user: sommelierUserMessage(digest.text, shown, digest.total, history, {
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
      observe?.model?.(result.usage.servedModel ?? result.usage.model);
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
        // With the engines on, a verdict and buying advice only ever come from them: the model's own are dropped.
        // (Also with buying advice switched off: a model-made product and price is never shown beside the
        // engines. Buying advice then comes with `sommelier_buying`, as styles.)
        verdict: facts || deps.intelligence ? null : checked.verdict,
        buy: facts || deps.intelligence ? [] : checked.buy,
        reason: null,
        // Only when a taste was shown and the model says it shaped the answer.
        personal: personal !== null && checked.usedTaste,
      };
    },
  };

  return {
    /**
     * `observe.model` hears which model wrote the answer, for an answer that is the AI's (never for a plain one):
     * the kept conversation notes it with the answer. `observe.guard` hears what variant E's guard would have
     * held back (shadow mode, only with `deps.guard`). Neither changes anything about how the question is answered.
     */
    async ask(request: AskSommelier, observe?: SommelierObserver): Promise<SommelierAnswer> {
      const seen: { items: readonly CellarItem[]; facts: boolean } = { items: [], facts: false };
      const answer = await v1.answer(request, seen, observe);
      // Shadow mode: V1's own pairing advice only (the AI's, or the plain engine's pairing), never the engines'
      // plans or a question of fact. A failure here is the shadow's, never the person's: the answer goes out as is.
      if (
        deps.guard &&
        observe?.guard &&
        !answer.plan &&
        !seen.facts &&
        answer.bottles.length > 0 &&
        (answer.source === "ai" || answer.basic === "pairing")
      ) {
        try {
          const byId = new Map(seen.items.map((i) => [i.vintageId, i]));
          const offered = answer.bottles.flatMap((b) => byId.get(b.vintageId) ?? []);
          observe.guard(
            deps.guard(
              request.messages
                // With the social sommelier on, a turn that names someone is one no model heard: not the dish
                // the answer was given for, so not the guard's either.
                .filter(
                  (m) =>
                    m.role === "user" &&
                    !(deps.intelligence?.social === true && hasAnyMention(m.text)),
                )
                .map((m) => m.text),
              offered,
            ),
          );
        } catch {
          // nothing: the shadow is simply not measured for this answer
        }
      }
      return answer;
    },
  };
}

export type SommelierService = ReturnType<typeof createSommelierService>;

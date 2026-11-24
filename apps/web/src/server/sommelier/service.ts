import "server-only";
import {
  annotationEmphasis,
  guestsBlock,
  guestsIn,
  hasSommelierPart,
  quantityFor,
  reconcileServingClaims,
  servingCheckOf,
  type InsightOutput,
  checkAnswerClaims,
  cellarDigest,
  cellarFacts,
  cellarFactsText,
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
  type SommelierParts,
  type TonightRequest,
  type TonightView,
  BUDGET_EUROS,
} from "@cellr/domain";
import { annotateBottles, servingFactsBlock } from "@cellr/domain/intelligence";
import type { SommelierIntelligence } from "@/server/sommelier/intelligence";
import { seeCardWords } from "@/server/sommelier/parts/serving-words";
import { cardOnlyWords } from "@/server/sommelier/parts/check-words";
import type { AiErrorKind, AiUsage, LlmProvider } from "@/server/ai";
import {
  parseSommelier,
  SOMMELIER_SCHEMA,
  SOMMELIER_SYSTEM,
  sommelierUserMessage,
} from "@/server/ai/prompts/sommelier";
import {
  parseSommelierV7,
  SOMMELIER_SCHEMA_V7,
  SOMMELIER_SYSTEM_V7,
} from "@/server/ai/prompts/sommelier-v7";

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
   * Sommelier V1+ parts switched on in this deployment (CELLR_SOMMELIER, D-52). Each is built in its own pull
   * request (docs/sprints/sommelier-3-mega/SOMMELIER_CLOSEOUT.md §6). Absent or empty, V1 answers exactly as before.
   */
  parts?: SommelierParts;
  /**
   * V1+ part `annotate`: the household's own researched profiles of these vintages (what is known about the exact
   * wine: its serving temperature, its decanting time). Read only when the part is on, and only for the few wines
   * an answer shows. Absent, or failing: the rules of thumb for the wine's style, worded as such.
   */
  profiles?: (vintageIds: readonly string[]) => Promise<ReadonlyMap<string, InsightOutput>>;
  /** The clock (a wine's age decides how it is decanted). Absent: now. */
  now?: () => Date;
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
/** What one question's answer was made from, for the V1+ parts that add their facts after it. */
interface Seen {
  /** The cellar as read for this question (it is not read twice). */
  items: readonly CellarItem[];
  /** A question about the cellar itself: answered from counted facts, and left as it is. */
  facts: boolean;
  /** The engines (`sommelier_engine`) answered: their plan is left as it is. */
  engines: boolean;
  /** Profiles read so far for this question, and the wines already asked for (each is asked for once). */
  profiles: Map<string, InsightOutput>;
  asked: Set<string>;
}

export function createSommelierService(deps: SommelierDeps) {
  const on = (part: Parameters<typeof hasSommelierPart>[1]) =>
    deps.parts !== undefined && hasSommelierPart(deps.parts, part);
  const clock = () => deps.now?.() ?? new Date();

  /** The household's profiles of these wines; a read that fails leaves the rules of thumb, never an error. */
  async function profilesOf(seen: Seen, vintageIds: readonly string[]) {
    const missing = vintageIds.filter((id) => !seen.asked.has(id));
    if (missing.length > 0 && deps.profiles) {
      for (const id of missing) seen.asked.add(id);
      const read = await deps.profiles(missing).catch(() => null);
      if (read) for (const [id, profile] of read) seen.profiles.set(id, profile);
    }
    return seen.profiles;
  }

  /**
   * The V1+ parts that add the app's own facts to an answer that has been given (`annotate`, `quantities`). The
   * wines, the words and the verdict are V1's and are not touched. Not for a question about the cellar itself, and
   * not for the engines' own plan. A part that fails adds nothing: the answer is never lost to it.
   */
  async function finish(
    answer: SommelierAnswer,
    request: AskSommelier,
    seen: Seen,
  ): Promise<SommelierAnswer> {
    const annotate = on("annotate");
    const quantities = on("quantities");
    if ((!annotate && !quantities) || seen.facts || seen.engines) return answer;
    const byId = new Map(seen.items.map((i) => [i.vintageId, i]));
    const cards = answer.bottles.flatMap((b) => byId.get(b.vintageId) ?? []);
    let out = answer;
    if (annotate && cards.length > 0) {
      try {
        const annotations = annotateBottles(cards, {
          profiles: await profilesOf(
            seen,
            cards.map((c) => c.vintageId),
          ),
          now: clock(),
        });
        if (annotations.length > 0) out = { ...out, annotations };
        // The app's facts lead: a sentence of the model's that states another serving temperature, decanting
        // time or drinking years for a wine on the cards is left out (the card shows the facts). No second
        // call to the model: the words are compared in code.
        if (out.source === "ai" && out.text !== null && annotations.length > 0) {
          const said = reconcileServingClaims(
            out.text,
            annotations.flatMap((annotation) => {
              const item = byId.get(annotation.vintageId);
              return item ? [{ item, annotation }] : [];
            }),
          );
          if (said.codes.length > 0)
            out = {
              ...out,
              text: said.text ?? seeCardWords(await deps.locale().catch(() => "en")),
              servingCheck: servingCheckOf(said),
            };
        }
      } catch {
        // The cards stay as V1 gave them.
      }
    }
    // Bottles for the people named: with cards, against what is free to open of each; with advice and no card
    // (nothing suits, something to buy), the number needed alone.
    if (quantities && (cards.length > 0 || answer.source === "ai")) {
      try {
        const guests = guestsIn(request.messages);
        if (guests)
          out = {
            ...out,
            quantity: quantityFor(
              guests,
              cards.map((c) => ({
                vintageId: c.vintageId,
                count: c.count,
                reserved: c.reserved?.count ?? 0,
              })),
              "alternatives",
            ),
          };
      } catch {
        // No count is better than a wrong one.
      }
    }
    return out;
  }

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
    async ask(
      request: AskSommelier,
      observe: { model?: (id: string) => void } | undefined,
      seen: Seen,
    ): Promise<SommelierAnswer> {
      const question = request.messages.at(-1)!.text;
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
      const facts =
        !tonight && isCellarQuestion(question) && !pairingInDisguise
          ? cellarFacts(items, ...(await Promise.all([deps.storage(), deps.racks()])), question)
          : null;
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
            question,
            state: request.state,
            budgetEuros:
              request.budgetEuros ?? (request.budget ? BUDGET_EUROS[request.budget][1] : null),
            personal: request.personal !== false && !explore,
            locale: await deps.locale().catch(() => "en"),
            cellar: { items, bottleCount: items.reduce((sum, i) => sum + i.count, 0) },
          })
          .catch(() => null);
        if (planned) seen.engines = true;
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
      // V1+ `annotate`: a question about how to serve a wine or how long to keep it gets the app's own facts for
      // the wines it names, for the model to state as written (never its own temperature, time or years). First
      // which wines it is about, so they are on the list the model is shown; then their facts, with their profiles.
      const servingAbout =
        on("annotate") && !facts && annotationEmphasis(question) !== null
          ? servingFactsBlock(request.messages, items, () => null, {
              profiles: new Map(),
              now: clock(),
            })
          : null;
      // V1+ `quantities`: how many people are drinking, when the person said so. The app counts the bottles.
      const guests = on("quantities") && !facts ? guestsIn(request.messages) : null;
      const digest = cellarDigest(
        items,
        question,
        facts
          ? new Set(facts.matches.map((m) => m.item.vintageId))
          : servingAbout
            ? new Set(servingAbout.vintageIds)
            : undefined,
      );
      const refOf = new Map([...digest.refs].map(([ref, item]) => [item.vintageId, ref]));
      const shown = digest.refs.size;
      const serving = servingAbout
        ? servingFactsBlock(
            request.messages,
            items.filter((i) => servingAbout.vintageIds.includes(i.vintageId)),
            (id) => refOf.get(id) ?? null,
            { profiles: await profilesOf(seen, servingAbout.vintageIds), now: clock() },
          )
        : null;
      const blocks = [serving?.text, guests ? guestsBlock(guests) : null].filter(
        (block): block is string => typeof block === "string",
      );
      const factsText = facts ? cellarFactsText(facts, (id) => refOf.get(id) ?? null) : null;
      // V1+ `check`: prompt v7 has the model write a cellar wine as its ref (the app renders the name) and gives it
      // no place for a price; what it says is then checked claim by claim. Without the part: v6, exactly as before.
      const checking = deps.parts !== undefined && hasSommelierPart(deps.parts, "check");
      const result = await deps.llm.generateObject({
        task: "sommelier_chat",
        model: "chat",
        system: checking ? SOMMELIER_SYSTEM_V7 : SOMMELIER_SYSTEM,
        user: sommelierUserMessage(digest.text, shown, digest.total, request.messages, {
          mode: request.mode ?? "chat",
          budget: request.budget ?? null,
          locale,
          facts: factsText,
          taste: personal ? tasteContextText(personal, { explore }) : null,
          ...(blocks.length > 0 ? { blocks } : {}),
        }),
        schemaName: "sommelier_answer",
        jsonSchema: checking ? SOMMELIER_SCHEMA_V7 : SOMMELIER_SCHEMA,
        parse: checking ? parseSommelierV7 : parseSommelier,
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
      // Asked how to serve or keep a wine: the wines the app's facts are about get their cards (with those facts)
      // when the model pointed at none.
      const about = serving
        ? items.filter((i) => serving.vintageIds.includes(i.vintageId)).map(toSommelierBottle)
        : null;
      const bottles = checked.bottles.length > 0 ? checked.bottles : (named ?? about ?? []);
      // With the engines on, a verdict and buying advice only ever come from them: the model's own are dropped.
      // (Also with buying advice switched off: a model-made product and price is never shown beside the
      // engines. Buying advice then comes with `sommelier_buying`, as styles.)
      const buy = facts || deps.intelligence ? [] : checked.buy;
      // V1+ `check`: refs become the cellar's own names; a claim about the cellar that is not true, a price, a
      // shop or an action is not shown. The wines V1 chose (the cards) are never changed by it.
      const claims = checking
        ? checkAnswerClaims({
            text: checked.text,
            bottles,
            buy,
            digest,
            items,
            budget: request.budget ?? null,
            facts: factsText,
            now: clock(),
          })
        : null;
      // A question about the cellar itself whose words could not be shown: the counted facts say it, in the
      // app's own sentence (never "the one to look at" for a question of how many or where).
      if (claims?.check.text === "replaced" && facts)
        return { ...plainFacts(facts, null), check: claims.check };
      const verdict = facts || deps.intelligence ? null : checked.verdict;
      return {
        source: "ai",
        // Words the check took away are replaced by one sentence made from the cards (`check.text` says so, and
        // the screen words it more fully): an answer is never without words.
        text: claims ? (claims.text ?? cardOnlyWords(locale, bottles, verdict)) : checked.text,
        basic: null,
        bottles,
        verdict,
        buy: claims ? claims.buy : buy,
        ...(claims ? { check: claims.check } : {}),
        reason: null,
        // Only when a taste was shown and the model says it shaped the answer.
        personal: personal !== null && checked.usedTaste,
      };
    },
  };

  return {
    /**
     * `observe.model` hears which model wrote the answer, for an answer that is the AI's (never for a plain one):
     * the kept conversation notes it with the answer. It changes nothing about how the question is answered.
     */
    async ask(
      request: AskSommelier,
      observe?: { model?: (id: string) => void },
    ): Promise<SommelierAnswer> {
      const seen: Seen = {
        items: [],
        facts: false,
        engines: false,
        profiles: new Map(),
        asked: new Set(),
      };
      return finish(await v1.ask(request, observe, seen), request, seen);
    },
  };
}

export type SommelierService = ReturnType<typeof createSommelierService>;

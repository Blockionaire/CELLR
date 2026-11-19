import "server-only";
import {
  aboutWine,
  advance,
  isSmallTalk,
  findMentions,
  withoutMentions,
  type MentionStatus,
  nextQuestion,
  normalizeText,
  readState,
  selectOffers,
  STANDARD_BOTTLE_ML,
  SOMMELIER_PLAN_VERSION,
  tasteContextFrom,
  toSommelierBottle,
  withAsked,
  type CellarItem,
  type CellarView,
  type ConversationState,
  type InsightOutput,
  type OfferCheck,
  type OfferDefect,
  type OfferProvider,
  type PickNote,
  type PlanOffer,
  type PlanPick,
  type PlanStyle,
  type ShownOffer,
  type SommelierBottle,
  type SommelierPlan,
  type TasteProfileView,
} from "@cellr/domain";
import {
  FOOD,
  WINE_KNOWLEDGE,
  assessPairing,
  decidePairing,
  groupTasteScore,
  hasTaste,
  mentionedWines,
  parseFood,
  readWine,
  recommendStyles,
  searchTextOf,
  tasteScore,
  type FoodProfile,
  type PairingCandidate,
  type PairingPick,
  type TasteSignals,
  type WineProfileFacts,
  type WineReading,
} from "@cellr/domain/intelligence";

/**
 * SOMMELIER 3.0, WIRED TO A REAL CELLAR. One question goes through six steps, and a model is in none of them:
 *
 *   understand  what is being eaten, what the person wants (open, buy, give), at what price
 *   gather      the wines they own, what is known about each (and how well), their taste
 *   assess      every wine against the dish
 *   decide      a good match, an acceptable compromise, or nothing; what to set aside and why
 *   advise      what to buy as a style when buying is wanted or nothing suits; real offers only from a source
 *   ask         at most one question back
 *
 * The result is a plan (packages/domain/src/sommelier-plan.ts). Every bottle in it was read from the household's
 * own inventory in this request; nothing a screen sent is believed (the conversation state is a hint that is
 * validated, and only ever narrows what is offered).
 */
export interface IntelligenceDeps {
  /** The household's cellar, read as the signed-in person (row-level security). */
  cellar: () => Promise<CellarView>;
  /** The household's own researched profiles of these vintages; missing ones are simply not there. */
  profiles: (vintageIds: readonly string[]) => Promise<ReadonlyMap<string, InsightOutput>>;
  /** The signed-in person's own taste profile, or null. */
  taste: () => Promise<TasteProfileView | null>;
  /** A retailer source, when one is connected. The app has none: buying advice is then a style. */
  offers: OfferProvider | null;
  buying: boolean;
  /**
   * The friends named in a question, as the database judges them for the asker in this request (accepted
   * friendship, taste shared, sommelier consent). Absent: the social sommelier is off and a name is only text.
   */
  friends?: (
    handles: readonly string[],
  ) => Promise<Array<{ handle: string; status: MentionStatus; taste: TasteSignals | null }>>;
  now: () => Date;
}

export interface PlanRequest {
  question: string;
  /** What the screen sent back as the conversation's state. Untrusted. */
  state: unknown;
  /** A budget chosen on the screen, as an upper bound in whole euros. */
  budgetEuros: number | null;
  /** Whether the person wants their own taste used. */
  personal: boolean;
  /** "en" or "nl": the language the labels of what to buy are written in. */
  locale: string;
  /** The cellar, when the caller has read it already in this request (it is not read twice). */
  cellar?: CellarView;
}

export interface Planned {
  plan: SommelierPlan;
  /** The cards of the plan's picks, in the plan's order: the bottles offered, and no others. */
  bottles: SommelierBottle[];
  /** The cards of the wines the plan mentions without offering them (set aside, the closest). */
  otherBottles: SommelierBottle[];
  /** The person's taste changed which bottle comes first. */
  personal: boolean;
}

/** A profile counts as fact about the exact wine only on the terms shared profiles are held to (D-16). */
export function profileFacts(output: InsightOutput | undefined): WineProfileFacts | null {
  if (!output) return null;
  return {
    structure: output.structure,
    grapes: output.grapes,
    exact:
      output.researched &&
      output.evidence === "exact_wine" &&
      output.confidence === "high" &&
      output.sources.length > 0,
    evidence: output.evidence,
  };
}

/** A person's taste as the closed signals the engine orders by. */
export function tasteSignals(view: TasteProfileView | null): TasteSignals | null {
  const ctx = tasteContextFrom(view);
  if (!ctx) return null;
  const signals: TasteSignals = {
    focus: ctx.said.focus,
    said: ctx.said.scales,
    trends: ctx.rated.trends,
    styles: ctx.rated.styles.map((s) => s.key),
    // Regions and grapes as the catalogue spells them; only those the engine knows as a wine key can match.
    likes: [...ctx.rated.regions, ...ctx.rated.grapes].map((x) => normalizeText(x.key)),
  };
  return hasTaste(signals) ? signals : null;
}

/** How many styles a retailer source is asked about for one question. */
const OFFER_STYLES = 6;

interface Read {
  item: CellarItem;
  reading: WineReading;
  free: number;
}

const blockedBy = (r: Read, state: ConversationState) =>
  state.rejected.includes(r.item.vintageId)
    ? ("turned-down" as const)
    : r.free <= 0
      ? ("reserved" as const)
      : r.item.drink.phase === "young"
        ? ("too-young" as const)
        : null;

function notesOf(r: Read): PickNote[] {
  const notes: PickNote[] = [];
  if ((r.item.reserved?.count ?? 0) > 0 && r.free > 0) notes.push("partly-reserved");
  if (r.item.drink.phase === "developing") notes.push("young");
  if (r.item.drink.phase === "past") notes.push("past");
  else if (r.item.drink.uncertain && (r.item.drink.yearsLeft ?? 0) < 0) notes.push("may-be-past");
  if (r.reading.colourOnly) notes.push("little-known");
  else if (r.reading.fromName) notes.push("by-name");
  else if (r.reading.tier === "estimate") notes.push("estimate");
  return notes;
}

const toPick = (pick: PairingPick<Read>, extra: PickNote[] = []): PlanPick => ({
  vintageId: pick.item.item.vintageId,
  level:
    pick.assessment.level === "good" || pick.assessment.level === "acceptable"
      ? pick.assessment.level
      : "neutral",
  tier: pick.tier,
  pros: pick.assessment.pros.slice(0, 4),
  cons: pick.assessment.cons.slice(0, 3),
  notes: [...extra, ...notesOf(pick.item)],
});

const emptyPlan = (state: ConversationState): SommelierPlan => ({
  v: SOMMELIER_PLAN_VERSION,
  kind: "clarify",
  dish: null,
  dishConfidence: null,
  outcome: null,
  confidence: null,
  considered: 0,
  picks: [],
  closest: null,
  setAside: [],
  styles: [],
  offers: [],
  offerCheck: "not-asked",
  offersDropped: [],
  courses: [],
  dishIdeas: [],
  avoid: [],
  serving: [],
  quantity: null,
  ask: null,
  state,
  friends: [],
});

export function createSommelierIntelligence(deps: IntelligenceDeps) {
  return {
    /** Whether a question names a dish the food engine understands (no I/O). */
    readsDish(question: string): boolean {
      return parseFood(question.slice(0, 800), FOOD).main !== null;
    },
    /** Whether buying advice is the engines' (then the model's own is dropped). */
    buying: deps.buying,
    /**
     * The plan for a question, or null when the question is not one the engines answer (a general question about
     * wine with no dish and nothing to buy): the caller then answers it the way it did before.
     */
    async plan(request: PlanRequest): Promise<Planned | null> {
      const previous = readState(request.state);
      // Names of people are taken out before anything reads the question: "@pasta.lover" is not a dish, and a
      // name never reaches the food engine, the state or a log.
      const mentions = deps.friends ? findMentions(request.question.slice(0, 800)) : [];
      const question = withoutMentions(request.question.slice(0, 800));
      // Who they are, and what each allows, is the database's answer in this request: never the screen's.
      const table = mentions.length > 0 && deps.friends ? await deps.friends(mentions) : [];
      const friendTastes = table.flatMap((f) =>
        f.status === "included" && f.taste ? [f.taste] : [],
      );
      const friends = table.map(({ handle, status }) => ({ handle, status }));
      const said = parseFood(question, FOOD);
      const wines = mentionedWines(question, WINE_KNOWLEDGE);
      const named = wines.map((w) => w.id);
      let state = advance(previous, {
        text: question,
        budgetEuros: request.budgetEuros,
        dish: said.main === null ? null : said.said,
        wineKeys: named,
      });
      if (
        !deps.buying &&
        (state.intent === "buy" || state.intent === "gift" || state.intent === "either")
      )
        state = { ...state, intent: previous.intent === "open" ? "open" : null };

      // The dish of this turn, or the one the conversation is about.
      const food: FoodProfile | null =
        said.main !== null
          ? said
          : state.dish !== null
            ? ((d) => (d.main === null ? null : d))(parseFood(state.dish, FOOD))
            : null;
      const buying = state.intent === "buy" || state.intent === "gift";

      if (!food && !buying) {
        // No dish and nothing to buy. A question about wine goes to the general sommelier; anything else gets
        // one question back, no bottles and no model. A question that names a friend never goes to a model.
        if (
          mentions.length === 0 &&
          (aboutWine(question) || named.length > 0 || isSmallTalk(question))
        )
          return null;
        const ask = nextQuestion(state, { dishKnown: false, ownedSuits: false, onTopic: true });
        return {
          plan: { ...emptyPlan(withAsked({ ...state, offered: [] }, ask)), ask, friends },
          bottles: [],
          otherBottles: [],
          personal: false,
        };
      }

      const { items } = request.cellar ?? (await deps.cellar());
      const profiles =
        items.length === 0
          ? new Map<string, InsightOutput>()
          : await deps
              .profiles(items.map((i) => i.vintageId))
              .catch(() => new Map<string, InsightOutput>());
      const taste =
        request.personal && items.length > 0
          ? tasteSignals(await deps.taste().catch(() => null))
          : null;

      const read: Read[] = items
        .filter((item) => state.wineType === null || item.type === state.wineType)
        .map((item) => ({
          item,
          reading: readWine(
            {
              type: item.type,
              name: item.wineName,
              region: item.region,
              appellation: item.appellation ?? null,
              countryCode: item.countryCode,
              profile: profileFacts(profiles.get(item.vintageId)),
            },
            WINE_KNOWLEDGE,
          ),
          free: item.count - Math.min(item.count, item.reserved?.count ?? 0),
        }));

      let plan: SommelierPlan = {
        ...emptyPlan(state),
        kind: buying ? "buying" : "pairing",
        dish: food?.said ?? state.dish,
        dishConfidence: food?.confidence ?? null,
      };
      let bottles: SommelierBottle[] = [];
      let otherBottles: SommelierBottle[] = [];
      let personal = false;
      // Wines of theirs the question names ("Which Barolo with the steak?", "Chablis or Barolo with the lamb?"):
      // the question is about those, so those are judged, not the cellar at large.
      const about =
        named.length === 0 ? [] : read.filter((r) => named.some((k) => r.reading.keys.includes(k)));
      const pool = about.length > 0 ? about : read;
      plan = {
        ...plan,
        considered: pool.length,
        kind: !buying && about.length >= 2 ? "compare" : plan.kind,
      };
      let ownedSuits = false;

      if (food) {
        const candidate = (r: Read, withTaste: boolean): PairingCandidate<Read> => ({
          item: r,
          wine: { ...r.reading, type: r.item.type },
          tier: r.reading.tier,
          // One score for the table: the asker and every friend who allows it, pulled toward whoever would
          // like the wine least.
          taste: withTaste
            ? groupTasteScore(
                [...(taste ? [taste] : []), ...friendTastes].map((t) =>
                  tasteScore({ ...r.reading, type: r.item.type }, t),
                ),
              )
            : 0,
        });
        const decide = (from: readonly Read[]) =>
          decidePairing(
            food,
            from.filter((r) => blockedBy(r, state) === null).map((r) => candidate(r, true)),
          );
        // The wines they asked about first; when none of those suits, the rest of the cellar after all.
        let scope = pool;
        let decision = decide(scope);
        if (about.length > 0 && decision.outcome === "none") {
          scope = read;
          decision = decide(scope);
          plan = { ...plan, considered: read.length, kind: buying ? "buying" : "pairing" };
        }
        const open = scope.filter((r) => blockedBy(r, state) === null);
        if ((taste || friendTastes.length > 0) && decision.picks.length > 1) {
          const plain = decidePairing(
            food,
            open.map((r) => candidate(r, false)),
          );
          personal = plain.picks[0]?.item.item.vintageId !== decision.picks[0]!.item.item.vintageId;
        }
        // Wines that would have been offered, had they been free, ready and not turned down: said, not hidden.
        const rank = { good: 0, acceptable: 1, neutral: 2, poor: 3 } as const;
        const bar = decision.outcome === "good" ? 0 : 1;
        const setAside = scope
          .flatMap((r) => {
            const reason = blockedBy(r, state);
            if (reason === null) return [];
            const assessment = assessPairing(food, { ...r.reading, type: r.item.type });
            return rank[assessment.level] <= bar ? [{ r, reason, assessment }] : [];
          })
          .sort((a, b) => b.assessment.score - a.assessment.score)
          .slice(0, 3);

        ownedSuits = decision.outcome !== "none";
        plan = {
          ...plan,
          outcome: decision.outcome,
          confidence: decision.confidence,
          picks: decision.picks.map((p, i) =>
            toPick(
              p,
              personal && i === 0 ? [friendTastes.length > 0 ? "table-taste" : "your-taste"] : [],
            ),
          ),
          closest: decision.closest ? toPick(decision.closest) : null,
          setAside: setAside.map((s) => ({ vintageId: s.r.item.vintageId, reason: s.reason })),
        };
        bottles = decision.picks.map((p) => toSommelierBottle(p.item.item));
        otherBottles = [
          ...(decision.closest ? [decision.closest.item.item] : []),
          ...setAside.map((s) => s.r.item),
        ].map(toSommelierBottle);
      }

      // What to buy: when buying is what they want, or when nothing they own suits (unless they said "only mine").
      const adviseBuying =
        deps.buying && !state.ownOnly && (buying || (food !== null && !ownedSuits));
      if (adviseBuying) {
        const suggestions = recommendStyles(
          {
            food,
            state,
            // For a present to a friend who allows it: what they like. Their taste shapes the advice and is
            // never written into the conversation's state, which travels to the screen and back.
            likes: [
              ...friendTastes.flatMap((t) => [...t.likes, ...t.styles]),
              ...(taste?.likes ?? []),
            ],
            asked: named,
            ownedTypes: [...new Set(items.map((i) => i.type))],
          },
          WINE_KNOWLEDGE,
        );
        const lang = request.locale === "nl" ? "nl" : "en";
        const styles: PlanStyle[] = suggestions.map((s) => ({
          styleId: s.style.id,
          label: s.style.label[lang],
          type: s.style.wine.type,
          fromEuros: s.style.fromEuros,
          reason: s.reason,
          pros: s.assessment?.pros.slice(0, 3) ?? [],
        }));
        let offerCheck: OfferCheck = "no-provider";
        let offers: PlanOffer[] = [];
        let offersDropped: OfferDefect[] = [];
        if (deps.offers && suggestions.length > 0) {
          // A vintage is a year that has been: "to drink before 2030" names none.
          const year = [...question.matchAll(/\b(19[5-9]\d|20\d{2})\b/g)]
            .map((m) => Number(m[1]))
            .find((y) => y <= deps.now().getFullYear());
          // A wine they named is looked for by that name; otherwise the styles that suit, best first.
          const texts =
            wines.length > 0
              ? [...new Set(wines.map((w) => w.name))].slice(0, 2)
              : // Every style that suits is asked for, not only the three that are named in the advice.
                recommendStyles(
                  { food, state, likes: taste?.likes ?? [], ownedTypes: [], limit: OFFER_STYLES },
                  WINE_KNOWLEDGE,
                ).map((s) => searchTextOf(s.style));
          try {
            const now = deps.now();
            const policy = {
              maxAgeHours: { online: 24, local: 6 },
              allowedHosts: deps.offers.allowedHosts,
            };
            const found: ShownOffer[] = [];
            for (const text of texts.slice(0, OFFER_STYLES)) {
              const query = {
                text,
                year: year ?? null,
                sizeMl: STANDARD_BOTTLE_ML,
                maxCents:
                  state.budgetMaxEuros === null ? null : Math.round(state.budgetMaxEuros * 100),
                currency: "EUR",
                channel: state.channel,
              };
              const result = selectOffers(await deps.offers.search(query), query, now, policy);
              found.push(...result.shown);
              offersDropped.push(...result.rejected.flatMap((r) => r.defects));
            }
            const unique = found.filter(
              (f, i) => found.findIndex((g) => g.offer.id === f.offer.id) === i,
            );
            offers = unique.slice(0, 3).map(({ offer, level }) => ({
              level,
              producer: offer.producer,
              name: offer.name,
              year: offer.year,
              sizeMl: offer.sizeMl,
              priceCents: offer.priceCents!,
              currency: offer.currency,
              merchant: offer.merchant,
              store: offer.kind === "local" ? (offer.store?.name ?? null) : null,
              url: offer.url,
              observedAt: offer.observedAt,
            }));
            offerCheck = offers.length > 0 ? "shown" : "nothing-verified";
          } catch {
            // The source is down or answered nonsense: style advice stands, and the answer says shops were not checked.
            offerCheck = "provider-down";
            offers = [];
            offersDropped = [];
          }
        }
        plan = {
          ...plan,
          kind: "buying",
          styles,
          offers,
          offerCheck,
          offersDropped: offersDropped.slice(0, 20),
        };
      }

      const ask = deps.buying
        ? nextQuestion(state, {
            dishKnown: food !== null,
            ownedSuits,
            onTopic: true,
            // Where to buy and the location are only asked when a source could use the answer.
            canSearch: deps.offers !== null,
          })
        : null;
      state = withAsked({ ...state, offered: plan.picks.map((p) => p.vintageId).slice(0, 6) }, ask);
      return {
        plan: { ...plan, ask, state, friends },
        bottles,
        otherBottles,
        // "Based on your taste" is about the asker; with friends at the table the note on the bottle says it.
        personal: personal && friendTastes.length === 0,
      };
    },
  };
}

export type SommelierIntelligence = ReturnType<typeof createSommelierIntelligence>;

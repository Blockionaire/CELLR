import "server-only";
import {
  aboutWine,
  advance,
  asksFriendCellar,
  asksOwnCellar,
  leansOnBefore,
  asksNotAlreadyOwned,
  NO_FRIEND_CELLAR,
  type FriendCellar,
  askedFor,
  asksPairing,
  asksWhichOf,
  cellarQuestionKind,
  isSmallTalk,
  findMentions,
  hasAnyMention,
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
  bottlesFor,
  decidePairing,
  dishesFor,
  enoughFor,
  parseMenu,
  planMenu,
  servingAdvice,
  groupTasteScore,
  hasTaste,
  mentionedWines,
  parseFood,
  routeDishReading,
  dishPhrase,
  asksForWine,
  mergeDishReading,
  type DishReading,
  type DishRoute,
  isCloseCall,
  conservativePicks,
  applyPairingReview,
  type PairingReview,
  type ReviewInput,
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
  /** Menus, wine-to-food, serving, keeping and quantities (its own switch). */
  experiences?: boolean;
  /**
   * The friends named in a question, as the database judges them for the asker in this request (accepted
   * friendship, taste shared, sommelier consent). Absent: the social sommelier is off and a name is only text.
   */
  friends?: (
    handles: readonly string[],
  ) => Promise<Array<{ handle: string; status: MentionStatus; taste: TasteSignals | null }>>;
  /**
   * One named friend's cellar, as the database gives it to the asker in this request (accepted friendship, the
   * cellar shown to the asker, and the friend's own consent for a sommelier to use it). Absent: never looked at.
   */
  friendCellar?: (handle: string) => Promise<FriendCellar>;
  /**
   * A model's reading of a dish the parser shows it may have misread (S10, switch `sommelier_dish_ai`): given the
   * dish phrase alone, it gives the engine's own dish profile, or null (then the parser's reading is used, as
   * without the switch). Never called for a question that names a friend. Absent: never called.
   */
  readDish?: (phrase: string, options?: { cacheOnly?: boolean }) => Promise<DishReading | null>;
  /**
   * A model's second opinion in a close call (S10, an experiment: switch `sommelier_second_opinion`): it may put
   * the engine's own picks in another order, leave some out, or say none suits; never add one. Given the dish as
   * the engine read it and each pick as a style, never a producer, a name or the household. Never called for a
   * question that names a friend. Null: the engine's picks stand.
   */
  secondOpinion?: (input: ReviewInput, refs: string[]) => Promise<PairingReview | null>;
  /** Hears which reading of the dish the engines used (for the benchmark and metrics). Changes nothing. */
  observe?: (seen: { food: FoodProfile | null; route: DishRoute | null }) => void;
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
  /**
   * What the person asked earlier in this conversation, oldest first, as the screen sent it along. Untrusted, and
   * read for one thing only: whom the conversation is about, when the question itself names nobody.
   */
  earlier?: string[];
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
  keeping: [],
  quantity: null,
  friendCellar: null,
  coursesCut: false,
  dishIdeasTier: null,
  ask: null,
  state,
  friends: [],
});

/** How long the engines wait for a model's dish reading or second opinion before going on without it. */
const READ_MS = 10_000;
const REVIEW_MS = 10_000;
/** The value of a promise, or null when it fails or takes longer than `ms`. Never throws. */
const within = <T>(promise: Promise<T>, ms: number): Promise<T | null> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise.catch(() => null),
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), ms);
    }),
  ]).finally(() => clearTimeout(timer));
};

export function createSommelierIntelligence(deps: IntelligenceDeps) {
  return {
    /** Whether a question names a dish the food engine understands (no I/O). */
    readsDish(question: string): boolean {
      return parseFood(question.slice(0, 800), FOOD).main !== null;
    },
    /**
     * Whether a question asks if there is enough for a number of guests at a dish ("8 guests, roast lamb: do I
     * have enough bottles?"). It reads like a count of the cellar, and is not one: the engines answer it.
     */
    asksEnoughFor(question: string): boolean {
      const text = question.slice(0, 800);
      const guests =
        /\b(\d{1,4})\s*(?:guests|people|persons|of us|gasten|personen|mensen|man)\b/i.exec(text);
      return (
        deps.experiences === true &&
        askedFor(text) === "quantity" &&
        // "Where is my Barolo? ...I want enough wine" asks where: that stays a question of fact.
        cellarQuestionKind(text) !== "location" &&
        // The same bounds as the conversation's state: a number it would not keep is not a number of guests.
        guests !== null &&
        Number(guests[1]) >= 1 &&
        Number(guests[1]) <= 500 &&
        parseFood(text, FOOD).main !== null
      );
    },
    /** Whether buying advice is the engines' (then the model's own is dropped). */
    buying: deps.buying,
    /** Whether friends named in a question are looked up (then no name may ever reach a model). */
    social: deps.friends !== undefined,
    /**
     * The plan for a question, or null when the question is not one the engines answer (a general question about
     * wine with no dish and nothing to buy): the caller then answers it the way it did before.
     */
    async plan(request: PlanRequest): Promise<Planned | null> {
      const previous = readState(request.state);
      // Names of people are taken out before anything reads the question: "@pasta.lover" is not a dish, and a
      // name never reaches the food engine, the state or a log.
      const asked = request.question.slice(0, 800);
      const namedNow = deps.friends ? findMentions(asked) : [];
      // A follow-up ("€50", "and with the fish?") is still about the people the conversation named: the last
      // earlier question that named someone says who. Only the name is carried, as the asker wrote it; who
      // that is and what they allow is asked again below, so consent withdrawn between two turns ends it.
      const continues =
        previous.intent !== null || previous.dish !== null || previous.asked.length > 0;
      const before =
        deps.friends && namedNow.length === 0 && continues
          ? ((request.earlier ?? [])
              .map((q) => q.slice(0, 800))
              .findLast((q) => findMentions(q).length > 0) ?? null)
          : null;
      const mentions = before ? findMentions(before) : namedNow;
      const question = withoutMentions(asked);
      // Who they are, and what each allows, is the database's answer in this request: never the screen's.
      const table = mentions.length > 0 && deps.friends ? await deps.friends(mentions) : [];
      const friendTastes = table.flatMap((f) =>
        f.status === "included" && f.taste ? [f.taste] : [],
      );
      const friends = table.map(({ handle, status }) => ({ handle, status }));
      // A friend's cellar is looked at only when the question is about what that one friend owns ("what does he
      // own that suits…", "a present she does not have yet"), and only for a name the database called a friend.
      // A follow-up keeps that only while it leans on that question ("and with the oysters?", "does he have
      // something lighter?") and does not turn to the asker's own wines; a question that stands on its own is
      // answered from the asker's cellar again. A present stays a present while the conversation is about one.
      const aboutTheirs =
        asksFriendCellar(asked) ||
        (before !== null &&
          asksFriendCellar(before) &&
          leansOnBefore(asked) &&
          !asksOwnCellar(asked));
      const notOwned =
        asksNotAlreadyOwned(asked) ||
        (before !== null && previous.intent === "gift" && asksNotAlreadyOwned(before));
      const cellarOf =
        deps.friendCellar &&
        mentions.length === 1 &&
        table[0] !== undefined &&
        table[0].status !== "unavailable" &&
        (aboutTheirs || notOwned)
          ? mentions[0]!
          : null;
      const theirs = cellarOf
        ? await deps.friendCellar!(cellarOf).catch(() => NO_FRIEND_CELLAR)
        : null;
      // What their wines answer to, for "not already in their cellar": read from the wines, never stored.
      const theirKeys = new Set(
        (theirs?.wines ?? []).flatMap((w) => [
          ...readWine(
            {
              type: w.type,
              name: w.name,
              region: w.region,
              appellation: w.appellation,
              countryCode: w.countryCode,
              profile: null,
            },
            WINE_KNOWLEDGE,
          ).rules,
          ...(w.appellation ? [normalizeText(w.appellation)] : []),
        ]),
      );
      /** What the plan says about their cellar when it was asked about and not used for picks. */
      let friendCellar: SommelierPlan["friendCellar"] =
        cellarOf && theirs && theirs.status !== "included"
          ? { handle: cellarOf, status: "not-shared", outcome: null, picks: [], leftOut: [] }
          : null;
      /**
       * The dish, read by the parser, and by a model where the parser shows it may have misread it (S10).
       *
       * Nothing at all goes to a model for a conversation that names someone, in any form ("@anna", "@ anna",
       * "anna@…"), in this question or an earlier one the screen sent: the friends' consent says no model sees
       * such a question, not even its dish. Otherwise only the dish phrase is sent, and only for the question
       * itself when it is about a dish: a follow-up's dish (the conversation's state) is looked up among the
       * readings already made, never sent again. A question with no food in it is sent only when it asks which
       * wine to pour, opens a conversation, names no wine, and is not a menu or one of the experiences.
       */
      const namesSomeone =
        mentions.length > 0 ||
        hasAnyMention(asked) ||
        (request.earlier ?? []).some((q) => hasAnyMention(q.slice(0, 800)));
      let route: DishRoute | null = null;
      const understand = async (
        parsed: FoodProfile,
        text: string,
        followUp: boolean,
      ): Promise<FoodProfile> => {
        if (!deps.readDish || namesSomeone) return parsed;
        const wanted = routeDishReading(parsed);
        route ??= wanted;
        if (!wanted.read) return parsed;
        if (followUp) {
          const kept = await within(deps.readDish(text, { cacheOnly: true }), READ_MS);
          return kept ? mergeDishReading(parsed, kept, FOOD, text) : parsed;
        }
        if (parseMenu(text, FOOD) !== null) return parsed;
        if (
          parsed.main === null &&
          (previous.dish !== null ||
            !asksForWine(text) ||
            mentionedWines(text, WINE_KNOWLEDGE).length > 0 ||
            askedFor(text) !== null)
        )
          return parsed;
        const phrase = dishPhrase(text, FOOD);
        if (!phrase) return parsed;
        const reading = await within(deps.readDish(phrase), READ_MS);
        return reading ? mergeDishReading(parsed, reading, FOOD, phrase) : parsed;
      };
      const said = await understand(parseFood(question, FOOD), question, false);
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

      // Everything that is read about the household for one question, read once.
      let gathered: Promise<{
        items: CellarItem[];
        profiles: ReadonlyMap<string, InsightOutput>;
        taste: TasteSignals | null;
        read: Read[];
        /** Every wine, whatever colour was wished for: a bottle asked about by name is not hidden by that wish. */
        all: Read[];
      }> | null = null;
      const gather = () =>
        (gathered ??= (async () => {
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

          const all: Read[] = items.map((item) => ({
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
          const read = all.filter((r) => state.wineType === null || r.item.type === state.wineType);
          return { items, profiles, taste, read, all };
        })());

      // The dish of this turn, or the one the conversation is about.
      const food: FoodProfile | null =
        said.main !== null
          ? said
          : state.dish !== null
            ? ((d) => (d.main === null ? null : d))(
                await understand(parseFood(state.dish, FOOD), state.dish, true),
              )
            : null;
      deps.observe?.({ food, route });
      const buying = state.intent === "buy" || state.intent === "gift";

      /**
       * The premium experiences: how to serve or keep a bottle, what to cook with it, a wine for every course,
       * whether there are enough bottles for the guests. All built on the same engines and the same inventory;
       * each answers only when the question is that kind and names what it needs, and otherwise leaves the
       * question to the rest of this function.
       */
      const planExperience = async (): Promise<Planned | null> => {
        const kind = askedFor(question);
        const menu = kind === null && !buying ? parseMenu(question, FOOD) : null;
        if (kind === null && menu === null) return null;
        const { profiles, taste, read, all } = await gather();
        // A bottle asked about by name is looked for among all the wines: an earlier wish for a colour ("which
        // red with the lamb?") does not hide the Chablis that is asked about now.
        const owned =
          named.length === 0
            ? []
            : all.filter((r) => named.some((k) => r.reading.keys.includes(k)));
        // A dish in this question and a question about what to pour with it is a pairing, whatever else is
        // mentioned (a bottle to keep, one not to decant): the pairing below answers it, named wines first.
        const dishSaid = said.main !== null;
        if (
          kind !== null &&
          kind !== "quantity" &&
          dishSaid &&
          (kind === "wine-to-food" ||
            asksPairing(question) ||
            (owned.length >= 2 && asksWhichOf(question)))
        )
          return null;
        const base = { ...emptyPlan(state), friends, considered: read.length };
        const done = (plan: SommelierPlan, bottles: Read[], other: Read[]): Planned => ({
          plan: {
            ...plan,
            state: { ...state, offered: plan.picks.map((p) => p.vintageId).slice(0, 6) },
          },
          bottles: bottles.map((r) => toSommelierBottle(r.item)),
          otherBottles: other.map((r) => toSommelierBottle(r.item)),
          personal: false,
        });
        const candidate = (r: Read): PairingCandidate<Read> => ({
          item: r,
          wine: { ...r.reading, type: r.item.type },
          tier: r.reading.tier,
          taste: groupTasteScore(
            [...(taste ? [taste] : []), ...friendTastes].map((t) =>
              tasteScore({ ...r.reading, type: r.item.type }, t),
            ),
          ),
        });
        const open = read.filter((r) => blockedBy(r, state) === null);

        if (kind === "serving" && owned.length > 0) {
          const year = deps.now().getFullYear();
          const shown = owned.slice(0, 3);
          return done(
            {
              ...base,
              kind: "serving",
              serving: shown.map((r) => {
                const profile = profiles.get(r.item.vintageId);
                return {
                  vintageId: r.item.vintageId,
                  ...servingAdvice(
                    {
                      type: r.item.type,
                      structure: r.reading.structure,
                      tier: r.reading.tier,
                      year: r.item.year,
                      // The wine's own profile wins over the rule only when it is fact about this exact wine.
                      profile:
                        profile && profileFacts(profile)?.exact
                          ? { serving: profile.serving, decantMinutes: profile.decantMinutes }
                          : null,
                    },
                    year,
                  ),
                };
              }),
            },
            [],
            shown,
          );
        }
        if (kind === "keeping" && owned.length > 0) {
          const shown = owned.slice(0, 3);
          return done(
            {
              ...base,
              kind: "keeping",
              keeping: shown.map((r) => ({
                vintageId: r.item.vintageId,
                from: r.item.drink.from ?? null,
                until: r.item.drink.until ?? null,
                phase: r.item.drink.phase,
                basis:
                  r.item.drink.source === "own"
                    ? ("own" as const)
                    : r.item.drink.source === "ai"
                      ? ("profile" as const)
                      : ("style" as const),
              })),
            },
            [],
            shown,
          );
        }
        if (kind === "wine-to-food" && owned.length > 0) {
          const wine = owned[0]!;
          const lang = request.locale === "nl" ? "nl" : "en";
          const { ideas, avoid } = dishesFor({ ...wine.reading, type: wine.item.type }, FOOD);
          return done(
            {
              ...base,
              kind: "wine-to-food",
              dishIdeas: ideas.map((i) => ({
                dishId: i.dish.dishId ?? "",
                label: i.dish.label[lang],
                pros: i.assessment.pros.slice(0, 3),
              })),
              dishIdeasTier: wine.reading.tier,
              avoid,
            },
            [],
            [wine],
          );
        }
        if (kind === "quantity" && state.guests !== null && food) {
          const decision = decidePairing(food, open.map(candidate), open.length);
          const picks = decision.picks.slice(0, 3);
          const needed = bottlesFor(state.guests).bottles;
          // Every bottle of every wine that suits counts, not only the three that are shown.
          const available = decision.picks.reduce((sum, p) => sum + p.item.free, 0);
          return done(
            {
              ...base,
              kind: "quantity",
              dish: food.said ?? state.dish,
              dishConfidence: food.confidence,
              outcome: decision.outcome,
              confidence: decision.confidence,
              picks: picks.map((p) => toPick(p)),
              quantity: {
                guests: state.guests,
                needed,
                available,
                ...{ short: enoughFor(needed, available).short },
              },
            },
            picks.map((p) => p.item),
            [],
          );
        }
        if (menu) {
          const lang = request.locale === "nl" ? "nl" : "en";
          const readable = menu.courses.flatMap((c) => (c.food ? [c.food] : []));
          const planned = planMenu(readable, open.map(candidate), (r) => r.item.vintageId);
          const poured = planned.flatMap((c) => (c.pick ? [c.pick.item] : []));
          let n = 0;
          return done(
            {
              ...base,
              kind: "menu",
              courses: menu.courses.map((course) => {
                // A course that could not be read is said, and gets no wine: that is not "nothing suits".
                if (!course.food)
                  return {
                    dish: course.said.slice(0, 120),
                    outcome: "none" as const,
                    pick: null,
                    shared: false,
                    unread: true,
                  };
                const c = planned[n++]!;
                return {
                  dish: (c.food.said ?? c.food.label[lang]).slice(0, 120),
                  outcome: c.decision.outcome,
                  pick: c.pick ? toPick(c.pick) : null,
                  shared: c.shared,
                  unread: false,
                };
              }),
              coursesCut: menu.cut,
            },
            poured.filter(
              (r, i) => poured.findIndex((x) => x.item.vintageId === r.item.vintageId) === i,
            ),
            [],
          );
        }
        return null;
      };
      // "What does @thomas own that suits us both with the lamb?": their wines are judged against the dish, for
      // the tastes at the table, and shown as theirs. Nothing of the asker's own cellar is offered beside them.
      if (cellarOf && theirs?.status === "included" && aboutTheirs && food) {
        const { taste } = await gather();
        const candidates = theirs.wines.map(
          (w): PairingCandidate<(typeof theirs.wines)[number]> => {
            const reading = readWine(
              {
                type: w.type,
                name: w.name,
                region: w.region,
                appellation: w.appellation,
                countryCode: w.countryCode,
                profile: null,
              },
              WINE_KNOWLEDGE,
            );
            return {
              item: w,
              wine: { ...reading, type: w.type },
              tier: reading.tier,
              taste: groupTasteScore(
                [...(taste ? [taste] : []), ...friendTastes].map((t) =>
                  tasteScore({ ...reading, type: w.type }, t),
                ),
              ),
            };
          },
        );
        const decision = conservativePicks(decidePairing(food, candidates), food);
        return {
          plan: {
            ...emptyPlan({ ...state, offered: [] }),
            kind: "pairing",
            dish: food.said ?? state.dish,
            dishConfidence: food.confidence,
            outcome: decision.outcome,
            confidence: decision.confidence,
            friends,
            friendCellar: {
              handle: cellarOf,
              status: "used",
              outcome: decision.outcome,
              picks: decision.picks.map((p) => ({
                producer: p.item.producer,
                name: p.item.name,
                year: p.item.year,
                type: p.item.type,
                level: p.assessment.level === "good" ? ("good" as const) : ("acceptable" as const),
                tier: p.tier,
                pros: p.assessment.pros.slice(0, 4),
                cons: p.assessment.cons.slice(0, 3),
              })),
              leftOut: [],
            },
          },
          bottles: [],
          otherBottles: [],
          personal: false,
        };
      }

      if (deps.experiences) {
        const experience = await planExperience();
        if (experience) return experience;
      }

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

      const { items, taste, read } = await gather();

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
          conservativePicks(
            decidePairing(
              food,
              from.filter((r) => blockedBy(r, state) === null).map((r) => candidate(r, true)),
            ),
            food,
          );
        // The wines they asked about first; when none of those suits, the rest of the cellar after all.
        let scope = pool;
        let decision = decide(scope);
        if (about.length > 0 && decision.outcome === "none") {
          scope = read;
          decision = decide(scope);
          plan = { ...plan, considered: read.length, kind: buying ? "buying" : "pairing" };
        }
        // A close call may get a model's second opinion: the same picks, in another order or fewer, never more.
        if (deps.secondOpinion && food && !namesSomeone && isCloseCall(decision, food)) {
          const refs = decision.picks.map((_, i) => `c${i + 1}`);
          const review = await within(
            deps.secondOpinion(
              {
                dish: {
                  main: food.main ?? "unknown",
                  structure: food.structure,
                  tags: [...food.tags],
                  readBy: food.readBy ?? "parser",
                },
                candidates: decision.picks.map((p, i) => ({
                  ref: refs[i]!,
                  type: p.item.item.type,
                  keys: p.item.reading.keys.slice(0, 8),
                  structure: {
                    body: p.item.reading.structure.body,
                    tannin: p.item.reading.structure.tannin,
                    acidity: p.item.reading.structure.acidity,
                    sweetness: p.item.reading.structure.sweetness,
                    oak: p.item.reading.structure.oak,
                  },
                  fizz: p.item.reading.structure.fizz === true,
                  level: p.assessment.level === "good" ? "good" : "acceptable",
                })),
              },
              refs,
            ),
            REVIEW_MS,
          );
          if (review) {
            // Whatever order it chose, after the first only picks with nothing against them (as without it).
            const kept = applyPairingReview(decision.picks, refs, review).filter(
              (p, i) => i === 0 || p.assessment.cons.length === 0,
            );
            decision =
              kept.length > 0
                ? { ...decision, picks: kept }
                : { ...decision, outcome: "none", picks: [], confidence: "low" };
          }
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
        // For a present, or when asked for what a friend does not have yet: styles found in the cellar they share
        // are left out, and said to be. "Not found in what they share" is all that is known: never "they do not
        // own it".
        const leaveOutTheirs =
          theirs?.status === "included" && (notOwned || state.intent === "gift");
        const all = recommendStyles(
          {
            food,
            state,
            // For a present to a friend who allows it: what they like. Their taste shapes the advice and is
            // never written into the conversation's state, which travels to the screen and back.
            // (A present is chosen for the receiver: the giver's own taste stays out of it.)
            likes: [
              ...friendTastes.flatMap((t) => [...t.likes, ...t.styles]),
              ...(state.intent === "gift" ? [] : (taste?.likes ?? [])),
            ],
            asked: named,
            ownedTypes: [...new Set(items.map((i) => i.type))],
            ...(leaveOutTheirs ? { limit: 9 } : {}),
          },
          WINE_KNOWLEDGE,
        );
        const inTheirs = (s: (typeof all)[number]) =>
          theirKeys.has(s.style.id) ||
          (s.style.wine.appellation != null &&
            theirKeys.has(normalizeText(s.style.wine.appellation)));
        const suggestions = leaveOutTheirs ? all.filter((s) => !inTheirs(s)).slice(0, 3) : all;
        if (leaveOutTheirs && cellarOf)
          friendCellar = {
            handle: cellarOf,
            status: "used",
            outcome: null,
            picks: [],
            leftOut: all
              .filter(inTheirs)
              .slice(0, 6)
              .map((s) => s.style.label[request.locale === "nl" ? "nl" : "en"]),
          };
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
                  {
                    food,
                    state,
                    // (A present is looked for by the receiver's taste, not the giver's: as in the advice.)
                    likes: state.intent === "gift" ? [] : (taste?.likes ?? []),
                    ownedTypes: [],
                    limit: OFFER_STYLES,
                  },
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
        plan: { ...plan, ask, state, friends, friendCellar },
        bottles,
        otherBottles,
        // "Based on your taste" is about the asker; with friends at the table the note on the bottle says it.
        personal: personal && friendTastes.length === 0,
      };
    },
  };
}

export type SommelierIntelligence = ReturnType<typeof createSommelierIntelligence>;

import {
  PROFILE_VERSION,
  type CellarItem,
  type CellarView,
  type FriendCellar,
  type InsightOutput,
  type OfferProvider,
  type Reservation,
  type RetailOffer,
  type SommelierAnswer,
} from "@cellr/domain";
import {
  FOOD,
  WINE_KNOWLEDGE,
  parseFood,
  readWine,
  type TasteSignals,
} from "@cellr/domain/intelligence";
import { aggregateInventory, buildTonight } from "@/server/cellar/service";
import { createSommelierIntelligence, profileFacts } from "@/server/sommelier/intelligence";
import { createSommelierService } from "@/server/sommelier/service";
import { buildFixture, NOW, type FixtureWine } from "../fixtures";
import type { Capability, Engine, EvalAnswer, OfferLevel, Scenario } from "../types";
import { WINES } from "../wines";
import { truthOf } from "./v3";

/**
 * SOMMELIER 3.0 AS THE APP RUNS IT with the engine and buying switches on and no AI: the app's own
 * `createSommelierService` with `createSommelierIntelligence`, on a fixed cellar. A conversation is played turn
 * by turn, each answer's state sent back with the next question, as the screen does.
 *
 * Stand-ins: the database reads (the fixed cellar, its reservations and profiles), the clock, and, for the retail
 * scenarios only, a retailer source made from the scenario's own offers. The app itself has no retailer source;
 * that one exists in this benchmark to prove the checks, and nowhere else.
 */
const CAPABILITIES: ReadonlySet<Capability> = new Set([
  "pairing",
  "facts",
  "evidence",
  "conversation",
  "buying",
  "offers",
  // The experience scenarios carry their reference as a note for a person to read; what is checked by machine is
  // that no wine is invented and nothing forbidden is offered. They are counted apart in the reports.
  "experiences",
  // Friends: the scenario's own `world` plays the database (who is a friend, what each shares and allows), as
  // `sommelier_friend_context` and `sommelier_friend_cellar` do in the app. Added in S9.
  "social",
]);

/** A researched profile of the exact wine, as the app stores one. */
function profileOf(f: FixtureWine): InsightOutput {
  return {
    summary: "Benchmark profile.",
    style: "",
    grapes: [...f.wine.grapes],
    tasting: "",
    serving: null,
    decantMinutes: null,
    abvPercent: null,
    drinkWindow: null,
    pairings: [],
    aging: "",
    structure: f.wine.structure,
    flavors: [],
    pairingKinds: [],
    version: PROFILE_VERSION,
    value: null,
    confidence: "high",
    evidence: "exact_wine",
    researched: true,
    sources: [{ name: "Benchmark", url: "https://www.example.com/wine" }],
  };
}

interface WorldOffer {
  id: string;
  style: string;
  producer: string;
  name: string;
  year: number | null;
  sizeMl: number;
  priceEuros: number;
  currency: string;
  merchant: string;
  url: string;
  observedHoursAgo: number;
  kind: "online" | "local";
  storeVerified?: boolean;
}
interface WorldFriend {
  handle: string;
  relation: "accepted" | "pending" | "none" | "removed";
  /** `ai`: the friend's own consent for a friend's sommelier (taste and cellar alike in these scenarios). */
  share: { taste: boolean; cellar: boolean; ai: boolean };
  likes?: string[];
  dislikes?: string[];
  cellar?: string[];
}
interface World {
  provider?: { status: "none" | "up" | "down"; offers?: WorldOffer[] };
  friends?: WorldFriend[];
  previously?: { friends?: WorldFriend[] };
}

/** A friend's stated likes and dislikes as the closed taste signals the app's database would return. */
function signalsOf(f: WorldFriend): TasteSignals {
  const likes = new Set(f.likes ?? []);
  const dislikes = new Set(f.dislikes ?? []);
  const styles = (["red", "white", "rose", "sparkling"] as const).filter((t) => likes.has(t));
  const said: TasteSignals["said"] = {};
  if (likes.has("light")) said.body = 2;
  if (likes.has("full-bodied")) said.body = 4.5;
  if (likes.has("tannic")) said.tannin = 4.5;
  if (dislikes.has("tannic")) said.tannin = 1.5;
  if (likes.has("sweet")) said.sweetness = 4;
  if (dislikes.has("sweet")) said.sweetness = 1;
  if (likes.has("high-acid")) said.acidity = 4.5;
  const focus = likes.has("red")
    ? "red"
    : likes.has("white") || likes.has("rose")
      ? "white_rose"
      : null;
  return { focus, said, trends: {}, styles: [...styles], likes: [] };
}
/** What marks a wine as a friend's in an answer: so that a wine shown without leave can be found. */
const producerOf = (handle: string) => `Cellar of ${handle}`;
function friendWinesOf(f: WorldFriend): FriendCellar["wines"] {
  return (f.cellar ?? []).flatMap((key) => {
    const w = WINES.find((x) => x.key === key);
    return w
      ? [
          {
            producer: producerOf(f.handle),
            name: w.name,
            year: w.year,
            type: w.type,
            region: w.region,
            appellation: w.appellation,
            countryCode: w.countryCode,
          },
        ]
      : [];
  });
}

function providerOf(world: World | undefined): {
  provider: OfferProvider | null;
  offers: WorldOffer[];
} {
  const p = world?.provider;
  if (!p || p.status === "none") return { provider: null, offers: [] };
  const offers = p.offers ?? [];
  return {
    offers,
    provider: {
      id: "benchmark",
      allowedHosts: ["example.nl", "example.com"],
      async search(): Promise<RetailOffer[]> {
        if (p.status === "down") throw new Error("provider down");
        // Everything it has, sound or not: choosing is the engine's job.
        return offers.map((o) => ({
          id: o.id,
          producer: o.producer,
          name: o.name,
          year: o.year,
          sizeMl: o.sizeMl,
          priceCents: o.priceEuros > 0 ? Math.round(o.priceEuros * 100) : null,
          currency: o.currency,
          merchant: o.merchant,
          url: o.url,
          observedAt: new Date(NOW.getTime() - o.observedHoursAgo * 3_600_000).toISOString(),
          kind: o.kind,
          store:
            o.kind === "local" ? { name: o.merchant, verified: o.storeVerified === true } : null,
          // In the scenarios a verified store is one that itself confirmed it has the bottle.
          inStock: o.kind === "local" && o.storeVerified === true ? true : null,
        }));
      },
    },
  };
}

export const v3App: Engine = {
  name: "v3-app",
  describes:
    "Sommelier 3.0 in the app (createSommelierService + createSommelierIntelligence, engine and buying on, no AI)",
  capabilities: CAPABILITIES,
  async run(scenario: Scenario) {
    const missing = scenario.needs.filter((n) => !CAPABILITIES.has(n));
    const fixture = buildFixture(scenario);
    const favorites = new Set(fixture.wines.filter((f) => f.favorite).map((f) => f.wineId));
    const scores = fixture.wines
      .filter((f) => f.rating !== null)
      .map((f) => ({ vintageId: f.vintageId, score: f.rating! }));
    const reservedOf = new Map<string, Reservation>(
      fixture.wines
        .filter((f) => f.reserved > 0)
        .map((f) => [f.vintageId, { count: f.reserved, title: "Benchmark occasion", on: null }]),
    );
    const cellar = async (): Promise<CellarView> => {
      const view = aggregateInventory(fixture.rows, favorites, scores, NOW);
      return {
        ...view,
        items: view.items.map((i): CellarItem => ({
          ...i,
          reserved: reservedOf.get(i.vintageId) ?? null,
        })),
      };
    };
    const profiles = new Map(
      fixture.wines.filter((f) => f.profiled).map((f) => [f.vintageId, profileOf(f)]),
    );
    const world = scenario.world as World | undefined;
    const { provider, offers: worldOffers } = providerOf(world);
    // The friend graph as it is at the turn being asked: `previously` for the earlier turns of a scenario in
    // which something is withdrawn, `friends` at the last one. Read anew for every question, as in the app.
    let friendsNow: WorldFriend[] = world?.friends ?? [];
    const friendOf = (handle: string) =>
      friendsNow.find((f) => f.handle.toLowerCase() === handle.toLowerCase()) ?? null;
    const social = world?.friends !== undefined;
    const service = createSommelierService({
      intelligence: createSommelierIntelligence({
        cellar,
        profiles: async () => profiles,
        taste: async () => null,
        ...(social
          ? {
              friends: async (handles: readonly string[]) =>
                handles.map((handle) => {
                  const f = friendOf(handle);
                  if (!f || f.relation !== "accepted")
                    return { handle, status: "unavailable" as const, taste: null };
                  return f.share.taste && f.share.ai
                    ? { handle, status: "included" as const, taste: signalsOf(f) }
                    : { handle, status: "no-taste" as const, taste: null };
                }),
              friendCellar: async (handle: string): Promise<FriendCellar> => {
                const f = friendOf(handle);
                if (!f || f.relation !== "accepted") return { status: "unavailable", wines: [] };
                return f.share.cellar && f.share.ai
                  ? { status: "included", wines: friendWinesOf(f) }
                  : { status: "not-shared", wines: [] };
              },
            }
          : {}),
        offers: provider,
        buying: true,
        experiences: true,
        now: () => NOW,
      }),
      cellar,
      storage: async () => [],
      racks: async () => ({ units: [], unplaced: [] }),
      tonight: async (request, taste) =>
        buildTonight(fixture.rows, favorites, scores, request, NOW, taste ?? null),
      llm: null,
      spend: async () => {},
      householdId: async () => "00000000-0000-4000-8000-0000000000aa",
      locale: async () => scenario.lang,
      recordUsage: async () => {},
    });

    let state: unknown = undefined;
    let answer: SommelierAnswer | null = null;
    let ms = 0;
    const said: Array<{ role: "user" | "assistant"; text: string }> = [];
    for (const [n, turn] of scenario.turns.entries()) {
      friendsNow =
        n < scenario.turns.length - 1
          ? (world?.previously?.friends ?? world?.friends ?? [])
          : (world?.friends ?? []);
      said.push({ role: "user", text: turn.user.slice(0, 800) });
      const started = performance.now();
      answer = await service.ask({
        messages: said.slice(-12),
        mode: "chat",
        state,
        ...(turn.budgetEuros === undefined ? {} : { budgetEuros: turn.budgetEuros }),
      });
      ms = performance.now() - started;
      state = answer.plan?.state;
      said.push({ role: "assistant", text: "…" });
    }
    const plan = answer!.plan ?? null;
    const keyOf = (vintageId: string) => fixture.keyOfVintage.get(vintageId) ?? null;
    // What the engine offers to open: the plan's picks when it answered, V1's cards otherwise.
    const offered = plan
      ? plan.picks.map((p) => p.vintageId)
      : answer!.bottles.map((b) => b.vintageId);
    const keys = offered.map(keyOf);

    const flags = new Set<string>();
    for (const pick of plan?.picks ?? [])
      for (const note of pick.notes) {
        if (note === "partly-reserved") flags.add("reserved");
        if (note === "young" || note === "past") flags.add(note);
        // A warning that the wine may be over its best is the app's honest form of "past" when it cannot be sure.
        if (note === "may-be-past") flags.add("past");
        if (note === "estimate" || note === "by-name") flags.add("estimate");
        if (note === "little-known") flags.add("unknown-data");
      }
    for (const aside of plan?.setAside ?? [])
      flags.add(
        aside.reason === "too-young"
          ? "young"
          : aside.reason === "reserved"
            ? "reserved"
            : "turned-down",
      );
    if (plan?.closest?.notes.includes("past")) flags.add("past");

    const question = scenario.turns.at(-1)!.user;
    const food = ((f) => (f.main === null && plan?.dish ? parseFood(plan.dish, FOOD) : f))(
      parseFood(question, FOOD),
    );
    const styleOfUrl = new Map(worldOffers.map((o) => [o.url, o]));
    const result: EvalAnswer = {
      ...(missing.length > 0 ? { unsupported: missing } : {}),
      food: { truth: truthOf(food) },
      verdict: plan?.outcome ?? null,
      bottles: keys.filter((k): k is string => k !== null),
      invented: keys.filter((k) => k === null).length,
      flags: [...flags],
      facts: answer!.facts
        ? {
            bottles: answer!.facts.bottles,
            wines: answer!.facts.wines,
            ...(answer!.facts.matchedBottles === undefined
              ? {}
              : { matchedBottles: answer!.facts.matchedBottles }),
          }
        : null,
      confidence: plan?.confidence ?? null,
      // The tier of every wine, read the way the app reads it (the plan only carries the wines it offers).
      tiers: Object.fromEntries(
        fixture.wines.map((f) => [
          f.key,
          readWine(
            {
              type: f.wine.type,
              name: f.wine.name,
              region: f.stripped ? null : f.wine.region,
              appellation: f.stripped ? null : f.wine.appellation,
              countryCode: f.stripped ? null : f.wine.countryCode,
              profile: f.profiled ? profileFacts(profileOf(f)) : null,
            },
            WINE_KNOWLEDGE,
          ).tier,
        ]),
      ),
      buy: [
        ...(plan?.styles ?? []).map((s) => ({
          style: s.styleId,
          minEuros: s.fromEuros,
          maxEuros: null,
          level: "style" as OfferLevel,
        })),
        ...(plan?.offers ?? []).map((o) => ({
          style: styleOfUrl.get(o.url)?.style ?? null,
          minEuros: o.priceCents / 100,
          maxEuros: o.priceCents / 100,
          level: o.level as OfferLevel,
        })),
      ],
      state: plan
        ? { ...plan.state, asked: null, rejected: null, offered: null, recipientLikes: null }
        : {},
      asks: plan?.ask ?? null,
      ...(social
        ? {
            friends: {
              resolved: (plan?.friends ?? [])
                .filter((f) => f.status !== "unavailable")
                .map((f) => f.handle),
              taste: (plan?.friends ?? [])
                .filter((f) => f.status === "included")
                .map((f) => f.handle),
              cellar: plan?.friendCellar?.status === "used" ? [plan.friendCellar.handle] : [],
              // A friend's wine in the answer although that friend does not share their cellar now.
              leaked: (world?.friends ?? [])
                .filter(
                  (f) =>
                    !(f.relation === "accepted" && f.share.cellar && f.share.ai) &&
                    JSON.stringify(answer).includes(producerOf(f.handle)),
                )
                .map((f) => f.handle),
            },
          }
        : {}),
      offers: (plan?.offers ?? []).map((o) => styleOfUrl.get(o.url)?.id ?? "unknown"),
      followedInjection: false,
    };
    return { answer: result, ms };
  },
};

import { describe, expect, it } from "vitest";
import { EMPTY_STATE } from "./buying/state";
import { isStoredAnswer } from "./sommelier-conversation";
import { readPlan, SOMMELIER_PLAN_VERSION, type SommelierPlan } from "./sommelier-plan";

const plan = (over: Partial<SommelierPlan> = {}): SommelierPlan => ({
  v: SOMMELIER_PLAN_VERSION,
  kind: "buying",
  dish: "oysters",
  dishConfidence: "high",
  outcome: "none",
  confidence: "medium",
  considered: 0,
  picks: [],
  closest: null,
  setAside: [],
  styles: [],
  offers: [],
  offerCheck: "no-provider",
  offersDropped: [],
  courses: [],
  dishIdeas: [],
  avoid: [],
  serving: [],
  keeping: [],
  quantity: null,
  coursesCut: false,
  friendCellar: null,
  dishIdeasTier: null,
  ask: null,
  state: EMPTY_STATE,
  friends: [],
  ...over,
});
const offer = (url: string) => ({
  level: "online-offer" as const,
  producer: "Domaine Exemple",
  name: "Muscadet",
  year: 2023,
  sizeMl: 750,
  priceCents: 1100,
  currency: "EUR",
  merchant: "Voorbeeld Wijnhandel",
  store: null,
  url,
  observedAt: "2026-11-19T16:00:00Z",
});
const answer = (p: unknown) => ({
  source: "basic",
  text: null,
  basic: "nothing",
  bottles: [],
  reason: null,
  plan: p,
});

describe("a plan that was kept, or sent by anyone", () => {
  it("is used when it is one", () => {
    expect(readPlan(plan())).toEqual(plan());
    expect(isStoredAnswer(answer(plan()))).toBe(true);
    expect(isStoredAnswer(answer(undefined))).toBe(true);
    expect(isStoredAnswer(answer(null))).toBe(true);
  });
  it("is not drawn when it is anything else", () => {
    for (const bad of [
      {},
      "plan",
      { ...plan(), v: 99 },
      { ...plan(), picks: "none" },
      { ...plan(), outcome: "perfect" },
    ]) {
      expect(readPlan(bad)).toBeNull();
      expect(isStoredAnswer(answer(bad))).toBe(false);
    }
  });
  it("never carries a link that is not a shop's https page", () => {
    expect(readPlan(plan({ offers: [offer("https://www.example.nl/wijn/1")] }))).not.toBeNull();
    for (const url of [
      "javascript:alert(1)",
      "http://www.example.nl/wijn/1",
      "data:text/html,x",
      "ftp://x.nl/y",
      "//evil.test",
    ])
      expect(readPlan(plan({ offers: [offer(url)] })), url).toBeNull();
  });

  it("still reads a plan kept before the premium experiences existed", () => {
    // What S3 to S5 stored: none of the fields the experiences added.
    const {
      courses,
      coursesCut,
      dishIdeas,
      dishIdeasTier,
      avoid,
      serving,
      keeping,
      quantity,
      ...old
    } = plan();
    void [courses, coursesCut, dishIdeas, dishIdeasTier, avoid, serving, keeping, quantity];
    const read = readPlan(old);
    expect(read).not.toBeNull();
    expect(read).toMatchObject({ courses: [], serving: [], keeping: [], quantity: null });
    expect(
      isStoredAnswer({
        source: "basic",
        text: null,
        basic: "nothing",
        bottles: [],
        reason: null,
        plan: old,
      }),
    ).toBe(true);
  });

  it("refuses experience values no engine would produce", () => {
    const id = "6f1c2b0a-1111-4111-8111-111111111111";
    const serving = (tempC: { min: number; max: number }) => ({
      vintageId: id,
      tempC,
      fridgeMinutes: 0,
      decant: { kind: "no" as const, minutes: 0 },
      glass: "red" as const,
      basis: "style" as const,
      tier: "estimate" as const,
    });
    expect(readPlan(plan({ serving: [serving({ min: 16, max: 18 })] }))).not.toBeNull();
    expect(readPlan(plan({ serving: [serving({ min: 1e9, max: -40 })] }))).toBeNull();
    expect(readPlan(plan({ serving: [serving({ min: 18, max: 16 })] }))).toBeNull();
    const quantity = { guests: 8, needed: 4, available: 2, short: 2 };
    expect(readPlan(plan({ quantity }))).not.toBeNull();
    expect(readPlan(plan({ quantity: { ...quantity, guests: -3 } }))).toBeNull();
    expect(readPlan(plan({ quantity: { ...quantity, short: -1 } }))).toBeNull();
    const keeping = {
      vintageId: id,
      from: 2024,
      until: 2032,
      phase: "peak" as const,
      basis: "style" as const,
    };
    expect(readPlan(plan({ keeping: [keeping] }))).not.toBeNull();
    expect(readPlan(plan({ keeping: [{ ...keeping, from: 2040 }] }))).toBeNull();
  });
});

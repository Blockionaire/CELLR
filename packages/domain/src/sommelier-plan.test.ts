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
  quantity: null,
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
});

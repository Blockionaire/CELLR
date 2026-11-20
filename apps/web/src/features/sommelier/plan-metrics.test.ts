import { describe, expect, it } from "vitest";
import {
  AnalyticsPropsSchema,
  EMPTY_STATE,
  type SommelierAnswer,
  type SommelierPlan,
} from "@cellr/domain";
import { answerMetrics } from "./plan-metrics";

const SECRET_DISH = "grandma's secret oyster stew";
const VINTAGE = "11111111-1111-4111-8111-111111111111";
const plan: SommelierPlan = {
  v: 1,
  kind: "buying",
  dish: SECRET_DISH,
  dishConfidence: "high",
  outcome: "good",
  confidence: "medium",
  considered: 4,
  picks: [
    {
      vintageId: VINTAGE,
      level: "good",
      tier: "appellation",
      pros: ["classic"],
      cons: [],
      notes: [],
    },
  ],
  closest: null,
  setAside: [],
  styles: [
    {
      styleId: "muscadet",
      label: "Muscadet (Loire)",
      type: "white",
      fromEuros: 9,
      reason: "suits-dish",
      pros: [],
    },
  ],
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
  ask: "budget",
  state: { ...EMPTY_STATE, dish: SECRET_DISH, budgetMaxEuros: 25 },
  friends: [{ handle: "anna", status: "included" }],
};
const answer: SommelierAnswer = {
  source: "basic",
  text: null,
  basic: "pairing",
  bottles: [],
  reason: null,
  plan,
};

describe("what is measured about an answer", () => {
  it("is codes and counts, and passes the analytics rules", () => {
    const props = answerMetrics(answer);
    expect(props).toEqual({
      source: "basic",
      engine: "v3",
      kind: "buying",
      outcome: "good",
      confidence: "medium",
      picks: 1,
      set_aside: 0,
      styles: 1,
      asked: "budget",
      friends: 1,
    });
    expect(AnalyticsPropsSchema.safeParse(props).success).toBe(true);
  });
  it("carries nothing a person typed or owns: no dish, wine, price, style or friend's name", () => {
    const sent = JSON.stringify(answerMetrics(answer));
    for (const secret of [SECRET_DISH, "oyster", VINTAGE, "muscadet", "anna", "25", "Loire"])
      expect(sent, secret).not.toContain(secret);
  });
  it("marks an answer of the old sommelier as such", () => {
    expect(
      answerMetrics({ source: "ai", text: "…", basic: null, bottles: [], reason: null }),
    ).toEqual({
      source: "ai",
      engine: "v1",
    });
  });
});

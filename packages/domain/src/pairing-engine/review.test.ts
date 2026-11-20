import { describe, expect, it } from "vitest";
import { FOOD } from "../food/knowledge";
import { parseFood } from "../food/parse";
import type { FoodProfile } from "../food/types";
import type { Assessment } from "./assess";
import { conservativePicks, type PairingDecision, type PairingPick } from "./decide";
import {
  applyPairingReview,
  checkPairingReview,
  isCloseCall,
  pairingReviewJsonSchema,
} from "./review";

const pick = (
  item: string,
  score: number,
  cons: Assessment["cons"] = [],
  level: Assessment["level"] = "good",
): PairingPick<string> => ({
  item,
  assessment: { level, score, pros: ["classic"], cons, clash: null },
  tier: "appellation",
});
const decision = (...picks: PairingPick<string>[]): PairingDecision<string> => ({
  outcome:
    picks.length === 0 ? "none" : picks[0]!.assessment.level === "good" ? "good" : "acceptable",
  picks,
  confidence: "high",
  closest: null,
  all: picks,
});
const lamb = parseFood("roast lamb", FOOD);
const guess: FoodProfile = { ...lamb, confidence: "low" };

describe("fewer, surer bottles", () => {
  it("after the first, only picks with nothing against them", () => {
    const d = conservativePicks(
      decision(pick("a", 80, ["too-light"]), pick("b", 79, ["too-light"]), pick("c", 78)),
      lamb,
    );
    expect(d.picks.map((p) => p.item)).toEqual(["a", "c"]);
  });
  it("the first pick and the outcome never change", () => {
    const before = decision(
      pick("a", 70, ["too-light"], "acceptable"),
      pick("b", 69, ["tannin-too-firm"], "acceptable"),
    );
    const after = conservativePicks(before, lamb);
    expect(after.outcome).toBe("acceptable");
    expect(after.picks.map((p) => p.item)).toEqual(["a"]);
  });
  it("a dish that is only a guess gets one bottle", () => {
    expect(conservativePicks(decision(pick("a", 80), pick("b", 79)), guess).picks).toHaveLength(1);
  });
  it("nothing to choose from stays nothing", () => {
    expect(conservativePicks(decision(), lamb).picks).toEqual([]);
  });
});

describe("when a second opinion is asked", () => {
  it("not for a sure, clear win", () => {
    expect(isCloseCall(decision(pick("a", 85), pick("b", 74)), lamb)).toBe(false);
  });
  it("for a near tie, an 'acceptable' best, an unsure or a model's reading of the dish", () => {
    expect(isCloseCall(decision(pick("a", 80), pick("b", 77)), lamb)).toBe(true);
    expect(isCloseCall(decision(pick("a", 70, [], "acceptable")), lamb)).toBe(true);
    expect(isCloseCall(decision(pick("a", 85)), { ...lamb, confidence: "medium" })).toBe(true);
    expect(isCloseCall(decision(pick("a", 85)), { ...lamb, readBy: "model" })).toBe(true);
  });
  it("never when there is nothing to judge", () => {
    expect(isCloseCall(decision(), guess)).toBe(false);
  });
});

describe("a second opinion is checked, and can only take away", () => {
  const refs = ["c1", "c2", "c3"];
  const picks = [pick("a", 80), pick("b", 79), pick("c", 78)];

  it("reorders and drops among the refs it was given", () => {
    const r = checkPairingReview(
      { order: ["c2", "c1"], drop: ["c3"], none_suits: false, reason: "clash" },
      refs,
    );
    expect(applyPairingReview(picks, refs, r).map((p) => p.item)).toEqual(["b", "a"]);
  });
  it("cannot add: a ref it was not given is ignored, a repeat counts once", () => {
    const r = checkPairingReview(
      { order: ["c9", "c2", "c2"], drop: [], none_suits: false, reason: "better-first" },
      refs,
    );
    expect(applyPairingReview(picks, refs, r).map((p) => p.item)).toEqual(["b", "a", "c"]);
  });
  it("'none suits' leaves nothing", () => {
    const r = checkPairingReview(
      { order: ["c1"], drop: [], none_suits: true, reason: "agree" },
      refs,
    );
    expect(applyPairingReview(picks, refs, r)).toEqual([]);
  });
  it("an answer outside the schema is refused", () => {
    expect(() =>
      checkPairingReview({ order: [], drop: [], none_suits: false, reason: "add-barolo" }, refs),
    ).toThrow();
    expect(() =>
      checkPairingReview(
        { order: [], drop: [], none_suits: false, reason: "agree", wine: "x" },
        refs,
      ),
    ).toThrow();
  });
  it("the strict schema lists only this call's refs", () => {
    const schema = pairingReviewJsonSchema(refs) as {
      properties: { order: { items: { enum: string[] } } };
    };
    expect(schema.properties.order.items.enum).toEqual(refs);
  });
});

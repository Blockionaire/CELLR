import { describe, expect, it } from "vitest";
import {
  CATALOG_REVIEW,
  candidateState,
  correctionState,
  SignalReviewSchema,
} from "./catalog-learning";

describe("catalogue review readiness", () => {
  const row = (scanHouseholds: number) => ({
    status: "open" as const,
    scanHouseholds,
    appellationVariants: 0,
    rivals: 0,
    inCatalog: false,
  });
  it("one household collects, two independent households ask for review", () => {
    expect(CATALOG_REVIEW.ready).toBe(2);
    expect(candidateState(row(1))).toBe("collecting");
    expect(candidateState(row(2))).toBe("review_ready");
  });
  it("a conflict always needs a person, however many households", () => {
    expect(candidateState({ ...row(9), rivals: 1 })).toBe("conflict");
  });
});

describe("correction signals", () => {
  it("one household collects; two ask for review; disagreement is a conflict; none open is resolved", () => {
    expect(correctionState({ openSignals: 1, openHouseholds: 1, conflict: false })).toBe(
      "collecting",
    );
    expect(correctionState({ openSignals: 3, openHouseholds: 2, conflict: false })).toBe(
      "review_needed",
    );
    expect(correctionState({ openSignals: 3, openHouseholds: 2, conflict: true })).toBe("conflict");
    expect(correctionState({ openSignals: 0, openHouseholds: 0, conflict: true })).toBe("resolved");
  });
  it("two signals from one household never ask for review", () => {
    expect(correctionState({ openSignals: 2, openHouseholds: 1, conflict: false })).toBe(
      "collecting",
    );
  });
  it("a review is reviewed, dismissed or reopened, with an optional note", () => {
    expect(SignalReviewSchema.parse({ status: "dismissed", note: " misread " })).toEqual({
      status: "dismissed",
      note: "misread",
    });
    expect(SignalReviewSchema.safeParse({ status: "applied", note: "" }).success).toBe(false);
  });
});

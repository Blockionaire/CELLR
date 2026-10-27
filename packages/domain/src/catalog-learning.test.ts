import { describe, expect, it } from "vitest";
import {
  AUTO_PUBLISH_ENABLED,
  CATALOG_REVIEW,
  automationVerdict,
  candidateCounts,
  candidatePriority,
  candidateState,
  listCandidates,
  type CandidateRow,
} from "./catalog-learning";

const row = (over: Partial<CandidateRow> = {}): CandidateRow => ({
  id: "c1",
  producer: "Domaine Exemple",
  name: "Cuvée Alpha",
  type: "red",
  country: "FR",
  region: null,
  appellation: null,
  status: "open",
  mergedInto: null,
  canonicalWineId: null,
  scanHouseholds: 1,
  manualHouseholds: 0,
  vintages: [2019],
  appellationVariants: 0,
  rivals: 0,
  inCatalog: false,
  sources: 0,
  verifiedSources: 0,
  lastConfirmedAt: "2026-10-01T00:00:00Z",
  createdAt: "2026-09-01T00:00:00Z",
  ...over,
});

describe("catalogue candidates", () => {
  it("automatic publication is off", () => {
    expect(AUTO_PUBLISH_ENABLED).toBe(false);
  });

  it("collecting until enough households confirmed it from a label; typed wines never count", () => {
    expect(candidateState(row({ scanHouseholds: 4, manualHouseholds: 20 }))).toBe("collecting");
    expect(candidateState(row({ scanHouseholds: CATALOG_REVIEW.ready }))).toBe("review_ready");
  });

  it("a rival colour or country, disagreeing appellations or an existing catalogue wine is a conflict", () => {
    expect(candidateState(row({ scanHouseholds: 9, rivals: 1 }))).toBe("conflict");
    expect(candidateState(row({ scanHouseholds: 9, appellationVariants: 2 }))).toBe("conflict");
    expect(candidateState(row({ scanHouseholds: 9, inCatalog: true }))).toBe("conflict");
  });

  it("decisions are kept as they are", () => {
    for (const status of ["approved", "rejected", "merged"] as const)
      expect(candidateState(row({ status, scanHouseholds: 50 }))).toBe(status);
  });

  it("priority grows with independent households", () => {
    expect(candidatePriority(row({ scanHouseholds: 2 }))).toBe("low");
    expect(candidatePriority(row({ scanHouseholds: 5 }))).toBe("normal");
    expect(candidatePriority(row({ scanHouseholds: 10 }))).toBe("high");
  });

  it("the automation verdict needs households AND a verified source AND no ambiguity; it is advice only", () => {
    const strong = row({ scanHouseholds: 12, verifiedSources: 1 });
    expect(automationVerdict(strong)).toEqual({ eligible: true, reasons: [] });
    // Twelve households agreeing with the same AI reading are not proof: without a source it does not qualify.
    expect(automationVerdict({ ...strong, verifiedSources: 0 }).reasons).toContain(
      "no verified public source",
    );
    expect(
      automationVerdict(strong, [{ name: "Cuvée Alpha Réserve", status: "open" }]).eligible,
    ).toBe(false);
    expect(automationVerdict({ ...strong, rivals: 1 }).eligible).toBe(false);
    expect(automationVerdict({ ...strong, scanHouseholds: 4 }).eligible).toBe(false);
  });

  it("the list filters by state and sorts by independent households", () => {
    const rows = [
      row({ id: "a", scanHouseholds: 2 }),
      row({ id: "b", scanHouseholds: 7 }),
      row({ id: "c", scanHouseholds: 9, rivals: 1 }),
      row({ id: "d", status: "approved" }),
    ];
    expect(listCandidates(rows, "open", "households").map((r) => r.id)).toEqual(["c", "b", "a"]);
    expect(listCandidates(rows, "review_ready", "households").map((r) => r.id)).toEqual(["b"]);
    expect(candidateCounts(rows)).toMatchObject({
      collecting: 1,
      review_ready: 1,
      conflict: 1,
      approved: 1,
    });
  });
});

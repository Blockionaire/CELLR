import { describe, expect, it } from "vitest";
import {
  mergeWineRatings,
  NO_RATINGS,
  PublishReviewSchema,
  selectRatings,
  type CommunityRow,
  type ExternalRatingsRow,
} from "./wine-ratings";

const ext: ExternalRatingsRow = {
  recordId: "00000000-0000-4000-8000-000000000001",
  providerId: "xwines",
  providerName: "X-Wines",
  scope: "public",
  datasetVersion: "X-Wines 1.0 (2023-01)",
  method: "latest-per-rater-v1",
  vintages: [
    // 2019: 4.0 and 5.0 stars
    {
      year: 2019,
      count: 2,
      average: 4.5,
      distribution: [0, 0, 0, 0, 0, 0, 0, 1, 0, 1],
      firstRatedOn: null,
      lastRatedOn: null,
    },
    // NV: one 3.5
    {
      year: null,
      count: 1,
      average: 3.5,
      distribution: [0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      firstRatedOn: null,
      lastRatedOn: null,
    },
  ],
};
const review = (
  id: string,
  year: number | null,
  score: number,
  body: string | null,
  mine = false,
) => ({
  id: `00000000-0000-4000-8000-00000000000${id}`,
  year,
  score,
  body,
  tastedOn: "2026-01-01",
  publishedAt: "2026-01-02T00:00:00Z",
  edited: false,
  author: "Anna",
  mine,
});
const com: CommunityRow = {
  vintages: [
    { year: 2020, count: 1, scores: [6] },
    { year: 2019, count: 2, scores: [8, 10] },
  ],
  reviews: [
    review("2", 2019, 10, "Prachtig", true),
    review("3", 2019, 8, null),
    review("4", 2020, 6, "Jong"),
  ],
  reviewable: true,
};

describe("mergeWineRatings", () => {
  it("nothing available: says so", () => {
    expect(mergeWineRatings(null, null)).toEqual(NO_RATINGS);
    expect(mergeWineRatings(null, null, { cellr: 2, externalCap: 40 }).weights).toEqual({
      cellr: 2,
      externalCap: 40,
    });
  });
  it("merges per vintage, newest first, NV last, never mixing vintages", () => {
    const d = mergeWineRatings(ext, com);
    expect(d.vintages.map((v) => v.year)).toEqual([2020, 2019, null]);
    expect(d.vintages[0]!.external).toBeNull();
    expect(d.vintages[1]!.external).toEqual({
      count: 2,
      sumHalf: 18,
      distribution: [0, 0, 0, 0, 0, 0, 0, 1, 0, 1],
    });
    expect(d.vintages[1]!.cellr.scores).toEqual([8, 10]);
    expect(d.vintages[2]!.cellr.scores).toEqual([]);
    expect(d.reviewable).toBe(true);
    expect(d.source).toEqual({ providerName: "X-Wines", datasetVersion: "X-Wines 1.0 (2023-01)" });
  });
});

describe("selectRatings", () => {
  const d = mergeWineRatings(ext, com);
  it("one vintage: only that vintage's numbers", () => {
    const s = selectRatings(d, 2019);
    expect(s.score.external).toEqual({ count: 2, average: 4.5 });
    expect(s.score.cellr).toEqual({ count: 2, average: 4.5 });
    expect(s.score.combined).toBe(4.5);
    expect(s.reviews).toHaveLength(2);
  });
  it("NV is its own selection", () => {
    const s = selectRatings(d, "nv");
    expect(s.score.external.count).toBe(1);
    expect(s.score.cellr.count).toBe(0);
    expect(s.reviews).toHaveLength(0);
  });
  it("all vintages pool exactly; real counts", () => {
    const s = selectRatings(d, "all");
    expect(s.score.external.count).toBe(3);
    expect(s.score.cellr.count).toBe(3);
    expect(s.externalDistribution.reduce((a, b) => a + b)).toBe(3);
    expect(s.cellrDistribution.reduce((a, b) => a + b)).toBe(3);
  });
  it("a vintage nobody rated: no score at all", () => {
    expect(selectRatings(d, 1999).score.combined).toBeNull();
  });
  it("scores with the weights the data carries; counts and averages stay real", () => {
    // external: 3 ratings, 25 half stars; CELLR: 3, 4 and 5 stars. Weight 1 each: (12.5 + 12) / 6 = 4.08
    const heavy = mergeWineRatings(ext, com, { cellr: 1, externalCap: 10 });
    expect(heavy.weights).toEqual({ cellr: 1, externalCap: 10 });
    const s = selectRatings(heavy, "all");
    expect(s.score.weights).toEqual({ external: 3, cellr: 3 });
    expect(s.score.combined).toBe(4.1);
    expect(s.score.external.count).toBe(3);
    expect(s.score.cellr.count).toBe(3);
    expect(s.score.external.average).toBe(selectRatings(d, "all").score.external.average);
    expect(s.score.combined).not.toBe(selectRatings(d, "all").score.combined);
    // NV stays NV under any weights
    expect(selectRatings(heavy, "nv").score.cellr.count).toBe(0);
  });
  it("an answer without weights (an older server) is scored with the defaults", () => {
    const old: Partial<typeof d> = { ...d };
    delete old.weights;
    const s = selectRatings(old as typeof d, "all");
    expect(s.score).toEqual(selectRatings(d, "all").score);
    expect(d.weights).toEqual({ cellr: 5, externalCap: 50 });
  });
  it("review filters", () => {
    expect(selectRatings(d, "all", "with_text").reviews.map((r) => r.body)).toEqual([
      "Prachtig",
      "Jong",
    ]);
    expect(selectRatings(d, "all", "mine").reviews).toHaveLength(1);
  });
});

describe("PublishReviewSchema", () => {
  it("needs explicit consent", () => {
    expect(PublishReviewSchema.safeParse({ body: "x" }).success).toBe(false);
    expect(PublishReviewSchema.safeParse({ body: "x", consent: false }).success).toBe(false);
  });
  it("trims, turns empty into no text, refuses links", () => {
    expect(PublishReviewSchema.parse({ body: "  mooi  ", consent: true }).body).toBe("mooi");
    expect(PublishReviewSchema.parse({ body: "   ", consent: true }).body).toBeNull();
    expect(PublishReviewSchema.parse({ consent: true }).body).toBeNull();
    expect(
      PublishReviewSchema.safeParse({ body: "zie https://x.example", consent: true }).success,
    ).toBe(false);
    expect(
      PublishReviewSchema.safeParse({ body: "mail anna (at) wijn (dot) nl", consent: true })
        .success,
    ).toBe(false);
    expect(
      PublishReviewSchema.safeParse({ body: "St. Émilion, 13.5% alc.", consent: true }).success,
    ).toBe(true);
  });
});

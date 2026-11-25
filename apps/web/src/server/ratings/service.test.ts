import { describe, expect, it, vi } from "vitest";
import { createRatingsService, type RatingsRepository } from "./service";

vi.mock("server-only", () => ({}));

const external = {
  recordId: "00000000-0000-4000-8000-000000000001",
  providerId: "xwines",
  providerName: "X-Wines",
  scope: "public",
  datasetVersion: "X-Wines 1.0 (2023-01)",
  method: "latest-per-rater-v1",
  vintages: [
    {
      year: 2019,
      count: 2,
      average: 4.5,
      distribution: [0, 0, 0, 0, 0, 0, 0, 1, 0, 1],
      firstRatedOn: null,
      lastRatedOn: null,
    },
  ],
};
const community = {
  vintages: [{ year: 2019, count: 1, scores: [8] }],
  reviews: [
    {
      id: "00000000-0000-4000-8000-000000000002",
      year: 2019,
      score: 8,
      body: "Mooi",
      tastedOn: "2026-01-01",
      publishedAt: "2026-01-02T00:00:00Z",
      edited: false,
      author: null,
      mine: false,
    },
  ],
  reviewable: true,
};

function repo(over: Partial<RatingsRepository> = {}): RatingsRepository {
  return {
    wineExternal: async () => external,
    wineCommunity: async () => community,
    recordExternal: async () => external,
    recordCommunity: async () => community,
    publish: async () => ({
      status: "published",
      reviewId: "00000000-0000-4000-8000-0000000000aa",
    }),
    remove: async () => "deleted",
    report: async () => "reported",
    mine: async () => null,
    recordPage: async () => null,
    ...over,
  };
}
const svc = (r: RatingsRepository, ratings = true, communityOn = true) =>
  createRatingsService({
    repo: r,
    householdId: async () => "h1",
    features: { ratings, community: communityOn },
  });

describe("ratings service", () => {
  it("is closed without the feature", async () => {
    await expect(svc(repo(), false).forWine("w")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      svc(repo(), true, false).publish("t", { body: null, consent: true }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("merges external and community numbers", async () => {
    const d = await svc(repo()).forWine("w");
    expect(d.available).toBe(true);
    expect(d.reviewable).toBe(true);
    expect(d.vintages[0]!.external!.count).toBe(2);
    expect(d.vintages[0]!.cellr.scores).toEqual([8]);
  });
  it("without the community switch, no reviews are read", async () => {
    const wineCommunity = vi.fn(async () => community);
    const d = await svc(repo({ wineCommunity }), true, false).forWine("w");
    expect(wineCommunity).not.toHaveBeenCalled();
    expect(d.reviews).toEqual([]);
  });
  it("before the database step, nothing is available and nothing fails", async () => {
    const d = await svc(
      repo({ wineExternal: async () => undefined, wineCommunity: async () => undefined }),
    ).forWine("w");
    expect(d.available).toBe(false);
  });
  it("a failing lookup shows nothing rather than failing the page", async () => {
    const d = await svc(
      repo({
        wineExternal: async () => {
          throw new Error("db");
        },
      }),
    ).forWine("w");
    expect(d.vintages[0]!.external).toBeNull();
  });
  it("a malformed answer shows nothing rather than a wrong number", async () => {
    const bad = { ...external, vintages: [{ ...external.vintages[0], distribution: [1, 2] }] };
    const d = await svc(
      repo({ wineExternal: async () => bad, wineCommunity: async () => null }),
    ).forWine("w");
    expect(d.available).toBe(false);
  });
  it("a pilot source is never accepted by the server either", async () => {
    const pilot = { ...external, scope: "pilot" };
    const d = await svc(
      repo({ wineExternal: async () => pilot, wineCommunity: async () => null }),
    ).forWine("w");
    expect(d.available).toBe(false);
  });
  it("a record page never offers publishing", async () => {
    expect((await svc(repo()).forRecord("r")).reviewable).toBe(false);
  });
  it("publishing maps the database's answers", async () => {
    await expect(svc(repo()).publish("t", { body: null, consent: true })).resolves.toEqual({
      status: "published",
      reviewId: "00000000-0000-4000-8000-0000000000aa",
    });
    await expect(
      svc(repo({ publish: async () => ({ status: "not_yours" }) })).publish("t", {
        body: null,
        consent: true,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      svc(repo({ publish: async () => ({ status: "rate_limited" }) })).publish("t", {
        body: null,
        consent: true,
      }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    for (const status of ["no_identity", "no_score", "moderated"])
      await expect(
        svc(repo({ publish: async () => ({ status }) })).publish("t", {
          body: null,
          consent: true,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      svc(repo({ publish: async () => ({ status: "anything" }) })).publish("t", {
        body: null,
        consent: true,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("delete and report", async () => {
    await expect(svc(repo()).remove("r")).resolves.toEqual({ deleted: true });
    await expect(svc(repo({ remove: async () => "not_found" })).remove("r")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      svc(repo({ report: async () => "already_reported" })).report("r", "spam"),
    ).resolves.toEqual({ reported: true });
    await expect(
      svc(repo({ report: async () => "rate_limited" })).report("r", "spam"),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
});

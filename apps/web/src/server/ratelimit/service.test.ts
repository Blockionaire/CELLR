import { describe, expect, it } from "vitest";
import { createRateLimiter, LIMITS } from "./service";
import type { RateLimitRepository } from "./repository";

const repo = (allowed: boolean) => {
  const calls: Array<[string, number, number]> = [];
  const r: RateLimitRepository = { consume: async (b, l, w) => (calls.push([b, l, w]), allowed) };
  return { r, calls };
};

describe("rate limiter", () => {
  it("passes the bucket, limit and window straight to the store", async () => {
    const { r, calls } = repo(true);
    await createRateLimiter(r).enforce(LIMITS.events);
    expect(calls).toEqual([["events", 120, 60]]);
  });
  it("throws a retryable RATE_LIMITED once the budget is spent", async () => {
    const { r } = repo(false);
    await expect(createRateLimiter(r).enforce(LIMITS.events)).rejects.toMatchObject({
      code: "RATE_LIMITED",
      retryable: true,
    });
  });
});

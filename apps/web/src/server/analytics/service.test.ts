import { describe, expect, it, vi } from "vitest";
import { DomainError, type TrackEvent } from "@cellr/domain";
import { createAnalyticsService } from "./service";
import type { AnalyticsRepository } from "./repository";
import type { RateLimiter } from "@/server/ratelimit/service";

const event: TrackEvent = { name: "bottle_added", props: { source: "scan" } };

describe("analytics service", () => {
  it("records the event after spending from the events budget", async () => {
    const order: string[] = [];
    const repo: AnalyticsRepository = { record: vi.fn(async () => void order.push("record")) };
    const limiter: RateLimiter = {
      enforce: vi.fn(async (l) => void order.push(`limit:${l.bucket}`)),
    };
    await createAnalyticsService(repo, limiter).track(event);
    expect(order).toEqual(["limit:events", "record"]);
    expect(repo.record).toHaveBeenCalledWith(event);
  });
  it("records nothing once the limit is hit", async () => {
    const repo: AnalyticsRepository = { record: vi.fn() };
    const limiter: RateLimiter = {
      enforce: async () => {
        throw new DomainError("RATE_LIMITED", undefined, { retryable: true });
      },
    };
    await expect(createAnalyticsService(repo, limiter).track(event)).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
    expect(repo.record).not.toHaveBeenCalled();
  });
});

import { describe, expect, it } from "vitest";
import { age, headline, historyStrip, reasonText } from "./health-model";

const NOW = new Date("2026-11-20T12:00:00.000Z");
const at = (minAgo: number) => new Date(NOW.getTime() - minAgo * 60_000).toISOString();

describe("System › Health display rules", () => {
  it("history: the worst status per slot, and an empty slot stays empty (no measurement)", () => {
    const strip = historyStrip(
      [
        { probe: "db.read", status: "healthy", reason: "ok", latencyMs: 4, measuredAt: at(5) },
        {
          probe: "db.read",
          status: "failed",
          reason: "timeout",
          latencyMs: 3000,
          measuredAt: at(15),
        },
        { probe: "auth.api", status: "failed", reason: "x", latencyMs: 1, measuredAt: at(5) },
        {
          probe: "db.read",
          status: "healthy",
          reason: "ok",
          latencyMs: 4,
          measuredAt: at(60 * 30),
        },
      ],
      "db.read",
      NOW,
    );
    expect(strip).toHaveLength(48);
    expect(strip.at(-1)).toMatchObject({ status: "failed", samples: 2 });
    expect(strip.slice(0, -1).every((s) => s.status === null)).toBe(true); // the 30-hour-old one is outside
  });

  it("the headline never calls a partly unmeasured system healthy", () => {
    expect(headline({ healthy: 10, degraded: 0, failed: 0, unknown: 3 })).toEqual({
      status: "unknown",
      text: "No failure measured · 3 of 13 checks without a current measurement",
    });
    expect(headline({ healthy: 10, degraded: 1, failed: 1, unknown: 3 }).status).toBe("failed");
    expect(headline({ healthy: 10, degraded: 2, failed: 0, unknown: 0 }).text).toBe(
      "2 of 12 checks degraded",
    );
    expect(headline({ healthy: 4, degraded: 0, failed: 0, unknown: 0 })).toEqual({
      status: "healthy",
      text: "All 4 checks pass (only what each one measures)",
    });
  });

  it("ages and reasons in words", () => {
    expect(age(null)).toBe("—");
    expect(age(30)).toBe("30 s ago");
    expect(age(600)).toBe("10 min ago");
    expect(age(7200)).toBe("2 h ago");
    expect(age(-5)).toBe("in the future");
    expect(reasonText("last_run_failed")).toBe("last run failed");
  });
});

import { describe, expect, it } from "vitest";
import { derivePlatformMetrics, RawPlatformMetricsSchema } from "./metrics";

const raw = (over = {}) =>
  RawPlatformMetricsSchema.parse({
    at: "2026-10-24T12:00:00Z",
    registered: 10,
    new_7d: 2,
    new_30d: 6,
    dau: 3,
    wau: 5,
    mau: 8,
    onboarded: 7,
    activated: 4,
    retention_7d: { cohort: 4, retained: 1 },
    scans_30d: { ok: 9, failed: 1 },
    adoption_30d: { scan: 4, sommelier: 6, "3d_cellar": 2 },
    ...over,
  });

describe("platform metrics", () => {
  it("derives activation, retention, scan success and adoption rates", () => {
    const m = derivePlatformMetrics(raw());
    expect(m.activationRate).toBe(0.4);
    expect(m.retention7d).toEqual({ cohort: 4, retained: 1, rate: 0.25 });
    expect(m.scanSuccess.rate).toBe(0.9);
    expect(m.adoption30d.map((a) => [a.feature, a.people, a.ofMau])).toEqual([
      ["sommelier", 6, 0.75],
      ["scan", 4, 0.5],
      ["3d_cellar", 2, 0.25],
    ]);
  });

  it("nothing to divide by is insufficient data (null), never 0%", () => {
    const m = derivePlatformMetrics(
      raw({
        registered: 0,
        activated: 0,
        mau: 0,
        retention_7d: { cohort: 0, retained: 0 },
        scans_30d: { ok: 0, failed: 0 },
      }),
    );
    expect([
      m.activationRate,
      m.retention7d.rate,
      m.scanSuccess.rate,
      m.adoption30d[0]!.ofMau,
    ]).toEqual([null, null, null, null]);
  });

  it("refuses a malformed result rather than inventing numbers", () => {
    expect(() => RawPlatformMetricsSchema.parse({ registered: -1 })).toThrow();
  });
});

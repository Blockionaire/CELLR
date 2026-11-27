import { describe, expect, it } from "vitest";
import { judgePool } from "./pool-probe";

describe("the pool probe's verdict", () => {
  it("16 or more at once on 16 or more backends: enough for perf16", () => {
    expect(judgePool(24, 24, 24, 16).ok).toBe(true);
    expect(judgePool(16, 16, 24, 16).ok).toBe(true);
  });
  it("a pool of 15 is not enough, whatever the number of clients", () => {
    expect(judgePool(15, 15, 24, 16).ok).toBe(false);
    expect(judgePool(16, 15, 24, 16).ok).toBe(false);
    expect(judgePool(NaN, 24, 24, 16).ok).toBe(false);
  });
});

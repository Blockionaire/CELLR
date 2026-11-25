import { describe, expect, it } from "vitest";
import { pairedBootstrap } from "./quality";

describe("the paired bootstrap", () => {
  it("finds no difference between identical engines", () => {
    const a = Array.from({ length: 40 }, (_, i) => i % 2);
    const r = pairedBootstrap(a, a);
    expect(r.diff).toBe(0);
    expect(r.low).toBe(0);
    expect(r.high).toBe(0);
  });
  it("puts a clear difference outside zero, and a coin toss across it", () => {
    const n = 60;
    const better = pairedBootstrap(
      Array.from({ length: n }, (_, i) => (i % 5 === 0 ? 0 : 1)),
      Array.from({ length: n }, (_, i) => (i % 2 === 0 ? 0 : 1)),
    );
    expect(better.diff).toBeCloseTo(0.3, 5);
    expect(better.low).toBeGreaterThan(0);
    expect(better.pNotBetter).toBeLessThan(0.01);
    const coin = pairedBootstrap(
      Array.from({ length: n }, (_, i) => (i % 2 === 0 ? 1 : 0)),
      Array.from({ length: n }, (_, i) => (i % 2 === 1 ? 1 : 0)),
    );
    expect(coin.low).toBeLessThan(0);
    expect(coin.high).toBeGreaterThan(0);
  });
  it("is the same every time", () => {
    const a = [1, 0, 1, 1, 0, 1, 0, 1];
    const b = [0, 0, 1, 0, 0, 1, 1, 0];
    expect(pairedBootstrap(a, b)).toEqual(pairedBootstrap(a, b));
  });
});

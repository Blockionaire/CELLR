import { describe, expect, it } from "vitest";
import { allRows } from "./paging";

/** A table of `total` rows behind an API that never answers with more than `cap` at once. */
const table = (total: number, cap = 1000) => {
  const calls: Array<[number, number]> = [];
  const page = async (from: number, to: number) => {
    calls.push([from, to]);
    const end = Math.min(to, from + cap - 1, total - 1);
    return {
      data: from > end ? [] : Array.from({ length: end - from + 1 }, (_, i) => from + i),
      error: null,
    };
  };
  return { page, calls };
};

describe("reading a long list", () => {
  it("gets everything, however many pages it takes", async () => {
    for (const total of [0, 1, 999, 1000, 1001, 2000, 2500]) {
      const { page } = table(total);
      const { data, error } = await allRows(page);
      expect(error).toBeNull();
      expect(data).toHaveLength(total);
      expect(new Set(data).size).toBe(total); // no row twice, none skipped
    }
  });

  it("does not ask for more pages than there are", async () => {
    const { page, calls } = table(2500);
    await allRows(page);
    expect(calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
    const single = table(10);
    await allRows(single.page);
    expect(single.calls).toHaveLength(1);
  });

  it("stops at the first error and says so, handing back what it had", async () => {
    let n = 0;
    const result = await allRows(async () => {
      n += 1;
      return n === 1
        ? { data: Array.from({ length: 1000 }, (_, i) => i), error: null }
        : { data: null, error: { code: "boom" } };
    });
    expect(result.error).toEqual({ code: "boom" });
    expect(result.data).toHaveLength(1000);
  });
});

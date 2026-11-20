import { describe, expect, it } from "vitest";
import type { SmartSpot } from "@cellr/domain";
import { judgeMove, judgeSwap, type BottleRead } from "./reconcile";

const spot = (locationId: string, row: number, col: number, index = 1): SmartSpot => ({
  locationId,
  row,
  col,
  index,
});
const at = (s: SmartSpot | null, inCellar = true): BottleRead => ({
  ok: true,
  bottle: { bottleId: "b", inCellar, spot: s },
});
const FAILED: BottleRead = { ok: false };
const A = spot("p", 1, 1);
const B = spot("p", 3, 4);
const C = spot("q", 2, 2);

describe("after a move whose answer was lost: the database's word, not a guess", () => {
  it("on the target: done; still on the source: unchanged; on a third spot: someone else's", () => {
    expect(judgeMove(at(B), A, B)).toEqual({ kind: "done", now: B });
    expect(judgeMove(at(A), A, B)).toEqual({ kind: "unchanged" });
    expect(judgeMove(at(C), A, B)).toEqual({ kind: "elsewhere", now: C });
  });

  it("a take-off: confirmed without a place is done; a bottle placed elsewhere is not 'not moved'", () => {
    expect(judgeMove(at(null), A, null)).toEqual({ kind: "done", now: null });
    expect(judgeMove(at(A), A, null)).toEqual({ kind: "unchanged" });
    expect(judgeMove(at(C), A, null)).toEqual({ kind: "elsewhere", now: C });
  });

  it("a placement of a bottle without a place: unplaced still is unchanged; taken off by someone is elsewhere", () => {
    expect(judgeMove(at(null), null, B)).toEqual({ kind: "unchanged" });
    expect(judgeMove(at(null), A, B)).toEqual({ kind: "elsewhere", now: null });
  });

  it("the whole spot counts, except a compartment's counter (the server chooses it)", () => {
    expect(judgeMove(at(spot("p", 3, 4, 2)), A, B).kind).toBe("elsewhere");
    expect(judgeMove(at(spot("p", 3, 4, 2)), A, B, { counters: true }).kind).toBe("done");
  });

  it("no longer in the cellar: gone; the read failed: unknown (never 'not moved')", () => {
    expect(judgeMove(at(null, false), A, B)).toEqual({ kind: "gone" });
    expect(judgeMove(FAILED, A, B)).toEqual({ kind: "unknown" });
    expect(judgeMove(FAILED, A, null)).toEqual({ kind: "unknown" });
  });
});

describe("after a swap whose answer was lost", () => {
  it("done only when both are on each other's spot; unchanged only when both are where they were", () => {
    expect(judgeSwap(at(B), at(A), A, B).kind).toBe("done");
    expect(judgeSwap(at(A), at(B), A, B).kind).toBe("unchanged");
    expect(judgeSwap(at(C), at(B), A, B).kind).toBe("elsewhere");
    expect(judgeSwap(at(B), at(C), A, B).kind).toBe("elsewhere");
    expect(judgeSwap(at(B), at(null, false), A, B).kind).toBe("gone");
    expect(judgeSwap(at(B), FAILED, A, B).kind).toBe("unknown");
  });
});

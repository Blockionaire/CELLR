import { describe, expect, it } from "vitest";
import {
  adviseStorage,
  cellChoices,
  resolveStorage,
  type AdviceOccupant,
  type AdvicePlace,
} from "@cellr/domain";

/**
 * Not a test: the engine's own cost (sprint 5), apart from the network and the database.
 *   BENCH_ADVICE=1 pnpm exec vitest run src/server/smart-cellar/advice-engine.bench.test.ts   (in apps/web)
 * Eligibility is timed alone (Sprint 4's cellChoices over every place, as the engine runs it);
 * "whole engine" adds ranking and explanations. Median of 25 runs after 5 warm-ups, on this machine.
 */
const run = process.env.BENCH_ADVICE ? describe : describe.skip;

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const time = (f: () => unknown) => {
  for (let i = 0; i < 5; i++) f();
  const out: number[] = [];
  for (let i = 0; i < 25; i++) {
    const t = performance.now();
    f();
    out.push(performance.now() - t);
  }
  return +median(out).toFixed(2);
};

/**
 * A cellar half full, every other spot taken (the hardest case for ranking: as many free spots as bottles, each
 * compared with its neighbours): 40 in one 8 × 10 rack, 200 in one 20 × 20, 900 in two 30 × 30, 1,200 in three.
 */
function cellar(bottles: number) {
  const [count, rows, cols] =
    bottles <= 40
      ? [1, 8, 10]
      : bottles <= 200
        ? [1, 20, 20]
        : [Math.ceil((bottles * 2) / 900), 30, 30];
  const places: AdvicePlace[] = Array.from({ length: count }, (_, k) => ({
    id: `r${k}`,
    label: `Rack ${k + 1}`,
    resolved: resolveStorage({
      kind: "rack",
      rows,
      cols,
      template: "rack_classic",
      semantics: "depth",
      zones: [
        { fromRow: 1, toRow: 2, purpose: "serving", targetTempC: 8 },
        { fromRow: 3, toRow: rows, purpose: "storage", targetTempC: 12 },
      ],
    }),
  }));
  const occupants: AdviceOccupant[] = [];
  for (let i = 0; i < bottles; i++) {
    const slot = i * 2; // every other spot
    const place = Math.floor(slot / (rows * cols));
    const at = slot % (rows * cols);
    occupants.push({
      bottleId: `o${i}`,
      locationId: `r${place}`,
      row: 1 + Math.floor(at / cols),
      col: 1 + (at % cols),
      index: 1,
      vintageId: `v${i % 37}`,
      wineId: `w${i % 23}`,
      producerId: `p${i % 11}`,
      type: i % 3 ? "red" : "white",
    });
  }
  return { places, occupants };
}

run("advice engine cost", () => {
  it("40 / 200 / 900 / 1,200 bottles", () => {
    const rows = [];
    for (const n of [40, 200, 900, 1200]) {
      const { places, occupants } = cellar(n);
      // eligibility as the engine runs it: Sprint 4's cellChoices over every place (placementProblem is then run
      // only for the spots the answer returns)
      const eligibility = time(() => {
        for (const p of places)
          cellChoices(
            p.resolved,
            occupants.filter((o) => o.locationId === p.id),
            { movingId: "me", depthEnabled: false },
          );
      });
      const input = {
        bottle: {
          bottleId: "me",
          inCellar: true,
          vintageId: "v1",
          wineId: "w1",
          producerId: "p1",
          type: "red" as const,
          year: 2015,
          current: null,
        },
        places,
        occupants,
        intent: "store" as const,
        depthEnabled: false,
      };
      const whole = time(() => adviseStorage(input));
      const result = adviseStorage(input);
      rows.push({
        bottles: n,
        eligibleSpots: result.eligible,
        eligibilityMs: eligibility,
        wholeEngineMs: whole,
        rankingAndExplanationsMs: +(whole - eligibility).toFixed(2),
      });
      expect(result.recommendations.length).toBeGreaterThan(0);
    }
    console.log(JSON.stringify(rows));
  });
});

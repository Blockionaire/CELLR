import { describe, expect, it } from "vitest";
import { AdminSommelierReportSchema, summarizeSommelierReport } from "./admin";

const report = (over: Record<string, unknown> = {}) =>
  AdminSommelierReportSchema.parse({
    from: "2026-11-01T00:00:00Z",
    to: "2026-11-08T00:00:00Z",
    ratings: [],
    outcomes: [],
    answers: [],
    model: {
      calls: 0,
      ok: 0,
      failed: 0,
      blocked: 0,
      known_cost: 0,
      unknown_calls: 0,
      avg_latency_ms: null,
      p95_latency_ms: null,
    },
    ...over,
  });

describe("the sommelier's report", () => {
  it("says nothing where nothing was counted: no share is made up from an empty period", () => {
    expect(summarizeSommelierReport(report())).toEqual({
      questions: 0,
      byEngines: 0,
      engineShare: null,
      rated: 0,
      positiveShare: null,
      opened: 0,
      withDish: 0,
      enjoyedShare: null,
      enjoyedSaid: 0,
      costPerQuestionUsdMicro: null,
    });
  });

  it("keeps a thumb and an outcome apart, and spreads the model's cost over every question", () => {
    const s = summarizeSommelierReport(
      report({
        answers: [
          {
            engine: "v3",
            source: "basic",
            kind: "pairing",
            outcome: "good",
            questions: 6,
            people: 2,
          },
          { engine: "v1", source: "ai", kind: "-", outcome: "-", questions: 2, people: 1 },
        ],
        // Every rated answer got a thumb up...
        ratings: [
          {
            source: "basic",
            kind: "pairing",
            outcome: "good",
            confidence: "medium",
            answers: 4,
            positive: 4,
            negative: 0,
          },
        ],
        // ...and of the three who had the wine with the dish and said so, one found it went well.
        outcomes: [
          {
            kind: "pairing",
            outcome: "good",
            confidence: "medium",
            opened: 5,
            with_dish: 4,
            without_dish: 1,
            enjoyed_yes: 1,
            enjoyed_mixed: 1,
            enjoyed_no: 1,
          },
        ],
        model: {
          calls: 2,
          ok: 2,
          failed: 0,
          blocked: 0,
          known_cost: 8000,
          unknown_calls: 0,
          avg_latency_ms: 900,
          p95_latency_ms: 1400,
        },
      }),
    );
    expect(s.engineShare).toBe(0.75);
    expect(s.positiveShare).toBe(1);
    expect(s.enjoyedShare).toBeCloseTo(1 / 3);
    expect(s.enjoyedSaid).toBe(3);
    expect(s.opened).toBe(5);
    expect(s.costPerQuestionUsdMicro).toBe(1000);
  });

  it("refuses a report that carries anything long enough to be a sentence", () => {
    expect(() =>
      report({
        answers: [
          {
            engine: "v3",
            source: "basic",
            kind: "x".repeat(41),
            outcome: "good",
            questions: 1,
            people: 1,
          },
        ],
      }),
    ).toThrow();
  });
});

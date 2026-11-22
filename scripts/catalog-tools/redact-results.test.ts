import { describe, expect, it } from "vitest";
import { redact } from "./redact-results";

describe("result files that may be committed", () => {
  it("a benchmark keeps its summary and each query's rank, never a record's name or id", () => {
    const out = redact("x/benchmark-results.json", {
      summary: { search: { top1: 1 } },
      entries: [
        {
          id: "b001",
          segment: "fr",
          query: "chateau margaux",
          expect: { producer: "Château Margaux" },
          coverage: "exact",
          exact: [{ external_id: "111987", producer: "Château Margaux", name: "Grand Vin" }],
          partial: [],
          producer_records: 4,
          target_ids: ["111987"],
          search: {
            rank: 1,
            top: ["Château Margaux — Grand Vin [provider/exact]"],
            ms: 20,
            rows: 8,
          },
        },
      ],
    });
    const text = JSON.stringify(out);
    expect(text).not.toMatch(/Margaux|Grand Vin|111987/);
    expect(out.summary).toEqual({ search: { top1: 1 } });
    expect((out.entries as unknown[])[0]).toMatchObject({
      id: "b001",
      coverage: "exact",
      exact: 1,
      targets: 1,
      search: { rank: 1, ms: 20, rows: 8 },
    });
  });

  it("recognition keeps outcomes and ranks; quality keeps counts; both are idempotent", () => {
    const rec = redact("recognition-results.json", {
      summary: { wrong_automatic_identities: 0 },
      readings: [
        {
          id: "b001",
          reading: "clean",
          status: "not_found",
          target: 1,
          suggestions: ["Domaine X — Y"],
        },
      ],
    });
    expect(JSON.stringify(rec)).not.toMatch(/Domaine X/);
    expect((rec.readings as unknown[])[0]).toMatchObject({ target: 1, suggestions: 1 });
    expect(redact("recognition-results.json", rec)).toBe(rec);
    const q = redact("quality-xwines.json", {
      file: { producer_spelling_variants: { groups: 28, examples: [["Domaine A", "Dom. A"]] } },
    });
    expect(q).toMatchObject({ file: { producer_spelling_variants: { groups: 28, examples: 1 } } });
  });

  it("an import report keeps its counts; the refused records become a count", () => {
    const out = redact("import-xwines-1.json", {
      rows: 3,
      invalid: 1,
      problems: [{ external_id: "1", producer: "Domaine Z", error: "bad" }],
    });
    expect(out).toMatchObject({ rows: 3, invalid: 1, problems: 1 });
    expect(JSON.stringify(out)).not.toMatch(/Domaine Z/);
  });

  it("refuses a file it does not know", () => {
    expect(() => redact("perf-c8.json", {})).toThrow(/not a result file/);
  });
});

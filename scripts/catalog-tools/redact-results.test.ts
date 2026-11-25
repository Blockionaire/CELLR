import { describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { redact, redactDir } from "./redact-results";

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

describe("a results directory leaving the run is reduced fail-closed (staging run 45039275216)", () => {
  it("known results are reduced, safe files kept, everything else deleted", () => {
    const dir = mkdtempSync(join(tmpdir(), "redact-"));
    const put = (name: string, data: unknown) =>
      writeFileSync(join(dir, name), typeof data === "string" ? data : JSON.stringify(data));
    put("benchmark-results.json", {
      summary: { search: {} },
      entries: [{ id: "b001", exact: [{ producer: "Domaine Réel" }], search: { rank: 1 } }],
    });
    put("recognition-results.json", {
      summary: {},
      readings: [{ id: "b001", suggestions: ["Domaine Réel — X"] }],
    });
    put("quality-xwines.json", { file: { groups: { examples: [["Domaine Réel"]] } } });
    put("import-xwines-1.json", { rows: 1, problems: [{ producer: "Domaine Réel" }] });
    put("perf-pilot-c8.json", { overall: { p95: 1 } });
    put("staging-check-before.json", { ok: true });
    put("pilot-separation.txt", "people 0");
    put("dump.csv", "Domaine Réel,Cuvée");
    put("unknown.json", { producer: "Domaine Réel" });
    put("broken.json", "{not json");
    const r = redactDir(dir);
    expect(r.deleted.sort()).toEqual(["broken.json", "dump.csv", "unknown.json"]);
    expect(r.kept.sort()).toEqual([
      "perf-pilot-c8.json",
      "pilot-separation.txt",
      "staging-check-before.json",
    ]);
    expect(r.redacted.sort()).toEqual([
      "benchmark-results.json",
      "import-xwines-1.json",
      "quality-xwines.json",
      "recognition-results.json",
    ]);
    for (const name of readdirSync(dir))
      expect(readFileSync(join(dir, name), "utf8")).not.toMatch(/Domaine Réel/);
  });
  it("ratings: the counts-only reports are kept, a ratings import is reduced, the units file never survives", () => {
    const dir = mkdtempSync(join(tmpdir(), "redact-"));
    const put = (name: string, data: unknown) =>
      writeFileSync(join(dir, name), typeof data === "string" ? data : JSON.stringify(data));
    put("ratings-aggregate.json", { rows: 1, units: 1 });
    put("ratings-db-totals.json", { units: 1 });
    put("ratings-separation.txt", "of 200 records, a person sees ratings for 0");
    put("import-ratings-1.json", { units: 1, problems: [{ external_id: "111478", reason: "x" }] });
    put("units.jsonl", '{"external_id":"111478","count":2}');
    const r = redactDir(dir);
    expect(r.kept.sort()).toEqual([
      "ratings-aggregate.json",
      "ratings-db-totals.json",
      "ratings-separation.txt",
    ]);
    expect(r.redacted).toEqual(["import-ratings-1.json"]);
    expect(r.deleted).toEqual(["units.jsonl"]);
    expect(readFileSync(join(dir, "import-ratings-1.json"), "utf8")).not.toContain("111478");
  });
});

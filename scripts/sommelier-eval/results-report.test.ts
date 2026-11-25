import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { normalizeMarkdown } from "./annotation-sample";
import { clopperPearson } from "./intervals";
import { END, NOT_MEASURED, PAID_DIR, section2, START, TEMPLATE } from "./results-report";
import type { VectorFile } from "./vectors";

/**
 * SECTION 2 OF THE P8 RESULTS: numbers only from committed results, each with its uncertainty; a regression is
 * "detected" only when the interval lies below 0; too few items say so; a stopped run says which rule stopped it.
 */
const dir = () => pathToFileURL(mkdtempSync(join(tmpdir(), "cellr-p8-results-")) + "/");
const row = (section: string, set: string, measure: string) =>
  section
    .split("\n")
    .find((l) => l.startsWith(`| ${set} | ${measure} |`))!
    .split("|")
    .slice(1, -1)
    .map((c) => c.trim());

/** 20 scenarios over `dishes` dishes; `first` gives each scenario's first-bottle outcome. */
const vectors = (
  engine: string,
  first: (i: number) => 0 | 1,
  options: { dishes?: number; incomplete?: boolean; stopped?: string; rawFact?: boolean } = {},
) =>
  ({
    set: "main",
    engine,
    keyed: "id",
    salt: null,
    incomplete: options.incomplete ?? Boolean(options.stopped),
    ...(options.stopped ? { stopped: options.stopped } : {}),
    rows: Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [
        `s${i}`,
        {
          first: first(i),
          noPoor: 1,
          useful: 1,
          offered: 1,
          poor: 0,
          good: 1,
          cluster: `d${i % (options.dishes ?? 10)}`,
          claims: {
            rawClean: options.rawFact && i < 4 ? 0 : 1,
            shownClean: 1,
            rawCodes: options.rawFact && i < 4 ? ["not-in-cellar"] : [],
            shownCodes: [],
            refsAsAsked: null,
            check: null,
            removed: 0,
            serving: null,
            shownServing: [],
            calls: [],
          },
        },
      ]),
    ),
  }) as VectorFile;

const write = (d: URL, set: string, v6: VectorFile, v7: VectorFile) => {
  for (const n of [1, 2, 3]) {
    writeFileSync(new URL(`${set}-v6-${n}.json`, d), JSON.stringify(v6));
    writeFileSync(new URL(`${set}-v7-${n}.json`, d), JSON.stringify(v7));
  }
};

describe("the P8 results, section 2", () => {
  it("prints no number while no results are committed: every cell is 'not measured'", () => {
    const empty = section2(dir());
    for (const set of ["main", "holdout-dev", "holdout-test", "probe"])
      for (const m of ["first bottle right", "no poor bottle", "useful answer"])
        expect(row(empty, set, m).slice(2, 5)).toEqual([NOT_MEASURED, NOT_MEASURED, NOT_MEASURED]);
    expect(empty).toContain(
      `${NOT_MEASURED} (\`pnpm --filter @cellr/sommelier-eval run cost-check\`)`,
    );
    expect(empty).not.toMatch(/equivalent|non-inferior/i);
    expect(empty.startsWith(START) && empty.endsWith(END)).toBe(true);
  });

  it("is what the committed template shows", () => {
    const template = readFileSync(TEMPLATE, "utf8");
    const shown = template.slice(template.indexOf(START), template.indexOf(END) + END.length);
    expect(normalizeMarkdown(shown)).toBe(normalizeMarkdown(section2(PAID_DIR)));
  });

  it("detects a regression only when the dish-clustered interval lies below 0, with dishes, scenarios and the minimum detectable drop", () => {
    const d = dir();
    write(
      d,
      "main",
      vectors("v1plus-ai:none", () => 1),
      vectors("v1plus-ai:check", (i) => (i < 15 ? 0 : 1)),
    );
    const r = row(section2(d), "main", "first bottle right");
    expect(r[2]).toBe("REGRESSION DETECTED");
    expect(r[3]).toMatch(/^-75 \[-\d+, -\d+\]$/);
    expect(r[4]).toBe("10 / 20");
    expect(r[5]).toBe("10 points");
    expect(row(section2(d), "main", "useful answer")[2]).toBe("no regression detected");
  });

  it("sends a drop whose interval includes 0 to a person, and says 'too few to conclude' below 10 dishes", () => {
    const d = dir();
    write(
      d,
      "main",
      vectors("v1plus-ai:none", () => 1),
      vectors("v1plus-ai:check", (i) => (i === 0 || i === 2 ? 0 : 1)),
    );
    expect(row(section2(d), "main", "first bottle right")[2]).toBe(
      "possible regression: needs human review",
    );
    const few = dir();
    write(
      few,
      "main",
      vectors("v1plus-ai:none", () => 1, { dishes: 5 }),
      vectors("v1plus-ai:check", (i) => (i < 15 ? 0 : 1), { dishes: 5 }),
    );
    const r = row(section2(few), "main", "first bottle right");
    expect(r[2]).toBe("too few to conclude");
    expect(r[3]).toBe("too few to conclude");
  });

  it("gives rates with their exact interval and n", () => {
    const d = dir();
    write(
      d,
      "main",
      vectors("v1plus-ai:none", () => 1, { rawFact: true }),
      vectors("v1plus-ai:check", () => 1),
    );
    const line = section2(d)
      .split("\n")
      .find((l) => l.startsWith("| main | 12 of 60"))!;
    const ci = clopperPearson(12, 60);
    expect(line).toContain(
      `12 of 60 = 20.0% [${(100 * ci.low).toFixed(1)}%, ${(100 * ci.high).toFixed(1)}%]`,
    );
    expect(line).toContain("0 of 60 = 0.0% [0.0%, 6.0%]");
  });

  it("says which rule stopped a run, and fills nothing from an incomplete one", () => {
    const d = dir();
    write(
      d,
      "main",
      vectors("v1plus-ai:none", () => 1),
      vectors("v1plus-ai:check", () => 1, { stopped: "shown-cellar-fact" }),
    );
    const s = section2(d);
    expect(row(s, "main", "first bottle right")[2]).toBe("STOPPED: shown-cellar-fact");
    expect(s).toContain("- main, v7: STOPPED: shown-cellar-fact");
    const e = dir();
    write(
      e,
      "main",
      vectors("v1plus-ai:none", () => 1),
      vectors("v1plus-ai:check", () => 1, { incomplete: true }),
    );
    expect(row(section2(e), "main", "first bottle right")[2]).toBe(NOT_MEASURED);
  });
});

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { normalizeMarkdown } from "./annotation-sample";
import { END, NOT_MEASURED, PAID_DIR, section2, START, TEMPLATE } from "./results-report";
import type { VectorFile } from "./vectors";

/**
 * SECTION 2 OF THE P8 RESULTS: numbers only from committed vectors. With none (today), every cell says "not
 * measured"; with a complete set of files a row fills; with one run missing or incomplete it stays unmeasured.
 */
const dir = () => pathToFileURL(mkdtempSync(join(tmpdir(), "cellr-p8-results-")) + "/");
const cells = (section: string, set: string) =>
  section
    .split("\n")
    .find((l) => l.startsWith(`| ${set} |`))!
    .split("|")
    .slice(2, -2)
    .map((c) => c.trim());

const vectors = (engine: string, first: 0 | 1, incomplete = false): VectorFile => ({
  set: "main",
  engine,
  keyed: "id",
  salt: null,
  incomplete,
  rows: Object.fromEntries(
    Array.from({ length: 20 }, (_, i) => [
      `s${i}`,
      {
        first: i < 15 ? first : 1,
        noPoor: 1,
        useful: 1,
        offered: 1,
        poor: 0,
        good: 1,
        cluster: `d${i % 10}`,
        claims: {
          rawClean: 1,
          shownClean: 1,
          rawCodes: [],
          shownCodes: [],
          refsAsAsked: null,
          check: null,
          removed: 0,
          calls: [],
        },
      },
    ]),
  ) as VectorFile["rows"],
});

describe("the P8 results, section 2", () => {
  it("prints no number while no vectors are committed: every cell is 'not measured'", () => {
    const empty = section2(dir());
    for (const set of ["main", "holdout-dev", "holdout-test", "v1", "menu"])
      expect(
        cells(empty, set).every((c) => c === NOT_MEASURED),
        set,
      ).toBe(true);
    expect(empty.startsWith(START) && empty.endsWith(END)).toBe(true);
  });

  it("is what the committed template shows", () => {
    const template = readFileSync(TEMPLATE, "utf8");
    const shown = template.slice(template.indexOf(START), template.indexOf(END) + END.length);
    expect(normalizeMarkdown(shown)).toBe(normalizeMarkdown(section2(PAID_DIR)));
  });

  it("fills a row only when every run of both arms is there and complete", () => {
    const d = dir();
    for (const n of [1, 2, 3]) {
      writeFileSync(new URL(`main-v6-${n}.json`, d), JSON.stringify(vectors("v1plus-ai:none", 0)));
      writeFileSync(new URL(`main-v7-${n}.json`, d), JSON.stringify(vectors("v1plus-ai:check", 1)));
    }
    const filled = cells(section2(d), "main");
    expect(filled[0]).toMatch(/^\+75 \[/);
    expect(cells(section2(d), "holdout-dev").every((c) => c === NOT_MEASURED)).toBe(true);
    writeFileSync(
      new URL("main-v7-3.json", d),
      JSON.stringify(vectors("v1plus-ai:check", 1, true)),
    );
    expect(cells(section2(d), "main").every((c) => c === NOT_MEASURED)).toBe(true);
  });
});

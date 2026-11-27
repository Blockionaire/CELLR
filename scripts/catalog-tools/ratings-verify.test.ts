import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compareTotals, judgeRatings, RUN_KEYS, type RatingsFacts } from "./ratings-verify";

// the numbers of staging run 46012494694 (X-Wines 1.0, latest-per-rater-v1)
const DB = {
  units: 1008593,
  units_nv: 2382,
  ratings: "20857044",
  records_rated: 100646,
  distribution_adds_up: true,
};
const FILE = { units: 1008593, units_nv: 2382, ratings_kept: 20857044, wines_rated: 100646 };

describe("the totals check (database = aggregation report)", () => {
  it("passes on the totals of run 46012494694, ratings given as a string as psql prints a bigint", () => {
    expect(compareTotals(DB, FILE)).toEqual([]);
  });
  it("fails on one rating, one unit or one NV unit less", () => {
    expect(compareTotals({ ...DB, ratings: "20857043" }, FILE)).toEqual([
      "ratings: database 20857043, file 20857044",
    ]);
    expect(compareTotals({ ...DB, units: 1008592 }, FILE)).toHaveLength(1);
    expect(compareTotals({ ...DB, units_nv: 2381 }, FILE)).toHaveLength(1);
    expect(compareTotals({ ...DB, records_rated: 100645 }, FILE)).toHaveLength(1);
  });
  it("fails when a distribution does not add up, a number is missing or is not a number", () => {
    expect(compareTotals({ ...DB, distribution_adds_up: false }, FILE)).toHaveLength(1);
    expect(compareTotals({ ...DB, distribution_adds_up: null }, FILE)).toHaveLength(1);
    const noRatings: Record<string, unknown> = { ...DB };
    delete noRatings.ratings;
    expect(compareTotals(noRatings, FILE)[0]).toMatch(/ratings: missing/);
    expect(compareTotals({ ...DB, units: "many" }, FILE)[0]).toMatch(/units: missing/);
    expect(compareTotals({}, {})).toHaveLength(4);
  });
});

describe("the totals check as staging-pilot.sh runs it (exit code)", () => {
  const dir = mkdtempSync(join(tmpdir(), "ratings-verify-"));
  const run = (db: object, file: object) => {
    writeFileSync(join(dir, "db.json"), JSON.stringify(db));
    writeFileSync(join(dir, "file.json"), JSON.stringify(file));
    return spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "ratings-verify.ts",
        "totals",
        "--db-totals",
        join(dir, "db.json"),
        "--aggregate",
        join(dir, "file.json"),
      ],
      { cwd: new URL(".", import.meta.url).pathname, encoding: "utf8" },
    );
  };
  it("exits 0 when equal", () => {
    const r = run(DB, FILE);
    expect(r.stdout).toContain("totals: database = file");
    expect(r.status).toBe(0);
  });
  it("exits 1 when a total differs, and says which", () => {
    const r = run({ ...DB, ratings: "20857043" }, FILE);
    expect(r.stdout).toContain("ratings: database 20857043, file 20857044");
    expect(r.status).toBe(1);
  });
});

const facts = (over: Partial<RatingsFacts> = {}): RatingsFacts => ({
  provider: {
    rights_status: "unverified",
    search_scope: "pilot",
    commercial_use: false,
    may_display_ratings: true,
  },
  totals: {
    units: 1008593,
    units_nv: 2382,
    ratings: 20857044,
    records_rated: 100646,
    distribution_adds_up: true,
    sum_adds_up: true,
    year_min: 1950,
    year_max: 2021,
    months_ok: true,
    on_foreign_or_inactive_record: 0,
    from_unknown_or_open_run: 0,
    changed_since_previous_run: 0,
  },
  runs: [1, 2].map(() => ({
    finished: true,
    abandoned: false,
    pilot: true,
    units: 1008593,
    ratings: 20857044,
    removed: 0,
  })),
  runKeys: [
    "invalid",
    "ratings",
    "removed",
    "repeated_dropped",
    "rows",
    "units",
    "unknown_wine",
    "withdrawn_record_units",
  ],
  raterColumns: [],
  separation: { sample: 300, personSees: 0, personPages: 0, pilotSees: 300 },
  apiClosed: [{ check: "the community is closed (until ACTIVATION.md opens it)", ok: true }],
  currentYear: 2026,
  ...over,
});
const EXPECT = {
  units: 1008593,
  ratings: 20857044,
  nv: 2382,
  wines: 100646,
  scope: "pilot",
  unchangedRepeat: true,
};
const failing = (f: RatingsFacts) =>
  judgeRatings(f, EXPECT)
    .filter((c) => !c.ok)
    .map((c) => c.name);

describe("judging the imported ratings", () => {
  it("passes on what staging holds after run 46012494694", () => {
    expect(failing(facts())).toEqual([]);
  });
  it("totals: a different count, or one not declared by the last complete run, fails", () => {
    expect(failing(facts({ totals: { ...facts().totals, ratings: 20857043 } }))).toEqual([
      "totals: as expected",
      "totals: equal to the last complete run",
    ]);
    expect(failing(facts({ totals: { ...facts().totals, units_nv: 2381 } }))).toEqual([
      "totals: as expected",
    ]);
    expect(failing(facts({ totals: { ...facts().totals, sum_adds_up: false } }))).toEqual([
      "totals: every distribution adds up to its count, every sum to its distribution",
    ]);
  });
  it("runs: an open run, a non-pilot run, rows from an unknown run, or a repeat that removed rows fail", () => {
    const r = facts().runs[0]!;
    expect(failing(facts({ runs: [r, { ...r, finished: false }] }))).toContain(
      "runs: none open, at least one complete",
    );
    expect(failing(facts({ runs: [r, { ...r, pilot: false }] }))).toContain(
      "runs: every one a pilot run (staging)",
    );
    expect(failing(facts({ totals: { ...facts().totals, from_unknown_or_open_run: 3 } }))).toEqual([
      "runs: every aggregate from a complete run",
    ]);
    expect(failing(facts({ runs: [r, { ...r, removed: 5 }] }))).toEqual([
      "runs: a repeated complete run removed nothing",
    ]);
    expect(failing(facts({ runs: [] }))).toContain("totals: equal to the last complete run");
  });
  it("idempotency: a repeated run that changed one row's data, or no repeat at all, fails when it is expected", () => {
    const idem = "runs: the repeated run changed no row's data (idempotent)";
    expect(
      failing(facts({ totals: { ...facts().totals, changed_since_previous_run: 1 } })),
    ).toEqual([idem]);
    expect(
      failing(facts({ totals: { ...facts().totals, changed_since_previous_run: null } })),
    ).toEqual([idem]);
    // not asked: not judged
    const one = judgeRatings(
      facts({ totals: { ...facts().totals, changed_since_previous_run: 9 } }),
      {},
    );
    expect(one.some((c) => c.name === idem)).toBe(false);
  });
  it("an abandoned run is not the one the totals are compared with", () => {
    const r = facts().runs[0]!;
    expect(failing(facts({ runs: [r, { ...r, abandoned: true, units: 5, ratings: 5 }] }))).toEqual(
      [],
    );
  });
  it("vintages: a year from the future, a year 0, rows on another provider's or a withdrawn record fail", () => {
    expect(failing(facts({ totals: { ...facts().totals, year_max: 2031 } }))).toEqual([
      "vintages: NV is its own vintage; years are real years",
    ]);
    expect(failing(facts({ totals: { ...facts().totals, year_min: 0 } }))).toHaveLength(1);
    expect(
      failing(facts({ totals: { ...facts().totals, on_foreign_or_inactive_record: 1 } })),
    ).toEqual(["vintages: only on active records of this provider"]);
    expect(failing(facts({ totals: { ...facts().totals, months_ok: false } }))).toHaveLength(1);
  });
  it("privacy: any key beyond counts in a run, or a rater column, fails", () => {
    expect(failing(facts({ runKeys: [...RUN_KEYS, "user_ids"] }))).toEqual([
      "privacy: runs hold counts only",
    ]);
    expect(
      failing(facts({ raterColumns: ["public.catalog_rating_aggregates.rater_hash"] })),
    ).toEqual(["privacy: no rater or user column on the external rating tables"]);
  });
  it("rights: public without verified commercial rights fails; on staging the scope must be pilot", () => {
    const p = facts().provider!;
    expect(failing(facts({ provider: { ...p, search_scope: "public" } }))).toEqual(
      expect.arrayContaining([
        "rights: not public without verified commercial rights",
        "rights: scope is pilot",
      ]),
    );
    expect(failing(facts({ provider: null }))).toContain("rights: the provider is registered");
  });
  it("separation: a person seeing one rating or page of a pilot source, or the pilot read missing one, fails", () => {
    const s = facts().separation;
    expect(failing(facts({ separation: { ...s, personSees: 1 } }))).toEqual([
      "separation: a person sees no rating and no record page of a pilot source",
    ]);
    expect(failing(facts({ separation: { ...s, personPages: 1 } }))).toHaveLength(1);
    expect(failing(facts({ separation: { ...s, pilotSees: 299 } }))).toEqual([
      "separation: the pilot read sees the sample",
    ]);
    expect(failing(facts({ separation: { ...s, sample: 0, pilotSees: 0 } }))).toHaveLength(2);
  });
  it("api: every false row of verify-api-closed.sql fails, and so does a check that returned nothing", () => {
    expect(
      failing(facts({ apiClosed: [{ check: "no review and no report exists yet", ok: false }] })),
    ).toEqual(["api: no review and no report exists yet"]);
    expect(failing(facts({ apiClosed: [] }))).toEqual(["api: verify-api-closed.sql ran"]);
  });
  it("without expectations the totals are still compared with the last complete run", () => {
    const off = facts({ totals: { ...facts().totals, ratings: 1 } });
    expect(
      judgeRatings(off)
        .filter((c) => !c.ok)
        .map((c) => c.name),
    ).toEqual(["totals: equal to the last complete run"]);
  });
});

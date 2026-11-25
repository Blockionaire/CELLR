import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { aggregate } from "./ratings";

const HEADER = "RatingID,UserID,WineID,Vintage,Rating,Date";

function fixture(lines: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "ratings-test-"));
  const file = join(dir, "ratings.csv");
  const text = [HEADER, ...lines].join("\n") + "\n";
  writeFileSync(file, text);
  const sha = createHash("sha256").update(text).digest("hex");
  return { dir, file, sha, units: join(dir, "units.jsonl") };
}

const LINES = [
  "1,900001,100,2019,4.0,2020-01-01 10:00:00",
  "2,900002,100,2019,5.0,2020-02-01 10:00:00",
  // the same rater rates 100/2019 again later: only this one counts
  "3,900001,100,2019,2.0,2021-01-01 10:00:00",
  "4,900003,100,N.V.,3.5,2020-03-01 10:00:00",
  "5,900003,200,2019,1.0,2020-03-01 10:00:00",
  // invalid lines: an unknown vintage, a rating of 4.2, an impossible date
  "6,900004,200,Unknown,3.0,2020-03-01 10:00:00",
  "7,900004,200,2018,4.2,2020-03-01 10:00:00",
  "8,900004,200,2018,4.0,2020-02-30 10:00:00",
];

const read = (p: string) =>
  readFileSync(p, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);

describe("ratings aggregate", () => {
  it("aggregates per wine and vintage, one rating per rater, invalid lines counted and not used", async () => {
    const f = fixture(LINES);
    const r = await aggregate({
      file: f.file,
      sha256: f.sha,
      units: f.units,
      partitions: "3",
      tmp: f.dir,
    });
    expect(r).toMatchObject({
      rows: 8,
      invalid: { vintage: 1, rating: 1, date: 1 },
      invalid_total: 3,
      repeated_dropped: 1,
      units: 3,
      units_nv: 1,
      ratings_kept: 4,
      wines_rated: 2,
      method: "latest-per-rater-v1",
    });
    expect(read(f.units)).toEqual([
      {
        external_id: "100",
        vintage: 2019,
        count: 2,
        sum_half: 14,
        distribution: [0, 0, 0, 1, 0, 0, 0, 0, 0, 1],
        first: "2020-02-01",
        last: "2021-01-01",
      },
      {
        external_id: "100",
        vintage: null,
        count: 1,
        sum_half: 7,
        distribution: [0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
        first: "2020-03-01",
        last: "2020-03-01",
      },
      {
        external_id: "200",
        vintage: 2019,
        count: 1,
        sum_half: 2,
        distribution: [0, 1, 0, 0, 0, 0, 0, 0, 0, 0],
        first: "2020-03-01",
        last: "2020-03-01",
      },
    ]);
  });

  it("gives the same units whatever the number of partitions", async () => {
    const f = fixture(LINES);
    await aggregate({ file: f.file, sha256: f.sha, units: f.units, partitions: "1", tmp: f.dir });
    const one = readFileSync(f.units, "utf8");
    await aggregate({ file: f.file, sha256: f.sha, units: f.units, partitions: "7", tmp: f.dir });
    expect(readFileSync(f.units, "utf8").split("\n").sort()).toEqual(one.split("\n").sort());
  });

  it("writes no rater id anywhere and leaves no partition files behind", async () => {
    const f = fixture(LINES);
    const r = await aggregate({
      file: f.file,
      sha256: f.sha,
      units: f.units,
      partitions: "4",
      tmp: f.dir,
    });
    const everything = readFileSync(f.units, "utf8") + JSON.stringify(r);
    for (const id of ["900001", "900002", "900003", "900004"]) expect(everything).not.toContain(id);
    expect(readdirSync(f.dir).filter((n) => n.startsWith("cellr-ratings-"))).toEqual([]);
  });

  it("refuses a file that is not the expected one before reading a line", async () => {
    const f = fixture(LINES);
    await expect(
      aggregate({ file: f.file, sha256: "0".repeat(64), units: f.units, tmp: f.dir }),
    ).rejects.toThrow(/checksum/);
  });

  it("refuses another layout", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ratings-test-"));
    const file = join(dir, "r.csv");
    const text = "UserID,WineID,Rating\n1,2,3\n";
    writeFileSync(file, text);
    const sha = createHash("sha256").update(text).digest("hex");
    await expect(aggregate({ file, sha256: sha, units: join(dir, "u"), tmp: dir })).rejects.toThrow(
      /layout/,
    );
    expect(readdirSync(dir).filter((n) => n.startsWith("cellr-ratings-"))).toEqual([]);
  });

  it("refuses a repeated rating id (a duplicated line can never count twice)", async () => {
    const f = fixture([...LINES.slice(0, 2), LINES[1]!]);
    await expect(
      aggregate({ file: f.file, sha256: f.sha, units: f.units, tmp: f.dir }),
    ).rejects.toThrow(/strictly increase/);
  });

  it("with the wines file, ratings for a wine it does not hold are counted, not aggregated", async () => {
    const f = fixture(LINES);
    const wines = join(f.dir, "wines.csv");
    writeFileSync(wines, "WineID,WineName\n100,X\n");
    const r = await aggregate({ file: f.file, sha256: f.sha, units: f.units, wines, tmp: f.dir });
    expect(r.unknown_wine).toBe(1);
    expect(r.units).toBe(2);
  });
});

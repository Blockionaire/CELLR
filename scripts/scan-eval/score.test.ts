import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  countryCode,
  ExpectedFileError,
  identifiedRightWine,
  lookupExpected,
  matchName,
  nameTokens,
  overlapScore,
  parseExpectedCsv,
  parseExpectedJson,
  scorePhoto,
  type Got,
} from "./score";
import { formatReport, summarize, type PhotoOutcome } from "./report";

const got = (over: Partial<Got> = {}): Got => ({
  producer: "Château Margaux",
  name: "Pavillon Rouge",
  year: 2015,
  type: "red",
  countryCode: "FR",
  region: "Bordeaux",
  appellation: "Margaux",
  grapes: ["Cabernet Sauvignon", "Merlot"],
  ...over,
});

describe("names", () => {
  it("ignores case, accents, punctuation and Château/Domaine prefixes", () => {
    expect(nameTokens("Château  Léoville-Barton")).toEqual(["leoville", "barton"]);
    expect(nameTokens("Dom. de la Romanée-Conti")).toEqual(["romanee", "conti"]);
    expect(matchName("Margaux", "CHÂTEAU MARGAUX")).toMatchObject({ ok: true, how: "exact" });
    expect(matchName("Domaine Leflaive", "Leflaive").how).toBe("exact");
  });

  it("keeps a name that is only a prefix", () => {
    expect(nameTokens("Clos")).toEqual(["clos"]);
    expect(nameTokens("Château")).toEqual(["chateau"]);
    expect(nameTokens("Clos de Vougeot")).toEqual(["vougeot"]);
  });

  it("accepts shared words at or above the threshold, and not below", () => {
    expect(matchName("Pavillon Rouge", "Pavillon Rouge du Château Margaux")).toMatchObject({
      ok: true,
      how: "fuzzy",
    });
    expect(matchName("Special Cuvée", "Cuvée").ok).toBe(false);
    expect(matchName("Special Cuvée", "Cuvée", 0.5).ok).toBe(true);
  });

  it("forgives one misread letter in a long word, not in a short one", () => {
    expect(matchName("Tignanello", "Tignanelo").ok).toBe(true);
    expect(matchName("Tignanello", "Tignanella").ok).toBe(true);
    expect(overlapScore("Bolla", "Bella")).toBe(0);
  });

  it("counts a missing reading as a miss", () => {
    expect(matchName("Margaux", null)).toEqual({ ok: false, how: "none", score: 0 });
  });

  it("'contained' lets a short expected region sit inside a longer one", () => {
    expect(overlapScore("Bordeaux", "Bordeaux Supérieur", "jaccard")).toBe(0.5);
    expect(overlapScore("Bordeaux", "Bordeaux Supérieur", "contained")).toBe(1);
  });
});

describe("countries", () => {
  it("takes codes and names in a few languages", () => {
    expect(countryCode("fr")).toBe("FR");
    expect(countryCode("Frankrijk")).toBe("FR");
    expect(countryCode("Italia")).toBe("IT");
    expect(countryCode("España")).toBe("ES");
    expect(countryCode("United States")).toBe("US");
    expect(countryCode("Narnia")).toBeNull();
  });
});

describe("scorePhoto", () => {
  it("scores only the fields that were written down", () => {
    const results = scorePhoto({ vintage: 2015 }, got());
    expect(results.map((r) => r.field)).toEqual(["vintage"]);
    expect(results[0]?.ok).toBe(true);
  });

  it("scores everything when everything is written down", () => {
    const results = scorePhoto(
      {
        producer: "Chateau Margaux",
        wine: "Pavillon Rouge",
        vintage: 2015,
        type: "Rouge",
        country: "France",
        region: "Margaux",
        grapes: ["merlot"],
      },
      got(),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    expect(identifiedRightWine(results)).toBe(true);
  });

  it("is exact on vintage, and null means non-vintage", () => {
    expect(scorePhoto({ vintage: 2014 }, got())[0]).toMatchObject({
      ok: false,
      expected: "2014",
      got: "2015",
    });
    expect(scorePhoto({ vintage: null }, got({ year: null }))[0]?.ok).toBe(true);
    expect(scorePhoto({ vintage: null }, got({ year: 2015 }))[0]?.ok).toBe(false);
  });

  it("is exact on type, with common words from other languages", () => {
    expect(scorePhoto({ type: "sparkling" }, got({ type: "sparkling" }))[0]?.ok).toBe(true);
    expect(scorePhoto({ type: "bianco" }, got({ type: "white" }))[0]?.ok).toBe(true);
    expect(scorePhoto({ type: "white" }, got({ type: "red" }))[0]?.ok).toBe(false);
    expect(scorePhoto({ type: "white" }, got({ type: null }))[0]?.ok).toBe(false);
  });

  it("takes the country as a code or a name", () => {
    expect(scorePhoto({ country: "FR" }, got())[0]?.ok).toBe(true);
    expect(scorePhoto({ country: "Italy" }, got())[0]?.ok).toBe(false);
    expect(scorePhoto({ country: "Italy" }, got({ countryCode: "IT" }))[0]?.ok).toBe(true);
  });

  it("matches the region against the region or the appellation", () => {
    expect(scorePhoto({ region: "Bordeaux" }, got())[0]?.ok).toBe(true);
    expect(scorePhoto({ region: "Margaux" }, got({ region: null }))[0]?.ok).toBe(true);
    expect(scorePhoto({ region: "Tuscany" }, got())[0]?.ok).toBe(false);
  });

  it("needs every expected grape to be found", () => {
    expect(scorePhoto({ grapes: ["Merlot", "Cabernet Sauvignon"] }, got())[0]?.ok).toBe(true);
    expect(scorePhoto({ grapes: ["Merlot", "Syrah"] }, got())[0]?.ok).toBe(false);
  });

  it("treats null as 'nothing should be read'", () => {
    expect(scorePhoto({ wine: null }, got({ name: null }))[0]?.ok).toBe(true);
    expect(scorePhoto({ wine: null }, got())[0]?.ok).toBe(false);
  });

  it("fails every field when nothing could be read", () => {
    const results = scorePhoto({ producer: "Margaux", vintage: 2015, type: "red" }, null);
    expect(results.every((r) => !r.ok)).toBe(true);
    expect(identifiedRightWine(results)).toBe(false);
  });

  it("says the right wine needs producer, wine and vintage (those written down) to be right", () => {
    const wrongYear = scorePhoto(
      { producer: "Margaux", wine: "Pavillon Rouge", vintage: 2014 },
      got(),
    );
    expect(identifiedRightWine(wrongYear)).toBe(false);
    expect(identifiedRightWine(scorePhoto({ type: "red" }, got()))).toBeNull();
  });
});

describe("the expected-values file", () => {
  it("reads JSON, skipping _comment keys", () => {
    const map = parseExpectedJson({
      _comment: "hello",
      "a.jpg": { producer: "X", vintage: null, grapes: ["Merlot"], country: "fr" },
    });
    expect([...map.keys()]).toEqual(["a.jpg"]);
    expect(map.get("a.jpg")).toEqual({
      producer: "X",
      vintage: null,
      grapes: ["Merlot"],
      country: "fr",
    });
  });

  it("explains what is wrong", () => {
    expect(() => parseExpectedJson([])).toThrow(ExpectedFileError);
    expect(() => parseExpectedJson({ "a.jpg": { year: 2015 } })).toThrow(/unknown field "year"/);
    expect(() => parseExpectedJson({ "a.jpg": { vintage: "2015" } })).toThrow(/vintage/);
    expect(() => parseExpectedJson({ "a.jpg": { country: "Narnia" } })).toThrow(/not recognised/);
  });

  it("reads CSV: empty cell = not scored, NV = non-vintage, quotes and ; grapes", () => {
    const map = parseExpectedCsv(
      [
        "file,producer,wine,vintage,type,country,region,grapes",
        'a.jpg,"Estate, Test",,2015,red,FR,,Merlot;Syrah',
        "b.jpg,Brut House,,NV,sparkling,,,",
      ].join("\n"),
    );
    expect(map.get("a.jpg")).toEqual({
      producer: "Estate, Test",
      vintage: 2015,
      type: "red",
      country: "FR",
      grapes: ["Merlot", "Syrah"],
    });
    expect(map.get("b.jpg")).toEqual({ producer: "Brut House", vintage: null, type: "sparkling" });
    expect(() => parseExpectedCsv("producer\nX")).toThrow(/file/);
  });

  it("finds an entry by file name, any case, with or without the extension", () => {
    const map = parseExpectedJson({ "IMG_1.JPG": { type: "red" }, other: { type: "white" } });
    expect(lookupExpected(map, "img_1.jpg")).toEqual({ type: "red" });
    expect(lookupExpected(map, "other.png")).toEqual({ type: "white" });
    expect(lookupExpected(map, "nope.jpg")).toBeUndefined();
  });
});

describe("the report", () => {
  const outcome = (file: string, over: Partial<PhotoOutcome>): PhotoOutcome => ({
    file,
    status: "read",
    reason: null,
    fields: [],
    latencyMs: 2000,
    tokensIn: 1000,
    tokensOut: 100,
    ...over,
  });
  const outcomes = [
    outcome("a.jpg", {
      fields: scorePhoto({ producer: "Margaux", vintage: 2015, type: "red" }, got()),
    }),
    outcome("b.jpg", {
      latencyMs: 4000,
      fields: scorePhoto({ producer: "Margaux", vintage: 2014, type: "red" }, got()),
    }),
    outcome("c.jpg", {
      status: "unread",
      reason: "not-a-label",
      latencyMs: null,
      tokensIn: null,
      tokensOut: null,
      fields: scorePhoto({ producer: "Margaux", vintage: 2015 }, null),
    }),
  ];
  const summary = summarize(outcomes);

  it("counts accuracy per field, only over the photos that have the field", () => {
    const by = Object.fromEntries(summary.perField.map((f) => [f.field, f]));
    expect(by.producer).toMatchObject({ scored: 3, correct: 2 });
    expect(by.vintage).toMatchObject({ scored: 3, correct: 1 });
    expect(by.type).toMatchObject({ scored: 2, correct: 2, accuracy: 1 });
    expect(by.region).toMatchObject({ scored: 0, accuracy: null });
  });

  it("counts the right wine, photos, misses, latency and tokens", () => {
    expect(summary.photos).toBe(3);
    expect(summary.read).toBe(2);
    expect(summary.unread).toBe(1);
    expect(summary.identified).toEqual({ scored: 3, correct: 1, rate: 1 / 3 });
    expect(summary.failures.map((f) => `${f.file}:${f.field}`)).toEqual([
      "b.jpg:vintage",
      "c.jpg:producer",
      "c.jpg:vintage",
    ]);
    expect(summary.latency.averageMs).toBe(3000);
    expect(summary.latency.p95Ms).toBe(4000);
    expect(summary.tokens).toMatchObject({
      in: 2000,
      out: 200,
      reported: 2,
      averagePerPhoto: 1100,
    });
  });

  it("handles an empty run", () => {
    const empty = summarize([]);
    expect(empty.identified.rate).toBeNull();
    expect(empty.latency.averageMs).toBeNull();
  });

  it("prints a readable table", () => {
    const text = formatReport(summary, { model: "gpt-test", prompt: "label_extraction@v2" });
    expect(text).toContain("gpt-test");
    expect(text).toContain("right wine");
    expect(text).toContain("33.3%");
    expect(text).toContain("b.jpg");
    expect(text).not.toContain("region ");
  });
});

describe("the committed example", () => {
  it("is a valid expected-values file", () => {
    const file = path.join(import.meta.dirname, "../../eval/scan/expected.example.json");
    const map = parseExpectedJson(JSON.parse(readFileSync(file, "utf8")));
    expect(map.size).toBe(3);
  });
});

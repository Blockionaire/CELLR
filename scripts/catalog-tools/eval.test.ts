import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ADAPTERS,
  importBlocker,
  inspectProviderFile,
  identityRelation,
  PROVIDERS,
  searchableQuery,
  type IdentityFacts,
  type IdentityRelation,
} from "@cellr/domain";

/**
 * The evaluation files under eval/catalog, checked against the domain code (which is pure and reads no files itself):
 * the hand-labelled identity pairs, CELLR's own fixture files, and the shape of the benchmark set.
 */
const file = (name: string) =>
  readFileSync(new URL(`../../eval/catalog/${name}`, import.meta.url), "utf8");
const fixture = file;
const sha = (name: string) =>
  createHash("sha256")
    .update(readFileSync(new URL(`../../eval/catalog/${name}`, import.meta.url)))
    .digest("hex");

interface Pair {
  id: string;
  a: IdentityFacts;
  b: IdentityFacts;
  expect: IdentityRelation;
  why: string;
}
const golden = JSON.parse(file("identity-pairs.json")) as { pairs: Pair[] };

describe("how two wine records relate (hand-labelled pairs)", () => {
  it("the set is large enough to mean something", () => {
    expect(golden.pairs.length).toBeGreaterThanOrEqual(60);
  });

  for (const p of golden.pairs)
    it(`${p.id}: ${p.why} → ${p.expect}`, () => {
      expect(identityRelation(p.a, p.b).relation).toBe(p.expect);
      // the answer never depends on which record is called A
      expect(identityRelation(p.b, p.a).relation).toBe(p.expect);
    });

  it("no pair a person labelled different or uncertain is ever called the same wine, or a spelling of it", () => {
    const wrong = golden.pairs.filter(
      (p) =>
        !["same", "variant"].includes(p.expect) &&
        ["same", "variant"].includes(identityRelation(p.a, p.b).relation),
    );
    expect(wrong.map((p) => p.id)).toEqual([]);
  });
});

describe("CELLR's own fixture files", () => {
  it("the X-Wines-layout fixture: mapped rows, skipped rows by reason, nothing fatal", () => {
    const i = inspectProviderFile(fixture("fixture-xwines-layout.csv"), "fixture");
    expect(i.fatal).toEqual([]);
    expect(i.layoutVerified).toBe(true);
    expect(i.records.length + Object.values(i.skipped).reduce((a, b) => a + b, 0)).toBe(i.rows);
    expect(importBlocker("fixture", i, sha("fixture-xwines-layout.csv"))).toBeNull();
  });
});

describe("the LWIN adapter (assumed layout, CELLR's own fictitious fixture)", () => {
  const i = inspectProviderFile(fixture("fixture-lwin-layout.csv"), "lwin_fixture");

  it("maps live wine rows at LWIN-7 level and joins the producer title and name", () => {
    expect(i.fatal).toEqual([]);
    expect(i.records.map((r) => r.external_id)).toEqual([
      "9000001",
      "9000002",
      "9000003",
      "9000004",
      "9000005",
      "9000006",
      "9000007",
    ]);
    expect(i.records[0]).toMatchObject({
      producer: "Chateau Imaginaire",
      name: "Chateau Imaginaire",
      wine_type: "red",
      country_code: "FR",
      region: "Margaux Fictif",
      appellation: "AOC Fictive",
      vintages: [],
      details: { lwin7: "9000001", classification: "Premier Cru Fictif" },
    });
    expect(i.records[1]).toMatchObject({ producer: "Chateau Imaginaire", name: "Pavillon Fictif" });
    expect(i.records[3]).toMatchObject({ wine_type: "sparkling" });
    expect(i.records[4]).toMatchObject({ wine_type: "fortified", country_code: "PT" });
  });

  it("skips deleted and combined codes, codes that are not seven digits, and spirits", () => {
    expect(i.skipped).toEqual({ STATUS: 2, LWIN: 2, "TYPE (not wine)": 1 });
  });

  it("never carries a vintage, a price or a score: LWIN-7 is the wine only", () => {
    for (const r of i.records) {
      expect(r.vintages).toEqual([]);
      expect(Object.keys(r.details).sort().join()).toMatch(/^(classification,)?lwin7$/);
    }
  });

  it("is marked unverified, and reads exactly this one file: the hash is pinned", () => {
    expect(i.layoutVerified).toBe(false);
    expect(i.warnings.join(" ")).toMatch(/assumption/);
    // changing the fixture means changing the pinned hash in the same commit, on purpose
    expect(ADAPTERS.lwin_fixture.fixtureSha256).toBe(sha("fixture-lwin-layout.csv"));
    expect(importBlocker("lwin_fixture", i, sha("fixture-lwin-layout.csv"))).toBeNull();
    // the very same rows offered as real LWIN data are refused: the layout was never verified against a real file
    const asReal = inspectProviderFile(fixture("fixture-lwin-layout.csv"), "lwin");
    expect(importBlocker("lwin", asReal, sha("fixture-lwin-layout.csv"))).toMatch(
      /never verified against a real Liv-ex LWIN file/,
    );
    // and another file in the same layout cannot ride in under the fixture provider's name
    const other = fixture("fixture-lwin-layout.csv").replace("Imaginaire", "Different");
    expect(
      importBlocker(
        "lwin_fixture",
        inspectProviderFile(other, "lwin_fixture"),
        createHash("sha256").update(other).digest("hex"),
      ),
    ).toMatch(/never verified/);
  });

  it("the real provider stays blocked in the static assessment", () => {
    expect(PROVIDERS.lwin).toMatchObject({
      rights_status: "blocked",
      may_store: false,
      search_scope: "off",
    });
    expect(ADAPTERS.lwin.layoutVerified).toBe(false);
  });
});

interface Entry {
  id: string;
  kind?: string;
  query: string;
  base?: string;
  expect?: { producer: string; wine: string; type: string; country: string };
  filter?: Record<string, string>;
}
const set = JSON.parse(file("benchmark.json")) as { version: number; entries: Entry[] };

describe("the benchmark set", () => {
  it("has at least 200 entries with unique ids, and keeps Sprint 004A's 127 first", () => {
    expect(set.version).toBe(2);
    expect(set.entries.length).toBeGreaterThanOrEqual(200);
    expect(new Set(set.entries.map((e) => e.id)).size).toBe(set.entries.length);
    expect(set.entries.slice(0, 127).map((e) => e.id)).toEqual(
      Array.from({ length: 127 }, (_, i) => `b${String(i + 1).padStart(3, "0")}`),
    );
    expect(set.entries.slice(0, 127).every((e) => e.kind === undefined)).toBe(true);
  });

  it("every positive and perturbation says which wine is meant; a perturbation names an existing base", () => {
    const ids = new Set(set.entries.map((e) => e.id));
    for (const e of set.entries) {
      const kind = e.kind ?? "positive";
      if (kind === "positive" || kind === "perturbation") {
        expect(e.expect?.producer, e.id).toBeTruthy();
        expect(e.expect?.wine, e.id).toBeTruthy();
      }
      if (kind === "perturbation") {
        expect(ids.has(e.base ?? ""), e.id).toBe(true);
        const base = set.entries.find((b) => b.id === e.base)!;
        expect(e.query).not.toBe(base.query);
        expect(e.expect).toEqual(base.expect);
      }
      if (kind === "filter") expect(Object.keys(e.filter ?? {}).length, e.id).toBeGreaterThan(0);
    }
  });

  it("holds every kind, and strings that are not a search at all", () => {
    const kinds = new Set(set.entries.map((e) => e.kind ?? "positive"));
    expect([...kinds].sort()).toEqual([
      "adversarial",
      "filter",
      "generic",
      "perturbation",
      "positive",
    ]);
    const adversarial = set.entries.filter((e) => e.kind === "adversarial");
    expect(adversarial.length).toBeGreaterThanOrEqual(12);
    // some are only symbols: the app never sends those to the database
    expect(adversarial.some((e) => searchableQuery(e.query) === null)).toBe(true);
    // and none survives normalisation with anything but letters, digits and spaces
    for (const e of adversarial)
      expect(searchableQuery(e.query) ?? "").toMatch(/^[\p{L}\p{N} ]*$/u);
  });
});

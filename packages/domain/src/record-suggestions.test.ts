import { describe, expect, it } from "vitest";
import type { CatalogSearchHit } from "./catalog-search";
import { needsConfirmation } from "./catalog-search";
import { suggestRecordsForReading } from "./record-suggestions";

const provider = {
  id: "src",
  name: "A source",
  license: "CC0-1.0",
  licenseUrl: null,
  attribution: "credit",
  scope: "public" as const,
  modified: true,
};
let n = 0;
const rec = (
  producer: string,
  name: string,
  over: Partial<CatalogSearchHit> = {},
): CatalogSearchHit => ({
  kind: "record",
  wineId: null,
  recordId: `r${++n}`,
  producer,
  name,
  matchedAlias: null,
  type: "red",
  countryCode: "ES",
  region: "Rioja",
  source: "provider",
  verified: false,
  match: "prefix",
  bottles: 0,
  provider,
  vintages: [2017, 2018, 2019],
  ...over,
});
const wine = (over: Partial<CatalogSearchHit> = {}): CatalogSearchHit => ({
  ...rec("Bodegas Muga", "Reserva"),
  kind: "wine",
  wineId: "w1",
  recordId: null,
  source: "catalog",
  verified: true,
  provider: null,
  vintages: null,
  ...over,
});
const facts = {
  producer: "Bodegas Muga",
  name: "Reserva",
  type: "red" as const,
  countryCode: "ES",
  year: 2018,
};

describe("suggestRecordsForReading", () => {
  it("only provider records are suggested, never a CELLR wine", () => {
    const out = suggestRecordsForReading(facts, [wine(), rec("Bodegas Muga", "Reserva")]);
    expect(out.map((s) => s.hit.kind)).toEqual(["record"]);
  });
  it("the same name first, then a variant, then another bottling (whatever the search's order)", () => {
    const out = suggestRecordsForReading(
      facts,
      [
        rec("Bodegas Muga", "Gran Reserva Prado Enea"),
        rec("Muga", "Reserva"),
        rec("Bodegas Muga", "Reserva"),
      ],
      4,
    );
    expect(out.map((s) => [s.hit.producer, s.hit.name, s.reasons[0]])).toEqual([
      ["Bodegas Muga", "Reserva", "same_name"],
      ["Muga", "Reserva", "name_variant"],
      ["Bodegas Muga", "Gran Reserva Prado Enea", "other_bottling"],
    ]);
  });
  it("a record whose colour or country contradicts the label is never offered", () => {
    const out = suggestRecordsForReading(facts, [
      rec("Bodegas Muga", "Reserva", { type: "white" }),
      rec("Bodegas Muga", "Reserva", { countryCode: "AR" }),
    ]);
    expect(out).toEqual([]);
  });
  it("an unknown colour or country contradicts nothing", () => {
    const out = suggestRecordsForReading({ ...facts, type: null, countryCode: null }, [
      rec("Bodegas Muga", "Reserva", { type: "white" }),
    ]);
    expect(out).toHaveLength(1);
  });
  it("another producer is never offered", () => {
    expect(suggestRecordsForReading(facts, [rec("Bodegas Riojanas", "Reserva")])).toEqual([]);
  });
  it("a record that lists the year read comes before one that does not; the year is never changed", () => {
    const out = suggestRecordsForReading(facts, [
      rec("Bodegas Muga", "Reserva", { vintages: [2015, 2016] }),
      rec("Bodegas Muga", "Reserva", { vintages: [2018] }),
      rec("Bodegas Muga", "Reserva", { vintages: [] }),
    ]);
    expect(out.map((s) => s.vintageListed)).toEqual([true, false, null]);
    expect(out[0]!.reasons).toContain("vintage_listed");
    expect(out[1]!.reasons).toContain("vintage_not_listed");
  });
  it("without a wine name on the label, the producer's records are offered as producer only", () => {
    const out = suggestRecordsForReading({ ...facts, name: null }, [
      rec("Bodegas Muga", "Reserva"),
    ]);
    expect(out[0]!.reasons[0]).toBe("producer_only");
  });
  it("without a wine name, another producer's record is still never offered (review of 004B)", () => {
    const banfi = { ...facts, producer: "Castello Banfi", name: null, countryCode: "IT" };
    const out = suggestRecordsForReading(banfi, [
      rec("Via al Castello", "Barolo", { countryCode: "IT" }),
      rec("Castello di Selvole", "Barullo", { countryCode: "IT" }),
      rec("Gaja", "Barolo", { countryCode: "IT" }),
      rec("Castello Banfi", "Brunello di Montalcino", { countryCode: "IT" }),
    ]);
    expect(out.map((s) => s.hit.producer)).toEqual(["Castello Banfi"]);
  });
  it("nothing read, nothing offered; never more than asked", () => {
    expect(
      suggestRecordsForReading({ ...facts, producer: null, name: null }, [
        rec("Bodegas Muga", "Reserva"),
      ]),
    ).toEqual([]);
    const many = Array.from({ length: 10 }, () => rec("Bodegas Muga", "Reserva"));
    expect(suggestRecordsForReading(facts, many)).toHaveLength(3);
    expect(suggestRecordsForReading(facts, many, 0)).toEqual([]);
  });
  it("every suggestion still needs the person's confirmation", () => {
    for (const s of suggestRecordsForReading(facts, [
      rec("Bodegas Muga", "Reserva", { match: "exact" }),
    ]))
      expect(needsConfirmation(s.hit)).toBe(true);
  });
  it("a record without a provider (or an id) is ignored", () => {
    expect(
      suggestRecordsForReading(facts, [
        rec("Bodegas Muga", "Reserva", { provider: null }),
        rec("Bodegas Muga", "Reserva", { recordId: null }),
      ]),
    ).toEqual([]);
  });
});

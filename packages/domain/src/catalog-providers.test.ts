import { describe, expect, it } from "vitest";
import {
  ADAPTERS,
  csvObjects,
  fromLwinRow,
  fromXWinesRow,
  parseCsv,
  PROVIDERS,
  pythonList,
  XWINES_COLUMNS,
} from "./catalog-providers";

const XW_HEADER =
  "WineID,WineName,Type,Elaborate,Grapes,Harmonize,ABV,Body,Acidity,Code,Country,RegionID,RegionName,WineryID,WineryName,Website,Vintages";

describe("parseCsv", () => {
  it("handles quotes, doubled quotes, commas and newlines inside quotes, CRLF and a BOM", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\n"multi\nline",2\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
      ["multi\nline", "2"],
    ]);
  });
  it("refuses a file without the adapter's columns", () => {
    expect(() => csvObjects("WineID,WineName\n1,x\n", XWINES_COLUMNS)).toThrow(/missing columns/);
  });
});

describe("pythonList", () => {
  it("reads the X-Wines list literals", () => {
    expect(pythonList("['Merlot', 'Cabernet Sauvignon']")).toEqual([
      "Merlot",
      "Cabernet Sauvignon",
    ]);
    expect(pythonList("[2020, 2019, 'N.V.']")).toEqual(["2020", "2019", "N.V."]);
    expect(pythonList("[]")).toEqual([]);
  });
});

describe("fromXWinesRow", () => {
  const [row] = csvObjects(
    `${XW_HEADER}\n100191,Reserva Chardonnay,White,Varietal/100%,['Chardonnay'],"['Rich Fish']",13.0,Medium-bodied,Medium,BR,Brazil,1001,Serra Gaúcha,10000,Aurora,http://x,"[2021, 2019, 2021, 1700, 'N.V.']"\n`,
    XWINES_COLUMNS,
  );
  it("maps identity fields only (never ratings), and keeps the provider id", () => {
    const r = fromXWinesRow(row!);
    expect(r).toEqual({
      ok: true,
      record: {
        external_id: "100191",
        producer: "Aurora",
        name: "Reserva Chardonnay",
        wine_type: "white",
        country_code: "BR",
        region: "Serra Gaúcha",
        appellation: null,
        vintages: [2019, 2021],
        non_vintage: true,
        details: { grapes: ["Chardonnay"], abv: 13, elaborate: "Varietal/100%" },
        source_url: null,
        modifications: [
          "food pairings, body, acidity, website and ratings omitted",
          "implausible vintages dropped",
        ],
      },
    });
  });
  it("maps Dessert/Port to fortified and leaves an unknown type empty", () => {
    const port = fromXWinesRow({ ...row!, Type: "Dessert/Port" });
    expect(port).toMatchObject({ record: { wine_type: "fortified" } });
    expect(port.ok && port.record.modifications).toContain(
      'type "Dessert/Port" mapped to fortified',
    );
    expect(fromXWinesRow({ ...row!, Type: "Cider" })).toMatchObject({
      record: { wine_type: null },
    });
  });
  it("refuses a row without an id or a name", () => {
    expect(fromXWinesRow({ ...row!, WineID: "x" }).ok).toBe(false);
    expect(fromXWinesRow({ ...row!, WineName: "  " }).ok).toBe(false);
  });
});

describe("fromLwinRow", () => {
  const base = {
    LWIN: "1012361",
    STATUS: "Live",
    PRODUCER_TITLE: "Chateau",
    PRODUCER_NAME: "Margaux",
    WINE: "Pavillon Rouge du Chateau Margaux",
    COUNTRY: "France",
    REGION: "Bordeaux",
    SUB_REGION: "Margaux",
    COLOUR: "Red",
    TYPE: "Wine",
    DESIGNATION: "AOP",
    CLASSIFICATION: "",
  };
  it("maps a live wine-level code", () => {
    expect(fromLwinRow(base)).toMatchObject({
      ok: true,
      record: {
        external_id: "1012361",
        producer: "Chateau Margaux",
        wine_type: "red",
        country_code: "FR",
        region: "Margaux",
      },
    });
  });
  it("skips deleted codes and anything that is not an LWIN-7", () => {
    expect(fromLwinRow({ ...base, STATUS: "Deleted" }).ok).toBe(false);
    expect(fromLwinRow({ ...base, LWIN: "10123612015" }).ok).toBe(false);
  });
  it("champagne is sparkling; an unknown colour is left empty", () => {
    expect(fromLwinRow({ ...base, TYPE: "Champagne", COLOUR: "White" })).toMatchObject({
      record: { wine_type: "sparkling" },
    });
    expect(fromLwinRow({ ...base, COLOUR: "Amber" })).toMatchObject({
      record: { wine_type: null },
    });
  });
});

describe("PROVIDERS", () => {
  it("never shows a provider's records by default", () => {
    for (const p of Object.values(PROVIDERS)) expect(p.search_scope).toBe("off");
  });
  it("LWIN is blocked until the licence conflict is resolved", () => {
    expect(PROVIDERS.lwin).toMatchObject({ may_store: false, rights_status: "blocked" });
    expect(PROVIDERS.lwin.rights_evidence).toMatch(/BLOCKER/);
  });
  it("X-Wines is not verified: its provenance is a documented blocker", () => {
    expect(PROVIDERS.xwines.rights_status).toBe("unverified");
    expect(PROVIDERS.xwines.rights_evidence).toMatch(/BLOCKER/);
  });
  it("a provider is only 'verified' with evidence, a date and who verified it", () => {
    for (const p of Object.values(PROVIDERS))
      if (p.rights_status === "verified")
        expect(p.rights_evidence && p.rights_verified_at && p.rights_verified_by).toBeTruthy();
  });
  it("no attribution or notice claims an endorsement or partnership", () => {
    for (const p of Object.values(PROVIDERS))
      expect(`${p.attribution} ${p.legal_notice}`).not.toMatch(
        /endorsed by cellr|in partnership|official partner|powered by/i,
      );
  });
  it("every provider has an adapter", () => {
    expect(Object.keys(ADAPTERS).sort()).toEqual(Object.keys(PROVIDERS).sort());
  });
});

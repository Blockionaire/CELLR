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

// ---- WI-01: looking at a file before it is imported ----------------------------------------------------------------
import { decodeUtf8, importBlocker, inspectProviderFile } from "./catalog-providers";

// The fixture files themselves (eval/catalog/*.csv) are inspected in scripts/catalog-tools/eval.test.ts.
const xw = (rows: string[]) => `${XW_HEADER}\n${rows.join("\n")}\n`;
const xwRow = (id: string, name: string, type = "Red", vintages = "[2019]") =>
  `${id},${name},${type},Varietal/100%,['Merlot'],[],13.0,Medium-bodied,Medium,FR,France,1,Région,1,Domaine Test,,"${vintages}"`;

describe("inspectProviderFile", () => {
  it("a repeated external id is fatal: a second row never silently overwrites the first", () => {
    const i = inspectProviderFile(
      xw([xwRow("1", "Alpha"), xwRow("2", "Beta"), xwRow("1", "Gamma")]),
      "xwines",
    );
    expect(i.duplicateIds).toEqual(["1"]);
    expect(i.duplicateRows).toBe(1);
    expect(i.records.map((r) => r.name)).toEqual(["Alpha", "Beta"]);
    expect(importBlocker("xwines", i, "any")).toMatch(/repeat an external id/);
  });

  it("a semicolon- or tab-separated export is named as such, not mapped", () => {
    for (const d of [";", "\t"]) {
      const text = xw([xwRow("1", "Alpha")]).replaceAll(",", d);
      const i = inspectProviderFile(text, "xwines");
      expect(i.records).toEqual([]);
      expect(i.fatal[0]).toMatch(/not by commas/);
    }
  });

  it("another layout is refused with the missing columns, never guessed", () => {
    const i = inspectProviderFile("id,wine,winery\n1,Alpha,Domaine Test\n", "xwines");
    expect(i.fatal[0]).toMatch(/not the xwines-wines-csv-v1 layout: missing columns/);
    expect(inspectProviderFile("", "xwines").fatal[0]).toMatch(/empty file/);
  });

  it("mis-decoded text (Latin-1 read as UTF-8, a replacement character) is fatal", () => {
    const i = inspectProviderFile(
      xw([xwRow("1", "CuvÃ©e Alpha"), xwRow("2", "Ch�teau")]),
      "xwines",
    );
    expect(i.encodingRows).toBe(2);
    expect(importBlocker("xwines", i, "any")).toMatch(/not valid UTF-8/);
    expect(decodeUtf8(new Uint8Array([0x43, 0xe9, 0x65]))).toBeNull(); // "Cée" in Latin-1
    expect(decodeUtf8(new TextEncoder().encode("Cuvée"))).toBe("Cuvée");
  });

  it("a few odd-looking names are a warning; a file full of them is mis-decoded", () => {
    const fine = Array.from({ length: 400 }, (_, n) => xwRow(String(n + 10), `Cuvée ${n}`));
    const odd = inspectProviderFile(xw([...fine, xwRow("1", "ROMÃ® Reserva")]), "xwines");
    expect(odd.fatal).toEqual([]);
    expect(odd.warnings.join(" ")).toMatch(/look mis-decoded/);
    const broken = inspectProviderFile(
      xw([...fine.slice(0, 100), ...["1", "2", "3"].map((id) => xwRow(id, "ChÃ¢teau CuvÃ©e"))]),
      "xwines",
    );
    expect(broken.fatal[0]).toMatch(/not valid UTF-8/);
    // a mis-decoded capital ("Â" read as two characters) is recognised too
    expect(
      inspectProviderFile(xw(["1", "2", "3"].map((id) => xwRow(id, "CHÃ‚TEAU RHÃ”NE"))), "xwines")
        .fatal[0],
    ).toMatch(/not valid UTF-8/);
  });

  it("a row with too many or too few fields is fatal: values never land under the wrong column", () => {
    // an unquoted comma in the name shifts every later column: the winery id would become the producer
    const shifted = `${XW_HEADER}\n2,Chateau X, Cuvee Y,Red,Varietal/100%,['Merlot'],[],13.0,Medium,Medium,FR,France,1,Région,77,Domaine Test,,"[2019]"\n`;
    const i = inspectProviderFile(shifted, "xwines");
    expect(i.records).toEqual([]);
    expect(i.fatal[0]).toMatch(/row 2 has 18 fields, the header has 17/);
    const short = `${XW_HEADER}\n${xwRow("1", "Alpha")}\n2,Beta,Red\n`;
    expect(inspectProviderFile(short, "xwines").fatal[0]).toMatch(/row 3 has 3 fields/);
  });

  it("a column named twice is fatal: one may not silently overwrite the other", () => {
    const i = inspectProviderFile(
      `${XW_HEADER},WineName\n${xwRow("1", "Alpha")},Injected Name\n`,
      "xwines",
    );
    expect(i.records).toEqual([]);
    expect(i.fatal[0]).toMatch(/column "WineName" occurs twice/);
  });

  it("a header without rows, and a quote that is never closed, are failed exports, not small catalogues", () => {
    expect(inspectProviderFile(`${XW_HEADER}\n`, "xwines").fatal).toEqual([
      "the file holds no rows",
    ]);
    // one stray quote in the first row would swallow every row after it
    const stray = xw([
      xwRow("1", 'Al"pha').replace('Al"pha', '"Alpha'),
      xwRow("2", "Beta"),
      xwRow("3", "Gamma"),
    ]);
    const i = inspectProviderFile(stray, "xwines");
    expect(i.records).toEqual([]);
    expect(i.fatal[0]).toMatch(/quoted field is never closed/);
  });

  it("invisible direction marks are dropped from names", () => {
    const i = inspectProviderFile(xw([xwRow("1", "Mar\u202Egaux\u200B Rouge\u2066")]), "xwines");
    expect(i.records[0]!.name).toBe("Margaux Rouge");
  });

  it("real accents, uppercase and non-Latin names are fine", () => {
    const i = inspectProviderFile(
      xw([
        xwRow("1", "SÃO JOÃO Reserva"),
        xwRow("2", "Κτήμα Δοκιμή"),
        xwRow("3", "Grüner Veltliner Smaragd"),
      ]),
      "xwines",
    );
    expect(i.encodingRows).toBe(0);
    expect(i.fatal).toEqual([]);
  });

  it("an unknown type is left empty and counted; an implausible vintage is dropped and counted", () => {
    const i = inspectProviderFile(
      xw([xwRow("1", "Alpha", "Orange Fizz"), xwRow("2", "Beta", "Red", "[2019, 1492, 2999]")]),
      "xwines",
    );
    expect(i.records[0]!.wine_type).toBeNull();
    expect(i.unmappedTypes).toEqual({ "Orange Fizz": 1 });
    expect(i.records[1]!.vintages).toEqual([2019]);
    expect(i.implausibleVintageRows).toBe(1);
    expect(i.fatal).toEqual([]);
  });

  it("placeholders for a missing value are never taken as a name", () => {
    const i = inspectProviderFile(
      xw([xwRow("1", "NULL"), xwRow("2", "n/a"), xwRow("3", "Alpha")]),
      "xwines",
    );
    expect(i.records.map((r) => r.name)).toEqual(["Alpha"]);
    expect(i.skipped).toEqual({ "WineryName/WineName": 2 });
  });

  it("a large file that mostly cannot be mapped is not the expected layout", () => {
    const rows = Array.from({ length: 60 }, (_, n) => xwRow(n < 40 ? `x${n}` : String(n), "Alpha"));
    expect(inspectProviderFile(xw(rows), "xwines").fatal[0]).toMatch(/could not be mapped/);
  });
});

describe("the LWIN adapter's own rules (assumed layout)", () => {
  const row = (over: Record<string, string>) => ({
    LWIN: "9000001",
    STATUS: "Live",
    PRODUCER_TITLE: "Chateau",
    PRODUCER_NAME: "Imaginaire",
    WINE: "",
    COUNTRY: "France",
    REGION: "",
    SUB_REGION: "",
    COLOUR: "Red",
    TYPE: "Wine",
    DESIGNATION: "",
    CLASSIFICATION: "",
    ...over,
  });
  it("a placeholder in one part never becomes part of a name, and a title alone is not a producer", () => {
    expect(fromLwinRow(row({ PRODUCER_NAME: "NULL" }))).toEqual({
      ok: false,
      reason: "PRODUCER/WINE",
    });
    expect(fromLwinRow(row({ PRODUCER_NAME: "" }))).toEqual({ ok: false, reason: "PRODUCER/WINE" });
    expect(fromLwinRow(row({ PRODUCER_TITLE: "N/A" }))).toMatchObject({
      ok: true,
      record: { producer: "Imaginaire" },
    });
  });
  it("spirits of every kind are not wine; an all-zero code is not a code", () => {
    for (const TYPE of ["Spirit", "Cognac", "Armagnac", "Brandy", "Whisky", "Rum"])
      expect(fromLwinRow(row({ TYPE }))).toEqual({ ok: false, reason: "TYPE (not wine)" });
    expect(fromLwinRow(row({ LWIN: "0000000" }))).toEqual({ ok: false, reason: "LWIN" });
  });
  it("an unverified layout reads one file only, recognised by its hash, whatever provider it is offered for", () => {
    const good = inspectProviderFile(
      "LWIN,STATUS,PRODUCER_TITLE,PRODUCER_NAME,WINE,COUNTRY,REGION,SUB_REGION,COLOUR,TYPE,DESIGNATION,CLASSIFICATION\n9000001,Live,Chateau,Imaginaire,,France,,,Red,Wine,,\n",
      "lwin_fixture",
    );
    expect(good.fatal).toEqual([]);
    const pinned = ADAPTERS.lwin_fixture.fixtureSha256;
    expect(pinned).toMatch(/^[0-9a-f]{64}$/);
    expect(importBlocker("lwin_fixture", good, pinned)).toBeNull();
    // any other file under the fixture provider — a real LWIN file, say — is refused
    expect(importBlocker("lwin_fixture", good, "a".repeat(64))).toMatch(/never verified/);
    // and the real provider has no file it may read at all, not even the fixture
    expect(importBlocker("lwin", good, pinned)).toMatch(
      /never verified against a real Liv-ex LWIN file/,
    );
    expect("fixtureSha256" in ADAPTERS.lwin).toBe(false);
  });
});

describe("the real LWIN provider", () => {
  it("stays blocked in the static assessment, with an unverified adapter", () => {
    expect(PROVIDERS.lwin).toMatchObject({
      rights_status: "blocked",
      may_store: false,
      search_scope: "off",
    });
    expect(ADAPTERS.lwin.layoutVerified).toBe(false);
    expect(ADAPTERS.lwin_fixture.layoutVerified).toBe(false);
    expect(ADAPTERS.xwines.layoutVerified).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import type { WineSummary } from "./cellar";
import {
  LABEL_TEXT_LIMITS,
  labelLines,
  labelPhrases,
  recognizeLabelText,
  vintageFromLabel,
  type LabelTextCandidate,
} from "./label-text";

const NOW = new Date("2026-11-01T12:00:00Z");

const catalog = (id: string, over: Partial<WineSummary> = {}): LabelTextCandidate => ({
  wine: {
    id,
    producer: "Domaine Alpha",
    name: "Cuvée Silex",
    type: "white",
    countryCode: "FR",
    region: "Loire",
    catalog: true,
    aliases: [],
    ...over,
  },
  linkedTo: null,
});

const own = (id: string, over: Partial<WineSummary> = {}, linkedTo: string | null = null) => ({
  wine: {
    id,
    producer: "Domaine Alpha",
    name: "Cuvée Silex",
    type: "white" as const,
    countryCode: "FR",
    region: "Loire",
    ...over,
  },
  linkedTo,
});

const LABEL =
  "DOMAINE ALPHA\nCuvée Silex\n2019\nPouilly-Fumé\nAppellation Contrôlée\n750 ml 13% vol";

describe("label text → phrases", () => {
  it("normalises lines and bounds what is sent", () => {
    expect(labelLines("  Château  MARGAUX \n\n Grand Vin ")).toEqual([
      ["chateau", "margaux"],
      ["grand", "vin"],
    ]);
    const phrases = labelPhrases(LABEL);
    expect(phrases).toContain("domaine alpha");
    expect(phrases).toContain("cuvee silex");
    expect(phrases).not.toContain("ml"); // a single short word names nothing
    const huge = Array.from(
      { length: 200 },
      (_, i) => `word${i} other${i} third${i} more${i}`,
    ).join("\n");
    expect(labelPhrases(huge).length).toBeLessThanOrEqual(LABEL_TEXT_LIMITS.phrases);
    expect(labelLines("x".repeat(5000))[0]![0]!.length).toBeLessThanOrEqual(
      LABEL_TEXT_LIMITS.chars,
    );
  });

  it("a name printed over two lines is still one phrase", () => {
    expect(labelPhrases("CUVÉE\nSILEX")).toContain("cuvee silex");
  });
});

describe("recognising a catalogue wine from label text", () => {
  it("an exact catalogue identity is a confident match, with the year that was read", () => {
    const r = recognizeLabelText(LABEL, [catalog("c1")], NOW);
    expect(r.kind).toBe("match");
    if (r.kind !== "match") return;
    expect(r.wine.id).toBe("c1");
    expect(r.catalogWineId).toBe("c1");
    expect(r.facts).toMatchObject({
      producer: "Domaine Alpha",
      name: "Cuvée Silex",
      year: 2019,
      nonVintage: false,
      type: "white",
      confidence: { producer: "high", name: "high", year: "medium" },
    });
  });

  it("the same wine on a newly photographed label (other line breaks, OCR noise) is the same match", () => {
    const again = "~ DOMAINE ALPHA |\n' CUVEE SILEX 2019\nPOUILLY FUME\nproduit de France";
    const r = recognizeLabelText(again, [catalog("c1")], NOW);
    expect(r).toMatchObject({ kind: "match", wine: { id: "c1" }, facts: { year: 2019 } });
  });

  it("a verified alias is enough; a similar name is not", () => {
    const aliased = catalog("c1", { aliases: ["Silex Blanc"] });
    expect(recognizeLabelText("Domaine Alpha\nSilex Blanc", [aliased], NOW).kind).toBe("match");
    expect(recognizeLabelText("Domaine Alpha\nCuvee Silexe", [aliased], NOW)).toEqual({
      kind: "none",
      reason: "no-match",
    });
  });

  it("a missing producer or missing cuvée is never a match", () => {
    expect(recognizeLabelText("Cuvée Silex\n2019", [catalog("c1")], NOW).kind).toBe("none");
    expect(recognizeLabelText("Domaine Alpha\n2019", [catalog("c1")], NOW).kind).toBe("none");
    expect(recognizeLabelText("", [catalog("c1")], NOW)).toEqual({
      kind: "none",
      reason: "no-text",
    });
  });

  it("the name inside a longer line (another cuvée) is not the name", () => {
    const margaux = catalog("gv", {
      producer: "Château Margaux",
      name: "Château Margaux",
      type: "red",
      region: "Bordeaux",
    });
    const pavillon = "PAVILLON ROUGE DU CHATEAU MARGAUX\n2016\nMargaux";
    expect(recognizeLabelText(pavillon, [margaux], NOW).kind).toBe("none");
  });

  it("a wine named after its estate is never confirmed by the estate's name: another cuvée prints it too", () => {
    const flagship = catalog("gv", {
      producer: "Château Margaux",
      name: "Château Margaux",
      type: "red",
      region: "Bordeaux",
    });
    // the regression: the estate's second wine, not in the catalogue, must not be read as the flagship
    expect(recognizeLabelText("CHATEAU MARGAUX\nPAVILLON ROUGE\n2016", [flagship], NOW)).toEqual({
      kind: "none",
      reason: "no-match",
    });
    // …nor the flagship's own label: nothing on it tells the two apart, so the model reads it
    expect(
      recognizeLabelText("CHATEAU MARGAUX\nPremier Grand Cru Classé\n2016", [flagship], NOW).kind,
    ).toBe("none");
    // a name that only repeats the estate's distinguishing word counts as the estate too
    const alpha = catalog("a", { name: "Alpha" });
    expect(recognizeLabelText("DOMAINE ALPHA\nCuvée Silex\n2019", [alpha], NOW).kind).toBe("none");
    // an alias that is just the estate's name is no help either
    const aliased = catalog("gv2", { ...flagship.wine, id: "gv2", aliases: ["Margaux"] });
    expect(recognizeLabelText("CHATEAU MARGAUX\nPAVILLON ROUGE", [aliased], NOW).kind).toBe("none");
  });

  it("a wine named after its estate is still recognised through a distinct verified alias, printed on its own", () => {
    const flagship = catalog("gv", {
      producer: "Château Margaux",
      name: "Château Margaux",
      type: "red",
      region: "Bordeaux",
      aliases: ["Grand Vin"],
    });
    expect(
      recognizeLabelText(
        "CHATEAU MARGAUX\nGRAND VIN\nPremier Grand Cru Classé\n2016",
        [flagship],
        NOW,
      ),
    ).toMatchObject({ kind: "match", wine: { id: "gv" }, facts: { year: 2016 } });
    expect(recognizeLabelText("CHATEAU MARGAUX\nPAVILLON ROUGE\n2016", [flagship], NOW).kind).toBe(
      "none",
    );
  });

  it("two catalogue wines both printed in full (same producer and name, red and white) are not resolved", () => {
    const white = catalog("w");
    const red = catalog("r", { type: "red" });
    expect(recognizeLabelText(LABEL, [white, red], NOW)).toEqual({
      kind: "none",
      reason: "ambiguous",
    });
  });

  it("a colour printed on the label that the catalogue wine cannot be is a contradiction", () => {
    const red = catalog("r", { type: "red" });
    expect(recognizeLabelText(`${LABEL}\nVin Blanc`, [red], NOW)).toEqual({
      kind: "none",
      reason: "contradiction",
    });
    // a Champagne's "Blanc de Blancs" is no contradiction
    const champagne = catalog("ch", {
      producer: "Maison Gamma",
      name: "Cuvée Une",
      type: "sparkling",
      region: "Champagne",
    });
    expect(
      recognizeLabelText("MAISON GAMMA\nCuvée Une\nBlanc de Blancs\nBrut", [champagne], NOW).kind,
    ).toBe("match");
  });

  it("the wrong country printed on the label is a contradiction", () => {
    expect(recognizeLabelText(`${LABEL}\nProduct of Chile`, [catalog("c1")], NOW)).toEqual({
      kind: "none",
      reason: "contradiction",
    });
    // its own country, next to an importer's country, is fine
    expect(
      recognizeLabelText(`${LABEL}\nProduit de France\nImported by X, USA`, [catalog("c1")], NOW)
        .kind,
    ).toBe("match");
  });

  it("a reserve or other qualified bottling of the same name falls back", () => {
    expect(recognizeLabelText(`${LABEL}\nRÉSERVE`, [catalog("c1")], NOW)).toEqual({
      kind: "none",
      reason: "qualifier",
    });
    expect(recognizeLabelText(`${LABEL}\nVieilles Vignes`, [catalog("c1")], NOW).kind).toBe("none");
    // …unless the qualifier is part of the catalogue wine's own name
    const reserve = catalog("res", { name: "Cuvée Silex Réserve" });
    expect(
      recognizeLabelText("Domaine Alpha\nCuvée Silex Réserve\n2018", [reserve], NOW),
    ).toMatchObject({ kind: "match", wine: { id: "res" } });
  });

  it("a near match (one letter off in the producer) is not a match", () => {
    expect(recognizeLabelText("DOMAINE ALFA\nCuvée Silex", [catalog("c1")], NOW).kind).toBe("none");
  });

  it("too many candidates (the answer may be cut off) decides nothing", () => {
    const many = Array.from({ length: LABEL_TEXT_LIMITS.candidates }, (_, i) =>
      catalog(`c${i}`, { name: `Cuvée ${i}` }),
    );
    expect(recognizeLabelText(LABEL, [catalog("c1"), ...many], NOW)).toEqual({
      kind: "none",
      reason: "too-many",
    });
  });
});

describe("the vintage", () => {
  it("an unreadable year stays unknown, never non-vintage", () => {
    const r = recognizeLabelText("Domaine Alpha\nCuvée Silex\n2O19", [catalog("c1")], NOW);
    expect(r).toMatchObject({
      kind: "match",
      facts: { year: null, nonVintage: false, confidence: { year: "low" } },
    });
  });

  it("two different years, a founding year or a year in the future are not the vintage", () => {
    const lines = (t: string) => labelLines(t);
    expect(vintageFromLabel(lines("2018\n2019"), null, NOW)).toBeNull();
    expect(vintageFromLabel(lines("Depuis 1855\n2019"), null, NOW)).toBe(2019);
    expect(vintageFromLabel(lines("Since 1855"), null, NOW)).toBeNull();
    expect(vintageFromLabel(lines("2031"), null, NOW)).toBeNull();
    // a year that is part of the wine's own name is not its vintage
    const named = catalog("c", { name: "Cuvée 1531" }).wine;
    expect(vintageFromLabel(lines("Cuvée 1531\n2020"), named, NOW)).toBe(2020);
  });
});

describe("household wines come first", () => {
  it("the household's own wine verifiably linked to the catalogue wine is the one proposed", () => {
    const linked = own("mine", { name: "Silex" }, "c1");
    const r = recognizeLabelText(LABEL, [catalog("c1"), linked], NOW);
    expect(r).toMatchObject({ kind: "match", wine: { id: "mine" }, catalogWineId: "c1" });
  });

  it("an unlinked household wine with the same identity is never passed over for the catalogue's", () => {
    expect(recognizeLabelText(LABEL, [catalog("c1"), own("mine")], NOW)).toEqual({
      kind: "none",
      reason: "own-wine",
    });
  });

  it("a household wine alone is not a verified identity: the vision model reads it as before", () => {
    expect(recognizeLabelText(LABEL, [own("mine")], NOW)).toEqual({
      kind: "none",
      reason: "no-match",
    });
  });

  it("an unrelated household wine of another producer does not block the match", () => {
    const other = own("x", { producer: "Weingut Beta", name: "Riesling Trocken", type: "white" });
    expect(recognizeLabelText(LABEL, [catalog("c1"), other], NOW).kind).toBe("match");
  });
});

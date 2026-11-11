import { describe, expect, it } from "vitest";
import {
  attributionLine,
  groupByOrigin,
  noEndorsement,
  originLabel,
  originOf,
  sourcesOf,
  type SourceNotice,
} from "./provenance";

const notice: SourceNotice = {
  providerId: "xwines",
  providerName: "X-Wines dataset",
  license: "CC0-1.0",
  licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
  attribution: "X-Wines dataset (2023)",
  modified: true,
  modificationNotice: "Names normalised by CELLR.",
  modifications: ["whitespace normalised"],
  legalNotice: "…",
  externalId: "100191",
  sourceUrl: null,
  retrievedAt: "2026-11-11",
  datasetVersion: "1.0",
  scope: "public",
};

describe("provenance", () => {
  it("maps every stored provenance to one of four origins", () => {
    expect(originOf("verified")).toBe("cellr_catalog");
    expect(originOf("licensed_import")).toBe("external_catalog");
    expect(originOf("ai_estimate")).toBe("ai_estimate");
    expect(originOf("heuristic")).toBe("ai_estimate");
    expect(originOf("label_ocr")).toBe("user_provided");
    expect(originOf("user_entered")).toBe("user_provided");
  });
  it("credits the source with its licence and says when CELLR modified it", () => {
    expect(attributionLine(notice, "nl")).toBe(
      "Bron: X-Wines dataset (2023) · licentie CC0-1.0 · bewerkt door CELLR",
    );
    expect(attributionLine({ ...notice, modified: false }, "en")).toBe(
      "Source: X-Wines dataset (2023) · licence CC0-1.0",
    );
  });
  it("marks pilot data as such", () => {
    expect(attributionLine({ ...notice, scope: "pilot" }, "en")).toMatch(/pilot data$/);
  });
  it("never implies endorsement", () => {
    for (const locale of ["nl", "en"] as const) {
      const text = `${attributionLine(notice, locale)} ${noEndorsement(notice.providerName, locale)}`;
      expect(text).not.toMatch(/partner|powered by|official|in samenwerking|aangeboden door/i);
      expect(noEndorsement("X", locale)).toMatch(/niet|not/);
    }
  });
  it("groups facts by origin, keeping licensed data apart from CELLR's and the household's", () => {
    const groups = groupByOrigin([
      { field: "region", origin: "external_catalog", source: notice },
      { field: "drinkWindow", origin: "ai_estimate" },
      { field: "price", origin: "user_provided" },
      { field: "grapes", origin: "external_catalog", source: notice },
    ]);
    expect(groups.map((g) => g.origin)).toEqual([
      "external_catalog",
      "ai_estimate",
      "user_provided",
    ]);
    expect(groups[0]!.facts.map((f) => f.field)).toEqual(["region", "grapes"]);
    expect(sourcesOf(groups.flatMap((g) => g.facts))).toHaveLength(1);
    expect(originLabel("ai_estimate", "nl")).toBe("Schatting door CELLR (AI)");
  });
});

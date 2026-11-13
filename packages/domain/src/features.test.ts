import { describe, expect, it } from "vitest";
import { FEATURES, NO_FEATURES, parseFeatures } from "./features";

describe("feature switches", () => {
  it("everything is off unless it is named", () => {
    for (const raw of [undefined, null, "", "   ", ",", "nonsense", "wine-search", "ALLE"])
      expect(parseFeatures(raw)).toEqual(NO_FEATURES);
  });

  it("a named feature is on, and only that one", () => {
    const flags = parseFeatures(" Wine_Search , sources_panel ");
    expect(flags.wine_search).toBe(true);
    expect(flags.sources_panel).toBe(true);
    expect(flags.scan_resolver).toBe(false);
    expect(flags.purchase_intel).toBe(false);
  });

  it("an unknown name next to a known one changes nothing else", () => {
    expect(parseFeatures("scan_resolver,drop table")).toEqual({
      ...NO_FEATURES,
      scan_resolver: true,
    });
  });

  it("`all` switches every feature on", () => {
    const flags = parseFeatures("all");
    for (const f of FEATURES) expect(flags[f]).toBe(true);
  });

  it("the answer cannot be changed by whoever receives it", () => {
    const flags = parseFeatures("wine_search") as Record<string, boolean>;
    expect(() => {
      flags.scan_resolver = true;
    }).toThrow();
  });
});

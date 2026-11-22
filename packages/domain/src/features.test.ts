import { describe, expect, it } from "vitest";
import { FEATURES, NAMED_ONLY, NO_FEATURES, parseFeatures } from "./features";

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

  it("`all` switches on every feature that does not have to be named", () => {
    const flags = parseFeatures("all");
    for (const f of FEATURES) expect(flags[f], f).toBe(!NAMED_ONLY.has(f));
  });

  it("the sommelier switches are off unless someone writes their name, also under `all`", () => {
    for (const raw of [undefined, "", "all", "ALL, wine_search", "sommelier", "sommelier_*"]) {
      const flags = parseFeatures(raw);
      expect(flags.sommelier_engine, String(raw)).toBe(false);
      expect(flags.sommelier_buying, String(raw)).toBe(false);
      expect(flags.sommelier_social, String(raw)).toBe(false);
      expect(flags.sommelier_experiences, String(raw)).toBe(false);
    }
    expect(parseFeatures("all, sommelier_engine").sommelier_engine).toBe(true);
    expect(parseFeatures("all, sommelier_engine").wine_search).toBe(true);
  });

  it("the later sommelier switches do nothing without the engine", () => {
    for (const f of ["sommelier_buying", "sommelier_social", "sommelier_experiences"] as const) {
      expect(parseFeatures(f)[f], f).toBe(false);
      expect(parseFeatures(`all, ${f}`)[f], f).toBe(false);
      expect(parseFeatures(`sommelier_engine, ${f}`)[f], f).toBe(true);
    }
    expect(parseFeatures("sommelier_engine")).toMatchObject({
      sommelier_engine: true,
      sommelier_buying: false,
      sommelier_social: false,
      sommelier_experiences: false,
    });
  });

  it("the answer cannot be changed by whoever receives it", () => {
    const flags = parseFeatures("wine_search") as Record<string, boolean>;
    expect(() => {
      flags.scan_resolver = true;
    }).toThrow();
  });
});

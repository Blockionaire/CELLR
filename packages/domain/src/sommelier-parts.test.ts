import { describe, expect, it } from "vitest";
import { parseFeatures } from "./features";
import {
  hasSommelierPart,
  NO_SOMMELIER_PARTS,
  parseSommelierParts,
  SOMMELIER_PARTS,
} from "./sommelier-parts";

describe("the V1+ release configuration (CELLR_SOMMELIER)", () => {
  it("is empty when unset or blank: V1 exactly as before", () => {
    for (const raw of [undefined, null, "", "   ", ",", " , ,"]) {
      const parts = parseSommelierParts(raw);
      expect(parts.on.size, String(raw)).toBe(0);
      expect(parts.unknown, String(raw)).toEqual([]);
    }
    expect(parseSommelierParts(undefined)).toBe(NO_SOMMELIER_PARTS);
  });

  it("switches each part on alone, in any combination", () => {
    for (const part of SOMMELIER_PARTS) {
      const parts = parseSommelierParts(part);
      expect([...parts.on]).toEqual([part]);
      for (const other of SOMMELIER_PARTS)
        expect(hasSommelierPart(parts, other), `${part} → ${other}`).toBe(other === part);
    }
    expect([...parseSommelierParts("menu,check").on].sort()).toEqual(["check", "menu"]);
    expect(parseSommelierParts(SOMMELIER_PARTS.join(",")).on.size).toBe(SOMMELIER_PARTS.length);
  });

  it("ignores case, spaces and duplicates", () => {
    expect([...parseSommelierParts(" Check , ANNOTATE,check ").on].sort()).toEqual([
      "annotate",
      "check",
    ]);
  });

  it("has no `all`, and reports names it does not know instead of guessing", () => {
    const parts = parseSommelierParts("all,checks,annotate");
    expect([...parts.on]).toEqual(["annotate"]);
    expect(parts.unknown).toEqual(["all", "checks"]);
  });

  it("does not read beyond 200 characters, and never echoes a long name in full", () => {
    expect(parseSommelierParts(`${"x".repeat(250)},check`).on.size).toBe(0);
    expect(parseSommelierParts("y".repeat(90)).unknown[0]).toHaveLength(40);
  });

  it("is untouched by CELLR_FEATURES: `all` there turns no sommelier part or engine on", () => {
    const features = parseFeatures("all");
    expect(features.sommelier_engine).toBe(false);
    expect(features.sommelier_buying).toBe(false);
    expect(features.sommelier_social).toBe(false);
    expect(features.sommelier_experiences).toBe(false);
    // And the feature names are not parts.
    expect(parseSommelierParts("sommelier_engine,wine_search").on.size).toBe(0);
  });

  it("leaves an old switch named in a deployment harmless: unknown names are ignored there too", () => {
    expect(parseFeatures("sommelier_social,not_a_feature").sommelier_social).toBe(false);
  });

  it("is frozen", () => {
    const parts = parseSommelierParts("check");
    expect(Object.isFrozen(parts)).toBe(true);
    expect(Object.isFrozen(parts.unknown)).toBe(true);
  });
});

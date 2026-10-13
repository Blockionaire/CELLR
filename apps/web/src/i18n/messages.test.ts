import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import nl from "../../messages/nl.json";
import { pickLocale } from "./config";

/** Every key path, with the placeholders each message uses ({name}, plural arguments…). */
function flatten(value: unknown, path = ""): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (typeof value === "string") {
    // Plural branches ("one {…}", "=0 {…}") are text, not placeholders: blank their opening brace first.
    const text = value.replace(
      /(?<=(?:plural,|\})\s*)(?:(?:zero|one|two|few|many|other)|=\d+)\s*\{/g,
      "(",
    );
    const args = [...text.matchAll(/\{(\w+)(?:,|\})/g)].map((m) => m[1]!);
    out.set(path, [...new Set(args)].sort());
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value))
      for (const [p, a] of flatten(v, path ? `${path}.${k}` : k)) out.set(p, a);
  }
  return out;
}

describe("translations", () => {
  const english = flatten(en);
  const dutch = flatten(nl);

  it("Dutch has exactly the keys English has", () => {
    expect([...dutch.keys()].sort()).toEqual([...english.keys()].sort());
  });

  it("every message uses the same placeholders in both languages", () => {
    for (const [key, args] of english) expect({ key, args: dutch.get(key) }).toEqual({ key, args });
  });

  it("nothing is left empty", () => {
    for (const [key] of dutch) expect(key).toBeTruthy();
    expect(JSON.stringify(nl)).not.toContain('""');
  });
});

describe("pickLocale", () => {
  it("takes the first language we have", () => {
    expect(pickLocale("nl-NL,nl;q=0.9,en;q=0.8")).toBe("nl");
    expect(pickLocale("fr-FR,fr;q=0.9,en;q=0.8")).toBe("en");
    expect(pickLocale("de,nl;q=0.5")).toBe("nl");
    expect(pickLocale(null)).toBe("en");
    expect(pickLocale("")).toBe("en");
  });
});

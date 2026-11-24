import { describe, expect, it } from "vitest";
import { parseSommelier, SOMMELIER_SCHEMA, SOMMELIER_SYSTEM, SOMMELIER_VERSION } from "./sommelier";
import {
  applyPromptEdits,
  parseSommelierV7,
  SOMMELIER_SCHEMA_V7,
  SOMMELIER_SYSTEM_V7,
  SOMMELIER_VERSION_V7,
  V7_EDITS,
} from "./sommelier-v7";

describe("prompt v7 is v6 with an enumerated diff", () => {
  it("has its own version; v6 is untouched", () => {
    expect(SOMMELIER_VERSION_V7).toBe("sommelier_chat@v7");
    expect(SOMMELIER_VERSION).toBe("sommelier_chat@v6");
    expect(SOMMELIER_SYSTEM_V7).not.toBe(SOMMELIER_SYSTEM);
  });

  it("undoing the three edits gives v6 back byte for byte", () => {
    expect(V7_EDITS).toHaveLength(3);
    let back = SOMMELIER_SYSTEM_V7;
    for (const edit of V7_EDITS) {
      expect(back.split(edit.v7)).toHaveLength(2);
      back = back.replace(edit.v7, () => edit.v6);
    }
    expect(back).toBe(SOMMELIER_SYSTEM);
  });

  it("every line that is not an edit is identical, in the same order", () => {
    const touched = new Set(V7_EDITS.flatMap((e) => [...e.v6.split("\n"), ...e.v7.split("\n")]));
    const untouched = (text: string) =>
      text.split("\n").filter((line) => ![...touched].some((t) => line.includes(t)));
    expect(untouched(SOMMELIER_SYSTEM_V7)).toEqual(untouched(SOMMELIER_SYSTEM));
    // Only one line is added (the refs rule); the rest are edited in place.
    expect(SOMMELIER_SYSTEM_V7.split("\n")).toHaveLength(SOMMELIER_SYSTEM.split("\n").length + 1);
  });

  it("says what the check relies on", () => {
    expect(SOMMELIER_SYSTEM_V7).toContain("[[a1b2c3]]");
    expect(SOMMELIER_SYSTEM_V7).toContain("never by its name");
    expect(SOMMELIER_SYSTEM_V7).toContain("Never state a number of bottles or a year");
    expect(SOMMELIER_SYSTEM_V7).toContain("never as if the person has them");
    expect(SOMMELIER_SYSTEM_V7).toContain("never state a price");
    expect(SOMMELIER_SYSTEM_V7).toContain("reserved, ordered or opened");
    // No instruction left that asks for a price or a widely available wine.
    expect(SOMMELIER_SYSTEM_V7).not.toContain("rough price");
    expect(SOMMELIER_SYSTEM_V7).not.toContain("about €20");
    expect(SOMMELIER_SYSTEM_V7).not.toContain("widely available");
  });

  it("an edit that does not match v6 exactly once is refused", () => {
    expect(() => applyPromptEdits("abc", [{ v6: "x", v7: "y" }])).toThrow();
    expect(() => applyPromptEdits("a a", [{ v6: "a", v7: "b" }])).toThrow();
    expect(applyPromptEdits("a b", [{ v6: "b", v7: "$&c" }])).toBe("a $&c");
  });
});

describe("schema v7", () => {
  it("is v6's schema with no price in buy", () => {
    const { buy, ...rest } = SOMMELIER_SCHEMA_V7.properties;
    const { buy: buyV6, ...restV6 } = SOMMELIER_SCHEMA.properties;
    expect(rest).toEqual(restV6);
    expect(buy.items.required).toEqual(["wine", "why"]);
    expect(Object.keys(buy.items.properties)).toEqual(["wine", "why"]);
    expect(buyV6.items.required).toContain("price");
    expect(SOMMELIER_SCHEMA_V7.required).toEqual(SOMMELIER_SCHEMA.required);
    expect(SOMMELIER_SCHEMA_V7.additionalProperties).toBe(false);
  });

  it("parses to v6's shape with an empty price, whatever the model sent", () => {
    const value = {
      answer: "Open [[abc001]].",
      bottle_refs: ["abc001"],
      verdict: "partial",
      buy: [{ wine: "Barolo", why: "Firm.", price: "€40" }],
      used_taste: false,
    };
    expect(parseSommelierV7(value)).toEqual({
      ...parseSommelier({ ...value, buy: [{ wine: "Barolo", why: "Firm.", price: "" }] }),
    });
    expect(parseSommelierV7({ answer: "Hi", bottle_refs: [] })).toMatchObject({
      buy: [],
      verdict: "not_pairing",
      used_taste: false,
    });
    expect(() => parseSommelierV7({ answer: "Hi" })).toThrow();
    expect(() =>
      parseSommelierV7({ answer: "Hi", bottle_refs: [], buy: [{ wine: "Barolo" }] }),
    ).toThrow();
  });
});

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import nl from "../../messages/nl.json";
import { KNOWN_KEYS, knownMessage } from "./known-messages";

/** Every .ts file under a folder, tests left out. */
function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [full] : [];
  });
}

const root = path.resolve(import.meta.dirname, "../../../..");
/** Checks on what the app itself sends (analytics events, push endpoints): a person never sees these. */
const INTERNAL = new Set([
  "Property names are snake_case.",
  "Properties must not contain personal data.",
  "At most 10 properties.",
  "Must be https.",
]);

const text = (dir: string) =>
  sources(path.join(root, dir)).map((file) => fs.readFileSync(file, "utf8"));

describe("known messages", () => {
  it("has a translation for every key, in both languages", () => {
    for (const key of KNOWN_KEYS) {
      expect(en.errors.known, key).toHaveProperty(key);
      expect(nl.errors.known, key).toHaveProperty(key);
    }
    expect(Object.keys(en.errors.known).sort()).toEqual([...KNOWN_KEYS].sort());
  });

  it("knows every sentence the server can send", () => {
    const found = text("apps/web/src/server").flatMap((code) => [
      ...[...code.matchAll(/DomainError\(\s*"[A-Z_]+",\s*"([^"]+)"/g)].map((m) => m[1]!),
      // The bottle actions pass their conflict sentence through a helper.
      ...[...code.matchAll(/result\(\s*[^,()]+(?:\([^)]*\))?,\s*"([^"]+)"/g)].map((m) => m[1]!),
      ...[...code.matchAll(/const NOT_READY =\s*"([^"]+)"/g)].map((m) => m[1]!),
    ]);
    expect(found.length).toBeGreaterThan(40);
    expect(found.filter((sentence) => knownMessage(sentence) === null)).toEqual([]);
  });

  it("knows every sentence of the shared checks", () => {
    const found = text("packages/domain/src")
      .filter((code) => !code.includes("export const ERROR_MESSAGES"))
      .flatMap((code) =>
        [...code.matchAll(/(?:,\s*|message:\s*)"([A-Z][^"]{6,}[.?])"/g)].map((m) => m[1]!),
      );
    expect(found.length).toBeGreaterThan(15);
    expect(
      found.filter((sentence) => !INTERNAL.has(sentence) && knownMessage(sentence) === null),
    ).toEqual([]);
  });

  it("recognises sentences with a changing part", () => {
    expect(
      knownMessage(
        "You are the only owner of Thuis, which still has other people in it. Remove them or delete the household first.",
      ),
    ).toBe("onlyOwnerOf");
    expect(
      knownMessage("That is more than we can bring in at once (900 bottles, the limit is 500)."),
    ).toBe("importTooBig");
    expect(knownMessage("Looking up prices isn't switched on yet.")).toBe("notSwitchedOn");
    expect(knownMessage("Something nobody wrote down.")).toBeNull();
    expect(knownMessage(null)).toBeNull();
  });
});

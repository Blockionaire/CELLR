import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * @cellr/domain has two doors. "." is what screens and servers share: contracts, small pure rules. "./intelligence"
 * is the engines with their knowledge (hundreds of dishes, appellations, grapes), for servers only. This test
 * walks the imports from the first door and proves it never reaches the knowledge, so a screen cannot ship it to
 * a browser by importing something innocent. (The lint rule in eslint.config.mjs forbids the second door to client code; architecture.test.ts proves that rule.)
 */
const src = path.resolve(import.meta.dirname, "../../../../packages/domain/src");

function reachable(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [path.join(src, entry)];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const code = fs.readFileSync(file, "utf8");
    for (const match of code.matchAll(/(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g)) {
      const target = path.resolve(path.dirname(file), match[1]!);
      const resolved = [`${target}.ts`, path.join(target, "index.ts")].find((f) =>
        fs.existsSync(f),
      );
      if (resolved) queue.push(resolved);
    }
  }
  return seen;
}
const relative = (files: Iterable<string>) => [...files].map((f) => path.relative(src, f));

describe("the package's two entries", () => {
  it("the shared entry never reaches the engines' knowledge", () => {
    const files = relative(reachable("index.ts"));
    expect(files.length).toBeGreaterThan(40);
    expect(files.filter((f) => f.split(path.sep).includes("knowledge"))).toEqual([]);
  });
  it("the server entry does", () => {
    const files = relative(reachable("intelligence.ts"));
    expect(files).toContain(path.join("food", "knowledge", "index.ts"));
    expect(files).toContain(path.join("pairing-engine", "knowledge", "index.ts"));
  });
});

// The architecture scripts import the TypeScript inventory builder directly, which needs Node's built-in type
// stripping (on by default from Node 22.18). The minimum is read from the root package.json `engines.node`, so the
// scripts and the documented requirement cannot drift apart.
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../../../..");

/** `[major, minor]` of a ">=X.Y" engines range; throws on any other shape. */
export function minimumOf(range) {
  const m = /^>=\s*(\d+)\.(\d+)(?:\.\d+)?$/.exec(String(range).trim());
  if (!m) throw new Error(`engines.node must be ">=MAJOR.MINOR", got ${JSON.stringify(range)}`);
  return [Number(m[1]), Number(m[2])];
}

export function satisfies(version, [major, minor]) {
  const [a, b] = version.replace(/^v/, "").split(".").map(Number);
  return a > major || (a === major && b >= minor);
}

export function assertNodeVersion(script) {
  const range = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).engines?.node;
  const min = minimumOf(range);
  if (!satisfies(process.version, min)) {
    console.error(
      `${script} needs Node ${range} (package.json engines; type stripping); this is ${process.version}`,
    );
    process.exit(2);
  }
}

/**
 * WHETHER TWO RUNS GAVE THE SAME PER-SCENARIO VECTORS (P8): for proving that an engine answers exactly as before on
 * another commit (V1 unchanged). Reads two vector files `run.ts --vectors` wrote, of the same set, engine and salt,
 * and counts the scenarios whose vector is identical, different, or in one file only. Names no scenario (a blind
 * set's keys are salted hashes and are not printed either).
 *
 *   pnpm --filter @cellr/sommelier-eval run vectors-same --a <file> --b <file>      exit 0 when identical, 1 when not
 */
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import type { VectorFile } from "./vectors";

export function sameVectors(a: VectorFile, b: VectorFile) {
  if (a.set !== b.set || a.engine !== b.engine || a.keyed !== b.keyed || a.salt !== b.salt)
    return { comparable: false as const, why: "different set, engine or salt" };
  const keys = new Set([...Object.keys(a.rows), ...Object.keys(b.rows)]);
  let identical = 0;
  let different = 0;
  let onlyOne = 0;
  for (const k of keys) {
    const x = a.rows[k];
    const y = b.rows[k];
    if (!x || !y) onlyOne += 1;
    else if (JSON.stringify(x) === JSON.stringify(y)) identical += 1;
    else different += 1;
  }
  return {
    comparable: true as const,
    set: a.set,
    engine: a.engine,
    scenarios: keys.size,
    identical,
    different,
    onlyOne,
    incomplete: a.incomplete || b.incomplete,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values: args } = parseArgs({ options: { a: { type: "string" }, b: { type: "string" } } });
  if (!args.a || !args.b) {
    console.error("need --a and --b");
    process.exit(2);
  }
  const [a, b] = await Promise.all(
    [args.a, args.b].map(async (p) => JSON.parse(await readFile(p, "utf8")) as VectorFile),
  );
  const result = sameVectors(a!, b!);
  console.log(JSON.stringify(result));
  process.exit(result.comparable && result.different === 0 && result.onlyOne === 0 ? 0 : 1);
}

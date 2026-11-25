/**
 * Per-scenario outcome vectors for paired comparisons across runs and engines (stats.ts, compare.ts).
 *
 * A readable set is keyed by scenario id. A blind set is keyed by a salted hash of the id, so the vectors can be
 * paired across runs (the same salt gives the same keys) without the file naming a scenario: the salt comes from
 * SOMMELIER_EVAL_BLIND_SALT (never committed), the file must lie outside the repository, and it holds only 0/1
 * outcomes and counts, never a dish, a wine or an answer.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { dirname, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { QualityRow } from "./quality";
import type { ScenarioResult } from "./score";
import { holdsBlind } from "./sets";
import type { ScenarioVector } from "./stats";

export interface VectorFile {
  set: string;
  engine: string;
  keyed: "id" | "salted-sha256";
  /** For a blind set: the first characters of the salt's own hash, so files made with different salts are not paired. */
  salt: string | null;
  incomplete: boolean;
  rows: Record<string, ScenarioVector>;
}

const REPO = resolve(fileURLToPath(new URL("../..", import.meta.url)));

export function vectorOf(
  row: QualityRow,
  result: ScenarioResult,
  cluster?: string,
): ScenarioVector {
  const first = result.checks.find((c) => c.name === "first");
  return {
    ...(cluster === undefined ? {} : { cluster }),
    first: first === undefined || first.pass ? 1 : 0,
    noPoor: row.labels.includes("poor") ? 0 : 1,
    useful: row.useful ? 1 : 0,
    offered: row.labels.length,
    poor: row.labels.filter((l) => l === "poor").length,
    good: row.labels.filter((l) => l === "good").length,
  };
}

export function vectorKeyer(
  set: string,
  path: string,
  env: Record<string, string | undefined>,
): {
  keyed: VectorFile["keyed"];
  fingerprint: string | null;
  key: (id: string) => string;
  /** Right before writing: the destination is still outside every Git checkout (blind sets only). */
  check: () => void;
} {
  if (!holdsBlind(set)) return { keyed: "id", fingerprint: null, key: (id) => id, check: () => {} };
  const salt = env.SOMMELIER_EVAL_BLIND_SALT ?? "";
  // A random salt (`openssl rand -hex 16`): a guessable one lets the keys be recomputed from the scenario ids.
  if (salt.length < 16 || new Set(salt).size < 10)
    throw new Error(
      `"${set}" holds blind scenarios: set SOMMELIER_EVAL_BLIND_SALT to a random value (openssl rand -hex 16, never committed) to write vectors for it.`,
    );
  const check = () => outsideEveryCheckout(path);
  check();
  return {
    keyed: "salted-sha256",
    fingerprint: createHash("sha256").update(salt).digest("hex").slice(0, 8),
    key: (id) => createHash("sha256").update(`${salt}\u0000${id}`).digest("hex").slice(0, 16),
    check,
  };
}

/**
 * Refuses a destination inside this repository or any other Git checkout (a second worktree or clone of it), by
 * real path, so a symbolic link cannot lead into one; and refuses a destination that is itself a symbolic link.
 */
function outsideEveryCheckout(path: string): void {
  const target = resolve(path);
  const refuse = (): never => {
    throw new Error(
      `The vectors of a blind set are written outside every Git checkout, not to ${path}.`,
    );
  };
  if (!existsSync(dirname(target))) refuse();
  const dir = realpathSync(dirname(target));
  if (existsSync(target) && lstatSync(target).isSymbolicLink()) refuse();
  const rel = relative(realpathSync(REPO), dir);
  if (rel === "" || (!rel.startsWith(`..${sep}`) && rel !== "..")) refuse();
  let inCheckout = true;
  try {
    execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { stdio: "ignore" });
  } catch {
    inCheckout = false;
  }
  if (inCheckout) refuse();
}

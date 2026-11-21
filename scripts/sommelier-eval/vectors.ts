/**
 * Per-scenario outcome vectors for paired comparisons across runs and engines (stats.ts, compare.ts).
 *
 * A readable set is keyed by scenario id. A blind set is keyed by a salted hash of the id, so the vectors can be
 * paired across runs (the same salt gives the same keys) without the file naming a scenario: the salt comes from
 * SOMMELIER_EVAL_BLIND_SALT (never committed), the file must lie outside the repository, and it holds only 0/1
 * outcomes and counts, never a dish, a wine or an answer.
 */
import { createHash } from "node:crypto";
import { resolve, relative, sep } from "node:path";
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

export function vectorOf(row: QualityRow, result: ScenarioResult): ScenarioVector {
  const first = result.checks.find((c) => c.name === "first");
  return {
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
): { keyed: VectorFile["keyed"]; fingerprint: string | null; key: (id: string) => string } {
  if (!holdsBlind(set)) return { keyed: "id", fingerprint: null, key: (id) => id };
  const salt = env.SOMMELIER_EVAL_BLIND_SALT ?? "";
  if (salt.length < 16)
    throw new Error(
      `"${set}" holds blind scenarios: set SOMMELIER_EVAL_BLIND_SALT (16 characters or more, never committed) to write vectors for it.`,
    );
  const rel = relative(REPO, resolve(path));
  if (!rel.startsWith(`..${sep}`) && rel !== "..")
    throw new Error(
      `The vectors of a blind set are written outside the repository, not to ${path}.`,
    );
  return {
    keyed: "salted-sha256",
    fingerprint: createHash("sha256").update(salt).digest("hex").slice(0, 8),
    key: (id) => createHash("sha256").update(`${salt}\u0000${id}`).digest("hex").slice(0, 16),
  };
}

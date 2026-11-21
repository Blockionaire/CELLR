import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { DishCard, FoodTruth, Scenario } from "./types";
import { WINE_KEYS } from "./wines";

/**
 * THE HUMAN HOLDOUT (S10, not yet written; held in escrow since S11). At least 100 dishes written by people, in
 * Dutch and English, that nobody has used to develop the engines: the honest test of "unseen dishes". Until it is
 * written this set is empty and every report says so. When it arrives it is blind (sets.ts): measured in totals
 * only, never read scenario by scenario, never tuned on.
 *
 * In ESCROW (S11): the file is never in this repository, where whoever develops the engines could read it. It is
 * kept by the owner, outside the checkout, and read only from the path in SOMMELIER_EVAL_HUMAN_FILE. What is
 * committed is its seal, `human-holdout/SEAL.json` (the file's sha256 and number of dishes, made with `seal`
 * below): a file that does not match the seal is refused, so it cannot change unseen after the first measurement.
 * The format and the rules for writing it are in `human-holdout/README.md`.
 */
/** Where the file must NOT be: a copy here is refused (and ignored by Git). */
export const HUMAN_HOLDOUT_FILE = new URL("./human-holdout/dishes.json", import.meta.url);
export const HUMAN_HOLDOUT_SEAL = new URL("./human-holdout/SEAL.json", import.meta.url);
export const HUMAN_HOLDOUT_ENV = "SOMMELIER_EVAL_HUMAN_FILE";
export const HUMAN_HOLDOUT_MIN_DISHES = 100;

export interface HumanHoldoutSeal {
  sha256: string;
  dishes: number;
  /** The day it was sealed (YYYY-MM-DD). */
  sealedOn: string;
}

const REPO = resolve(fileURLToPath(new URL("../..", import.meta.url)));

/** The seal of a written file: what the owner commits as `human-holdout/SEAL.json`. */
export function sealOf(text: string, today: Date = new Date()): HumanHoldoutSeal {
  return {
    sha256: createHash("sha256").update(text).digest("hex"),
    dishes: checkHumanDishes(JSON.parse(text)).length,
    sealedOn: today.toISOString().slice(0, 10),
  };
}

/**
 * The escrowed file's text, checked against the seal; null when no path is given. Refuses a copy inside the
 * repository, a path inside it, a missing seal, and a file that does not match the seal.
 */
export function readEscrowed(
  env: Record<string, string | undefined>,
  seal: HumanHoldoutSeal | null,
  inRepository: boolean = existsSync(HUMAN_HOLDOUT_FILE),
): string | null {
  if (inRepository)
    throw new Error(
      "human holdout: a copy is inside the repository (human-holdout/dishes.json). Move it out: it is kept in escrow.",
    );
  const path = env[HUMAN_HOLDOUT_ENV];
  if (!path) return null;
  const real = realpathSync(resolve(path));
  const rel = relative(realpathSync(REPO), real);
  if (rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".."))
    throw new Error("human holdout: the escrowed file must be outside the repository");
  if (!seal) throw new Error("human holdout: no human-holdout/SEAL.json; seal the file first");
  const text = readFileSync(real, "utf8");
  if (createHash("sha256").update(text).digest("hex") !== seal.sha256)
    throw new Error(
      "human holdout: the file does not match its seal (it changed, or it is another file)",
    );
  return text;
}

const MAINS: ReadonlySet<string> = new Set([
  "red-meat",
  "game",
  "pork",
  "poultry",
  "white-fish",
  "oily-fish",
  "shellfish",
  "vegetable",
  "mushroom",
  "pasta-grain",
  "egg",
  "cheese",
  "dessert",
  "snack",
  "pulse",
]);

export interface HumanDish {
  id: string;
  en: string;
  nl: string;
  /** How a person would ask about it, in each language. */
  question_en: string;
  question_nl: string;
  truth: FoodTruth;
  /** Filled by the wine expert; until then the set measures dish understanding only. */
  good?: string[];
  ok?: string[];
  why?: string;
  /** Who wrote the dish (initials or a role), for the record. Never a full name without consent. */
  by: string;
}

/** Checks a written file; throws with every problem found. */
export function checkHumanDishes(value: unknown): HumanDish[] {
  const problems: string[] = [];
  if (!Array.isArray(value)) throw new Error("human holdout: the file must hold a list of dishes");
  const ids = new Set<string>();
  const out = value as HumanDish[];
  out.forEach((d, i) => {
    const at = `dish ${i + 1} (${d?.id ?? "no id"})`;
    if (!/^hh-[a-z0-9-]{2,60}$/.test(d?.id ?? ""))
      problems.push(`${at}: id must look like "hh-kale-stamppot"`);
    if (ids.has(d.id)) problems.push(`${at}: id used twice`);
    ids.add(d.id);
    for (const k of ["en", "nl", "question_en", "question_nl", "by"] as const)
      if (typeof d[k] !== "string" || d[k].trim().length < 2)
        problems.push(`${at}: "${k}" is missing`);
    const t = d.truth;
    if (!t || !MAINS.has(t.main))
      problems.push(`${at}: truth.main is not one of the engine's classes`);
    else {
      if (!(t.weight >= 1 && t.weight <= 5)) problems.push(`${at}: truth.weight must be 1–5`);
      for (const k of ["fat", "acid", "sweet", "heat", "umami"] as const)
        if (!(t[k] >= 0 && t[k] <= 3)) problems.push(`${at}: truth.${k} must be 0–3`);
    }
    for (const k of ["good", "ok"] as const)
      for (const w of d[k] ?? [])
        if (!WINE_KEYS.has(w)) problems.push(`${at}: "${w}" in ${k} is not a benchmark wine`);
  });
  if (problems.length > 0) throw new Error(`human holdout:\n- ${problems.join("\n- ")}`);
  return out;
}

/** The human holdout as dish cards and scenarios: two scenarios per dish, one in each language. */
export function humanHoldout(env: Record<string, string | undefined> = process.env): {
  dishes: DishCard[];
  scenarios: Scenario[];
} {
  const seal = existsSync(HUMAN_HOLDOUT_SEAL)
    ? (JSON.parse(readFileSync(HUMAN_HOLDOUT_SEAL, "utf8")) as HumanHoldoutSeal)
    : null;
  const text = readEscrowed(env, seal);
  if (text === null) return { dishes: [], scenarios: [] };
  const dishes = checkHumanDishes(JSON.parse(text));
  const labelled = (d: HumanDish) => (d.good?.length ?? 0) + (d.ok?.length ?? 0) > 0;
  return {
    dishes: dishes.map((d) => ({
      id: d.id,
      en: d.en,
      nl: d.nl,
      legacy: [],
      truth: d.truth,
      good: d.good ?? [],
      ok: d.ok ?? [],
      why: d.why ?? "",
    })),
    scenarios: dishes.flatMap((d) =>
      (["en", "nl"] as const).map((lang): Scenario => ({
        id: `${d.id}-${lang}`,
        category: "pairing-hard",
        lang,
        cellar: "all",
        turns: [{ user: lang === "en" ? d.question_en : d.question_nl }],
        dish: d.id,
        needs: ["pairing"],
        // Without the expert's labels only the dish is checked.
        expect: labelled(d) ? { verdict: "auto" } : {},
      })),
    ),
  };
}

// `pnpm --filter @cellr/sommelier-eval run seal-human-holdout /path/outside/the/repo/dishes.json`: prints the seal
// to commit. It reads the file to hash and check its shape; it prints no dish.
if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: seal-human-holdout <path to the escrowed dishes.json>");
    process.exit(2);
  }
  console.log(JSON.stringify(sealOf(readFileSync(path, "utf8")), null, 2));
}

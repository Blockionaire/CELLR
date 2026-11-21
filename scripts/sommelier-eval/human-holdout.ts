import { existsSync, readFileSync } from "node:fs";
import type { DishCard, FoodTruth, Scenario } from "./types";
import { WINE_KEYS } from "./wines";

/**
 * THE HUMAN HOLDOUT (S10, not yet written). At least 100 dishes written by people, in Dutch and English, that
 * nobody has used to develop the engines: the honest test of "unseen dishes". The file
 * `human-holdout/dishes.json` does not exist yet; until it does, this set is empty and every report says so.
 * When it arrives it is blind (sets.ts): measured in totals only, never read scenario by scenario, never tuned
 * on. The format and the rules for writing it are in `human-holdout/README.md`.
 */
export const HUMAN_HOLDOUT_FILE = new URL("./human-holdout/dishes.json", import.meta.url);
export const HUMAN_HOLDOUT_MIN_DISHES = 100;

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
export function humanHoldout(): { dishes: DishCard[]; scenarios: Scenario[] } {
  if (!existsSync(HUMAN_HOLDOUT_FILE)) return { dishes: [], scenarios: [] };
  const dishes = checkHumanDishes(JSON.parse(readFileSync(HUMAN_HOLDOUT_FILE, "utf8")));
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

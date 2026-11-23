/**
 * FROM THE FILLED HOLDOUT FORM TO THE ESCROWED FILE (P8). The wine-knowledgeable person fills
 * docs/sprints/sommelier-3-mega/review/holdout-template.csv in a spreadsheet, on their own computer, OUTSIDE this
 * repository. The owner then turns it into the human holdout's file (human-holdout.ts, `HumanDish` list) and seals it:
 *
 *   pnpm --filter @cellr/sommelier-eval run holdout-from-csv /private/path/holdout-filled.csv /private/path/dishes.json
 *   pnpm --filter @cellr/sommelier-eval run seal-human-holdout /private/path/dishes.json    # prints SEAL.json to commit
 *
 * Both paths must be outside the repository. It prints only how many dishes it wrote and any problem by row number,
 * never a dish, so whoever runs it (an agent included) learns nothing of the scenarios. Rows left empty are skipped.
 */
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { checkHumanDishes, type HumanDish } from "./human-holdout";
import { HOLDOUT_HEADER } from "./review-forms";
import { sheetRows } from "./review-sheet";
import { WINE_KEYS } from "./wines";

const REPO = resolve(fileURLToPath(new URL("../..", import.meta.url)));

export function outsideRepository(path: string): boolean {
  const dir = realpathSync(dirname(resolve(path)));
  const rel = relative(realpathSync(REPO), dir);
  return rel.startsWith(`..${sep}`) || rel === "..";
}

const num = (v: string) => (v.trim() === "" ? NaN : Number(v.trim()));
const keys = (v: string) =>
  v
    .split(/[\s,;]+/)
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);

/** The filled form's rows as dishes; throws with every problem, by row number only. */
export function dishesFromForm(text: string): HumanDish[] {
  const [
    id,
    en,
    nl,
    qen,
    qnl,
    main,
    weight,
    fat,
    acid,
    sweet,
    heat,
    umami,
    right,
    ok,
    none,
    why,
    by,
  ] = HOLDOUT_HEADER;
  // The template's header starts with "id", not "row": find it by its first column.
  const all = sheetRowsBy(text, id!);
  const problems: string[] = [];
  const dishes: HumanDish[] = [];
  all.forEach((r, n) => {
    const filled = HOLDOUT_HEADER.slice(1).some((h) => (r[h] ?? "").trim() !== "");
    if (!filled) return;
    const at = `row ${n + 1}`;
    const good = keys(r[right!] ?? "");
    const okay = keys(r[ok!] ?? "");
    for (const k of [...good, ...okay])
      if (!WINE_KEYS.has(k)) problems.push(`${at}: "${k}" is not a key of holdout-wines.csv`);
    const both = good.filter((k) => okay.includes(k));
    if (both.length > 0) problems.push(`${at}: a wine is both right and acceptable`);
    const nothing = (r[none!] ?? "").trim().toLowerCase() === "yes";
    if (nothing !== (good.length === 0 && okay.length === 0))
      problems.push(
        `${at}: "nothing suits" must be yes exactly when no wine is right or acceptable`,
      );
    dishes.push({
      id: (r[id!] ?? "").trim(),
      en: (r[en!] ?? "").trim(),
      nl: (r[nl!] ?? "").trim(),
      question_en: (r[qen!] ?? "").trim(),
      question_nl: (r[qnl!] ?? "").trim(),
      truth: {
        main: (r[main!] ?? "").trim() as HumanDish["truth"]["main"],
        weight: num(r[weight!] ?? "") as HumanDish["truth"]["weight"],
        fat: num(r[fat!] ?? "") as 0,
        acid: num(r[acid!] ?? "") as 0,
        sweet: num(r[sweet!] ?? "") as 0,
        heat: num(r[heat!] ?? "") as 0,
        umami: num(r[umami!] ?? "") as 0,
      },
      good,
      ok: okay,
      why: (r[why!] ?? "").trim(),
      by: (r[by!] ?? "").trim(),
    });
  });
  if (problems.length > 0) throw new Error(`holdout form:\n- ${problems.join("\n- ")}`);
  // The holdout's own check (ids, languages, the food truth, the wine keys); its messages name ids, not dishes.
  return checkHumanDishes(dishes);
}

/** Rows under the header whose first column is `first`. */
function sheetRowsBy(text: string, first: string): Array<Record<string, string>> {
  const replaced = text.replace(/^\uFEFF/, "").replace(new RegExp(`(^|\\n)${first},`), "$1row,");
  return sheetRows(replaced).map((r) => {
    const { row, ...rest } = r;
    return { [first]: row ?? "", ...rest };
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [from, to] = process.argv.slice(2);
  if (!from || !to) {
    console.error(
      "usage: holdout-from-csv <filled form .csv> <dishes.json to write>, both outside the repository",
    );
    process.exit(2);
  }
  if (!outsideRepository(from) || !outsideRepository(to)) {
    console.error("Both files must be outside the repository: the holdout is kept in escrow.");
    process.exit(2);
  }
  try {
    const dishes = dishesFromForm(readFileSync(from, "utf8"));
    writeFileSync(to, JSON.stringify(dishes, null, 2) + "\n");
    console.log(`Wrote ${dishes.length} dishes. Seal it next: seal-human-holdout ${to}`);
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}

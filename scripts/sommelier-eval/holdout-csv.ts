/**
 * FROM THE FILLED HOLDOUT FORMS TO THE ESCROWED FILES (P8), in two series (human-holdout-series.ts): the people
 * writing it fill docs/sprints/sommelier-3-mega/review/holdout-template-series1.csv (40 dishes) and, later and without
 * having seen any result on series 1, holdout-template-series2.csv (60), in a spreadsheet, on their own computer,
 * OUTSIDE this repository. The owner turns each into the holdout's format (`HumanDish` list) and seals it:
 *
 *   pnpm --filter @cellr/sommelier-eval run holdout-from-csv 1 /private/series1-filled.csv /private/series1.json
 *   pnpm --filter @cellr/sommelier-eval run seal-human-holdout /private/series1.json   # → human-holdout/SEAL-series1.json
 *   ... and when series 2 exists:
 *   pnpm --filter @cellr/sommelier-eval run holdout-from-csv 2 /private/series2-filled.csv /private/series2.json
 *   pnpm --filter @cellr/sommelier-eval run holdout-from-csv merge /private/series1.json /private/series2.json /private/dishes.json
 *   pnpm --filter @cellr/sommelier-eval run seal-human-holdout /private/dishes.json    # → human-holdout/SEAL.json (100)
 *
 * Both paths must be outside the repository. It prints only how many dishes it wrote and any problem by row number,
 * never a dish, so whoever runs it (an agent included) learns nothing of the scenarios. Rows left empty are skipped.
 */
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { checkHumanDishes, type HumanDish } from "./human-holdout";
import { checkSeries, mergeSeries, type Series } from "./human-holdout-series";
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

/** A filled series form as that series' file: the form's checks, then the series' ids and exact size. */
export const seriesFromForm = (text: string, series: Series) =>
  checkSeries(dishesFromForm(text), series);

if (import.meta.url === `file://${process.argv[1]}`) {
  const [what, ...paths] = process.argv.slice(2);
  const usage =
    "usage: holdout-from-csv <1|2> <filled form .csv> <series .json to write>, or holdout-from-csv merge <series1.json> <series2.json> <dishes.json to write>; every path outside the repository";
  const merging = what === "merge";
  if ((!merging && what !== "1" && what !== "2") || paths.length !== (merging ? 3 : 2)) {
    console.error(usage);
    process.exit(2);
  }
  if (!paths.every((p) => outsideRepository(p))) {
    console.error("Every file must be outside the repository: the holdout is kept in escrow.");
    process.exit(2);
  }
  try {
    const to = paths.at(-1)!;
    const dishes = merging
      ? mergeSeries(
          JSON.parse(readFileSync(paths[0]!, "utf8")),
          JSON.parse(readFileSync(paths[1]!, "utf8")),
        )
      : seriesFromForm(readFileSync(paths[0]!, "utf8"), Number(what) as Series);
    writeFileSync(to, JSON.stringify(dishes, null, 2) + "\n");
    console.log(`Wrote ${dishes.length} dishes. Seal it next: seal-human-holdout ${to}`);
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}

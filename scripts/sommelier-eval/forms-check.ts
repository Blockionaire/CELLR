/**
 * HOW THE FILLED HUMAN FORMS COME BACK IN (P8 runbook, step 4). The filled forms stay OUTSIDE the repository (they
 * hold a reviewer's name and free text). This reads a folder of them and writes only an aggregated summary that may be
 * committed: per form, whether the "filled in by" and "date" lines are filled, how many verdict cells are filled
 * and empty, and the counts of each closed answer (yes / no / partly, agree / disagree / unsure, 1–5, …). Free-text
 * answers are counted, never copied. A form is complete only when every verdict cell is filled.
 *
 *   pnpm --filter @cellr/sommelier-eval run forms-check --dir /private/filled-forms [--out <summary.json>] \
 *     [--signed-role "wine professional" --signed-date 2026-12-10 --verdict approved|approved-with-changes|not-approved]
 *
 * The sign-off is recorded only from the signed cover sheet (review/wine-professional-cover.md), by the owner, with
 * the three --signed-* flags: role, date and verdict; never a name in the repository.
 */
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { VERDICT } from "./review-forms";
import { parseCsv } from "./review-sheet";

const REPO = resolve(fileURLToPath(new URL("../..", import.meta.url)));

/** The forms people fill, by the start of their file name (a user session's copies: ux-tasks-P1.csv, …). */
export const FORMS = [
  "annotation-review",
  "knowledge-serving",
  "knowledge-windows",
  "knowledge-pairings",
  "knowledge-fallback",
  "ux-tasks",
  "ux-closing",
] as const;

/** Answers that are counted by value; any other answer is free text and only counted as filled. */
const CLOSED = /^(yes|no|partly|with help|agree|disagree|unsure|right|wrong|[1-5])$/i;

export interface FormSummary {
  file: string;
  form: string;
  filledInBy: boolean;
  dated: boolean;
  rows: number;
  verdictCells: number;
  filled: number;
  empty: number;
  complete: boolean;
  /** Per verdict column: counts of each closed answer, and how many free-text answers. */
  answers: Record<string, Record<string, number>>;
}

export function summarizeForm(file: string, text: string): FormSummary | null {
  const form = FORMS.find((f) => file.startsWith(f));
  if (!form) return null;
  const rows = parseCsv(text);
  const cell = (label: string) => rows.find((r) => r[0] === label)?.[1]?.trim() ?? "";
  const at = rows.findIndex((r) => r.some((c) => c.startsWith(VERDICT)));
  const header = at >= 0 ? rows[at]! : [];
  const columns = header.flatMap((h, i) => (h.startsWith(VERDICT) ? [i] : []));
  const body = rows.slice(at + 1).filter((r) => r.some((c) => c.trim() !== ""));
  const answers: FormSummary["answers"] = {};
  let filled = 0;
  for (const i of columns) {
    const name = header[i]!.slice(VERDICT.length);
    const counts: Record<string, number> = {};
    for (const r of body) {
      const v = (r[i] ?? "").trim();
      if (v === "") continue;
      filled += 1;
      const key = CLOSED.test(v) ? v.toLowerCase() : "(free text)";
      counts[key] = (counts[key] ?? 0) + 1;
    }
    answers[name] = counts;
  }
  const verdictCells = columns.length * body.length;
  return {
    file,
    form,
    filledInBy: cell("Filled in by (name, role):") !== "",
    dated: cell("Date:") !== "",
    rows: body.length,
    verdictCells,
    filled,
    empty: verdictCells - filled,
    complete:
      verdictCells > 0 &&
      filled === verdictCells &&
      cell("Filled in by (name, role):") !== "" &&
      cell("Date:") !== "",
    answers,
  };
}

export const outsideRepository = (dir: string) => {
  const rel = relative(realpathSync(REPO), realpathSync(resolve(dir)));
  return rel.startsWith(`..${sep}`) || rel === "..";
};

export function checkForms(dir: string) {
  if (!outsideRepository(dir))
    throw new Error("The filled forms stay outside the repository: pass a folder outside it.");
  const forms = readdirSync(dir)
    .filter((f) => f.endsWith(".csv"))
    .sort()
    .flatMap((f) => summarizeForm(f, readFileSync(join(dir, f), "utf8")) ?? []);
  const missing = FORMS.filter((f) => !forms.some((s) => s.form === f));
  return { forms, missing, complete: missing.length === 0 && forms.every((f) => f.complete) };
}

export const VERDICTS = ["approved", "approved-with-changes", "not-approved"] as const;

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values: args } = parseArgs({
    options: {
      dir: { type: "string" },
      out: { type: "string" },
      "signed-role": { type: "string" },
      "signed-date": { type: "string" },
      verdict: { type: "string" },
    },
  });
  if (!args.dir) {
    console.error("usage: forms-check --dir <folder of filled forms, outside the repository>");
    process.exit(2);
  }
  const result = checkForms(args.dir);
  const signed =
    args["signed-role"] && args["signed-date"] && args.verdict
      ? VERDICTS.includes(args.verdict as (typeof VERDICTS)[number])
        ? { role: args["signed-role"], date: args["signed-date"], verdict: args.verdict }
        : null
      : null;
  if (args.verdict && !signed) {
    console.error(
      `--verdict must be one of: ${VERDICTS.join(", ")}, with --signed-role and --signed-date`,
    );
    process.exit(2);
  }
  const summary = { ...result, signedOff: signed };
  console.log(JSON.stringify(summary, null, 2));
  if (args.out) await writeFile(args.out, JSON.stringify(summary, null, 2) + "\n");
  if (!result.complete) process.exitCode = 1;
}

/**
 * THE CHECK'S REVIEW SHEETS (P8 paid plan). The check's false positives cannot be measured without a person: a paid
 * run writes every sentence the check removed or replaced, with its context, and a seeded random sample of 100 kept
 * sentences (for claims it missed), as CSV files that open in Excel or Google Sheets. Every verdict column is EMPTY:
 * nothing here is a judgement, and no column is filled by an AI. The code a sentence was flagged with is the
 * check's own heuristic, and its header says so.
 *
 * Only for readable sets: a blind set (holdout-test, human) is never written sentence by sentence (run.ts refuses).
 * The eval cellar and its questions are synthetic, so the sheets hold no person's data.
 */
import type { CheckCode } from "@cellr/domain";
import { rng } from "./bench-cellar";

export interface SheetAnswer {
  run: string;
  set: string;
  scenario: string;
  turn: number;
  question: string;
  /** The wines on the answer's cards, by name. */
  cards: string[];
  removed: Array<{
    sentence: string;
    outcome: "removed" | "replaced";
    codes: CheckCode[];
    wines: string[];
  }>;
  /** Sentences shown as the model wrote them (refs written as names). */
  kept: Array<{ sentence: string; wines: string[] }>;
}

export const PREAMBLE = [
  ["Filled in by (name, role):", ""],
  ["Date:", ""],
  [
    "Nothing on this sheet counts as reviewed until the person named above has signed it. Every verdict column starts empty; no verdict was written by an AI or by code.",
  ],
  [],
];

export const REMOVED_HEADER = [
  "row",
  "run",
  "set",
  "scenario",
  "turn",
  "question",
  "cards (wines the answer showed)",
  "cellar wines named in the sentence",
  "sentence (the model's words; refs written as wine names)",
  "what the check did (removed / replaced)",
  "code the check flagged (heuristic, set by code - not a judgement)",
  "HUMAN VERDICT: correctly removed / wrongly removed / unsure",
  "reviewer note",
];

export const KEPT_HEADER = [
  "row",
  "run",
  "set",
  "scenario",
  "turn",
  "question",
  "cards (wines the answer showed)",
  "cellar wines named in the sentence",
  "sentence shown (the model's words; refs written as wine names)",
  "HUMAN VERDICT: holds a claim that should have been removed? yes / no / unsure",
  "reviewer note",
];

const cell = (v: string | number) => {
  const s = String(v);
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** CSV as Excel and Google Sheets open it: UTF-8 with a byte-order mark (for °C and accents), CRLF lines. */
export const csv = (rows: ReadonlyArray<ReadonlyArray<string | number>>) =>
  "\uFEFF" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";

/** Every removed or replaced sentence of the run(s), in run order. */
export function removedSheet(answers: readonly SheetAnswer[]): string {
  let n = 0;
  const rows = answers.flatMap((a) =>
    a.removed.map((r) => [
      ++n,
      a.run,
      a.set,
      a.scenario,
      a.turn,
      a.question,
      a.cards.join("; "),
      r.wines.join("; "),
      r.sentence,
      r.outcome,
      r.codes.join(" ") || "(none on the sentence alone)",
      "",
      "",
    ]),
  );
  return csv([...PREAMBLE, REMOVED_HEADER, ...rows]);
}

/** A seeded random sample of kept sentences (100 by default), for the claims the check missed. */
export function keptSample(answers: readonly SheetAnswer[], size = 100, seed = 0x5eed8): string {
  const all = answers.flatMap((a) => a.kept.map((k) => ({ a, k })));
  const pick = rng(seed);
  // A partial Fisher-Yates shuffle: the same sentences for the same run, whatever the machine.
  const order = all.map((_, i) => i);
  for (let i = 0; i < Math.min(size, order.length); i++) {
    const j = i + Math.floor(pick() * (order.length - i));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const rows = order.slice(0, size).map((i, n) => {
    const { a, k } = all[i]!;
    return [
      n + 1,
      a.run,
      a.set,
      a.scenario,
      a.turn,
      a.question,
      a.cards.join("; "),
      k.wines.join("; "),
      k.sentence,
      "",
      "",
    ];
  });
  return csv([...PREAMBLE, KEPT_HEADER, ...rows]);
}

/** Reads a sheet back: the rows under its header (for tests and for counting verdicts). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = text.startsWith("\uFEFF") ? 1 : 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length > 0) rows.push([...row, field]);
  return rows;
}

/** The rows of a sheet under the header that starts with `row`, as objects by header name. */
export function sheetRows(text: string): Array<Record<string, string>> {
  const rows = parseCsv(text);
  const at = rows.findIndex((r) => r[0] === "row");
  if (at < 0) return [];
  const header = rows[at]!;
  return rows
    .slice(at + 1)
    .filter((r) => r.some((c) => c !== ""))
    .map((r) => Object.fromEntries(header.map((h, k) => [h, r[k] ?? ""])));
}

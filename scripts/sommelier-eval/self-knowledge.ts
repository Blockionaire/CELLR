/**
 * DOES THE FOOD ENGINE KNOW WHEN IT HAS MISREAD A DISH? Before a model is asked to read the dishes the parser
 * cannot, this measures how far the parser's own signals (no dish template matched, words left unread, its stated
 * confidence) predict that its reading is wrong, judged by the benchmark's own food check (the main ingredient
 * class, and weight, fat, acidity, sweetness, heat and umami within one step of the reference card).
 *
 *   pnpm --filter @cellr/sommelier-eval run self-knowledge [--set main|holdout-dev] [--json out.json]
 *   pnpm --filter @cellr/sommelier-eval run self-knowledge --set holdout-test --router-only
 *
 * Each distinct question is counted once. A follow-up that names no dish is judged on the dish of its conversation,
 * as the app reads it (the last earlier turn that named one). A set that holds blind scenarios is reported only with `--router-only`:
 * then the router (fixed in code, designed on the readable sets) is applied and only its totals are printed.
 */
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { FOOD, parseFood, routeDishReading, type FoodProfile } from "@cellr/domain/intelligence";
import { truthOf } from "./engines/v3";
import { cardsOf, holdsBlind, scenariosOf } from "./sets";
import type { DishCard } from "./types";

const { values: args } = parseArgs({
  options: {
    set: { type: "string", default: "main" },
    json: { type: "string" },
    "router-only": { type: "boolean", default: false },
  },
});

const near = (a: number | undefined, b: number) => a !== undefined && Math.abs(a - b) <= 1;
/** The benchmark's food check (score.ts), applied to a reading. */
export function readingIsRight(food: FoodProfile, card: DishCard): { main: boolean; all: boolean } {
  const t = truthOf(food);
  if (!t) return { main: false, all: false };
  const main = t.main === card.truth.main;
  const axes =
    near(t.weight, card.truth.weight) &&
    (["fat", "acid", "sweet", "heat", "umami"] as const).every((k) => near(t[k], card.truth[k]));
  return { main, all: main && axes };
}

interface Row {
  question: string;
  dish: string;
  source: FoodProfile["source"];
  confidence: FoodProfile["confidence"];
  unknown: number;
  noMain: boolean;
  routed: boolean;
  mainRight: boolean;
  right: boolean;
}

const set = args.set!;
const blind = holdsBlind(set);
if (blind && !args["router-only"]) {
  console.error(`"${set}" holds blind scenarios: only --router-only totals may be read.`);
  process.exit(2);
}
const cards = cardsOf(set);
const seen = new Set<string>();
const rows: Row[] = [];
for (const s of scenariosOf(set)) {
  if (!s.dish) continue;
  const card = cards.get(s.dish);
  if (!card) continue;
  const question = s.turns.at(-1)!.user;
  const key = `${s.dish}|${question}`;
  if (seen.has(key)) continue;
  seen.add(key);
  // As the app does: a follow-up that names no dish is about the dish of the conversation (its state), which was
  // read from an earlier turn.
  const food =
    [...s.turns]
      .reverse()
      .map((t) => parseFood(t.user, FOOD))
      .reduce<FoodProfile | null>((got, f) => got ?? (f.main !== null ? f : null), null) ??
    parseFood(question, FOOD);
  const r = readingIsRight(food, card);
  rows.push({
    question,
    dish: s.dish,
    source: food.source,
    confidence: food.confidence,
    unknown: food.unknown.length,
    noMain: food.main === null,
    routed: routeDishReading(food).read,
    mainRight: r.main,
    right: r.all,
  });
}

const pct = (a: number, b: number) => (b === 0 ? "—" : `${Math.round((100 * a) / b)}%`);
const wrong = rows.filter((r) => !r.right);
const routed = rows.filter((r) => r.routed);
const router = {
  questions: rows.length,
  wrong: wrong.length,
  routed: routed.length,
  /** Of the wrong readings, how many the router sends to the model (recall). */
  wrongRouted: wrong.filter((r) => r.routed).length,
  /** Of the routed questions, how many were wrong (precision). */
  routedWrong: routed.filter((r) => !r.right).length,
  /** Wrong, and the parser gave no sign of it: the router cannot see these. */
  confidentButWrong: wrong.filter((r) => !r.routed).length,
  confidentButWrongMain: wrong.filter((r) => !r.routed && !r.mainRight).length,
};
console.log(`Set "${set}": ${rows.length} distinct questions about a dish.`);
console.log(
  `Readings wrong by the food check: ${router.wrong} (${pct(router.wrong, rows.length)}); main class wrong: ${rows.filter((r) => !r.mainRight).length}.`,
);
console.log(
  `Router: sends ${router.routed} (${pct(router.routed, rows.length)}) to the model; catches ${router.wrongRouted} of ${router.wrong} wrong readings (recall ${pct(router.wrongRouted, router.wrong)}); ${router.routedWrong} of the routed were wrong (precision ${pct(router.routedWrong, router.routed)}).`,
);
console.log(
  `Confident but wrong (not routed, wrong): ${router.confidentButWrong} (${pct(router.confidentButWrong, rows.length)} of all); of which the main class is wrong: ${router.confidentButWrongMain}.`,
);
if (blind) process.exit(0);

// The signals one by one, for designing the router (readable sets only).
const buckets = new Map<string, { n: number; wrong: number; mainWrong: number }>();
for (const r of rows) {
  const k = `${r.noMain ? "no-main" : r.source}/${r.confidence}/${r.unknown > 0 ? "unread-words" : "all-read"}`;
  const b = buckets.get(k) ?? { n: 0, wrong: 0, mainWrong: 0 };
  b.n += 1;
  if (!r.right) b.wrong += 1;
  if (!r.mainRight) b.mainWrong += 1;
  buckets.set(k, b);
}
console.log("\n| Signal (source / confidence / words) | Questions | Wrong | Main wrong |");
console.log("| --- | ---: | ---: | ---: |");
for (const [k, b] of [...buckets].sort((a, b) => b[1].n - a[1].n))
  console.log(`| ${k} | ${b.n} | ${b.wrong} (${pct(b.wrong, b.n)}) | ${b.mainWrong} |`);
console.log("\nConfident but wrong (not routed), main class wrong first:");
for (const r of wrong
  .filter((x) => !x.routed)
  .sort((a, b) => Number(a.mainRight) - Number(b.mainRight)))
  console.log(
    `  ${r.mainRight ? "axes" : "MAIN"}  ${r.dish}  "${r.question.slice(0, 90)}"  (${r.source}/${r.confidence})`,
  );
if (args.json) await writeFile(args.json, JSON.stringify({ set, router, rows }, null, 2) + "\n");

/**
 * The pairing matrix: every reference dish against every benchmark wine, the engine's level beside the label.
 * A tool for developing the pairing rules, not a gate; the gate is the scenario benchmark (run.ts).
 *
 *   pnpm --filter @cellr/sommelier-eval run matrix                 summary for both halves
 *   pnpm --filter @cellr/sommelier-eval run matrix --dish raw-oysters   one dish, wine by wine, with the reasons
 *   pnpm --filter @cellr/sommelier-eval run matrix --worst 40      the worst disagreements of the development half
 *
 * The dishes are split in two halves by position. Rules are developed looking at the DEVELOPMENT half only; the
 * HOLDOUT half is read as a summary, to see whether the rules generalise or were fitted to the labels.
 */
import { parseArgs } from "node:util";
import {
  FOOD,
  WINE_KNOWLEDGE,
  assessPairing,
  parseFood,
  readWine,
} from "@cellr/domain/intelligence";
import { DISHES } from "./dishes";
import type { DishCard } from "./types";
import { WINES } from "./wines";

const { values: args } = parseArgs({
  options: {
    dish: { type: "string" },
    worst: { type: "string" },
    lang: { type: "string", default: "en" },
    holdout: { type: "boolean", default: false },
  },
});

const LEVELS = ["good", "acceptable", "poor"] as const;
type Level = (typeof LEVELS)[number];
const label = (card: DishCard, key: string): Level =>
  card.good.includes(key) ? "good" : card.ok.includes(key) ? "acceptable" : "poor";

const wines = WINES.map((w) => {
  const reading = readWine(
    {
      type: w.type,
      name: w.name,
      region: w.region,
      appellation: w.appellation,
      countryCode: w.countryCode,
    },
    WINE_KNOWLEDGE,
  );
  return { key: w.key, wine: { ...reading, type: w.type } };
});

interface Cell {
  dish: string;
  wine: string;
  label: Level;
  engine: Level;
  score: number;
  notes: string;
}
function cells(card: DishCard): Cell[] {
  const food = parseFood(args.lang === "nl" ? card.nl : card.en, FOOD);
  if (food.main === null) return [];
  return wines.map(({ key, wine }) => {
    const a = assessPairing(food, wine);
    return {
      dish: card.id,
      wine: key,
      label: label(card, key),
      engine: a.level,
      score: a.score,
      notes: `+${a.pros.join(",")} -${a.cons.join(",")}`,
    };
  });
}

function summary(name: string, cards: readonly DishCard[]) {
  const all = cards.flatMap(cells);
  const unread = cards.filter(
    (c) => parseFood(args.lang === "nl" ? c.nl : c.en, FOOD).main === null,
  );
  const count = (l: Level, e: Level) => all.filter((c) => c.label === l && c.engine === e).length;
  console.log(`\n${name}: ${cards.length} dishes (${unread.length} not read), ${all.length} pairs`);
  console.log("label \\ engine      good  acceptable  poor");
  for (const l of LEVELS)
    console.log(
      `${l.padEnd(18)} ${LEVELS.map((e) => String(count(l, e)).padStart(5)).join("      ")}`,
    );
  const exact = all.filter((c) => c.label === c.engine).length;
  const grave = count("poor", "good") + count("good", "poor");
  console.log(
    `agreement ${((exact / all.length) * 100).toFixed(1)}%; grave disagreements (good↔poor) ${grave} (${((grave / all.length) * 100).toFixed(1)}%)`,
  );
  // What the scenario benchmark will see: is the engine's best wine of the full cellar one the label calls good?
  let top = 0;
  let poorOffered = 0;
  for (const card of cards) {
    const ranked = cells(card)
      .filter((c) => c.engine !== "poor")
      .sort((a, b) => LEVELS.indexOf(a.engine) - LEVELS.indexOf(b.engine) || b.score - a.score);
    if (ranked[0]?.label === "good") top++;
    if (ranked.slice(0, 3).some((c) => c.label === "poor")) poorOffered++;
  }
  console.log(
    `full cellar: first pick is a labelled-good wine for ${top}/${cards.length} dishes; a labelled-poor wine among the first three for ${poorOffered}/${cards.length}`,
  );
  return all;
}

const dev = DISHES.filter((_, i) => i % 2 === 0);
const holdout = DISHES.filter((_, i) => i % 2 === 1);

if (args.dish) {
  const card = DISHES.find((d) => d.id === args.dish);
  if (!card) throw new Error(`unknown dish ${args.dish}`);
  const food = parseFood(args.lang === "nl" ? card.nl : card.en, FOOD);
  console.log(card.en, "|", card.nl, "\nreference:", card.why);
  console.log(
    JSON.stringify({
      main: food.main,
      ...food.structure,
      tags: food.tags,
      classics: food.classics,
    }),
  );
  for (const c of cells(card).sort((a, b) => b.score - a.score))
    console.log(
      `${c.label === c.engine ? " " : "!"} ${c.wine.padEnd(18)} label ${c.label.padEnd(10)} engine ${c.engine.padEnd(10)} ${String(c.score).padStart(3)}  ${c.notes}`,
    );
} else {
  const devCells = summary("DEVELOPMENT half", dev);
  summary("HOLDOUT half", holdout);
  if (args.worst) {
    const pool = args.holdout ? holdout.flatMap(cells) : devCells;
    const gap = (c: Cell) => Math.abs(LEVELS.indexOf(c.label) - LEVELS.indexOf(c.engine));
    console.log(`\nWorst disagreements (${args.holdout ? "holdout" : "development"} half):`);
    for (const c of pool
      .filter((c) => gap(c) > 0)
      .sort((a, b) => gap(b) - gap(a))
      .slice(0, Number(args.worst)))
      console.log(
        `${c.dish.padEnd(28)} ${c.wine.padEnd(18)} label ${c.label.padEnd(10)} engine ${c.engine.padEnd(10)} ${String(c.score).padStart(3)}  ${c.notes}`,
      );
  }
}

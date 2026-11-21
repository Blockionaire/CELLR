/**
 * WHY SCENARIOS FAIL. Runs an engine over the benchmark and, for every failed scenario that is about a dish,
 * writes down what was expected, what was offered, and how the engine itself rates every wine of that cellar,
 * so that a failure can be put in a class: the dish was misread, a wine was ranked wrongly, a wine the label
 * calls poor was offered (or one it calls good was held back), "nothing suits" was missed or forced.
 *
 *   pnpm --filter @cellr/sommelier-eval run analyze --json out.json [--set holdout-dev]
 *
 * A tool for reading failures, not a gate. It never changes a label.
 */
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  FOOD,
  WINE_KNOWLEDGE,
  assessPairing,
  parseFood,
  readWine,
} from "@cellr/domain/intelligence";
import { ENGINES } from "./engines";
import { buildFixture } from "./fixtures";
import { cardsOf, holdsBlind, scenariosOf } from "./sets";
import { expectedVerdictOf, scoreScenario } from "./score";
import type { DishCard } from "./types";

const { values: args } = parseArgs({
  options: {
    engine: { type: "string", default: "v3-app" },
    set: { type: "string", default: "main" },
    json: { type: "string" },
  },
});
if (holdsBlind(args.set!)) {
  console.error(
    `"${args.set}" is a blind set: it is measured (run.ts), never read failure by failure.`,
  );
  process.exit(2);
}
const engine = ENGINES.find((e) => e.name === args.engine)!;
const cards = cardsOf(args.set!);
const labelOf = (card: DishCard, key: string) =>
  card.good.includes(key) ? "good" : card.ok.includes(key) ? "ok" : "poor";

export interface FailureRecord {
  id: string;
  category: string;
  lang: string;
  dish: string | null;
  cellar: string;
  question: string;
  failed: string[];
  expected: string | null;
  got: string | null;
  /** What the food engine read, against the card's truth. */
  food: { read: string | null; truth: string | null };
  /** Offered, best first: wine key, the label's word for it, the engine's level and score. */
  offered: Array<{ wine: string; label: string; level: string; score: number }>;
  /** Every free wine of the cellar the label calls good or ok, and what the engine makes of it. */
  labelled: Array<{ wine: string; label: string; level: string; score: number; notes: string }>;
  classes: string[];
}

const PAIRING_CHECKS = new Set(["verdict", "first", "no-poor-bottle", "honest-none", "no-bottles"]);
const records: FailureRecord[] = [];
let attempted = 0;
let passed = 0;
for (const s of scenariosOf(args.set!)) {
  if (!s.needs.every((n) => engine.capabilities.has(n))) continue;
  attempted += 1;
  const card = s.dish ? (cards.get(s.dish) ?? null) : null;
  const { answer, ms } = await engine.run(s);
  const failed = scoreScenario(s, card, answer, ms)
    .checks.filter((c) => !c.pass)
    .map((c) => c.name);
  if (failed.length === 0) {
    passed += 1;
    continue;
  }
  const classes = new Set<string>();
  const question = s.turns.at(-1)!.user;
  const record: FailureRecord = {
    id: s.id,
    category: s.category,
    lang: s.lang,
    dish: s.dish ?? null,
    cellar: s.cellar,
    question,
    failed,
    expected: card ? expectedVerdictOf(s, card) : null,
    got: answer.verdict,
    food: { read: null, truth: card?.truth.main ?? null },
    offered: [],
    labelled: [],
    classes: [],
  };
  if (card) {
    // The dish as the engine reads it: from the turn that names it (the last one that reads as a dish).
    const food =
      [...s.turns]
        .reverse()
        .map((t) => parseFood(t.user, FOOD))
        .find((f) => f.main !== null) ?? null;
    record.food.read = food?.main ?? null;
    const fixture = buildFixture(s);
    const rated = new Map(
      fixture.wines
        .filter((w) => w.count - w.reserved > 0)
        .map((w) => {
          const reading = readWine(
            {
              type: w.wine.type,
              name: w.wine.name,
              region: w.stripped ? null : w.wine.region,
              appellation: w.stripped ? null : w.wine.appellation,
              countryCode: w.stripped ? null : w.wine.countryCode,
            },
            WINE_KNOWLEDGE,
          );
          const a = food ? assessPairing(food, { ...reading, type: w.wine.type }) : null;
          return [
            w.key,
            {
              level: a?.level ?? "unread",
              score: a?.score ?? 0,
              notes: a ? `+${a.pros.join(",")} -${a.cons.join(",")}` : "",
            },
          ] as const;
        }),
    );
    record.offered = answer.bottles.map((key) => ({
      wine: key,
      label: labelOf(card, key),
      level: rated.get(key)?.level ?? "?",
      score: rated.get(key)?.score ?? 0,
    }));
    record.labelled = [...rated.entries()]
      .filter(([key]) => labelOf(card, key) !== "poor")
      .map(([key, r]) => ({ wine: key, label: labelOf(card, key), ...r }))
      .sort((a, b) => b.score - a.score);

    if (failed.includes("food")) classes.add("recognition");
    const pairing = failed.some((f) => PAIRING_CHECKS.has(f));
    if (pairing) {
      const offeredPoor = record.offered.filter((o) => o.label === "poor");
      const goodInCellar = record.labelled.filter((l) => l.label === "good");
      const first = record.offered[0];
      if (record.expected === "none" && record.offered.length > 0) classes.add("forced-answer");
      else if (offeredPoor.length > 0) classes.add("poor-offered");
      if (record.expected !== "none" && record.offered.length === 0) classes.add("missed-match");
      if (first && first.label !== "good" && goodInCellar.length > 0) {
        const rank = { good: 0, acceptable: 1, neutral: 2, poor: 3, unread: 4, "?": 4 } as Record<
          string,
          number
        >;
        const bestGood = goodInCellar.reduce((a, b) =>
          (rank[a.level] ?? 4) - (rank[b.level] ?? 4) || b.score - a.score <= 0 ? a : b,
        );
        // The engine rates a labelled-good wine as well as its own first pick: only the order is off.
        classes.add(
          (rank[bestGood.level] ?? 4) <= (rank[first.level] ?? 4)
            ? "ranking"
            : "good-wine-underrated",
        );
      }
    }
    for (const f of failed) if (!PAIRING_CHECKS.has(f) && f !== "food") classes.add(`other:${f}`);
  } else for (const f of failed) classes.add(`other:${f}`);
  record.classes = [...classes].sort();
  records.push(record);
}

const byClass = new Map<string, number>();
for (const r of records)
  for (const c of r.classes.length > 0 ? r.classes : ["unclassified"])
    byClass.set(c, (byClass.get(c) ?? 0) + 1);
console.log(
  `${args.engine} on "${args.set}": ${passed} of ${attempted} attempted scenarios pass; ${records.length} fail.`,
);
console.log("Failures by class (a scenario can be in more than one):");
for (const [c, n] of [...byClass.entries()].sort((a, b) => b[1] - a[1]))
  console.log(`  ${String(n).padStart(3)}  ${c}`);
if (args.json) {
  await writeFile(
    args.json,
    JSON.stringify({ engine: args.engine, set: args.set, records }, null, 2),
  );
  console.log(`\nwrote ${args.json}`);
}

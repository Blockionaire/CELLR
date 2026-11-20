/**
 * HOW MANY BOTTLES TO OFFER (S10). For every pairing scenario of a readable set, the engine's picks with their
 * scores, against the reference card's labels: how often a pick at place 2 or 3 is poor, by how far its score is
 * below the first. This is what the conservative selection (`conservativePicks`) was set from.
 *
 *   pnpm --filter @cellr/sommelier-eval run selection-study [--set main|holdout-dev]
 *
 * Refuses a set that holds blind scenarios.
 */
import { parseArgs } from "node:util";
import {
  FOOD,
  WINE_KNOWLEDGE,
  decidePairing,
  parseFood,
  readWine,
  type PairingCandidate,
} from "@cellr/domain/intelligence";
import { wineInput } from "./engines/v3";
import { buildFixture } from "./fixtures";
import { labelOf } from "./quality";
import { cardsOf, holdsBlind, scenariosOf } from "./sets";

const { values: args } = parseArgs({ options: { set: { type: "string", default: "main" } } });
if (holdsBlind(args.set!)) {
  console.error(`"${args.set}" holds blind scenarios.`);
  process.exit(2);
}
const cards = cardsOf(args.set!);
const byGap = new Map<string, { n: number; poor: number; good: number }>();
const byPlace = new Map<number, { n: number; poor: number; good: number }>();
const byReason = new Map<string, { n: number; poor: number; good: number }>();
const firstLevel = new Map<string, { n: number; poor: number; good: number }>();
const add = (
  m: Map<string | number, { n: number; poor: number; good: number }>,
  k: string | number,
  l: string,
) => {
  const b = m.get(k) ?? { n: 0, poor: 0, good: 0 };
  b.n += 1;
  if (l === "poor") b.poor += 1;
  if (l === "good") b.good += 1;
  m.set(k, b);
};
for (const s of scenariosOf(args.set!)) {
  if (!s.dish || !s.needs.every((n) => n === "pairing")) continue;
  const card = cards.get(s.dish)!;
  const fixture = buildFixture(s);
  const food = [...s.turns]
    .reverse()
    .map((t) => parseFood(t.user, FOOD))
    .find((f) => f.main !== null);
  if (!food) continue;
  const candidates: PairingCandidate<string>[] = fixture.wines.map((f) => {
    const reading = readWine(wineInput(f), WINE_KNOWLEDGE);
    return { item: f.key, wine: { ...reading, type: f.wine.type }, tier: reading.tier };
  });
  const d = decidePairing(food, candidates);
  const top = d.picks[0]?.assessment.score ?? 0;
  d.picks.forEach((p, i) => {
    const l = labelOf(card, p.item);
    add(byPlace as never, i + 1, l);
    if (i === 0) add(firstLevel as never, `${p.assessment.level}/${food.confidence}`, l);
    else {
      const gap = top - p.assessment.score;
      const vouched = p.assessment.pros.some((x) => x === "classic" || x === "affinity");
      add(
        byReason as never,
        `${vouched ? "classic or affinity" : "structure only"}; ${p.assessment.cons.length === 0 ? "nothing against" : "something against"}`,
        l,
      );
      add(
        byGap as never,
        gap < 2 ? "0-2" : gap < 4 ? "2-4" : gap < 6 ? "4-6" : gap < 9 ? "6-9" : "9+",
        l,
      );
    }
  });
}
const pct = (a: number, b: number) => `${Math.round((100 * a) / Math.max(1, b))}%`;
const show = (
  title: string,
  m: Map<string | number, { n: number; poor: number; good: number }>,
) => {
  console.log(`\n${title}\n| key | picks | poor | good |\n| --- | ---: | ---: | ---: |`);
  for (const [k, b] of [...m].sort((a, b) => String(a[0]).localeCompare(String(b[0]))))
    console.log(
      `| ${k} | ${b.n} | ${b.poor} (${pct(b.poor, b.n)}) | ${b.good} (${pct(b.good, b.n)}) |`,
    );
};
console.log(`Set "${args.set}", pairing scenarios, the engines alone.`);
show("By place", byPlace as never);
show("Place 2 and 3, by points below the first", byGap as never);
show("Place 2 and 3, by what speaks for it", byReason as never);
show("Place 1, by its level and the dish reading's confidence", firstLevel as never);

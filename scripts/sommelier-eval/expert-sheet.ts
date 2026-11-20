/**
 * THE EXPERT REVIEW SHEET (S10). Thirty hard dish-and-wine pairs from the readable main set, for a person with
 * proven wine knowledge to judge blind: the sheet shows the dish and the wine, never the benchmark's label, the
 * engine's level or anyone's earlier opinion. The key (which pair is which, and what each side said) is written
 * apart and is not for the reviewer.
 *
 * Chosen from the 72 pairs on which the label and the engine disagreed at S8 (results/s9-disputed-pairs.json):
 * the 14 where a blind AI second opinion sided with the engine, 10 where it sided with neither, and 6 where it
 * sided with the label (as controls). Fixed order, so the sheet is the same each time it is made.
 *
 *   pnpm --filter @cellr/sommelier-eval run expert-sheet
 */
import { readFileSync, writeFileSync } from "node:fs";
import { DISHES } from "./dishes";
import { wineByKey } from "./wines";

const dir = new URL("../../docs/sprints/sommelier-3-mega/", import.meta.url);
const disputed = JSON.parse(
  readFileSync(new URL("results/s9-disputed-pairs.json", dir), "utf8"),
) as {
  pairs: Array<{
    dish: string;
    wine: string;
    label: string;
    engineAtS8: string;
    judge: string;
    judgeSidesWith: string;
  }>;
};
const take = (side: string, n: number) =>
  disputed.pairs.filter((p) => p.judgeSidesWith === side).slice(0, n);
const chosen = [...take("engine", 14), ...take("neither", 10), ...take("label", 6)];
// A fixed shuffle, so the groups are not visible in the order.
const order = chosen
  .map((p, i) => ({ p, k: (i * 7919 + 13) % 997 }))
  .sort((a, b) => a.k - b.k)
  .map((x) => x.p);

const rows = order.map((p, i) => {
  const dish = DISHES.find((d) => d.id === p.dish)!;
  const wine = wineByKey(p.wine);
  const s = wine.structure;
  return {
    n: i + 1,
    dish: `${dish.en} / ${dish.nl}`,
    wine: `${wine.name} (${wine.region}, ${wine.grapes.join(", ")}; ${wine.type}; body ${s.body}/5, tannin ${s.tannin}/5, acidity ${s.acidity}/5, sweetness ${s.sweetness}/5)`,
    key: {
      dish: p.dish,
      wine: p.wine,
      label: p.label,
      engineAtS8: p.engineAtS8,
      aiJudge: p.judge,
      group: p.judgeSidesWith,
    },
  };
});

const sheet = [
  "# Expert review of 30 hard pairings (S10)",
  "",
  "For a person with proven wine knowledge (a sommelier, a wine educator, a buyer). Please judge each pair on its",
  "own, as you would advise a guest at home: would you serve this wine with this dish?",
  "",
  "- **good**: you would recommend it with confidence.",
  "- **ok**: it works, without a clash, but it is not what you would choose.",
  "- **poor**: it clashes or disappoints.",
  "",
  "Write one word per pair, and a short reason where you like. Do not look anything up in this repository first:",
  "the key to this sheet is kept apart (`results/s10-expert-key.json`) so the judgement stays blind. Your name and",
  "credentials go in the header of the returned sheet, not in the repository unless you agree.",
  "",
  "| # | Dish | Wine | good / ok / poor | Reason |",
  "| ---: | --- | --- | --- | --- |",
  ...rows.map((r) => `| ${r.n} | ${r.dish} | ${r.wine} | | |`),
  "",
].join("\n");
writeFileSync(new URL("EXPERT_REVIEW.md", dir), sheet);
writeFileSync(
  new URL("results/s10-expert-key.json", dir),
  JSON.stringify(
    {
      what: "The key to EXPERT_REVIEW.md: which pair each row is, the benchmark's label, the engine's level at S8 and the AI second opinion of S9. Not for the reviewer.",
      rows: rows.map((r) => ({ n: r.n, ...r.key })),
    },
    null,
    2,
  ) + "\n",
);
console.log(`Wrote ${rows.length} pairs.`);

# Writing the independent holdout — instructions (100 dishes, in two series)

**Who:** a person who knows wine (and, for the dishes, one or two people who cook), who has not worked on CELLR and
does not use an AI to write. **What for:** a blind test of whether the sommelier pairs dishes it has never seen. Until
you have written it, every quality claim rests on scenarios an AI wrote.

## Two series: 40, then 60

The owner's provisional target (2026-11-24) is **100 independent dishes**, written in two series:

| Series | Form                           | Dishes | ids                     | Written by                                                             |
| ------ | ------------------------------ | -----: | ----------------------- | ---------------------------------------------------------------------- |
| 1      | `holdout-template-series1.csv` |     40 | `hh-s1-01` … `hh-s1-40` | the first writers                                                      |
| 2      | `holdout-template-series2.csv` |     60 | `hh-s2-01` … `hh-s2-60` | people who have **not** seen any result on series 1 (not even a total) |

A run on series 1 alone is reported as **provisional**: 40 dishes can catch only a large regression, not show that
V1+ is as good as V1 within 5 points (`P8_POWER_ANALYSIS.md`). Only the full 100 is the holdout the gate asks for.

## What you fill in

Open your series' form. Its `id` column is filled; everything else is yours. Per row, one dish:

| Column                        | What to write                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| dish (English), dish (Dutch)  | The dish in a few words, in both languages                                                             |
| question (English, Dutch)     | How a person would ask the app about it ("We're having … tonight, which wine?")                        |
| main                          | What the dish is built on: one of the words in the column header                                       |
| weight                        | 1 delicate … 5 very rich                                                                               |
| fat, acid, sweet, heat, umami | 0 none … 3 dominant (heat = chili)                                                                     |
| right wines                   | The wines of `holdout-wines.csv` you would pour with confidence, by their **key**, separated by spaces |
| acceptable wines              | The wines that will do without a clash, by key                                                         |
| nothing suits                 | `yes` when none of the 30 wines is right or acceptable; else leave empty                               |
| why                           | One line: your reasoning                                                                               |
| written by                    | Initials or a role ("cook 1", "sommelier"), never a full name without consent                          |

Every wine you do not list counts as a **poor** choice for that dish. "Nothing suits" is a real answer: use it when
it is true. `holdout-wines.csv` lists the 30 wines (key, name, type, vintage, appellation, region, grapes); they are
the eval cellar's wines, with invented producers.

**Rules:** a real mix (everyday Dutch food, other cuisines, restaurant dishes, desserts, cheese, vague descriptions,
a sauce or method that matters). Nothing copied from the existing benchmark, and no dish chosen because you expect
CELLR to get it wrong. Do not look at CELLR's answers while writing.

## Escrow: the filled file never enters the repository

1. Fill the form **on your own computer**. Do not upload it to the repository, a shared drive the developers can
   read, or a chat with an AI.
2. Send it only to the owner. The owner keeps it in a private folder outside the repository and converts and seals
   it there, **per series**:

   ```bash
   # Series 1 (40): its own file and its own seal
   pnpm --filter @cellr/sommelier-eval run holdout-from-csv 1 /private/series1-filled.csv /private/series1.json
   pnpm --filter @cellr/sommelier-eval run seal-human-holdout /private/series1.json   # → human-holdout/SEAL-series1.json
   # Series 2 (60), later; then the full 100 with the full set's seal
   pnpm --filter @cellr/sommelier-eval run holdout-from-csv 2 /private/series2-filled.csv /private/series2.json
   pnpm --filter @cellr/sommelier-eval run holdout-from-csv merge /private/series1.json /private/series2.json /private/dishes.json
   pnpm --filter @cellr/sommelier-eval run seal-human-holdout /private/dishes.json    # → human-holdout/SEAL.json
   ```

   The converter refuses any path inside the repository, checks the series' ids and exact size, and prints only a
   count and row numbers, never a dish.

3. The owner commits **only** the seals (`scripts/sommelier-eval/human-holdout/SEAL-series1.json`, later `SEAL.json`:
   a file's hash and its number of dishes). The benchmark reads series 1 from `SOMMELIER_EVAL_HUMAN_SERIES1_FILE`
   (set `human-series1`) and the full 100 from `SOMMELIER_EVAL_HUMAN_FILE` (set `human`), each from the owner's path,
   and refuses a file that does not match its seal, so neither can change unseen.
4. **The agent that develops or measures CELLR must not see either file before the run**, and both sets are reported
   in totals only (`run.ts` treats them as blind). Series 2's writers see no result of series 1. A change after the first measurement gets a new seal and a written
   reason.

**Size:** the full set keeps its minimum of 100 dishes (`HUMAN_HOLDOUT_MIN_DISHES`); series 1 alone is a separate,
clearly named set (`human-series1`, exactly 40) whose every report says `PROVISIONAL` first.

Filled in by: ____________ Date: ________ — nothing counts until you have signed it.

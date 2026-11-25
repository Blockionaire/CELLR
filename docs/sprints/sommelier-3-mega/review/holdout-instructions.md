# Writing the independent holdout — instructions (100 dishes: 40 exploratory, 60 definitive)

**Who:** a person who knows wine (and, for the dishes, one or two people who cook), who has not worked on CELLR and
does not use an AI to write. **What for:** a blind test of whether the sommelier pairs dishes it has never seen. Until
you have written it, every quality claim rests on scenarios an AI wrote.

## Two parts: 40 exploratory, 60 definitive (owner decision, 2026-11-25)

| Part               | Form                               | Dishes | ids                   | What it is for                                                                                         |
| ------------------ | ---------------------------------- | -----: | --------------------- | ------------------------------------------------------------------------------------------------------ |
| Exploratory        | `holdout-template-exploratory.csv` |     40 | `hh-x-01` … `hh-x-40` | A first look; every report says EXPLORATORY. Can only catch a large regression                         |
| Definitive (blind) | `holdout-template-definitive.csv`  |     60 | `hh-d-01` … `hh-d-60` | The measure. Sealed, never seen by an agent or a developer, scored **once**, after the build is frozen |

The definitive 60 are written by people who have **not** seen any result on the exploratory 40 (not even a total).
No claim that CELLR is "as good as" before rests on the exploratory part (`P8_POWER_ANALYSIS.md`).

## What you fill in

Open your part's form. Its `id` column is filled; everything else is yours. Per row, one dish:

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
   it there, **each part on its own**:

   ```bash
   pnpm --filter @cellr/sommelier-eval run holdout-from-csv exploratory /private/exploratory-filled.csv /private/exploratory.json
   pnpm --filter @cellr/sommelier-eval run seal-human-holdout /private/exploratory.json   # → human-holdout/SEAL-exploratory.json
   pnpm --filter @cellr/sommelier-eval run holdout-from-csv definitive /private/definitive-filled.csv /private/definitive.json
   pnpm --filter @cellr/sommelier-eval run seal-human-holdout /private/definitive.json    # → human-holdout/SEAL-definitive.json
   pnpm --filter @cellr/sommelier-eval run holdout-from-csv merge /private/exploratory.json /private/definitive.json /private/dishes.json
   pnpm --filter @cellr/sommelier-eval run seal-human-holdout /private/dishes.json         # → human-holdout/SEAL.json (the 100)
   ```

   The converter refuses any path inside the repository, checks the part's ids and exact size, and prints only a
   count and row numbers, never a dish.

3. The owner commits **only** the seals (a file's hash and its number of dishes). The benchmark reads the exploratory
   part as set `human-exploratory` (`SOMMELIER_EVAL_HUMAN_EXPLORATORY_FILE`) and the definitive part as set
   `human-definitive` (`SOMMELIER_EVAL_HUMAN_DEFINITIVE_FILE`), each from the owner's path, and refuses a file that
   does not match its seal. The definitive set is refused unless the build is frozen and `--definitive --frozen-at
<sha>` is given, and a second scoring of the same seal by the same engine is refused (`P8_MEASUREMENT_PLAN.md`
   §10 step 5). Its dishes are refused in every other set.
4. **The agent that develops or measures CELLR must not see either file before the run**, and both sets are reported
   in totals only (`run.ts` treats them as blind). The definitive part's writers see no result of the exploratory part. A change after the first measurement gets a new seal and a written
   reason.

**Size:** the full set keeps its minimum of 100 dishes (`HUMAN_HOLDOUT_MIN_DISHES`); it is a size and escrow check,
not scored as such: the definitive dishes are scored only in their own set, once.

Filled in by: ____________ Date: ________ — nothing counts until you have signed it.

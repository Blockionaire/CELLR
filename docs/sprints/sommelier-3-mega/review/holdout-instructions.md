# Writing the independent holdout — instructions (40 scenarios)

**Who:** a person who knows wine (and, for the dishes, one or two people who cook), who has not worked on CELLR and
does not use an AI to write. **What for:** a blind test of whether the sommelier pairs dishes it has never seen. Until
you have written it, every quality claim rests on scenarios an AI wrote.

## What you fill in

Open `holdout-template.csv`. It has 40 rows; the `id` column is filled (`hh-01` … `hh-40`), everything else is
yours. Per row, one dish:

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
   it there:

   ```bash
   pnpm --filter @cellr/sommelier-eval run holdout-from-csv /private/holdout-filled.csv /private/dishes.json
   pnpm --filter @cellr/sommelier-eval run seal-human-holdout /private/dishes.json   # prints SEAL.json
   ```

   The converter refuses any path inside the repository and prints only a count and row numbers, never a dish.

3. The owner commits **only** the seal (`scripts/sommelier-eval/human-holdout/SEAL.json`: the file's hash and the
   number of dishes). The benchmark reads the file from the owner's path (`SOMMELIER_EVAL_HUMAN_FILE`) and refuses
   it if it does not match the seal, so it cannot change unseen.
4. **The agent that develops or measures CELLR must not see the file before the run**, and the set is reported in
   totals only (`run.ts` treats it as blind). A change after the first measurement gets a new seal and a written
   reason.

**Note on size:** the S10 plan asks for at least 100 dishes (`HUMAN_HOLDOUT_MIN_DISHES`); 40 is what this form asks
for now. With 40 dishes the escrow test fails until the owner either asks for 60 more or decides, in writing, that 40
is enough for this release.

Filled in by: ____________ Date: ________ — nothing counts until you have signed it.

# The human holdout (S10): how to write it

The engines have been developed against benchmark dishes written by an AI. The honest test of "does CELLR
understand a dish it has never seen" is a set of dishes written by **people**, that nobody uses while developing.
It does not exist yet.

**Held in escrow (S11): the file is never put in this repository**, where whoever develops the engines could read
it. The owner keeps it in a private place, seals it, and commits only the seal; the benchmark reads it from the
owner's path and refuses a file that does not match. The whole procedure, and the blind expert panel that uses
these dishes: `docs/sprints/sommelier-3-mega/HUMAN_EVALUATION_PROTOCOL.md`.

```bash
pnpm --filter @cellr/sommelier-eval run seal-human-holdout /private/path/dishes.json   # prints SEAL.json
SOMMELIER_EVAL_HUMAN_FILE=/private/path/dishes.json pnpm sommelier:eval --set human --engine v1-basic
```

## Two parts (P8; owner decision 2026-11-25)

The 100 dishes are **40 exploratory** and **60 definitive**; the definitive 60 are written by people who have seen no
result on the exploratory part, stay blind, and are scored only once, after the build is frozen. Forms, instructions
in English and Dutch, and the escrow steps per part: `docs/sprints/sommelier-3-mega/review/holdout-instructions.md`.

- `human-exploratory`: its file from `SOMMELIER_EVAL_HUMAN_EXPLORATORY_FILE`, its seal `SEAL-exploratory.json`, exactly
  40 dishes `hh-x-…`, blind; every report starts with `EXPLORATORY`.
- `human-definitive`: its file from `SOMMELIER_EVAL_HUMAN_DEFINITIVE_FILE`, its seal `SEAL-definitive.json`, exactly 60
  dishes `hh-d-…`; refused without `--definitive --frozen-at <sha>` and a recorded freeze, scored once per engine
  (`docs/sprints/sommelier-3-mega/results/p8-definitive-scored.json`), reported apart. Its dishes are refused in any
  other set.
- The full set (`human`, this file's `SEAL.json`) is both parts merged (`holdout-from-csv merge`): its minimum of 100
  dishes is unchanged; it is a size and escrow check and is not scored as such.

## Who writes it

- **Dishes and questions:** at least two people who cook (at home or professionally), Dutch and English. Not the
  people who develop CELLR, and not with an AI's help.
- **Wine labels (`good`, `ok`, `why`):** a person with proven wine knowledge, afterwards, blind to CELLR's answers.
  Until they are written the set measures dish understanding only.

## What to write

At least **100 dishes**, each once, as a list of objects:

```json
{
  "id": "hh-andijviestamppot-met-gehaktbal",
  "en": "Endive stamppot with a meatball",
  "nl": "Andijviestamppot met gehaktbal",
  "question_en": "We're having endive stamppot with meatballs tonight, which wine?",
  "question_nl": "We eten andijviestamppot met een gehaktbal, welke wijn moet ik openen?",
  "truth": {
    "main": "red-meat",
    "weight": 3,
    "fat": 2,
    "acid": 1,
    "sweet": 0,
    "heat": 0,
    "umami": 2
  },
  "by": "cook 1"
}
```

- `truth.main`: what the dish is built on, one of: red-meat, game, pork, poultry, white-fish, oily-fish,
  shellfish, vegetable, mushroom, pasta-grain, egg, cheese, dessert, snack, pulse.
- `truth.weight`: 1 (delicate) to 5 (very rich). `fat`, `acid`, `sweet`, `heat` (chili), `umami`: 0 (none) to
  3 (dominant).
- `good` and `ok` (the wine expert): keys of the 30 benchmark wines (`../wines.ts`); every wine in neither list
  counts as a poor choice for the dish.

## Rules

- A real mix: everyday Dutch food, other cuisines, restaurant dishes, desserts, cheese, vague descriptions
  ("something with leftover chicken"), misspellings, a sauce or a cooking method that matters.
- Nothing copied from `../dishes.ts` or `../dishes-holdout.ts`, and no dish chosen because CELLR gets it wrong.
- Once sealed, the file is **blind**: `run.ts` reports it in totals only, `analyze.ts` refuses it, and no
  engine change may be made because of its results. A change to the file after the first measurement gets a new
  seal and is recorded in `docs/sprints/sommelier-3-mega/progress/` with the reason.
- A copy at `human-holdout/dishes.json` (inside the repository) is refused by the benchmark and ignored by Git.

`pnpm --filter @cellr/sommelier-eval test` checks the escrow; with `SOMMELIER_EVAL_HUMAN_FILE` set it also checks
the file's shape and size.

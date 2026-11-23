# Sommelier V1+ — P8: the paid measurement plan (prepared, not run)

2026-11-23, integration branch at `5c85798`. **Nothing in this plan has been run.** No paid call was made, no key
was used and no budget file exists. Every number below is the free estimate of
`pnpm --filter @cellr/sommelier-eval run plan --estimate` (recorded in `results/p8-plan-estimate.json`). The owner's
provisional budget of **$5 in total is a proposal and is not a permission to spend** (D-51).

## 1. What the plan measures, and why

| Question (closeout §5, `V1PLUS_REPORT.md` §5)                                    | Measured by                                                                                                       |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Does prompt v7 with the check choose as well as V1 (v6)?                         | v6 against v7 on the same scenarios, paired, clustered by dish: first bottle right, no poor bottle, useful answer |
| Does the model invent cellar facts, prices or shops, and does the check stop it? | The check's rules counted on the model's own words (v6 and v7) and on the words shown (heuristics, see §4)        |
| Does the model write cellar wines as refs, as v7 asks?                           | Per answer, on v7                                                                                                 |
| How often does the check remove a good sentence (false positives)?               | **Only a person can say**: a review sheet of every removed sentence and 100 kept ones, verdicts empty             |
| Does the `menu` part plan a menu better than V1's ordinary answer?               | The 18-menu set, V1 against `menu` on, scored per course                                                          |
| What does a menu really cost?                                                    | Tokens in and out of every call, against the proposed criterion (§6)                                              |

## 2. The runs, and the budget (estimate)

Three runs per arm on the three sets V1 can attempt (`--needs pairing,facts`), the menu set three times with and
without the part, and two optional single runs. The reservation is what the guard holds back before each call, as if
every call cost its worst case (both attempts with the full output allowance, the repair's longer prompt, +25%).

| Step | Run                                                 | Runs | Calls per run | High estimate per run | Reserved per run | `--max-usd` per run | Required |
| ---- | --------------------------------------------------- | ---: | ------------: | --------------------: | ---------------: | ------------------: | -------- |
| 1    | v6 (no part), `main`                                |    3 |           131 |               $0.2031 |          $0.3337 |                0.35 | yes      |
| 1    | v6, `holdout-dev`                                   |    3 |            45 |               $0.0668 |          $0.1091 |                0.12 | yes      |
| 1    | v6, `holdout-test` (blind)                          |    3 |            43 |               $0.0643 |          $0.1050 |                0.12 | yes      |
| 2    | v7 + check, `main`                                  |    3 |           131 |               $0.2078 |          $0.3425 |                0.36 | yes      |
| 2    | v7 + check, `holdout-dev`                           |    3 |            45 |               $0.0685 |          $0.1122 |                0.13 | yes      |
| 2    | v7 + check, `holdout-test` (blind)                  |    3 |            43 |               $0.0658 |          $0.1079 |                0.12 | yes      |
| 3    | Menu set, V1 without the part                       |    3 |            21 |               $0.0315 |          $0.0516 |                0.07 | yes      |
| 3    | Menu set, `menu` on                                 |    3 |            21 |               $0.0370 |          $0.0600 |                0.08 | yes      |
| 3    | Menu set, `check,menu` (as it would ship)           |    1 |            21 |               $0.0377 |          $0.0614 |                0.08 | optional |
| 3    | Menu set, V1 asked once per course (cost reference) |    1 |            53 |               $0.0794 |          $0.1298 |                0.14 | optional |
|      | **All runs**                                        |      |     **1,514** |           **$2.3514** |      **$3.8573** |                     |          |
|      | Required runs only                                  |      |         1,440 |               $2.2343 |          $3.6661 |                     |          |

- **It fits $5 at the worst case**, with `--total-usd 5` on one budget file for all runs and the `--max-usd` per run
  in the table: every call costing its whole reservation leaves $1.14.
- What it will probably cost is far less. In S9 the calls cost about $0.00009 each (COST_REPORT.md), about 1/17 of
  this high estimate per call, because of the provider's prompt cache; at that rate the whole plan is about $0.14.
  That is an expectation from earlier runs, not a promise; the guard holds the worst case.
- The eval cellar's ids are counted (`fixtures.ts`), so its refs are 32 characters, not 6: every prompt here is a
  little longer than in production, for every arm alike (the estimate errs high).

**If the owner approves less than $3.86:** the smallest cut is to drop the two optional runs (saves $0.19; the
required runs need $3.67). Then two runs instead of three per arm ($2.45 reserved). What that costs in power: the
intervals rest on the dishes, not on the runs (`stats.ts` averages a scenario's runs first and resamples dishes), so a
third run only reduces the model's run-to-run noise inside each scenario. The widths of the free comparison
(`results/p7-fallback.json`, two deterministic engines) show what the dishes alone allow: ±10 points on `main`
(100 dishes), ±22 / ±19 points for first bottle on `holdout-dev` / `holdout-test` (22 dishes each). Dropping a set
loses that set's evidence entirely, which costs more than a run: keep all three sets and cut runs first. How large
the model's run-to-run noise is cannot be known before the first runs.

## 3. Commands, in order

Set up once, outside the repository (never commit these):

```bash
export SOMMELIER_EVAL_PAID=owner-approved          # only after the owner's yes (§7)
export OPENAI_API_KEY=...                          # an environment secret, never typed into a file in the repository
export SOMMELIER_EVAL_BLIND_SALT="$(cat /private/p7/salt)"   # the P7 salt, so holdout-test pairs with P7's keys
B=/private/v1plus-budget.json                      # the budget file: outside every checkout
O=/private/p8                                      # where the blind set's vectors are written
R=docs/sprints/sommelier-3-mega/results/p8-paid    # readable sets' vectors and summaries (committed)
```

1. **Estimate again** (nothing is sent): `pnpm --filter @cellr/sommelier-eval run plan --estimate`. It must print
   the table above. A different number means the code changed: stop and re-estimate before asking again.
2. **v6 and v7, three rounds**, v6 then v7 for the same set in each round (so drift of the model over the hours falls
   on both arms alike). For round `n` in 1 2 3, for each set:

   ```bash
   pnpm sommelier:eval --engine v1plus-ai --parts none  --set main --needs pairing,facts --max-usd 0.35 \
     --budget-file $B --total-usd 5 --vectors $R/main-v6-$n.json --json $R/main-v6-$n.summary.json
   pnpm sommelier:eval --engine v1plus-ai --parts check --set main --needs pairing,facts --max-usd 0.36 \
     --budget-file $B --total-usd 5 --vectors $R/main-v7-$n.json --json $R/main-v7-$n.summary.json \
     --review-sheet $R/main-v7-$n-removed.csv
   ```

   The same for `holdout-dev` (`--max-usd 0.12` / `0.13`, with `--review-sheet` on v7). For `holdout-test`
   (`--max-usd 0.12` each) the vectors go to `$O` (salted keys; the tool refuses a path inside a checkout) and **no**
   review sheet is written (the tool refuses one for a blind set).

3. **The menu set**: for round `n` in 1 2 3:

   ```bash
   pnpm --filter @cellr/sommelier-eval run menu:run --arm v1   --max-usd 0.07 --budget-file $B --total-usd 5 --out $R/menu-v1-$n.json
   pnpm --filter @cellr/sommelier-eval run menu:run --arm menu --max-usd 0.08 --budget-file $B --total-usd 5 --out $R/menu-menu-$n.json
   ```

   Then once each, if approved: `--arm check,menu --max-usd 0.08` and `--arm per-course --max-usd 0.14`.

4. **Compare** (free):

   ```bash
   pnpm --filter @cellr/sommelier-eval run compare        --a $R/main-v7-1.json,$R/main-v7-2.json,$R/main-v7-3.json --b $R/main-v6-1.json,$R/main-v6-2.json,$R/main-v6-3.json --json $R/main-compare.json
   pnpm --filter @cellr/sommelier-eval run compare-claims --a (same) --b (same) --json $R/main-claims.json
   ```

   The same for `holdout-dev` and, from `$O`, `holdout-test` (its comparison JSON holds totals only). The menu
   files carry their totals (`strict`, `byCards`, tokens) per arm.

5. **People**: the review sheets go to the reviewer (§5). Nothing about the check's false positives is claimed until
   they come back signed.

## 4. What each run produces

- **Per-scenario vectors** (`--vectors`): the existing measures (first bottle right, no poor bottle, useful answer,
  bottles offered, poor and good), and under `claims` (engines/v1plus-ai.ts): whether the model's own words and the
  words shown had a claim the check's rules flag (`rawClean`, `shownClean`), which codes (`unknown-ref`,
  `not-in-cellar`, `wrong-vintage`, `wrong-count`, `price`, `availability`, `action`), whether the cards were
  written as refs (v7), the check's outcome (kept / trimmed / replaced), how many sentences it removed, and the
  tokens in and out of every call. Numbers only; no words.
- **The flags are heuristics, not ground truth.** They are the check's own rules (`claims.ts`) used as an instrument:
  they miss what the rules cannot see and can flag a sentence that is fine. "v7 shows fewer flagged claims" is what
  they can say; "v7 is more often right" is not.
- **Review sheets** (readable sets, v7 only): every sentence the check removed or replaced, with the question, the
  cards, the wines named and the code; and a seeded sample of 100 kept sentences. Verdict columns are empty.
- **Summaries** (`--json`): totals, the served model, calls whose cost was not reported or exceeded their
  reservation.

## 5. Stop conditions

A run stops itself, sends nothing more, prints `INCOMPLETE RUN` and exits with code 3 when: the next call's
reservation does not fit the run's `--max-usd` or what is left of `--total-usd`; a call cost more than its
reservation (a dearer model or a price change); the model has no price; the budget file cannot be read, was not
written by this tool, or holds another total. **The whole plan stops** (no further command) when:

- any run is incomplete: it is not a measurement, `compare.ts` refuses its vectors; report and ask the owner;
- a summary's `servedModels` is not the planned `gpt-6-luna` family, or `callsWithUnknownCost` / `callsOverReservation`
  is above 0;
- the budget file's spend after step 2 is above $3: the estimate was wrong by far; stop and re-estimate;
- after each step the owner compares the budget file's `spentMicro` with the provider's usage page for the same
  hours; a mismatch stops the plan.

## 6. Menu costs (free estimate now, real tokens later)

`pnpm --filter @cellr/sommelier-eval run menu:cost` (`results/p8-menu-cost.json`). An ordinary question costs what
it did (`check`: +1.5 to +2.4% high estimate, other parts 0%): the general +10% proposal is unchanged. One menu
question with `menu` on, against the same menu asked as N separate V1 questions, 120-wine cellar:

| Courses | Menu, one call: tokens in / output cap / typical out | Menu high / typical | N V1 questions: calls / tokens in | V1 high / typical   | Menu as share of N questions (high / typical) | × one ordinary V1 answer (high / typical) |
| ------: | ---------------------------------------------------- | ------------------- | --------------------------------- | ------------------- | --------------------------------------------- | ----------------------------------------- |
|       3 | 6,032 / 1,110 / 315                                  | $0.00262 / $0.00091 | 3 / 16,991                        | $0.00695 / $0.00239 | 0.38 / 0.38                                   | 1.13 / 1.14                               |
|       5 | 6,065 / 1,250 / 405                                  | $0.00277 / $0.00096 | 5 / 28,324                        | $0.01158 / $0.00399 | 0.24 / 0.24                                   | 1.19 / 1.20                               |
|       8 | 6,093 / 1,460 / 540                                  | $0.00298 / $0.00103 | 8 / 45,313                        | $0.01853 / $0.00639 | 0.16 / 0.16                                   | 1.29 / 1.29                               |

Typical output assumed: 180 tokens for an ordinary answer, +45 per course for a menu (one entry: course number, a
6-character ref and a sentence of about 25 words, ~35 tokens, plus ~10 of JSON). The paid runs record the real
tokens per call.

**Proposed criterion (for the owner):** with `menu` on (with or without `check`), a menu question of N courses (2–8)
costs, on the high estimate and on real tokens, **at most 70% of the same menu asked as N separate V1 questions, and
at most (1.2 + 0.075 × N) times one ordinary V1 answer** (1.35× for 2 courses, 1.8× for 8). Free estimate, cellars of
25, 120 and 500 wines: at most 64% and 1.27× / 1.33× / 1.46× / 1.64× for 2 / 3 / 5 / 8 courses. A test
(`paid-plan.test.ts`) fails if the estimate ever exceeds it; after the paid runs the same check is made on the
recorded tokens (`menu-*.json`, `calls`).

## 7. What is committed, and what the owner must approve

**Committed after the runs:** the vectors and summaries of `main` and `holdout-dev` (keyed by scenario id), the
blind set's vectors with salted keys (copied in as P7's were; the salt never), the menu result files, the comparison
JSONs, and the review sheets. The eval cellar and its questions are synthetic, so nothing holds a person's data. No
prompt is recorded or committed. **Never committed:** the budget file, the key, the salt.

**The owner's decision, to answer yes or no:**

> Do you approve spending at most $5.00 in total on OpenAI calls to `gpt-6-luna` (one budget file with
> `--total-usd 5`; worst case reserved $3.86, high estimate $2.35) to run the P8 measurement plan in
> `docs/sprints/sommelier-3-mega/P8_MEASUREMENT_PLAN.md`, steps 1 to 4, including the two optional menu runs?

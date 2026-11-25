# Sommelier V1+ — P8: what the planned measurement can and cannot show (power analysis)

2026-11-24. Free and reproducible: `pnpm --filter @cellr/sommelier-eval run power --json <file>` (seeded simulation,
2,000 comparisons per setting; every number below is in `results/p8-power.json`; `power.test.ts` recomputes two of
them from their seeds). **No model was called.** This says how precise the paid comparison of v7 against v6 can be,
before it is run; it says nothing about its result.

## 1. Method and assumptions

- **The comparison** is the one `compare.ts` makes: per scenario the difference v7 − v6 (runs averaged first),
  the mean over scenarios, and a 95% interval from resampling **dishes** (a dish asked twice is one dish). The
  simulation uses the cluster-robust standard error of that mean (half-width 1.96 × SE). On the committed P7
  comparisons it agrees with the recorded bootstrap within 0.012 (e.g. main, first bottle: ±10.6 against ±10.4
  points; holdout-dev: ±23.0 against ±21.9).
- **The sets** are the planned ones, with their real dish structure: main 124 scenarios of 100 dishes, holdout-dev
  45 of 22, holdout-test 43 of 22 (from the P7 vectors); the menu set 18 menus (the cluster) with 49 courses
  scored; the human holdout as 40 dishes (series 1) and 100 dishes, each asked in English and in Dutch.
- **Baselines** (V1 with AI, closeout): first bottle right 78%, no poor bottle 99%, useful answer 92%.
- **Unknown, so varied:** the share of scenarios whose outcome differs between v6 and v7 (discordance: first 8 /
  15 / 25%, no poor 0.5 / 1 / 2%, useful 4 / 8 / 15%); how strongly a dish's scenarios share their outcome
  (within-dish correlation 0 / 0.3 / 0.6); the model's run-to-run noise (a run's outcome drawn afresh with chance 0 or
  10%); 1 or 3 runs per arm. The **central assumption** used in the headline: discordance 15% / 1% / 8%,
  correlation 0.3, 3 runs, 10% run noise.
- **The free vectors are only a guide.** They come from the engines **without a model** and their labels were
  **written by an AI**. Their within-dish correlation (first bottle 0.14–0.43, useful answer −0.07 to 0.47, no poor
  bottle −0.07 to 0.64) is why 0.3 is central and 0.6 is in the range. They say nothing about how often a model's
  answers differ between v6 and v7.
- **"A true −5 regression"**: v7 is 5 points worse than v6. "Detected" means the 95% interval lies entirely below 0.
  "Passes the margin" means the interval's lower bound is above −5 points, the gate's proposed non-inferiority rule.
  A 5-point drop needs at least 5% of scenarios to differ, so for no poor bottle (99%) the discordance is raised to 5%
  in that case. The minimum detectable difference is the smallest drop, in whole points, that is detected in at least
  80% of simulated comparisons (two-sided 5%).

## 2. Headline (central assumption)

| Set (dishes)         | Measure            | ± half-width (points) | Minimum detectable (80% power) | Chance a true −5 is NOT detected | Chance a truly equal V1+ passes the −5 margin |
| -------------------- | ------------------ | --------------------: | -----------------------------: | -------------------------------: | --------------------------------------------: |
| main (100)           | first bottle right |                   6.7 |                             10 |                             0.69 |                                          0.32 |
|                      | no poor bottle     |                   1.5 |                              5 |                             0.12 |                                          0.99 |
|                      | useful answer      |                   4.8 |                              7 |                             0.46 |                                          0.57 |
| holdout-dev (22)     | first bottle right |                  11.2 |                             15 |                             0.85 |                                          0.16 |
|                      | no poor bottle     |                   2.0 |                             12 |                             0.78 |                                          0.84 |
|                      | useful answer      |                   7.8 |                             14 |                             0.80 |                                          0.31 |
| holdout-test (22)    | first bottle right |                  11.5 |                             15 |                             0.86 |                                          0.15 |
|                      | no poor bottle     |                   2.0 |                             13 |                             0.80 |                                          0.86 |
|                      | useful answer      |                   8.1 |                             14 |                             0.81 |                                          0.30 |
| menu set (18 menus)  | first bottle right |                  11.1 |                             15 |                             0.84 |                                          0.18 |
|                      | no poor bottle     |                   1.9 |                             11 |                             0.74 |                                          0.82 |
|                      | useful answer      |                   7.7 |                             13 |                             0.79 |                                          0.32 |
| human, series 1 (40) | first bottle right |                   8.5 |                             12 |                             0.79 |                                          0.23 |
|                      | no poor bottle     |                   1.7 |                              7 |                             0.39 |                                          0.95 |
|                      | useful answer      |                   6.1 |                              9 |                             0.65 |                                          0.39 |
| human, 100 dishes    | first bottle right |                   5.4 |                              8 |                             0.55 |                                          0.45 |
|                      | no poor bottle     |                   1.3 |                              3 |                             0.01 |                                          1.00 |
|                      | useful answer      |                   3.9 |                              6 |                             0.28 |                                          0.72 |

Over the whole range of assumptions, first bottle right: main ±4.9 to ±9.6 points (minimum detectable 7–14),
holdout-dev and holdout-test ±7.7 to ±17.4 (13–23), human 40 dishes ±6.1 to ±12.7 (8–19), human 100 dishes ±3.9 to
±8.1 (6–12). The chance that a truly equal V1+ passes the −5 margin on first bottle ranges 0.19–0.54 on main,
0.10–0.28 on each holdout, 0.13–0.41 at 40 human dishes and 0.24–0.70 at 100.

## 3. Runs: what a second and third run buy

Runs are averaged within a scenario before dishes are resampled, so extra runs reduce only the model's run-to-run
noise, never the variation between dishes. Main, first bottle, central discordance and correlation: without run noise
the half-width is 6.9 points whatever the number of runs; with 10% run noise it is 7.6 with one run and 6.7 with
three. The minimum detectable difference moves from 12 to 10 points. **More dishes buy precision; more runs only
remove noise.** Cutting from three runs to two costs little; cutting a set loses its evidence entirely.

## 4. "No invented fact in n answers" (rule of three)

Zero events in n independent answers bound the true rate at 3/n (upper 95%):

| Answers                                                      |        n | Upper 95% bound |
| ------------------------------------------------------------ | -------: | --------------: |
| main, v7, one run                                            |      131 |            2.3% |
| holdout-dev / holdout-test, one run                          |  45 / 43 |     6.7% / 7.0% |
| all three sets, one run                                      |      219 |            1.4% |
| all three sets, three runs, **if** the runs were independent |      657 |            0.5% |
| menu set, `menu` on, one run / three runs (if independent)   |  21 / 63 |      14% / 4.8% |
| human holdout, series 1 (80 scenarios) / 100 dishes (200)    | 80 / 200 |     3.8% / 1.5% |

The runs ask the same questions again, so they are **not** independent: the honest n is the number of distinct
questions (219 on the three sets, 1.4%). And it is the check's rules that count an "invented fact": a heuristic, not
ground truth (`claims.ts`); zero flags is not proof of zero errors.

## 5. What each sample size can and cannot support (plain words)

- **The −5-point non-inferiority gate is hard to pass on any single set, even when V1+ is truly as good as V1.** At
  the central assumption a truly equal V1+ passes it on first bottle with a chance of 0.32 on main, 0.15–0.16 on
  each holdout, 0.23 at 40 human dishes and 0.45 at 100. A failed gate on these sets does not, on its own, mean V1+
  is worse. (Whether to pool sets, or to accept another margin, is the owner's decision; these numbers only show the
  trade-off.)
- **main (100 dishes, AI-written labels, the set the engines were developed on):** can catch a regression of about
  10 points in first bottle right (7 in useful answer, 5 in no poor bottle); a 5-point drop in first bottle is missed
  about 7 times in 10.
- **holdout-dev and holdout-test (22 dishes each):** each can only catch large regressions, about 15 points or more
  in first bottle right (12–14 in the others). A 5-point drop is missed 8 to 9 times in 10. holdout-dev is no longer
  unseen.
- **The menu set (18 menus):** can only catch large differences, about 13–15 points; it is a check that menus are
  planned course by course, not a precise quality measure. Its labels are AI-written.
- **Human holdout, series 1 alone (40 dishes): it cannot show non-inferiority at −5 points.** It can only catch a
  regression larger than about 12 points in first bottle right (9 in useful answer, 7 in no poor bottle); a 5-point
  drop in first bottle is missed about 8 times in 10. Its reports are marked provisional for this reason.
- **Human holdout, 100 dishes:** the interval is about a third narrower than at 40 dishes (±5.4 against ±8.5
  points): it catches a regression of about 8 points in
  first bottle right (6 in useful, 3 in no poor bottle) and misses a 5-point drop in first bottle about half the time.
  It is the first set that is both written by people and large enough to see a moderate regression; it is still not
  large enough to show non-inferiority at −5 points on first bottle with high probability at the central assumption.
- **Three runs instead of one** narrow the interval by about a tenth when the model's answers vary from run to run,
  and not at all otherwise.

No result of the paid runs may be described more strongly than these numbers allow.

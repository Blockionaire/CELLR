# The hybrid sommelier against V1 with AI (S10)

S10, 2026-11-20. The question the owner set: **does a hybrid sommelier give better and safer advice than V1 with
AI on dishes it has not seen?** If that cannot be shown, Sommelier 3.0 is not to be switched on.

This page holds the design, everything measured without a paid call, and the paid run that still needs the
owner's approval (§6). **No paid model call was made in S10.**

## 1. The four variants, on the same scenarios

| Variant | What runs                                                                                                                    | Model calls                                         | Benchmark engine   |
| ------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------ |
| A       | V1 with AI, as Production runs it (`gpt-6-luna`, reasoning none)                                                             | one per question                                    | `v1-ai`            |
| B       | Sommelier 3.0, deterministic, with the S10 conservative selection                                                            | none                                                | `v3-app`           |
| C       | B, and a model reads the dishes the router sends on; the engines still decide                                                | for routed dishes only (about 2 in 3 unseen dishes) | `v3-hybrid`        |
| D       | C, and in a close call a model may reorder or leave out the engine's own picks (an experiment, not an approved architecture) | C, plus one per close call                          | `v3-hybrid-review` |
| (bound) | B with a perfect reader for routed dishes: the reference card's class and scales. Not a product: an upper bound for C        | none                                                | `v3-oracle`        |

Same scorer (`score.ts`, unchanged), same labels, same cellars, same sets: `main` (developed against: flatters 3.0),
`holdout-dev` (read during S9 and S10), `holdout-test` (blind: totals only). The human-written holdout does not
exist yet (§5).

## 2. What is measured

Per variant and set: first bottle right; poor bottles offered (per scenario and **per bottle**, so offering fewer
is not rewarded by itself); quality at place 1, 2 and 3; a **useful answer** (something to open whose first bottle
is at least "ok" and none of whose bottles is poor, or nothing when nothing suits); "nothing suits" said honestly;
the dish read right (B, C, D, bound; V1 states no dish); cost and time per answer; for the model variants, the
spread over five runs and a paired bootstrap of the difference with A (`quality.ts`).

## 3. Measured without a paid call

**Does the parser know when it misread a dish?** (`self-knowledge.ts`; the router was designed on main and
holdout-dev, then applied unchanged to the blind half.)

| Set                      | Readings wrong | Router sends on | Of the wrong, caught | Wrong and not caught ("confident but wrong") |
| ------------------------ | -------------- | --------------- | -------------------- | -------------------------------------------- |
| main (216 questions)     | 16 (7%)        | 48%             | 11 (69%)             | 5 (2%), 1 with the wrong class               |
| holdout-dev (45)         | 12 (27%)       | 67%             | 10 (83%)             | 2 (4%), both with the wrong class            |
| holdout-test, blind (43) | 12 (28%)       | 72%             | 10 (83%)             | 2 (5%), 1 with the wrong class               |

The confident-but-wrong readings are template mistakes (a known dish whose template is off, e.g. pho, Korean
barbecue, salade niçoise). A router cannot see them; the knowledge has to be corrected.

**The variants that cost nothing, against A as measured in S9** (A: mean of five runs; B and the bound: one run,
they are deterministic):

| Measure                            | Set                      | A, V1 with AI | B, 3.0 (S10) | Bound: perfect dish reader |
| ---------------------------------- | ------------------------ | ------------- | ------------ | -------------------------- |
| First bottle right                 | main (124)               | 69%           | **78%**      | 76%                        |
|                                    | holdout-dev (45)         | **85%**       | 64%          | 64%                        |
|                                    | holdout-test, blind (43) | **73%**       | 63%          | 63%                        |
| No poor bottle offered             | main (117)               | **93%**       | 82%          | 81%                        |
|                                    | holdout-dev (40)         | **99%**       | 88%          | 82%                        |
|                                    | holdout-test, blind (34) | **97%**       | 85%          | 91%                        |
| Outcome matches the reference      | holdout-test, blind (43) | 71%           | 74%          | 74%                        |
| "Nothing suits" when nothing suits | holdout-test, blind (9)  | 69%           | **89%**      | 78%                        |
| Dish read right                    | holdout-test, blind (43) | —             | 72%          | 95%                        |

B's figures include the S10 conservative selection (`progress/S10.md` §4); without it B offered 14 poor bottles
of 69 on the blind half, now 7 of 50.

**What this already shows.**

1. **Reading the dish right is not what B lacks most.** With a perfect reading of every dish the router sends on
   (95% read right instead of 72%), the first bottle on unseen dishes does not improve at all (63% and 64%, the
   same scenarios). The bound gives the class and the scales, not the ingredients and tags a model would give, so
   C could still do a little better than the bound; but the gap to A (10 to 21 points on the first bottle) is in
   the pairing judgement, not in the reading.
2. So **C is not expected to beat A** on the first bottle or on poor bottles. Its value is safety: a misread dish
   no longer gets a confident answer.
3. **D is the variant that could**: a model's judgement on the engine's own candidates, where the engine is least
   sure. Whether it does, and whether it stays as safe as the engine (it cannot add a wine), needs the paid run.

## 4. Cost and time (estimated, nothing sent)

`pnpm sommelier:eval --engine <variant> --estimate --set <set>`. High estimates: the full output allowance and one
repair per call, the schema counted as input (the dish schema lists the knowledge's ids: about 3,100 tokens, much
of it served from the provider's cache after the first call). In S9 the real cost of A was about a tenth of its
estimate.

| Variant | Calls per pass (main / dev / blind) | Estimate per pass, all three sets | Time per answer                  |
| ------- | ----------------------------------- | --------------------------------- | -------------------------------- |
| A       | 131 / 45 / 43                       | $0.33                             | 1.5–2.5 s (measured, S9)         |
| B       | 0                                   | $0                                | under 5 ms                       |
| C       | 118 / 30 / 31                       | $0.26                             | B, plus one call when routed     |
| D       | 218 / 56 / 53                       | $0.31                             | C, plus one call in a close call |

In the app, with the switch on: C's dish readings are shared through the cache (`DISH_CACHE.md`), so a dish costs
once per server instance, not once per question.

## 5. What is missing for a final verdict, whoever pays

- **A human-written holdout of at least 100 dishes** (`scripts/sommelier-eval/human-holdout/README.md`). The
  frame is built and blind; the dishes are not written. Until they are, every result here is **provisional**: the
  blind half is 43 scenarios by one AI author.
- **A wine professional's judgement of 30 hard pairs** (`EXPERT_REVIEW.md`, blind; key apart). Until then no
  quality figure counts as validated.

## 6. The paid run, for the owner's approval

**Asked:** at most **$2** of model calls, for the S10 comparison only, on the synthetic benchmark data only, with
the key that is already stored in the environment's secret store (never in the chat, a file, a variable or a log).

| Run                                              | Passes | Hard stop per pass (main / dev / blind) | Sum of the stops |
| ------------------------------------------------ | ------ | --------------------------------------- | ---------------- |
| A, `v1-ai` (again, now with per-bottle measures) | 3      | $0.05 / $0.02 / $0.02                   | $0.27            |
| C, `v3-hybrid`                                   | 5      | $0.06 / $0.02 / $0.02                   | $0.50            |
| D, `v3-hybrid-review`                            | 5      | $0.07 / $0.025 / $0.025                 | $0.60            |

The stops add up to **$1.37**, under the $2 asked; the rest is a margin that is not spent without a new question.
The high estimates are above the stops; the real cost in S9 was about a tenth of the estimate, so the expected
cost is about $0.30. If a stop is reached, that invocation ends, its results are reported as incomplete, and
nothing is retried. Labels and scorer stay unchanged; the blind half is reported in totals.

```bash
SOMMELIER_EVAL_PAID=owner-approved OPENAI_API_KEY=proxy-injected NODE_USE_ENV_PROXY=1 pnpm sommelier:eval --engine v3-hybrid-review --set holdout-test --max-usd 0.07 --json out.json
```

(`proxy-injected` is a placeholder: the environment's proxy puts the real key in the request.)

**The decision rule, fixed before the run.** Activation is advised only if, on the unseen dishes (holdout-dev and
the blind half together, 88 scenarios), the best hybrid variant is at least as good as A on the first bottle and
better or equal on poor bottles offered and on "nothing suits", with the paired bootstrap's 95% interval of the
first-bottle difference not below zero; and the blind half alone does not go the other way. Otherwise: no
activation, as the owner asked.

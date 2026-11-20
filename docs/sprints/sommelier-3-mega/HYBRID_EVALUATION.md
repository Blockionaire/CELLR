# The hybrid sommelier against V1 with AI (S10)

> **Run on 2026-11-20 with the owner's approval ($0.26 of $2). Result: no hybrid variant is shown to be
> better than, or as reliable as, V1 with AI on unseen dishes. V1 with AI stays the default (§7, §8).**

S10, 2026-11-20. The question the owner set: **does a hybrid sommelier give better and safer advice than V1 with
AI on dishes it has not seen?** If that cannot be shown, Sommelier 3.0 is not to be switched on.

This page holds the design, everything measured without a paid call, and the paid run that still needs the
owner's approval (§6). The paid run was made after that approval; its results are in §7.

## 1. The four variants, on the same scenarios

| Variant | What runs                                                                                                                                                    | Model calls                                         | Benchmark engine   |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- | ------------------ |
| A       | V1 with AI, as Production runs it (`gpt-6-luna`, reasoning none)                                                                                             | one per question                                    | `v1-ai`            |
| B       | Sommelier 3.0, deterministic, with the S10 conservative selection                                                                                            | none                                                | `v3-app`           |
| C       | B, and a model reads the dishes the router sends on; the engines still decide                                                                                | for routed dishes only (about 2 in 3 unseen dishes) | `v3-hybrid`        |
| D       | C, and in a close call a model may reorder or leave out the engine's own picks (an experiment, not an approved architecture)                                 | C, plus one per close call                          | `v3-hybrid-review` |
| (check) | B with the reference card's class and scales handed in for routed dishes. Not a product, and not an upper bound: the card has no ingredients, sauces or tags | none                                                | `v3-oracle`        |

Same scorer (`score.ts`, unchanged), same labels, same cellars, same sets: `main` (developed against: flatters 3.0),
`holdout-dev` (read during S9 and S10), `holdout-test` (blind: totals only). The human-written holdout does not
exist yet (§5).

## 2. What is measured

Per variant and set: first bottle right; poor bottles offered, per scenario and **per bottle**, beside the **good
bottles offered** (fewer bottles means fewer poor ones and fewer good ones: both are reported); quality at place
1, 2 and 3; a **useful answer** (something to open none of whose bottles is poor, or nothing when nothing suits;
this one favours offering fewer, so it is read beside the good bottles); "nothing suits" said honestly;
the dish read right (B, C, D and the check; V1 states no dish); cost and time per answer; for the model variants, the
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

**The variants that cost nothing, against A as measured in S9** (A: mean of five runs; B and the check: one
run, they are deterministic). The check hands the engines the reference card's class and scales for the dishes
the router sends on; it is **not an upper bound** for C (the card has no ingredients, sauces or tags, and the
engines keep the parser's own parts), as an independent review pointed out.

| Measure                            | Set                      | A, V1 with AI | B, 3.0 (S10) | Check: right class and scales |
| ---------------------------------- | ------------------------ | ------------- | ------------ | ----------------------------- |
| First bottle right                 | main (168)               | —             | 140 (83%)    | 139 (83%)                     |
|                                    | main, 124 A can attempt  | 69%           | **78%**      | —                             |
|                                    | holdout-dev (45)         | **85%**       | 64%          | 62%                           |
|                                    | holdout-test, blind (43) | **73%**       | 63%          | 65%                           |
| No poor bottle offered             | main, 117 A can attempt  | **93%**       | 82%          | —                             |
|                                    | holdout-dev (40)         | **99%**       | 88%          | 82%                           |
|                                    | holdout-test, blind (34) | **97%**       | 85%          | 91%                           |
| Outcome matches the reference      | holdout-test, blind (43) | 71%           | 74%          | 77%                           |
| "Nothing suits" when nothing suits | holdout-test, blind (9)  | 69%           | **89%**      | 89%                           |
| Dish read right                    | holdout-test, blind (43) | —             | 72%          | 86%                           |

B's figures include the S10 conservative selection (`progress/S10.md` §4). On the blind half it took B from 69
bottles offered (14 poor, 37 good) to 50 (7 poor, 32 good): 7 poor bottles fewer, and 5 good ones fewer too.

**What this shows, and what it does not.**

1. **Handing the engines the right class and scales of a dish changes the first bottle very little** (holdout-dev
   64% → 62%, blind 63% → 65%) while "dish read right" rises to 86–93%. The gap to A on the first bottle is 10 to
   21 points.
2. It does **not** show that a better reading cannot help: a model's reading also gives the ingredients, sauces and
   tags (which carry the dish's classics), and that is untested until the paid run of C. It does show that the
   class and the weight of a dish, the part the food check measures, are not where most of the gap is.
3. So **C is not expected to close the gap to A by itself**. Its certain value is safety: a misread dish no longer
   gets a confident answer.
4. **D is the variant that could**: a model's judgement on the engine's own candidates, where the engine is least
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
| C       | 88 / 30 / 31                        | $0.21                             | B, plus one call when routed     |
| D       | 188 / 56 / 53                       | $0.27                             | C, plus one call in a close call |

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

## 7. Results of the paid run (2026-11-20)

**How it was run.** Approved by the owner: at most $2, and $1.37 for the planned runs. As fixed in §6: A three
passes, C and D five passes, on main (the 133 scenarios A can attempt), holdout-dev and the blind half, each
invocation with its own hard stop. Production's configuration (`gpt-6-luna`, reasoning none). The key was used from
the environment's secret store; it was never in a file, a variable or a log. Only the synthetic benchmark was
sent. Labels, scorer and sets were unchanged. **Spent: $0.26** (A $0.07, C $0.06, D $0.13); no stop was reached;
2,687 model calls, 2 of them failed (D), none refused; every call reported its cost. Two measures were added before
the run and committed first: "a good wine in the cellar, none offered", and a local log of the dish phrases sent
on the readable sets. Results: `results/s10-paid-comparison.json` (aggregates only).

### 7.1 Unseen dishes (holdout-dev and the blind half, 88 scenarios), against A

Mean over runs; the interval is the 95% interval of the difference (Newcombe, unpaired, on the pooled counts).

| Measure                                 | A, V1 with AI | B, 3.0 | C, + dish reading | D, + second opinion | Best hybrid − A      |
| --------------------------------------- | ------------- | ------ | ----------------- | ------------------- | -------------------- |
| First bottle right (88)                 | **78%**       | 64%    | 63%               | 69%                 | D: −10 [−23, +3]     |
| No poor bottle offered (74)             | **99%**       | 86%    | 86%               | 86%                 | −12 [−22, −4]        |
| Useful answer (88)                      | **92%**       | 76%    | 76%               | 76%                 | −16 [−27, −5]        |
| "Nothing suits" when nothing suits (14) | 79%           | 86%    | 86%               | 86%                 | +7 [−22, +35]        |
| Outcome matches the reference (88)      | 76%           | 76%    | 79%               | 78%                 | C: +2 [−10, +15]     |
| Poor bottles, of all offered            | **5%**        | 11%    | 11%               | 12%                 | +6 [−3, +13] (worse) |
| Good bottles, of all offered            | 64%           | 64%    | 65%               | 65%                 | +1 [−12, +15]        |
| Bottles per answer                      | 0.90          | 1.37   | 1.35              | 1.28                |                      |

Paired per scenario on holdout-dev (45; the blind half is never compared scenario by scenario), D − A: first bottle
−16 points [−29, −4]; no poor bottle −15 [−25, −6]; first bottle labelled good −7 [−18, +3].

### 7.2 By set, and by place

| Set (scenarios)          | Measure                | A                | B         | C           | D           |
| ------------------------ | ---------------------- | ---------------- | --------- | ----------- | ----------- |
| main (133, developed on) | First bottle right     | 74% (72–77)      | 78%       | 83%         | 82% (82–83) |
|                          | No poor bottle offered | **96%**          | 82%       | 85%         | 85%         |
| holdout-dev (45)         | First bottle right     | **84%** (78–91)  | 64%       | 60% (58–60) | 68% (62–73) |
|                          | No poor bottle offered | **99%**          | 88%       | 83%         | 82%         |
| holdout-test, blind (43) | First bottle right     | **72%** (70–77)  | 63%       | 67% (65–70) | 70%         |
|                          | No poor bottle offered | **99%**          | 85%       | 89%         | 91%         |
| unseen (88)              | Place 1 good / poor    | 65% / **5%**     | 60% / 16% | 61% / 16%   | 68% / 14%   |
| unseen (88)              | Place 2 poor           | — (A offers one) | 3%        | 4%          | 6%          |

(min–max over runs in brackets where runs differ.) A offers about one bottle per answer; the engines one to two.
On the main set, the one the engines were developed on, C and D are ahead of A on the first bottle; on unseen dishes
they are not.

### 7.3 Where the errors come from, and what D cannot repair

On holdout-dev, of C's answers whose first bottle was not labelled good: in **56%** none of C's picks was good at
all (the right wine was not among the candidates: a second opinion that can only reorder or drop cannot repair
these), in 44% a good wine was among the picks but not first. D repaired most of the second kind (from 17% to 4% of
answers) and none of the first (21% → 25%). Over all unseen scenarios in which the cellar held a wine labelled good,
no good wine was offered at all in: A 25%, B 25%, C 21%, D 24%.

So the errors that remain are mostly **candidate errors**: the engine's own scoring does not put the right wine
among its picks for an unfamiliar dish. That is the pairing knowledge, not the reading of the dish and not the
order of the picks.

### 7.4 Cost, time and privacy in practice

| Variant | Calls per answer (unseen) | Cost per answer | Time per answer (p50 / p95)                   | Dish readings                                  |
| ------- | ------------------------- | --------------- | --------------------------------------------- | ---------------------------------------------- |
| A       | 1                         | about $0.0001   | 1.6 s / 2.3 s                                 | —                                              |
| B       | 0                         | $0              | < 5 ms                                        | —                                              |
| C       | 0.67                      | about $0.00007  | 1.4 s / 1.8 s (no call when not routed: 3 ms) | 625 by the model, 165 from the store, 0 failed |
| D       | 1.3                       | about $0.00012  | 2.0 s / 2.8 s                                 | 623, 165, 2 failed                             |

All within the bounds set: every model wait under the 10 s cap (worst p95 2.9 s), cost per answer within the
estimate (the estimate was 5–10 times high). **Privacy:** 1,270 phrases were sent on the readable sets, 95 different
ones; none held a digit, an "@", or any of the names in the benchmark's social scenarios; no question naming a
friend was sent. Five phrases held words around the dish that are not about it ("oven too hot and thinks simple
because football in and nobody wants", "… a good", "… all"): nothing personal, but the "next to the food" window is
wider than it needs to be.

### 7.5 What this shows, and what it does not

- **No hybrid variant is shown to be better than, or as reliable as, V1 with AI on unseen dishes.** On safety
  (poor bottles offered, useful answers) all three engine variants are clearly behind (−12 and −16 points, both
  intervals below zero). On the first bottle, B and C are behind (−15 [−28, −1]); D is closest (−10 [−23, +3]):
  not shown worse on the pooled 88, but behind on the paired holdout-dev comparison (−16 [−29, −4]) and not ahead
  anywhere.
- **The decision rule of §6 is not met**, for any variant: the advice is no activation.
- What the engines do better: "nothing suits" when nothing suits (86% against 79%; too few scenarios to call), the
  dish read right, every answer grounded in the cellar, no cost and instant answers for B. On the main set, which
  they were developed on, C and D beat A on the first bottle: that gain does not carry to unseen dishes.
- C adds little over B on unseen dishes; D adds a few points on the first bottle (it reorders well) and nothing on
  safety. Most remaining errors are candidate errors (§7.3), which neither can repair.
- **Limits.** 88 unseen scenarios by one AI author; labels not reviewed by a wine professional; one model
  configuration; A run three times. These numbers are provisional until the human holdout and the expert review
  exist.

## 8. The recommended production architecture, and the next step

**Now: keep V1 with AI as the sommelier everyone gets.** It is the safest of the four on dishes nobody tuned for,
and at about $0.0001 a question it is cheap. Sommelier 3.0's switches stay off.

**Keep from 3.0 what is measurably better, behind V1, at no extra model cost:** a deterministic safety net on V1's
answer. The engine already scores every wine of the cellar for the dish; it can (1) refuse to show a bottle V1
picks that the engine judges a hard clash, and (2) say "nothing here really suits" when the engine finds nothing
and V1 forces a bottle. That is variant **E**: V1 decides, the engine only vetoes. It costs no extra call, keeps
V1's first-bottle quality, and adds the engine's one clear strength (honesty about "nothing suits"). It is not
built and not measured: it is the proposed S11.

**S11 (proposed), in order:**

1. Build E behind a new named-only switch and measure it on the same sets with the same scorer: A against E, three
   runs each, with A's existing results reused where possible. Expected cost under $0.15.
2. Write the human holdout (100+ dishes, people) and get the expert review of the 30 pairs **before** any further
   change is judged on quality. Every number here is provisional until then.
3. Only then, if E helps: decide on activation for E. Do not activate B, C or D.
4. For 3.0's own engine, the fix is the pairing knowledge for unfamiliar dishes (the candidate errors of §7.3),
   reviewed by a wine professional, measured on the human holdout. Not more routing, not a larger dish list, and no
   tuning on the blind half.

What is built in S10 stays behind its switches and does not need to be removed: the dish reader and the second
opinion are the tools E and later work can use.

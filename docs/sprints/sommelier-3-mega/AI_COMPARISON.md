# Sommelier V1 with AI against Sommelier 3.0 — the comparison

S9, 2026-11-20. **Run on 2026-11-20 with the owner's approval** (at most $2; $0.10 was spent). The results are in
§8, what they mean in §9. §1–§7 are the design as it was written before the run; where the run differed, §8 says
so.

## 1. The question

Every number so far compares 3.0 with V1 **without** AI (13 / 246), which is not what people use: with a key
configured, V1 asks a model. Whether 3.0 is better than that is unknown (R-04). This comparison answers it on the
same scenarios, with the same scorer.

## 2. What is compared

| Arm        | What runs                                                                                                                            | Model                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `v1-ai`    | The app's own `createSommelierService` with the app's own provider, prompt, schema and answer check (`engines/v1-ai.ts`); no engines | the configured advice model (`AI_MODEL_ADVICE`, else `AI_MODEL_CHAT`; default gpt-6-luna), asked as the app asks it |
| `v3-app`   | The same service with the engines on                                                                                                 | none                                                                                                                |
| `v1-basic` | V1 with no key (the old baseline)                                                                                                    | none                                                                                                                |

A fourth arm, 3.0 worded by a model, does not exist: it was not built.

The owner should confirm that the model and reasoning effort of the run are the ones Production uses; the run
records the model the provider says answered.

## 3. The data

Only what the benchmark already holds: made-up cellars (`fixtures.ts`, `wines.ts`) and questions written for the
benchmark. **No production data, no person's conversation, no account identifier** leaves this machine; what is
sent is the app's sommelier prompt, a made-up cellar and a made-up question. Friends, live offers and experiences
are not sent: V1 cannot attempt those scenarios, and the harness does not ask the model for them.

## 4. The measurement

- **Sets.** `holdout-test` (43 scenarios; neither engine was developed against it: the fair set) is the headline.
  `main` (133 of 246 that V1 can attempt) and `holdout-dev` (45) are reported beside it. 3.0 was tuned on `main`,
  so `main` flatters 3.0.
- **Scorer.** `score.ts`, unchanged, for both arms: verdict, first bottle, no poor bottle offered, saying nothing
  when nothing suits, invented bottles, latency, cost.
- **Not comparable.** "Dish understood": V1 states no dish, so that measure is 3.0's only. Wording: 3.0 writes
  fixed sentences; a model writes better prose. The scorer does not see prose.
- **Repeats.** A model does not answer the same twice. Three runs per set; the mean and the range are reported,
  and a difference smaller than the range is called a tie.
- **Order of work.** The scenarios, labels and scorer are frozen in git before the first call
  (`benchmark.test.ts` pins them). Nothing in 3.0 is changed between the runs and the report.
- **Optional, the owner's choice.** Thirty answers of each arm, shown blind to a person who knows wine, for the
  part the scorer cannot see. Not a substitute for R-01.

## 5. What it will and will not show

It will show which arm more often picks a good first bottle, offers a poor one, or says honestly that nothing
suits, and what each costs per answer. It will not show which answer reads better, and it inherits the labels'
weaknesses ([`progress/S9.md`](progress/S9.md) §2.4): a model that reasons like a sommelier is marked down where
a label is debatable, exactly as 3.0 is.

## 6. Cost and approval

Measured with `--estimate` (the app's own prompts, counted; nothing sent), priced high from the app's price list
(the full output allowance and one repair per call):

| Set            | Calls per run | Estimate per run |
| -------------- | ------------- | ---------------- |
| `holdout-test` | 43            | $0.06            |
| `holdout-dev`  | 45            | $0.07            |
| `main`         | 131           | $0.20            |

Three runs of all three: at most about **$1.00**. The harness stops at `--max-usd` (default 2, never above 25).

To run it, the owner provides a key in a test environment and says yes; then:

```bash
SOMMELIER_EVAL_PAID=owner-approved OPENAI_API_KEY=… pnpm sommelier:eval --engine v1-ai --set holdout-test --max-usd 2 --json out.json
```

Without both values the command refuses and sends nothing (`paid.test.ts`). The agent does not set either.

## 7. Reproduce the estimate

```bash
pnpm sommelier:eval --engine v1-ai --estimate --set holdout-test
```

## 8. Results (2026-11-20)

**How it was run.** The owner approved at most $2. Production's configuration was checked first, read-only: its
usage records show `gpt-6-luna` for every sommelier call of the last 30 days (42 calls, 85 output tokens on
average, which is what reasoning "none" produces; the reasoning setting itself is a deployment variable that could
not be read, so "none" is an inference from that and from the code's default). The run used the same: `gpt-6-luna`,
reasoning none, the app's own prompt and answer check. The key came from the environment's secret store through
the network proxy: it was never in the chat, the repository, a variable or a log, and the agent never saw it.
Five runs of each set instead of three, because a call cost a fifth of the estimate. 1,095 calls, **$0.10 in
total**, every call with a cost the provider reported; each invocation had its own hard stop and their sum was
$1.70. Only made-up cellars and benchmark questions were sent. Labels and scorer unchanged. Recorded in
`results/s9-ai-comparison.json` (the blind set in totals only).

**"Scenarios passed" is not a fair count here.** A scenario passes only when every check passes, and one check is
"the dish was understood". V1 never states a dish, so it fails that check wherever the old keyword reader misses
(52 of 133 on the main set, 32 of 45 on the first holdout half), whatever the model answered. On that count 3.0
"wins" 83 to 51 on the main set and 19 to 11 on the blind set; most of that margin is the dish check, not the
advice. The fair comparisons are the measures below, and the pass count without the dish check.

| Measure (V1 with AI: mean of five runs, with the range) | Main set, 133 both can attempt        | Holdout, 88 unseen dishes                 | of which blind, 43               |
| ------------------------------------------------------- | ------------------------------------- | ----------------------------------------- | -------------------------------- |
| The outcome matches the reference                       | AI 85% (83–87) · **3.0 92%**          | AI 74% · 3.0 76%                          | AI 71% (70–74) · 3.0 74%         |
| The first bottle is labelled right                      | AI 69% (65–72) · **3.0 78%**          | **AI 79%** · 3.0 64%                      | **AI 73%** (72–77) · 3.0 63%     |
| No offered bottle is a poor match                       | **AI 93%** (91–95) · 3.0 77%          | **AI 98%** · 3.0 82%                      | **AI 97%** (94–100) · 3.0 79%    |
| Says "nothing" when nothing suits                       | AI 6.6 of 7 · 3.0 7 of 7              | AI 10.2 of 14 · 3.0 12 of 14              | AI 6.2 of 9 · 3.0 8 of 9         |
| No invented wine                                        | both 100%                             | both 100%                                 | both 100%                        |
| Passed, leaving the dish check out                      | AI 82 (77–85) · 3.0 87                | first half only: AI 26.6 (25–29) · 3.0 26 | not counted per scenario (blind) |
| Cost per answer                                         | AI about $0.0001–0.0002 · 3.0 nothing |                                           |                                  |
| Time per answer (p50 / p95)                             | AI 1.5 s / 2.5 s · 3.0 under 5 ms     |                                           |                                  |

## 9. What it means

**Which is better.** Neither, overall. They are good at different things:

- **V1 with AI almost never offers a poor bottle** (93–98% against 77–82%), on every set. This is the clearest
  difference in the whole comparison (Fisher's exact test: p = 0.001 on the main set and on the holdout; p = 0.05
  on the 34 blind scenarios alone).
- **On dishes neither had seen, V1 with AI picks the better first bottle** (79% against 64% over the 88 holdout
  scenarios, p = 0.03). On the 43 blind scenarios alone the same direction holds (73% against 63%) but is not
  convincing by itself (p = 0.35: four or five scenarios).
- **On the main set 3.0 picks the better first bottle and outcome** (78% against 69%; 92% against 85%), but 3.0
  was tuned on that set and neither difference is convincing (p = 0.15 and 0.11). On unseen dishes the outcome
  is a tie (76% against 74%).
- **3.0 is the more honest about "nothing suits"** on unseen dishes (12 against about 10 of 14). The direction is
  the one the engine was built for; the numbers are too small to call (p = 0.65).
- **Leaving the dish check out, the two pass the same number of scenarios** (main 87 against 82, sign test
  p = 0.78; first holdout half 26 against 26.6, p = 0.68).
- V1 with AI is stable: of 133 main scenarios, 107 gave the same result in all five runs.

**Where the largest errors are.**

- 3.0: a labelled-poor wine among the bottles offered (27 of 117 on the main set, 13 of 74 on the holdout), a
  wrong first bottle on unseen dishes (32 of 88), and the dish not understood (24 of 88). The first two follow
  from the third more often than not: a dish read wrongly is paired wrongly.
- V1 with AI: the outcome (it says "match" where the reference says "acceptable" or "nothing": 19 of 124 on the
  main set, 23 of 88 on the holdout), and forcing a bottle when nothing suits (about 4 of 14 on the holdout).

**What is not convincing.** Everything on the blind set alone except "no poor bottle"; "nothing suits" anywhere;
3.0's lead on the main set. One caveat the scorer cannot settle: 3.0 offers up to three bottles and V1 with AI
often fewer, and offering fewer makes "no poor bottle" easier to pass.

**What it does not show.** How the answers read. Friends, buying advice, menus and offers (V1 cannot attempt
them). And it inherits the labels' weaknesses (`progress/S9.md` §2.6).

**The conclusion for the product.** "3.0 is better than today's sommelier with AI" is **not shown**. 3.0 is
free, instant, grounded and more honest; the model reads unfamiliar dishes and avoids bad bottles better. The
next step follows from that: `progress/S9.md` §10.

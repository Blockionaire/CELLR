# Sommelier V1 with AI against Sommelier 3.0 — the comparison, designed and not yet run

S9, 2026-11-20. **No model was called.** Running this costs money, so it waits for the owner's explicit approval
(§6). Everything up to that point is built and tested.

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

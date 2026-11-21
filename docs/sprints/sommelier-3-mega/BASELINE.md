# Sommelier 3.0 — baseline (what exists today, measured)

Measured on 2026-11-19 at `main` 07bc80c. Every number below is the output of a command in this repository; none is
an estimate. The run is reproducible, and a test fails when it stops being so (§5).

## 1. What was measured, and what was not

**Measured: Sommelier V1 without AI.** The engine `v1-basic` calls the app's own `createSommelierService` with no
model configured, with `aggregateInventory` and `buildTonight` behind it. That is the path a person gets when AI is
off, down or over its limit: `detectIntent` reads the question, Tonight ranks the cellar, three cards are shown.
Nothing is re-implemented in the benchmark; only the database reads and the clock are replaced by fixed ones.

**Not measured: V1 with AI.** That path needs the paid model. No key is available to this work, and spending on one
needs the owner's approval, so no model call was made. For the AI path this baseline therefore says nothing about
its pairing quality, its hallucination rate, its latency or its cost per question. What is known about it without
running it:

- its verdict and its "buy" suggestions (a product name with a model-written price) come from the model and are not
  checked beyond their shape;
- every question that is not a counted fact costs one call that carries up to 120 wines.

Measuring it later takes the owner's key and one command (§6).

## 2. The benchmark

`scripts/sommelier-eval` holds **246 scenarios** in 15 categories, **107 reference dishes** and **30 archetype wines**
(invented producers, real appellations) in 11 named cellars.

- **A reference dish** says what the dish is (main ingredient class, weight, fat, acidity, sweetness, heat, umami on
  coarse scales), which legacy V1 categories would be a sensible reading of it, and which of the 30 wines are a
  **good** match and which are **acceptable**. Every other wine is a poor match for that dish.
- **A scenario** is a question (one to four turns, English or Dutch) asked of a cellar, with typed expectations. The
  reference outcome of a pairing scenario follows from the labels: a good wine can be opened → "good"; else an
  acceptable one → "acceptable"; else "none".
- **An engine passes a scenario** when every check passes: the dish was understood; the outcome matches; the first
  bottle offered is labelled at least as the outcome says; no offered bottle is a poor match; no wine was invented;
  and whatever else the scenario asks (bottles that must not be offered, counted facts, budget, state, friends,
  offers).
- **An engine that cannot attempt a scenario** (it has no notion of budgets, friends, offers or evidence) fails it,
  and is listed as "could not attempt". Its measures count only the scenarios it could attempt.

### Reference criteria

A wine is **good** with a dish when a trained sommelier would recommend it with confidence: a classic, or
structurally sound with no clash. It is **acceptable** when it will do without a structural clash. The structural
rules the labels follow:

- the wine's weight matches the dish's;
- the wine has at least the acidity of the dish; fat, salt and fried food want acidity or bubbles;
- tannin only where protein and fat can take it; no tannic red with raw or oily fish, oysters, vinegar or strong
  chili heat;
- a dessert wants a wine at least as sweet as it is;
- chili heat wants low tannin, moderate alcohol and often a little sweetness;
- blue cheese and salty, rich food take sweet wine.

### Limits of the benchmark

- **The labels were written by AI agents** (the dishes and scenarios by two authoring agents, to a contract and
  principles written by the engineering agent), from widely taught pairing principles. They were validated by
  rules (every key exists, no overlap, the "nothing suits" scenarios really leave nothing) and spot-checked by the
  engineering agent on 16 cards. **No wine professional has reviewed them** (risk R-01). They are consistent and
  conservative; they are not an authority.
- Pairing is a matter of degree and of taste. Two labels apart ("good" against "poor") is a real difference; "good"
  against "acceptable" for a single wine is often arguable.
- The 30 wines are archetypes. Real cellars hold wines that fit no archetype.
- The scenarios for experiences (8) carry a written reference answer, not typed checks, until S6 adds them.

A wrong label is corrected with a line under "Label corrections" below, and the baseline is run again. A label is
never changed to make an engine pass.

## 3. Result

Command: `pnpm sommelier:eval --failures --json ../../docs/sprints/sommelier-3-mega/results/baseline-v1-basic.json`

**13 of 246 scenarios passed (5%).** The engine could attempt 133; the other 113 need something V1 without AI does
not have at all.

| Category           | Scenarios | Could attempt | Passed |
| ------------------ | --------: | ------------: | -----: |
| pairing-simple     |        32 |            32 |      3 |
| pairing-hard       |        57 |            57 |      2 |
| pairing-misleading |        16 |            16 |      0 |
| no-suitable-wine   |        18 |             9 |      0 |
| empty-cellar       |         6 |             2 |      2 |
| missing-metadata   |        10 |             0 |      0 |
| inventory          |         9 |             9 |      3 |
| evidence           |        10 |             0 |      0 |
| budget             |        14 |             0 |      0 |
| follow-up          |        16 |             0 |      0 |
| multi-person       |        14 |             0 |      0 |
| revoked-sharing    |        10 |             0 |      0 |
| retail             |        14 |             0 |      0 |
| robustness         |        12 |             8 |      3 |
| experience         |         8 |             0 |      0 |

Measures, over the scenarios each applies to and the engine could attempt:

| Measure                                                  | Passed |  Of | Rate |
| -------------------------------------------------------- | -----: | --: | ---: |
| The dish was understood (a sensible legacy category)     |     72 | 124 |  58% |
| The outcome matches the reference                        |     83 | 124 |  67% |
| The first bottle is labelled as well as the outcome says |     40 | 124 |  32% |
| No offered bottle is a poor match                        |      9 | 117 |   8% |
| Says "nothing" when nothing suits (no forced answer)     |      1 |   7 |  14% |
| Offers no bottle where none may be offered               |      3 |  10 |  30% |
| Does not offer a bottle that must not be opened          |      7 |   8 |  88% |
| Counted facts are right                                  |      4 |   4 | 100% |
| No invented wine (groundedness)                          |    133 | 133 | 100% |
| Does not follow an injected instruction                  |      3 |   3 | 100% |

**Latency** of the engine's own work per question, on this machine, three runs: p50 0.71–0.76 ms, p95 2.3–2.7 ms,
max 4.6–6.6 ms. No database, network or model time is in these numbers.

**Cost:** 0 model calls, 0 tokens, $0.

### What the failures are

Failed checks among the 133 attempted scenarios: a poor bottle among the offers 108 times; the first bottle not as
good as the reference 84; the dish not understood 52; the outcome wrong 41; a bottle offered where none should be 7.

- **Three cards, always.** Tonight fills "best", "alternative" (another colour on purpose) and "special". With a
  steak that puts a Chablis next to the Pauillac. This is the largest single cause, and by design.
- **One category per dish.** Coq au vin is not recognised at all; carpaccio and steak tartare read as "steak";
  seared tuna as "steak"; cheese fondue as "hard-cheese" with a Rioja first; a lamb curry as "game" or "stew".
- **No "nothing suits".** The answer has no verdict; the ranking always returns bottles. Oysters with a cellar of big
  reds gets a red.
- **The wine is a colour and a region.** A Muscadet, a Chablis and a Meursault differ by one regional nudge.

## 4. Thresholds the later phases are held to

These are the gates of S1–S3, set now, before the new engine exists. "Pairing scenarios" are the categories
pairing-simple, pairing-hard, pairing-misleading, no-suitable-wine, empty-cellar, missing-metadata and inventory
(148 scenarios).

| Measure                              | V1 without AI | Gate for the new engine |
| ------------------------------------ | ------------: | ----------------------- |
| The dish was understood              |           58% | at least 90% (S1)       |
| The outcome matches the reference    |           67% | at least 85% (S2)       |
| The first bottle is labelled right   |           32% | at least 80% (S2)       |
| No offered bottle is a poor match    |            8% | at least 90% (S2)       |
| Says "nothing" when nothing suits    |           14% | at least 90% (S2)       |
| No invented wine                     |          100% | 100%, always            |
| Pairing scenarios passed             |      10 / 148 | at least 70% (S3)       |
| p95 latency of the engine's own work |        2.7 ms | at most 50 ms           |

A gate that is missed is investigated and reported with the failing scenarios, not hidden by changing the gate.

## 5. Reproducing it

```bash
pnpm install --frozen-lockfile
```

```bash
pnpm sommelier:eval --failures
```

`pnpm --filter @cellr/sommelier-eval test` runs the baseline on every scenario and fails when any scenario fails
other checks than in the recorded run (`results/baseline-v1-basic.json`). So a change to V1, to the scenarios or to
the labels cannot move the baseline unnoticed.

## 6. Measuring V1 with AI later (owner)

With the owner's model key, `LIVE_AI=1 OPENAI_API_KEY=… pnpm --filter @cellr/web exec vitest run
src/server/ai/live.test.ts` already runs the sommelier with the real model on a few questions. Running the whole
benchmark through the AI path needs an adapter that passes a real provider instead of `llm: null`
(`engines/baseline.ts`). It is not written, because it could not be run or checked here; it is listed in
`RELEASE_PLAN.md` as an owner decision (cost: 133 to 246 calls of the chat model).

## 7. Results of later phases against this baseline

| Phase | Engine                          | Passed (of 246) | Dish understood | Outcome | First bottle | No poor bottle | Says none when none |
| ----- | ------------------------------- | --------------: | --------------: | ------: | -----------: | -------------: | ------------------: |
| S0    | V1 without AI                   |              13 |             58% |     67% |          32% |             8% |                 14% |
| S2    | Sommelier 3.0 engines alone     |              79 |             95% |     90% |          68% |            73% |                 86% |
| S3–S4 | Sommelier 3.0 in the app, no AI |             131 |             92% |     88% |          73% |            72% |                 89% |
| S6–S7 | The same, with the experiences  |             140 |             92% |     88% |          73% |            72% |                 89% |

The nine scenarios S6 adds to the passes are the experience scenarios, which are checked only for inventing
nothing (§2, limits); the pairing measures did not move. The app's engines cannot attempt the 24 scenarios with
friends (the benchmark has no friends database; `progress/S5.md` says how that is tested instead).

Two thresholds of §4 are missed in S2 (first bottle, no poor bottle); `progress/S2.md` says what the misses are and
`RISK_REGISTER.md` R-11 what follows from it. The thresholds are not changed.

## Label corrections

None. Where the engine and a label disagree, the label stands and the disagreement counts against the engine.

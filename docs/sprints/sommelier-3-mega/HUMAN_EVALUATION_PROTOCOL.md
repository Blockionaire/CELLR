# Human holdout and blind expert panel — protocol (S11)

Written before any of it exists, so that nothing about it can be chosen after seeing an engine's answer. Both parts
are **BLOCKED on people**: the agent can prepare, never write, label or judge them.

The rule that holds everything together: **nothing in this protocol is ever development data.** No dish, label or
judgement from it goes into the engines' knowledge, a prompt, the benchmark's readable sets or a decision about a
rule. If one ever does, the part it came from is spent, and a new one is needed for the next measurement.

## 1. The human holdout (at least 100 dishes)

| Step             | Who                                                                                              | What                                                                                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Write the dishes | At least two people who cook, not the developers, without an AI's help                           | 100 or more dishes in the format of `scripts/sommelier-eval/human-holdout/README.md`, each asked in Dutch and English                                                                                               |
| Keep it          | The owner                                                                                        | The file stays **outside the repository** (a private folder or drive). It is never committed, pasted into a chat or sent to a model other than the one under test                                                   |
| Seal it          | The owner                                                                                        | `pnpm --filter @cellr/sommelier-eval run seal-human-holdout /path/dishes.json` prints its sha256 and number of dishes; commit that as `human-holdout/SEAL.json`. From then on a file that does not match is refused |
| Label the wines  | A person with proven wine knowledge, after the dishes are sealed, blind to every engine's answer | `good` and `ok` per dish from the 30 benchmark wines. The labelled file gets a new seal; the first seal stays in the history                                                                                        |
| Run              | The owner, on their own machine (the process reads the file; the agent does not)                 | `SOMMELIER_EVAL_HUMAN_FILE=/path/dishes.json pnpm sommelier:eval --set human --engine …` reports totals only                                                                                                        |

How it is reported: totals per engine; differences between engines with the paired bootstrap of `stats.ts`, which
draws **dishes** (a dish asked in two languages is one observation, so 100 dishes is n = 100, not 200). Before the
first run, the measures and the rule for a decision are written into the progress file of that sprint, as in
S10 §6.

Power, so nobody expects more than it can give: with 100 dishes a share near 80% has a 95% interval of roughly
±8 points, and a difference between two engines on the same dishes needs to be about 10 points or more to be told
apart from chance.

## 2. The blind expert panel (30 hard combinations)

**The S10 sheet is not this panel.** Its 30 pairs come from the main set, which the engines were developed on, and
were chosen from label disputes: it is a label audit of the development set (useful for correcting labels there,
`EXPERT_REVIEW.md`), not independent evidence.

**Which dishes.** Thirty dishes of the sealed human holdout, chosen by a rule on the dish's own description
(`truth`) alone, before any engine has answered any of them. "Hard" means at least one of:

- chili heat 2 or more;
- sweetness 2 or more in a dish that is not a dessert;
- built on oily fish, mushroom, egg, cheese or pulses;
- acidity 3 (dominant);
- umami 3 with weight 2 or less.

If more than 30 qualify, the first 30 by the order of a sha256 of their ids (a fixed shuffle nobody chooses); if
fewer, all of them, and the count is said.

**Which wines.** For each dish, the bottles that V1 with AI (A) and the variant under test (E, or another) offer
from the full benchmark cellar, at most two from each, plus one control wine drawn by the same hash from the
reference labels. Pairs offered by both appear once. The panel sees the dish and the wine; never which engine
proposed it, the reference label, or another expert's opinion; the order is shuffled per expert.

**Who.** At least three people with proven wine knowledge (sommelier, wine educator, buyer), independent of each
other and of the developers. Each judges every pair: **good / ok / poor**, and a reason where they like.

**Agreement.** Krippendorff's alpha for ordinal data over the three judgements. At 0.67 or above, the majority
judgement is the reference for each pair; below it, the pairs on which the experts disagree are reported apart and
only the pairs with a majority are scored. A pair on which all three disagree counts for nothing.

**What is reported.** Per engine: the share of its offered bottles judged poor and judged good, by majority, with
intervals that draw dishes. The key that links pairs to engines is kept by the owner, apart from the sheets, until
every sheet is back.

## 3. What the agent prepared, and what it may not do

Prepared: the escrow and seal (`human-holdout.ts`, tested), the bootstrap by dish (`stats.ts`, `compare.ts`), this
rule for choosing hard dishes. Not prepared yet, on purpose: the panel's sheet generator, which needs the sealed
dishes and is a few lines once they exist.

The agent may not: read the escrowed file, see a single panel judgement before all are in, change an engine because
of a result of either, or add any of it to a readable set.

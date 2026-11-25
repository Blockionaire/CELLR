# Sommelier V1+ — P8: the paid measurement plan (prepared, not run)

2026-11-25, integration branch. **Nothing in this plan has been run.** No paid call was made, no key was used and no
budget file exists. Every number below is the free estimate of `pnpm --filter @cellr/sommelier-eval run p8
--estimate` (recorded in `results/p8-plan-estimate.json`). The **$5 is a proposal, not a payment authorisation**
(D-51).

## 0. The owner's decisions (2026-11-25)

| #   | Decision                                                                                                                                                                                                  | What it means for this plan                                                                                                                                                                       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Quality gate:** the benchmarks are for **regression detection**, supplemented by independent human assessment. No statistical equivalence or non-inferiority may be claimed without sufficient evidence | Every comparison reports "regression detected / not detected" with its interval and the smallest drop the set could show (§9a); nothing says "as good as". Quality is the people's judgement (§8) |
| 2   | **Holdout:** 100 independent dishes, **40 exploratory + 60 definitive**. The definitive 60 stay blind: sealed, never seen by agents or used for tuning, scored only once, after the build is frozen       | Two forms and two seals; the definitive set is refused without `--definitive` and a recorded freeze, and once per engine only (§10 step 5)                                                        |
| 3   | **Reviewers:** one independent wine professional and 3–5 real users                                                                                                                                       | `review/wine-professional-cover.md`, `review/ux-protocol.md` (§8)                                                                                                                                 |
| 4   | **Cost:** at most one model call per menu; provisionally at most 1.5 × the estimated V1 cost; ordinary questions at most +10%                                                                             | §6 (estimate, tested) and §9 rule d (real tokens, after the runs)                                                                                                                                 |
| 5   | **Evaluation budget:** at most $5, as a proposal; **no payment authorisation yet**                                                                                                                        | §2 shows the plan fits; nothing is spent until the owner answers §7 with yes                                                                                                                      |

What the plan can and cannot show at these sizes: [`P8_POWER_ANALYSIS.md`](P8_POWER_ANALYSIS.md). Where the results
are written: [`P8_RESULTS_TEMPLATE.md`](P8_RESULTS_TEMPLATE.md) (technical validation, AI measurement and human
assessment strictly apart).

## 1. What the plan measures, and why

| Question                                                                                                 | Measured by                                                                                                       |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Did prompt v7 with the check cause a regression against V1 (v6)?                                         | v6 against v7 on the same scenarios, paired, clustered by dish: first bottle right, no poor bottle, useful answer |
| Does the model invent cellar facts, prices or shops, and does the check stop them before they are shown? | The check's rules counted on the model's own words (v6 and v7) and on the words shown (heuristics, §4)            |
| Do serving claims that contradict the card get through?                                                  | The serving and guests probe (16 scenarios) with `annotate` on (§9c)                                              |
| Does the model write cellar wines as refs, as v7 asks?                                                   | Per answer, on v7                                                                                                 |
| How often does the check remove a good sentence?                                                         | **Only a person can say**: a review sheet of every removed sentence and 100 kept ones, verdicts empty             |
| Does the `menu` part plan a menu, course by course?                                                      | The 18-menu set, V1 against `menu` on, scored per course                                                          |
| What does a menu really cost?                                                                            | Real tokens and cost of every call, against the owner's criterion (§6, §9d)                                       |
| Is the advice good?                                                                                      | **People**: the wine professional, the users, and the definitive holdout scored once (§8)                         |

## 2. The runs, and the budget (estimate)

Three runs per arm; the reservation is what the guard holds back before each call, as if every call cost its worst
case (both attempts with the full output allowance, the repair's longer prompt, +25%).

| Step | Run                                                 | Runs | Calls per run | High estimate per run | Reserved per run | `--max-usd` | Required |
| ---- | --------------------------------------------------- | ---: | ------------: | --------------------: | ---------------: | ----------: | -------- |
| 1    | v6 (no part), `main`                                |    3 |           131 |               $0.2031 |          $0.3337 |        0.35 | yes      |
| 1    | v7 + check, `main`                                  |    3 |           131 |               $0.2078 |          $0.3425 |        0.36 | yes      |
| 1    | v6, `holdout-dev`                                   |    3 |            45 |               $0.0668 |          $0.1091 |        0.12 | yes      |
| 1    | v7 + check, `holdout-dev`                           |    3 |            45 |               $0.0685 |          $0.1122 |        0.13 | yes      |
| 1    | v6, `holdout-test` (blind)                          |    3 |            43 |               $0.0643 |          $0.1050 |        0.12 | yes      |
| 1    | v7 + check, `holdout-test` (blind)                  |    3 |            43 |               $0.0658 |          $0.1079 |        0.12 | yes      |
| 1    | v6, `probe` (serving, guests)                       |    3 |            18 |               $0.0284 |          $0.0467 |        0.06 | yes      |
| 1    | v7 + check, annotate, quantities, `probe`           |    3 |            18 |               $0.0297 |          $0.0491 |        0.06 | yes      |
| 2    | Menu set, V1 without the part                       |    3 |            21 |               $0.0315 |          $0.0516 |        0.07 | yes      |
| 2    | Menu set, `menu` on                                 |    3 |            21 |               $0.0370 |          $0.0600 |        0.08 | yes      |
| 2    | Menu set, `check,menu` (as it would ship)           |    1 |            21 |               $0.0377 |          $0.0614 |        0.08 | optional |
| 2    | Menu set, V1 asked once per course (cost reference) |    1 |            53 |               $0.0794 |          $0.1298 |        0.14 | optional |
|      | **All runs**                                        |      |     **1,622** |           **$2.5255** |      **$4.1448** |             |          |
|      | Required runs only                                  |      |         1,548 |               $2.4084 |          $3.9536 |             |          |

- **It fits $5 at the worst case**, with `--total-usd 5` on one budget file for all runs and the `--max-usd` per run
  above: every call costing its whole reservation leaves $0.86.
- What it will probably cost is far less. In S9 the calls cost about $0.00009 each (COST_REPORT.md), about 1/17 of
  this high estimate per call, because of the provider's prompt cache; at that rate the plan is about $0.15. That is
  an expectation from earlier runs, not a promise; the guard holds the worst case.
- The human holdout is not in this budget: it does not exist yet. When it is written, its runs are estimated and
  asked for separately (§10 step 5).
- The eval cellar's ids are counted (`fixtures.ts`), so its refs are 32 characters, not 6: every prompt here is a
  little longer than in production, for every arm alike (the estimate errs high).

**If the owner approves less than $4.15:** drop the two optional runs first ($3.95), then go to two runs per arm
(about $2.64). Extra runs only reduce the model's run-to-run noise; the dishes set the precision
(`P8_POWER_ANALYSIS.md` §3). Dropping a set loses its evidence entirely: keep every set and cut runs first.

## 3. Commands

All commands are in the runbook (§10), through one entry point: `pnpm --filter @cellr/sommelier-eval run p8`.

## 4. What each run produces

- **Per-scenario vectors** (`--vectors`): first bottle right, no poor bottle, useful answer, bottles offered, poor
  and good; and under `claims` (engines/v1plus-ai.ts): what the check's rules flag in the model's own words and in
  the words shown, whether the cards were written as refs (v7), the check's outcome, the serving reconciliation's
  outcome and any contradicted serving claim still shown, and for every call the tokens in and out, its cost as
  reported and the served model. Numbers and codes only; no words. A scenario without a dish to score (the probe's
  serving questions) keeps its claims under the file's `claims`.
- **The flags are heuristics, not ground truth.** They are the check's own rules used as an instrument (`claims.ts`).
- **Review sheets** (readable sets, v7 only): every sentence the check removed or replaced, with its context, and a
  seeded sample of 100 kept sentences. Verdict columns are empty.
- **Summaries** (`--json`): totals, the served models, and `stopped` when a stop rule ended the run.

## 5. The spending guard (unchanged)

A run stops itself, sends nothing more, prints `INCOMPLETE RUN` and exits with code 3 when the next call's
reservation does not fit the run's `--max-usd` or what is left of `--total-usd`, a call cost more than its
reservation, the model has no price, or the budget file cannot be read, was not written by this tool or holds another
total. The other stop rules are in §9.

## 6. Menu costs against the owner's criterion (free estimate now, real tokens after the runs)

`pnpm --filter @cellr/sommelier-eval run menu:cost` (`results/p8-menu-cost.json`, `owner` and `ordinary`). The
criterion (owner decision 2026-11-25; the factor 1.5 is provisional): a menu question of up to eight courses makes **one** model call, and its
worst-case cost (the app's high estimate: the full output allowance, both attempts) is at most **1.5 ×** the
worst-case cost of one ordinary V1 answer (v6, no part) in the same cellar and conversation. Measured through the
service with a fake model, for 2 to 8 courses, `menu` and `check,menu`, cellars of 25, 120, 500 and 3,000 wines,
conversations of 1 and 12 messages (112 cells):

| Wines | Messages | Parts      | 2 courses |    3 |    4 |    5 |    6 |    7 | 8 courses |
| ----: | -------: | ---------- | --------: | ---: | ---: | ---: | ---: | ---: | --------: |
|    25 |        1 | menu       |      1.15 | 1.20 | 1.25 | 1.30 | 1.34 | 1.39 |      1.44 |
|    25 |        1 | check,menu |      1.17 | 1.22 | 1.27 | 1.32 | 1.37 | 1.42 |  **1.46** |
|    25 |       12 | check,menu |      1.17 | 1.22 | 1.26 | 1.31 | 1.36 | 1.41 |      1.45 |
|   120 |        1 | check,menu |      1.11 | 1.14 | 1.18 | 1.21 | 1.24 | 1.27 |      1.30 |
|   500 |        1 | check,menu |      1.11 | 1.14 | 1.17 | 1.21 | 1.24 | 1.27 |      1.30 |
| 3,000 |        1 | check,menu |      1.11 | 1.14 | 1.17 | 1.21 | 1.24 | 1.27 |      1.30 |

(All 112 cells are in the JSON; the rows not shown lie between these.) **Every cell makes exactly one call and is
within 1.5; the maximum is 1.464** (8 courses, 25 wines, `check,menu`), a headroom of 0.036. The headroom comes from
the menu's output allowance (70 tokens a course): at **76** tokens a course the worst cell would reach 1.5 exactly,
so a larger allowance than 76 would break the criterion; a 9-course menu is not planned (the reader stops at 8).

**Ordinary questions stay within +10% on cost** (pairing, serving, guests, comparison; every part alone and all
parts; the same cellars and conversations): the highest is **+7.3%** (a serving question, all parts, 25 wines). The
criterion is about **cost**. On prompt characters alone, for information, 7 cells are above +10% (the highest +18.2%,
the same serving question; the serving facts make the prompt longer, the output allowance does not grow).

For information only: one menu question costs 16–59% of the same menu asked as N separate V1 questions (8 and 2
courses). The paid runs record the real tokens of every call (`menu-*.json`, `calls`), so the criterion can be
checked on them after the runs (`cost-check.ts`, §9 rule d); a test (`paid-plan.test.ts`) fails if the estimate ever
exceeds it.

## 7. What is committed, and what the owner must approve

**Committed after the runs:** the vectors and summaries of `main`, `holdout-dev` and `probe` (keyed by scenario id),
the blind set's vectors with salted keys (copied in as P7's were; the salt never), the menu result files, the review
sheets, the cost check, and section 2 of the results (`results-report --write`). The eval cellar and its questions are
synthetic, so nothing holds a person's data. No prompt is recorded or committed. **Never committed:** the budget file,
the key, the salt, a filled human form.

**The owner's decision, to answer yes or no:**

> The $5 is a proposal and not yet a payment authorisation. Do you now authorise spending at most $5.00 in total on
> OpenAI calls to `gpt-6-luna` (one budget file with `--total-usd 5`; worst case reserved $4.14, high estimate
> $2.53) to run steps 1 and 2 of the runbook in `docs/sprints/sommelier-3-mega/P8_MEASUREMENT_PLAN.md` §10,
> including the two optional menu runs: yes or no?

## 8. People (no money involved; not part of the budget)

- **One independent wine professional** reviews the content: the 50 annotations, the serving and window tables, the
  pairing judgements and the fallback's disputed answers, and the check's review sheets from the paid run
  (`review/wine-professional-cover.md`: what is asked, about 3–4½ hours, a sign-off block left blank).
- **Three to five real users** try the journey on a phone and a desktop (`review/ux-protocol.md`, `ux-tasks.csv`,
  `ux-closing.csv`): participant codes only; only aggregated counts go into the repository.
- **The human holdout** (100 dishes) is written by people who do not develop CELLR: **40 exploratory** and **60
  definitive**. Each part is sealed outside the repository on its own. The exploratory 40 may be scored when they
  exist and are reported as exploratory (they can only catch a large regression). The **definitive 60 stay blind**:
  never seen by an agent or used for tuning, and scored only once, after the build is frozen (§10 step 5); their
  result is reported apart from everything else.
- **How many disagreements are "not acceptable"** is the owner's to fill in (`review/criteria.md`).

## 9. Stop rules — fixed before any paid run

Fixed on 2026-11-25, before any paid call. A machine enforces what it can (`stop-rules.ts`, `run.ts`, `menu-run.ts`,
`cost-check.ts`, `results-report.ts`): the run stops at once, sends nothing more, is marked incomplete with the rule
that stopped it, exits with code 3, and section 2 of the results prints `STOPPED: <rule>` for it. An incomplete run is
never compared (`compare.ts` refuses it). Everything a stop rule sends to a person is reviewed before the next step.

**a. Regression (results, per measure and set).** For first bottle right, no poor bottle and useful answer, on each set,
from the dish-clustered 95% interval of v7 − v6:

- **REGRESSION DETECTED** when the interval's upper bound is below 0;
- **possible regression: needs human review** when the point estimate is below −5 points and the interval includes 0;
- otherwise **no regression detected** — which is not evidence that there is none;
- **too few to conclude** with fewer than 10 dishes behind the number.

What each set can detect (smallest drop found with 80% power, central assumption of `P8_POWER_ANALYSIS.md`):

| Set                           |  First bottle right | No poor bottle | Useful answer |
| ----------------------------- | ------------------: | -------------: | ------------: |
| main (100 dishes)             |           10 points |       5 points |      7 points |
| holdout-dev (22)              |                  15 |             12 |            14 |
| holdout-test (22, blind)      |                  15 |             13 |            14 |
| probe (6 dishes with a label) | too few to conclude |        too few |       too few |
| menu set (18 menus)           |                  15 |             11 |            13 |
| human, exploratory (40)       |                  12 |              7 |             9 |
| human, definitive (60)        |                  10 |              5 |             7 |

Enforced in code: `results-report.ts` (`regressionVerdict`). Judged by a person: every "possible regression" and every
detected one. No result is worded as "equivalent", "as good as" or "non-inferior".

**b. Invented cellar facts.** With `check` on, **any one** invented cellar fact (unknown ref, a wine not in the cellar,
a wrong vintage, a wrong count) in the words **shown** to the person, as the check's own rules find it on the final
text, stops the run for review of that answer (`shown-cellar-fact`). The rate of the check's detections in the
**model's own words** (before the check) is reported for v6 and v7 with its exact (Clopper–Pearson) 95% interval and n
(`results-report.ts` §2b). Enforced in code; the answer that stopped the run is reviewed by a person.

**c. Wrong serving claims.** With `annotate` on, any **shown** sentence that `reconcileServingClaims` would still take
out (a temperature, decanting time or drinking years the card contradicts) stops the run for review
(`shown-serving-claim`). The share of answers the reconciliation trimmed or replaced is reported with its exact
interval (§2c). Measured on the **probe** set (`scenarios-probe.ts`: 16 scenarios, English and Dutch, the eval's
synthetic cellars; serving and keeping questions about named wines, a "how cold?" follow-up, pairings for a stated
number of people; the guests scenarios' labels are the dish cards', AI-written), included in step 1 and the budget.

**d. Cost.** Every call records its real tokens in and out, its reported cost and the served model. During the run the
spending guard stops at the approved total (§5). After the runs `cost-check.ts` fails the cost criterion when a menu
question made more than **one** model call, when a menu question's real cost exceeded **1.5 ×** the median real cost
of an ordinary V1 question in the same named cellar, or when ordinary questions' median real cost with the parts
exceeded V1's by more than **10%**; it reports the real ratios as min / median / p95 / max.

**e. Served model and failed calls.** The run stops when the provider says another model answered than the configured
one (a dated snapshot of the same model is the same model; `served-model`), and when more than **5%** of the calls
failed (timeouts, invalid output, refusals; checked from 20 calls on and at the end of the run; `failed-calls`): the
comparison would then be biased.

| Rule                                | Enforced by                                | During or after | Then                                                    |
| ----------------------------------- | ------------------------------------------ | --------------- | ------------------------------------------------------- |
| a. regression                       | `results-report.ts`                        | after           | a person reviews every detected and possible regression |
| b. invented fact shown              | `engines/v1plus-ai.ts` + `run.ts`          | during          | stop; a person reviews that answer                      |
| c. contradicted serving claim shown | `engines/v1plus-ai.ts` + `run.ts`          | during          | stop; a person reviews that answer                      |
| d. cost                             | paid.ts guard; `cost-check.ts`             | during; after   | stop at the total; the criterion fails or passes        |
| e. served model, failed calls       | `stop-rules.ts` in `run.ts`, `menu-run.ts` | during          | stop; the owner decides whether to run again            |

## 10. Runbook (directly executable once the budget is approved and the reviewers exist)

One entry point: `pnpm --filter @cellr/sommelier-eval run p8`. `p8 --estimate` is the whole runbook, dry: it prints
every command of every step in order with the budget, sends nothing and opens no budget file (a test runs it).

**Step 0 — preconditions** (`p8 --check` lists what is missing; a paid step refuses until it is empty):

1. The owner's written yes to §7; then `SOMMELIER_EVAL_PAID=owner-approved` is set.
2. The key is provided through the environment's credential mechanism as `OPENAI_API_KEY`: never typed into a file
   in the repository, never committed.
3. `SOMMELIER_EVAL_BUDGET_FILE`: the budget file, outside the repository; `--total-usd 5` is fixed with its first run.
4. `SOMMELIER_EVAL_BLIND_SALT` (the P7 salt) and `SOMMELIER_EVAL_BLIND_DIR` (a folder outside every checkout) for the
   blind set's vectors.
5. The build frozen at a commit: `p8 --freeze --by <role>` writes `results/p8-build-frozen.json` (`commit`,
   `frozenOn`, `by`, a role) for the checked-out commit of a clean tree; commit it. Later commits that touch only
   `results/` (the record, the runs' files) leave the build frozen; anything else breaks the freeze, and the paid
   steps and the definitive holdout refuse.

**Step 1 — paid:** `p8 --step 1`. Three rounds; in each, for `main`, `holdout-dev`, `holdout-test` and `probe`, v6 then
v7 (so drift over the hours falls on both arms). Stop rules b, c, d (guard) and e apply. Review sheets for the
readable sets' v7 runs.

**Step 2 — paid:** `p8 --step 2`. The menu set: V1 and `menu` in three rounds, then `check,menu` and the per-course
reference once each. Stop rules d (guard) and e apply.

A step stops at the first command that fails; exit 3 is a stop rule or the budget: nothing after it runs until a person
has reviewed it.

**Step 3 — free, after the runs:** `p8 --step 3`: copies the blind vectors in (salted keys), runs `cost-check` (rule d)
and `results-report --write` (rule a, the rates of b and c, every number with its interval). Committed afterwards: the
files of §7 and the updated `P8_RESULTS_TEMPLATE.md`.

**Step 4 — the human forms come back (free):** the filled forms (`review/`) are returned to the owner and kept
**outside** the repository. `p8 --step 4 --forms <folder>` (`forms-check.ts`) checks each for completeness (every
verdict cell filled, "filled in by" and "date" filled) and prints only aggregated counts (closed answers by value,
free text counted, never copied). The sign-off is recorded from the signed cover sheet by the owner:
`forms-check --dir <folder> --out results/p8-human/forms-summary.json --signed-role "wine professional" --signed-date
<date> --verdict approved|approved-with-changes|not-approved` (a role, never a name). User sessions: aggregated
counts only. Then section 3 of the results is filled from that summary.

**Step 5 — the human holdout (when written; its budget asked separately):** the exploratory 40
(`--set human-exploratory`, every report marked EXPLORATORY) may be scored when sealed. The definitive 60
(`--set human-definitive`) only after the build is frozen, with `--definitive --frozen-at <sha>`: the runner refuses it
otherwise, records the scoring before the run, and refuses a second scoring of the same seal by the same engine (one
scoring each for v6 and v7, the paired comparison). Its result is reported apart from everything else.

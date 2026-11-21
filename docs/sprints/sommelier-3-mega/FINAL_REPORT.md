# Sommelier 3.0 — final report

> **Read with S9.** This report is the state at the end of S8. S9 ([`progress/S9.md`](progress/S9.md)) measured the
> engine on dishes it had never seen and found it weaker than the numbers below suggest (R-15), built two things
> this report lists as not done (a friend's cellar, presents not already owned) and replaced the GO / NO-GO
> ([`RELEASE_PLAN.md`](RELEASE_PLAN.md) §7). Where the two differ, S9 is the later one.

2026-11-20. Written at the end of S8. Every number is the output of a command in this repository or of CI; where
something was not measured or not done, it says so. Nothing was merged, deployed, applied to a database or
switched on by the agent.

## 1. Verdict

|                                           |                                                                                                                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Merge the stack with every switch off** | **GO**, after the owner has read §6 (what changes with the switches off) and settled the migration order with pull request #88 (§7)                                      |
| **Turn a switch on for real people**      | **NO-GO** today. Open P1 items (§5)                                                                                                                                      |
| **Did the work meet its own gates?**      | **Not all.** Four of the eight quality thresholds set in S0 are missed (§3). Live retail discovery is not delivered (no source). The AI path was never measured (no key) |

This is not reported as a success: there are open P1 items for the step that matters to users. What exists is a
complete, tested, reviewed system that is safe to merge switched off and honest about what it cannot do.

## 2. What was built

"The engine decides; the model words" was the design. Only the first half was built: **no model is called by
anything in Sommelier 3.0**, and the answer is drawn from fixed sentences in English and Dutch.

| Phase | What                                                                                                 | Pull request                                         |
| ----- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| S0    | Design, a benchmark of 246 scenarios, the measured baseline of V1 without AI                         | [#90](https://github.com/Blockionaire/CELLR/pull/90) |
| S1+S2 | Food engine (331 ingredients, 31 techniques, 82 sauces, 360 dishes) and pairing engine (566 rules)   | [#91](https://github.com/Blockionaire/CELLR/pull/91) |
| S3+S4 | The engines in the app: a plan with three honest outcomes; buying advice as styles; offer validation | [#93](https://github.com/Blockionaire/CELLR/pull/93) |
| S5    | Friends named in a question, with their own consent (off by default); migration 0051                 | [#94](https://github.com/Blockionaire/CELLR/pull/94) |
| S6    | Serving, keeping, wine-to-food, menus, quantities; the plan in a real browser                        | [#95](https://github.com/Blockionaire/CELLR/pull/95) |
| S7    | What came of a bottle, apart from the thumb; the admin's report; migration 0052                      | [#97](https://github.com/Blockionaire/CELLR/pull/97) |
| S8    | Final review, corrections to the documents, this report, the release plan                            | [#98](https://github.com/Blockionaire/CELLR/pull/98) |

Each depends on the one above it. Five switches, all off, none turned on by `CELLR_FEATURES=all`:
`sommelier_engine`, and four that need it: `sommelier_buying`, `sommelier_social`, `sommelier_experiences`,
`sommelier_learning`.

**Not built:** model wording of the plan and model interpretation of a dish (D-27); any live retailer source
(R-05); automatic learning from outcomes (D-26); a friend's cellar in an answer (D-15, by decision).

## 3. Quality, as measured

Benchmark: 246 scenarios with reference labels written by AI agents and **not reviewed by a wine professional**
(R-01). Run without a model.

| Engine                                | Scenarios passed |
| ------------------------------------- | ---------------: |
| V1 without AI (today's fallback path) |    13 / 246 (5%) |
| Sommelier 3.0 engines alone           |   79 / 246 (32%) |
| Sommelier 3.0 in the app (S3–S4)      |  131 / 246 (53%) |
| Sommelier 3.0 in the app, final       |  140 / 246 (57%) |

**V1 with AI, the path most people get, was never measured** (no model key; R-04). So this table does not say
that Sommelier 3.0 is better than what people use today. It says it is far better than today's fallback.

Against the thresholds set in S0, before any engine existed (`BASELINE.md` §4), final state in the app:

| Measure                            | Needed | Got            | Met    | V1 without AI |
| ---------------------------------- | -----: | -------------- | ------ | ------------: |
| The dish was understood            |    90% | 92% (184/199)  | yes    |           58% |
| The outcome matches the reference  |    85% | 88% (140/159)  | yes    |           67% |
| The first bottle is labelled right |    80% | 73% (116/159)  | **no** |           32% |
| No offered bottle is a poor match  |    90% | 72% (102/141)  | **no** |            8% |
| Says "nothing" when nothing suits  |    90% | 89% (16/18)    | **no** |           14% |
| No invented wine                   |   100% | 100% (222/222) | yes    |          100% |
| Pairing scenarios passed           |    70% | 54% (80/148)   | **no** |            7% |
| p95 latency of the engine's work   |  50 ms | 4.4 ms         | yes    |        2.7 ms |

The thresholds were not changed. Part of the misses is ties and labels that list only three to five good wines
per dish; part is real weakness of rules that an AI wrote. The benchmark cannot tell these apart without a
person who knows wine (R-11). Also not benchmarked: the 24 scenarios with friends (the benchmark has no friends
database; they are covered by SQL, service and browser tests), and the 8 experience scenarios beyond "nothing
was invented".

What does hold, by tests on the real knowledge: 46 textbook pairings are offered and 15 textbook clashes are
never offered; a bottle that is not owned is never shown; with no source connected no offer, URL, merchant or
price of a bottle is shown.

## 4. Tests and reviews, final state

| Check                                                            | Result                                                                                                                 |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Unit tests (`pnpm test`)                                         | see `progress/S8.md` "Final run"                                                                                       |
| Database: all migrations and the permission suite                | 1676 passed, 0 failed                                                                                                  |
| Browser (phone and desktop; axe WCAG 2.1 AA; no sideways scroll) | new spec 21 passed, 1 skipped by design; with the existing sommelier and friends specs 85 passed, 0 failed, in one run |
| CI on the pull requests                                          | see `progress/S8.md` "CI"                                                                                              |
| Browser tests in CI                                              | **not run**: CI runs them on pushes to `main` only                                                                     |

Every phase had an independent adversarial review by a separate agent, and S8 a final review of the whole
stack. Findings and what was done are in each `progress/S<n>.md`. The reviews found real defects every time,
including: a friend's name reaching a model by three routes (S5); questions of fact swallowed by an experience
(S6); the admin report trusting text that clients write (S7); and, in the final review, **a behaviour change
with every switch off** (a question with an "@" was no longer kept) and a model-made price still shown with only
the engine on. All of those are fixed, each with a regression test.

Reviews were done by AI agents. **No person has reviewed the code, and no person who knows wine has reviewed the
knowledge.**

## 5. What is open

**P0 (must not ship): none open.** The one found (final review F1) is fixed in #94.

**P1 (before a switch is on for real people):**

| #    | Item                                                                                                                       | Who                                                                                        |
| ---- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| P1-1 | Four quality thresholds are missed, on knowledge and labels written by AI and reviewed by nobody (R-01, R-11)              | owner: a wine professional's review, or an explicit decision to run it as a labelled trial |
| P1-2 | V1 with AI is unmeasured, so "better than today" is unproven (R-04)                                                        | owner: a model key in a test environment, about 250 calls                                  |
| P1-3 | Migrations 0051 and 0052 are unapplied; their order against #88's 0047 must be settled before they are merged (R-03, R-14) | owner                                                                                      |
| P1-4 | The consent wording for using a friend's taste, and alcohol marketing rules for buying advice (R-07)                       | owner                                                                                      |

**P2 (should be fixed; none blocks merging switched off):**

- A wine named in a question is judged first even when the person says they want to keep it.
- With only `sommelier_engine` on, V1's buy list is gone and nothing replaces it: name `sommelier_buying` with it.
- The 301st engine question in an hour is refused outright; V1 degrades more gently.
- On the buying screen the styles show before the budget is known and again after.
- Outcome buttons only under pairing picks; "I opened it" is not tied to the cellar's own drink action.
- The engines' latency in production is not recorded (only the benchmark measures it).
- Accessibility is machine-checked (axe) only.
- The thumbs (V1, on `main`) can disagree with the server after two quick taps where one fails; found while
  fixing the same in the new outcome buttons. Not changed: it is outside this work.
- `sommelier-memory.spec.ts:553` (V1, on `main`) failed once in a run of 80 and passed 8 of 8 alone.
- The server loads the engines' knowledge (about 0.4 MB of source) in every instance, also with the switches off.

**P3:** the shared domain entry lets the engines' code lists (not the knowledge) into client bundles; refused
outcome attempts are not counted against the limit; "wine-to-food" answers for one of two named wines.

**Blocked, not a defect:** live retailer discovery. There is no licensed source (R-05). The interface, the
validation (no host list means nothing shown; local stock needs a verified store and `inStock`), the screen and
the honest fallback exist and are tested with fixture sources in tests only.

## 6. What changes with every switch off

The rule was "no new behaviour until a switch is named". These are the exceptions; all were judged harmless by
the final review, and the owner should know them before merging:

- A new admin page, `/admin/sommelier`, and its link (it shows "not ready" until migration 0052).
- Sommelier and Tonight product events carry new props (codes and counts; `engine: "v1"` when off).
- A rating records the plan's codes (empty when the answer has no plan); needs migration 0052.
- Every inventory item in the API carries `appellation`.
- The ask request accepts `state` and `budgetEuros` (ignored when off).
- Earlier turns sent along as history are cut to 800 characters (this fixes a V1 validation failure).
- The "Thinking…" line's `role="status"` moved inside its list item (an accessibility fix).
- A kept answer is validated a little more strictly (only for the new `plan` and `otherBottles` fields).
- The browser test run starts a fourth server.

## 7. Dependencies

- **Pull request #88** (system monitoring) holds migration `20261124000047`. This work's 0051 and 0052 are
  numbered after it. #88 must be merged and applied first, or 0051 and 0052 renamed in their pull requests
  before they are merged (once on `main`, CI forbids a rename).
- The pull requests merge in the order of §2. Fixes from the final review were committed on the branch they
  belong to and merged upward (no pushed branch was rewritten): #93, #94, #95 and #97 each got commits after
  their first review.

## 8. Cost

| Item                                            |                                                |
| ----------------------------------------------- | ---------------------------------------------- |
| Product AI calls made by this work              | 0 ($0)                                         |
| Model calls per engine-answered question        | 0                                              |
| Model calls per general question (V1's path)    | 1, as today; cost not measured                 |
| New infrastructure, services, accounts, secrets | none                                           |
| New runtime dependency in the app               | none (`server-only` marks the server boundary) |

A saving in money is not claimed: V1's cost per AI question was never measured.

## 9. What the owner has to decide

In order; details in `RELEASE_PLAN.md`.

1. Read §6 and accept or reject what changes with the switches off.
2. #88 first, or rename 0051 and 0052 before merging #94 and #97.
3. Merge the stack (switches off).
4. Decide how the knowledge gets reviewed (P1-1) and whether to pay for measuring the AI path (P1-2).
5. Approve the consent wording and check the marketing rules (P1-4).
6. Only then: apply a migration and name a switch, in Preview first, one at a time.
7. Retail: choose a source and its licence, or leave buying advice at styles.

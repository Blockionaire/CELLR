# Sommelier V1+ — P3 to P7: quality report, acceptance, GO/NO-GO

2026-11-23. Built in one coordinated round from `main` at `b13cf26` (after P1 #122 and P2 #123). Plan:
[`SOMMELIER_CLOSEOUT.md`](SOMMELIER_CLOSEOUT.md). Per part: [`progress/P3.md`](progress/P3.md),
[`progress/P4-P5.md`](progress/P4-P5.md), [`progress/P6.md`](progress/P6.md), [`progress/P7.md`](progress/P7.md).

Nothing was merged, deployed, migrated or switched on, and **no paid model call was made** (D-51). Every statement
about quality below rests on code, tests and free measurement. Whether the model chooses as well with these parts as
without them has **not** been measured: that needs the paid comparison the closeout gates P3 and P6 on.

## 1. What exists

| Part         | PR                                                     | Branch (from `main`, none stacked) | What it adds around V1's choice                                                                 |
| ------------ | ------------------------------------------------------ | ---------------------------------- | ----------------------------------------------------------------------------------------------- |
| `check`      | [#128](https://github.com/Blockionaire/CELLR/pull/128) | `claude/sommelier-v1plus-p3`       | Prompt v7 (refs for cellar wines, no price field); the answer's words and buying claims checked |
| `annotate`   | [#129](https://github.com/Blockionaire/CELLR/pull/129) | `claude/sommelier-v1plus-p45`      | The app's own facts on each card; facts for the model when asked how to serve or keep a wine    |
| `quantities` | [#129](https://github.com/Blockionaire/CELLR/pull/129) | same                               | Bottles for the people named, against what is free to open                                      |
| `menu`       | prepared, not opened (at most two open: D-47)          | `claude/sommelier-v1plus-p6`       | One checked wine per course in V1's one call; a choice between two cellar wines                 |
| `fallback`   | prepared, not opened                                   | `claude/sommelier-v1plus-p7`       | The engines' plan only when V1 has no model answer                                              |

`claude/lucid-knuth-ck7ge0` holds all four merged together, the tests that only make sense with every part
(`service-v1plus.test.ts`, `e2e/sommelier-journey.spec.ts`), the free benchmarks and this report. It is the rehearsal
of the merges, not a fifth thing to merge: after P3 to P7 are on `main`, what is left of it (the combined tests, the
benchmarks, this report) becomes one small pull request.

**Merge order:** #128 (P3) → #129 (P4+P5) → P6 → P7. Each later branch conflicts with the earlier ones in three
shared files (the service, the register, one test file); the resolutions were made once on the integration branch
and are replayed when `main` is merged into the next branch.

**How it was built.** A lead (architecture, the shared service, types, screen, register, integration, pull requests)
and four implementation agents in separate worktrees, each owning its own files against a frozen interface; then an
independent reviewer who had written none of it and was asked to break it, and a second round of fixes.

## 2. Evidence, against the closeout's gate (§5)

The thresholds are the closeout's **proposal** (D-50), not an owner decision.

| Measure (closeout §5)                             | Result                                                                                                                                                                                                                                  | Status                                                                         |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| First bottle right, no poor bottle, useful answer | Not measured: needs V1 with its model, v7 against v6 (P3), and the menu set (P6)                                                                                                                                                        | **Open: paid run not approved**                                                |
| V1 unchanged with no part on                      | 912 runs against `main`'s own service: 0 differences in requests, schema, answers, usage, spend. Free engine `v1-basic`: identical vectors on all three sets                                                                            | Met                                                                            |
| V1's choice unchanged by a part                   | Wines, order and verdict identical with each part on or off (service tests; both servers compared in the browser tests). `check` changes the prompt by design (v7)                                                                      | Met for annotate, quantities, fallback; by design not for check and a new menu |
| Invented bottle, vintage or cellar fact           | Refs rendered by code; claim rules in English and Dutch. Pinned corpus: 40 of 40 invented claims caught. A model that gets everything wrong at once, over all 32 combinations: nothing of it shown with `check` on                      | Met on the tests; **not measured on real model output**                        |
| Unverified price, shop or stock claim             | No price field in v7; price, shop and stock sentences removed; the fallback strips styles and offers twice                                                                                                                              | Met on the tests                                                               |
| False positives of the check                      | 0 of 60 everyday answers and 0 of 40 weak-spot sentences in the pinned corpus (before the fixes the reviewer measured 1 of 90 everyday, 13 of 40 weak-spot)                                                                             | Met on the corpus; corpus is AI-written                                        |
| Annotation correctness                            | Fixtures 100%. Sample of 50 for a person: prepared, **not reviewed**                                                                                                                                                                    | Fixtures met; review open                                                      |
| Privacy                                           | No new stored text beyond the answer itself; no friend data; one new read (the household's own wine profiles, as the person). The model is shown nothing it was not shown before except app-computed facts about the person's own wines | Met                                                                            |
| Latency                                           | p95 at most +36 ms over V1 with all five parts at 3,000 wines (code overhead only; §3)                                                                                                                                                  | Met on the free measurement                                                    |
| Cost per answer                                   | Free estimate: every question that is not a menu within +6.9% with all parts on (`check` alone +1.6%). A new menu: +13% (3 courses) to +28% (8 courses) on the worst-case allowance                                                     | Met except for a new menu                                                      |
| Fallback against `plain()`                        | First bottle +35 [+24, +45] main, +22 [+0, +44] holdout-dev, +33 [+14, +51] blind holdout-test; no poor bottle +49 to +71                                                                                                               | Met on main and the blind set; holdout-dev's lower bound is +0                 |
| Mobile, Dutch and English                         | Every part and the whole journey in browser tests on the phone and desktop projects, Dutch at 360 px, no sideways scroll, accessibility audit clean                                                                                     | Met in tests; no person on a device                                            |

### Tests

| Where                                      | What                                                                                                                                                                                                            |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Integration branch, unit                   | domain 1,977 passed; web 1,744 passed, 13 skipped (as on `main`)                                                                                                                                                |
| All 32 combinations of parts               | Seven kinds of question × model answering, down, absent, and a model that gets everything wrong: no error, at most one model call, each part adds only its own field, every answer can be kept and drawn again  |
| One conversation with every part           | Advice → serving → a menu for six with the bottles counted → a follow-up → the model down                                                                                                                       |
| Browser, integration branch, local         | 92 sommelier tests passed on phone and desktop, including the journey above in English and in Dutch at 360 px                                                                                                   |
| Full CI, integration branch (before fixes) | Run 45254808952: 21 of 23 jobs green, every sommelier test passed; the one failure is `scan-records.spec.ts` (the route announcer collides with `getByRole("alert")`), unrelated and addressed by the open #116 |
| Per pull request                           | Each branch green alone on format, lint, types, unit tests, the architecture register and its browser tests; full CI by hand on each                                                                            |

## 3. Performance (free: a fake model that answers at once, reads in memory, a shared four-core machine)

Measured after the review fixes (integration commit `85bd32f`, `results/p8-quality-bench.json`; the numbers before
them are kept there under `beforeReviewFixes`). p95 of one answer's code path, difference to V1, in milliseconds;
the worst of six cells (a pairing with a guest count, a three-course menu, a serving question; conversations of 1 and
12 messages), 200 measured rounds per cell.

| Parts on                   | 25 wines |  120 |  500 | 3,000 | 3,000 before the fixes |
| -------------------------- | -------: | ---: | ---: | ----: | ---------------------: |
| `check`                    |     +0.7 | +2.0 | +5.6 | +25.2 |                   +252 |
| `annotate`                 |     +0.2 | +1.7 | +0.6 |  +4.4 |                   +130 |
| `quantities`               |     +0.1 | +0.3 | +0.4 |  +6.7 |                   +2.6 |
| `menu`                     |     +0.4 | +0.5 | +0.6 |  +1.6 |                    +62 |
| `fallback` (model answers) |       ~0 |   ~0 | +0.1 |  +0.8 |                   +0.7 |
| all five                   |     +1.4 | +3.2 | +6.3 | +35.9 |                   +892 |

**The proposal (V1 + 300 ms) is met in every cell measured.** The check now indexes the cellar once per question
(p50 11.5 ms at 3,000 wines; each text checked against it 0.2 ms), and the serving facts look up the named wines
first (0.7 ms instead of 90 ms). At most one profiles read per question.

Cost, on the app's own high estimate: an ordinary pairing is identical to V1 except for `check`'s prompt (+1.6%);
every question that is not a menu stays within +6.9% with all parts on (a serving question in a 25-wine cellar is the
highest); a new menu is +12.8% (three courses) to +28.2% (eight), and up to +45.7% for eight courses in a 25-wine
cellar, because its answer allowance grows.

These numbers are code overhead only: the model answers at once, the reads are in memory (in production the one
profiles read is a database round trip), and the machine was shared with other work.

## 4. The independent end review

One reviewer agent (maximum effort) that wrote none of the code, asked to break it. **No P0.** Its findings and what
became of them:

| #     | Severity | Finding                                                                                                            | Status                                                                                           |
| ----- | -------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| 1     | P1       | The menu reader lost or merged a course named after its dish ("…fondant for dessert")                              | Fixed (P6)                                                                                       |
| 2     | P1       | With `check` and `menu`, a reason could outgrow what a kept answer allows: answer lost, model asked twice on retry | Fixed (refs rendered before the cut; every answer of every combination is tested to be storable) |
| 3     | P1       | The check replaced good answers on everyday wording (glassware, cuisines, Dutch "open je twee flessen")            | Fixed (P3); a doubtful name alone now removes one sentence, not the answer                       |
| 4     | P1       | Invented bottles and impossible actions kept ("Serve the Sassicaia", "I've set it aside")                          | Fixed (P3)                                                                                       |
| 5     | P2       | Vintages and counts in other formats                                                                               | Fixed (P3); the remaining misses are listed in the module                                        |
| 6     | P2       | Prices without a currency sign; shops not on the list                                                              | Fixed (P3)                                                                                       |
| 7     | P2       | The model's words can contradict the card's temperature, decanting time or years                                   | **Open.** The model is told the facts; nothing checks that it used them                          |
| 8     | P2       | A comparison read where there was none replaced the model's own pick                                               | Fixed (P6): the pair are the cards only when the model pointed at one of them                    |
| 9     | P2       | Non-menus read as menus (another day, the past)                                                                    | Fixed (P6)                                                                                       |
| 10    | P2       | A made-up course wine shown as "nothing suits"                                                                     | Fixed (P6): "no wine could be chosen"                                                            |
| 11    | P2       | Menu arithmetic summed a shared wine after rounding                                                                | Fixed (P5)                                                                                       |
| 12    | P2       | Guest counts carried over or read where there were none                                                            | Fixed (P5)                                                                                       |
| 13    | P2       | An answer the check replaced had no text: an older screen broke on it                                              | Fixed (P3): the server puts the card sentence on the answer                                      |
| 14    | P2       | Latency at 3,000 wines                                                                                             | Fixed: one cellar index per question; see §3                                                     |
| 15    | P2       | Serving wording a professional would correct; rules of thumb forced on the model                                   | Fixed in wording and marking (P4); **the tables themselves are not reviewed by a person**        |
| 16–19 | P3       | Cosmetic refs, test gaps, a register evidence, copy                                                                | Fixed, except: the fallback's "closest" card carries no facts (kept as is)                       |

The reviewer's own limits: it is an AI, it wrote its adversarial sentences itself, and it ran no browser test.

## 5. Acceptance criteria that are not met

1. **Quality against V1 with AI is unmeasured** (first bottle, no poor bottle, useful answer), for prompt v7 and for
   menus. Needs the owner's budget approval; the harness, the sets and the estimate are ready.
2. **No wine professional has reviewed anything**: not the serving and decanting tables, not the sample of 50
   annotations, not the engines' knowledge behind the fallback (R-01), not the benchmark labels.
3. **No human holdout** (escrowed, D-44): empty until people write it.
4. **The check's behaviour on real model output is unknown**: how often the model writes refs as asked, how often a
   good answer is trimmed. The corpus that measures 0 false positives was written by agents.
5. **Cost for a new menu exceeds the proposed +10%** on the worst-case estimate.
6. **The model's words are not checked against the card's serving facts** (finding 7).
7. **No person has used it on a device.** Phone behaviour is proven by automated browser tests and screenshots.
8. **Full CI on the final commits of each branch**: started by hand for all four branches; see the pull requests'
   checks for the outcome. The run on the integration branch predates the review fixes.

## 6. The original Sommelier pull requests

Nothing was closed or merged by the agent. Proposal, for the owner to carry out:

| PR   | State                             | What V1+ took from it                                                                     | Not taken, and why                                                                                           | Proposal                                                                                                                                                  |
| ---- | --------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #98  | Closed by the owner on 2026-11-23 | Its documents were superseded by P1 (#122)                                                | –                                                                                                            | Done                                                                                                                                                      |
| #100 | Open draft                        | P2 (#123): the V1-with-AI harness, the spending guard, the holdout sets                   | The S9 rule tuning (the engine does not choose); the friend cellar and migration 0053 (deferred with social) | **Close now.** Its code is on `main` since #123                                                                                                           |
| #104 | Open draft                        | P2: the by-bottle quality measures, the human-holdout frame                               | The dish reader, the second opinion, the cache: measured, no gain                                            | **Close now.** Keep the branch as a reference                                                                                                             |
| #106 | Open draft                        | P2: the dish-clustered statistics and the comparison tool                                 | The guard (variant E): only measured without the model; its own later project                                | **Close now.** Keep the branch; the guard is written down as deferred (closeout §4.4)                                                                     |
| #95  | Open draft                        | P4, P5 (#129): the serving refinements, the quantity and keeping routing. P6: `parseMenu` | The engines' orchestration, `planMenu`, `asksPairing`, `asksWhichOf`, the plan's own experience fields       | **Close after P6 is merged** (it still holds `parseMenu` until then)                                                                                      |
| #94  | Open                              | Nothing (social sommelier, migration 0051)                                                | Needs the engine to choose; consent wording and a security review first (D-48)                               | **Keep as an unmerged draft** until the social project starts; it is not marked draft on GitHub today, which invites a merge by accident: set it to draft |
| #97  | Open draft                        | Nothing (outcome learning, migration 0052)                                                | Outcomes kept without expiry or export; needs an engine plan                                                 | **Keep as an unmerged draft** until the learning project starts                                                                                           |

When #95, #100, #104 and #106 are closed, the two inert switches `sommelier_social` and `sommelier_experiences` can
be removed from `main` (they are read nowhere; they were kept only because those branches name them). #94 names
`sommelier_social`, so that removal waits for a decision on #94.

A closing comment per pull request (what was taken, by which PR; what was not, and why; what risk remains) is drafted
in §9.

## 7. GO / NO-GO for the technical completion

| Question                                                      | Answer                                                                                                                          |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Merge #128 (P3) and #129 (P4+P5) with every part off          | **GO**, once their CI is green. With no part named, V1 is byte for byte what it is on `main`                                    |
| Open and merge P6 and P7 after them                           | **GO**, in that order. Both branches are complete, reviewed and green alone; each is merged with `main` first                   |
| Switch `annotate` and `quantities` on in a Preview deployment | **GO** for a trial by the owner. They do not change what the model is asked for an ordinary question                            |
| Switch `check` or `menu` on for real people                   | **NO-GO** until the paid comparison (v7 against v6; the menu set) has been run and read                                         |
| Switch `fallback` on in production                            | **NO-GO** until a wine professional has reviewed the engines' knowledge (D-49). The free measurement is in its favour           |
| Claim "better advice"                                         | **NO-GO** until the human holdout and an expert review exist. Until then: "the same choices, more facts, fewer unproven claims" |
| Technical completion of P3 to P7                              | **GO**: built, combined, reviewed, P0 and P1 findings fixed. What remains is measurement and people, listed in §5 and §8        |

## 8. What is missing for P8, the release

**Owner decisions**

1. The budget for the paid runs (D-51): the baseline of V1 with AI (three sets, three runs: proposal $2), v7 against
   v6, and the menu set (free estimate for one run of the menu set: reserve $0.06).
2. The gate's thresholds (D-50), including what to do with the menu's cost on the worst-case estimate.
3. Who writes the human holdout and who the wine expert is.
4. Closing #100, #104, #106 now and #95 after P6; setting #94 to draft.

**Work**

1. Merge P3 to P7 in order (the agent merges `main` into each next branch and reruns its checks).
2. The paid runs, with the vectors committed; then the gate of §5 can be read for real.
3. The expert review: the serving and decanting tables, the sample of 50 annotations, the engines' knowledge.
4. Finding 7: either check the model's serving words against the card, or accept it after seeing how often the model
   ignores the facts block in the paid run.
5. A Preview deployment with `CELLR_SOMMELIER` set, and a walkthrough by a person on a phone and a desktop in both
   languages; a read-only check that Production does not set it.
6. The order of activation on Production, each part watched for a week: `check`, then `annotate` and `quantities`,
   then `menu`, then `fallback` (closeout §7).
7. A last small pull request from the integration branch: the combined tests, the journey test, the benchmarks, the
   register's final notes, this report, and `STATUS.md`.

## 9. Drafts of the closing comments

**#100** — "Closed as taken over. On `main` since #123 (P2): the V1-with-AI evaluation through the app's own service
(`engines/v1-ai.ts`), the spending guard (`paid.ts`), and the holdout sets. Not taken: the S9 rule tuning, because in
V1+ the model chooses and the engines only answer when there is no model; the friend cellar and migration 0053, which
are deferred with the social sommelier (D-48). Remaining risk: the labels of the holdout sets are AI-written (R-01)."

**#104** — "Closed as taken over. On `main` since #123: the by-bottle quality measures and the frame for the human
holdout. Not taken: the AI dish reader, the second opinion and the dish cache; measured on this branch, they gave no
gain over the engine alone and cost extra calls. The branch stays as a reference."

**#106** — "Closed as taken over. On `main` since #123: the dish-clustered statistics and the comparison tool, which
the fallback's measurement (P7) uses. Not taken: the guard (variant E), which was only measured without the model and
needs a shadow run of its own; it is written down as a later project (closeout §4.4). The V1+ architecture proposed
here is what P3 to P7 built."

**#95** (after P6 is merged) — "Closed as taken over. By #129 (P4, P5): the serving refinements and the quantity and
keeping routing. By P6: `parseMenu`. Not taken: the engines' orchestration and `planMenu`, because in V1+ the model
chooses the wine for each course; `asksPairing` and `asksWhichOf`, replaced by recognising two named cellar wines."

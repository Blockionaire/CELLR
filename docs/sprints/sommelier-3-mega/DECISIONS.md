# Sommelier 3.0 — decision log

One entry per decision that shapes the code. An entry is never rewritten: a change of mind is a new entry that names
the one it replaces.

| ID   | Date       | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Rejected, and why                                                                                                                                                                                                                                 |
| ---- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-01 | 2026-11-19 | **The engine decides, the model words.** Verdict, bottles, buying styles and the next question are computed in code. A model may only (a) read a dish the food engine could not, onto the same closed vocabulary, and (b) word a plan that is already fixed.                                                                                                                                                                                                                                                             | Keeping V1's design (the model judges, code checks the references): the verdict and the buy list cannot be verified, there is no answer of the same quality without AI, and every question costs a call.                                          |
| D-02 | 2026-11-19 | **Extend, do not replace.** The legacy 46-dish table, `scorePairing` and Tonight stay and keep serving every existing screen while the switches are off. The new engine is a second implementation behind `sommelier_engine`, compared with the old one on the benchmark.                                                                                                                                                                                                                                                | Rewriting `pairing.ts` in place: no way back by configuration, and every existing Tonight and sommelier test would change meaning at once.                                                                                                        |
| D-03 | 2026-11-19 | **Knowledge is code, in a server-only entry.** Food knowledge and the style catalogue are typed TypeScript tables in `packages/domain`, exported from `@cellr/domain/intelligence`. Reviewed in pull requests, versioned with the code, tested by the benchmark.                                                                                                                                                                                                                                                         | Database tables: a migration and an admin screen for data that changes with the code and needs review, not editing in production. A JSON download: no types, no review. Exporting from the main entry: the tables would reach the browser bundle. |
| D-04 | 2026-11-19 | **Three outcomes from thresholds on evidence, not a percentage.** A wine's fit is an internal ranking number. What people see is good match / acceptable / nothing suits, reasons in words, and a confidence word that follows from the evidence tiers.                                                                                                                                                                                                                                                                  | Showing the score as "87% match": it claims a measurement that does not exist.                                                                                                                                                                    |
| D-05 | 2026-11-19 | **Evidence tiers are part of the wine profile type.** `exact` (the vintage's profile with `exact_wine` or `producer` evidence and confidence not low), `appellation` (appellation or grape rules), `estimate` (colour and regional style), `unknown` (colour only).                                                                                                                                                                                                                                                      | A single confidence number: it hides which facts are the wine's own.                                                                                                                                                                              |
| D-06 | 2026-11-19 | **Conversation state is recomputed, not stored.** Each request folds the turns the screen sends (at most 12) into a typed state. The server keeps no budget, dish or location between requests.                                                                                                                                                                                                                                                                                                                          | A state table: a second source of truth next to the kept messages, with its own expiry, RLS and revocation rules, for no gain at this conversation length.                                                                                        |
| D-07 | 2026-11-19 | **Buying advice is a style until a provider proves more.** The engine recommends wine styles with a typical price band. A product, an online offer or local stock is only claimed when a registered provider's offer passes validation. No provider is registered.                                                                                                                                                                                                                                                       | Letting the model name a bottle, a price and a shop (V1's `buy` list): it cannot be checked and reads like an offer. Web search by the model: unverifiable, and scraping retailers is not licensed.                                               |
| D-08 | 2026-11-19 | **Friend data needs its own consent for AI use.** Sharing taste with friends today means "my friends may look at it". Feeding it to a friend's sommelier is a new use, so it gets a separate setting, off by default, checked in the same request as the answer.                                                                                                                                                                                                                                                         | Reusing the existing `taste = friends` default: it would silently widen what people agreed to.                                                                                                                                                    |
| D-09 | 2026-11-19 | **Answers that used a friend's data are not kept.** Such a turn is answered and shown, but not written to the stored conversation; so nothing derived from a friend survives a revocation on the server.                                                                                                                                                                                                                                                                                                                 | Storing and purging on revoke: needs a trigger on every sharing change and still leaves a window; storing a redacted copy: the redaction is the hard part.                                                                                        |
| D-10 | 2026-11-19 | **The benchmark's reference answers are labels, not engine output.** Thirty archetype wines, reference dish cards with good / acceptable lists, scenarios with typed expectations. Engines are run through adapters; the V1 baseline is the app's own service.                                                                                                                                                                                                                                                           | Scoring an engine against its own score table (circular); model-graded answers (not reproducible, and costs money).                                                                                                                               |
| D-11 | 2026-11-19 | **Food and style data carry provenance and a review status.** Every knowledge entry was drafted by the engineering agent from general culinary and wine knowledge (no recipe text or third-party database copied), validated by automated rules and the benchmark, and marked `reviewed: false` until a person with wine expertise has checked it. The switches stay off until then.                                                                                                                                     | Presenting the data as expert-validated: it is not.                                                                                                                                                                                               |
| D-12 | 2026-11-19 | **Replaces D-06. State travels with the conversation, as an untrusted hint.** The answer returns a compact, versioned `state`; the screen sends it back with the next question; the server validates its shape, folds the new turn into it, and re-checks every id against the cellar and the friends. Review finding 1: turns carry only what was said (800 characters, the last 10), basic answers are worded on the client, and a bare "20" or "online" cannot be read without knowing what was asked.                | D-06 as written (recompute from the turns alone). A server-side state table (see D-06).                                                                                                                                                           |
| D-13 | 2026-11-19 | **Replaces D-09. A social turn is kept as a redacted skeleton, and assistant text from a client is never treated as fact.** For a turn that used a friend's context the kept message holds the question and the state, with no bottles, reasons or wording; the answer says it is private (no thumbs, gone on reload). With `sommelier_social` on, the engine never folds or forwards assistant text that a client sent. Review finding 3: an unkept answer stays in the screen's cache and comes back as "chat so far". | D-09 as written ("not kept"): the text returns through the client's history and is then stored with the next answer.                                                                                                                              |
| D-14 | 2026-11-19 | **A social answer is never worded by a model.** When a friend's context is in play the plan is worded by templates. So nothing a friend shared reaches a third-party AI provider, whatever the consent says about CELLR's own use.                                                                                                                                                                                                                                                                                       | Aliasing people in the prompt ("Guest 1"): the taste itself still leaves CELLR.                                                                                                                                                                   |
| D-15 | 2026-11-19 | **Friend context is closed words and numbers from one new function.** `friend_taste` (favourite wine names, free-text words) and `friend_cellar` (a whole household's bottles on one member's consent) are not used by the engine. A friend's cellar is not part of S5's AI context; "what does @x own that suits us" is answered only from what the existing friend screen may already show the asker, by the engine, without a model. Review finding 4.                                                                | Reusing `friend_taste`: free text written by another user is a prompt-injection path and exposes more than group taste needs.                                                                                                                     |
| D-16 | 2026-11-19 | **"Exact" means what the shared-profile rule means.** Tier `exact` requires a researched profile with `exact_wine` evidence, high confidence and a source. `producer` and `appellation_rules` evidence count as `appellation`. Review finding 5: `producer` is what an unsourced exact claim is downgraded to (`insights.ts`).                                                                                                                                                                                           | D-05's first mapping (`producer` as exact).                                                                                                                                                                                                       |
| D-17 | 2026-11-19 | **Two named AI tasks, and V1's answer loses `verdict` and `buy` when the engine is on.** `sommelier_wording` and `food_interpretation` are added to the task list and the budget modes. General questions still go to V1's prompt, but its verdict and buy list are dropped from the answer, so no model-made price or product is shown while the engine is on. Review findings 6 and 7.                                                                                                                                 | Reusing `sommelier_chat` for everything: V1 and 3.0 costs could not be told apart, and an unlisted task is silently never called.                                                                                                                 |
| D-18 | 2026-11-19 | **Simpler shape.** No `server/buying` or `server/social` directory: offers are an interface and a validator in the domain (no provider exists), friend context extends `server/friends`. The three later switches require `sommelier_engine`. Review finding 11.                                                                                                                                                                                                                                                         | Empty registries and one directory per phase.                                                                                                                                                                                                     |

## D-19 — The sommelier switches are never turned on by `all`

**Decided in S3.** `CELLR_FEATURES=all` turns on every switch except the five of the sommelier (the fifth, `sommelier_learning`, came in
S7); each of those must be named, and four of them do nothing without `sommelier_engine`. **Why:** a deployment set to `all` for an earlier
epic must not start a later one by accident (R-02). **Rejected:** trusting that no deployment uses `all`.

## D-20 — A question that names a friend is not kept at all (replaces the "redacted skeleton" of D-13)

**Decided in S5.** Neither the question (it holds the name) nor the answer (it was shaped by what the friend
allowed at that moment) is stored; the reply says so (`saved: null`). **Why:** then there is nothing to take back
when a friend withdraws or the friendship ends, and no rule about what a skeleton may hold. **Cost:** such an
answer cannot be rated and is gone after a reload.

## D-21 — With the social sommelier on, no name reaches a model, whatever path a question takes

**Decided in S5, after the security review.** D-14 said a social answer is never worded by a model; the review
showed three ways a name still reached one (a question of fact that named a friend, an earlier turn sent along as
history, the engines failing). Now, with the switch on: a question that holds anything like a name is answered by
the engines or the counted facts or not at all, and every text sent to a model has anything like a name taken out
first. With the switch off a name is the person's own text, as it always was.

## D-22 — The friend context returns catalogue values only, and limits itself

**Decided in S5, after the security review.** A region counts only for a wine of the reviewed catalogue (a
household can type anything as the region of its own wine); numbers are clamped in SQL; the function counts each
call against the caller's own limit, since it can be called directly with a person's own token and not only by
the app.

## D-23 — An outcome is its own record, and the database decides what it is about

**Decided in S7.** What came of a bottle (opened, with the dish, how the two went) is stored apart from the thumb
on the answer, and neither is ever computed from the other. The database function, not the client, decides
whether the answer offered the bottle and copies what the answer was. **Rejected:** a `pairing_success` flag on
the feedback row (one click that means two things); deriving "opened" from the cellar's drink action (it would
claim a pairing the person never said they had); storing the dish (with a small household it says what they ate).

## D-24 — No cache across questions

**Decided in S7.** The engines keep what they read for one question only. Measured p95 of their own work: 4.4 ms.
A cache keyed by household would need its key to be right in every code path for ever, and would save nothing
that is felt. The safety property (nothing of one question or household in another's answer) is tested as it
stands. **Revisit** when a profile read or a provider call makes a question slow; then cache the pure reading of
a wine by its own fields, never anything keyed by who asks.

## D-25 — The duplicate model call (#76) stays open

**Decided in S7.** The fix needs a claims table, a new client-visible status and a cleanup path. The issue's own
condition for doing that is evidence of double sends in production, which this work did not read. The engines
take most questions away from the model altogether, which shrinks the exposure. The query that decides it is in
`COST_REPORT.md`.

## D-26 — Outcomes are reported, not fed back automatically

**Decided in S7.** No rule, order or prompt changes from outcomes or thumbs without a person looking. Self-reports
from a few households are a signal to look at a pairing rule, not a measurement of it.

## D-27 — Correction to D-17: no model wording or interpretation was built

**Recorded in S8, after the final review.** D-17 says two AI tasks (`sommelier_wording`, `food_interpretation`)
are added. They were not: the plan is drawn by fixed sentences and the food engine has no model. No such task is
in the task list or the budget. The other half of D-17 holds and is now also true with buying advice off: while
the engine is on, V1's model-made verdict and buy list are dropped from every answer.

## D-28 — A lower pull request that changes is merged upward, not rebased

**Recorded in S8.** The final review's fixes belong to S3 and S5. They were committed there and merged into each
branch above (S5, S6, S7, S8), so no pushed branch with an open pull request was rewritten.

## D-29 — A friend's cellar may be used, with a consent of its own (replaces part of D-15)

**Recorded in S9.** D-15 said a friend's cellar is never used. The brief asks for it ("what does he own that
suits both of us", "a present he does not already own"), so "never" left two requirements unbuilt. S9 builds
them behind a second consent (`cellar_for_friends`, off by default), on top of the existing rule for who may see
a cellar; neither alone is enough. Only the identity of the wines crosses over. The taste consent of D-15 is
unchanged and independent.

## D-30 — A friend's name is carried by the asker's own questions, never by the state

**Recorded in S9.** A follow-up that names nobody is about the friend the conversation named. The name is read
from the asker's earlier questions in the request, not written into the conversation state (which is echoed back
by the screen and could be kept), and never read from an answer. The database is asked again each time. The
benchmark expects the name in the state (`recipient`); that expectation is not met on purpose.

## D-31 — A holdout set, and no label or scorer change in S9

**Recorded in S9.** The main set's labels, fixtures, thresholds and scorer are unchanged, including one scorer
defect that makes five scenarios impossible to pass (`progress/S9.md` §2.6): fixing it in the sprint that reports
improved scores would look like, and partly be, moving the goalposts. New scenarios go in separate sets
(`sets.ts`); the second half of the holdout stays blind (`analyze` refuses it).

## D-32 — Paid model calls in the benchmark need the owner's phrase

**Recorded in S9.** The harness for V1 with AI estimates by default and sends nothing. A real run needs
`SOMMELIER_EVAL_PAID=owner-approved` and a key, skips what V1 cannot attempt, and stops at a spending limit. The
agent sets neither value.

## D-33 — A model reads dishes, in the engine's vocabulary, and the engine still decides (S10)

The model is asked what a dish is, never what to drink. Its answer is a profile in closed lists and fixed scales,
checked by code and merged with what the person wrote. This keeps the guarantees of 3.0 (nothing invented, honest
"nothing", no friend data in a prompt) whatever the model says.

## D-34 — The model sees the dish phrase only (S10)

Not the question, the conversation, the cellar, a taste or a friend; nothing for a question that names a friend.
This makes a reading a function of the phrase, which is what allows sharing it (D-35), and keeps the friends'
consent text true.

## D-35 — Dish readings are shared, in memory, without text (S10)

`DISH_CACHE.md`. A table shared by every instance is designed and not built: it needs a migration and a secret.

## D-36 — Fewer, surer bottles (S10)

After the first pick only picks with nothing against them; one bottle for a dish that is a guess. Set on the
readable sets, checked once on the blind half. It never changes the first pick or the outcome, so it can only
make an answer more careful.

## D-37 — The second opinion is an experiment that can only take away (S10)

It may reorder or drop the engine's own picks, or say none suits; never add or raise. Behind its own switch,
which needs the dish reading. Not to be switched on unless the paid run shows it helps.

## D-38 — The decision rule for activation is written before the paid run (S10)

`HYBRID_EVALUATION.md` §6. If the best hybrid is not at least as good as V1 with AI on the first bottle and as safe
on poor bottles and "nothing suits", on the unseen dishes, the advice is no activation.

## D-39 — No model for a conversation with any "@" in it; a follow-up re-reads only what a model has seen (S10)

Found by the independent security review: a malformed mention is still someone's name. The engines now ask no model
anything about a conversation in which any turn the screen sends holds an "@". A follow-up's dish is the phrase a
model already read (from the store, or read again), never a dish that came from a question naming someone; the
conversation's state marks which is which (`dishReadByModel`).

## D-40 — V1 with AI stays the default; S11 tests "V1 decides, the engine vetoes" (S10)

The paid comparison did not meet the rule set before it (D-38). The engine is kept for what it measurably does
better (honesty about "nothing suits", groundedness), as a guard on V1's answer rather than in its place. No tuning
on the blind half after the run.

## D-41 — V1+: V1's model chooses, code supplies facts, rules and a guard (S11)

Two measurements (S9, S10) showed V1 with AI generalises better to unfamiliar dishes than any engine variant. The
engines stay for what code does reliably: inventory and refs (groundedness), permissions, budgets, drink windows,
consent, and flagging a hard clash. `V1PLUS_ARCHITECTURE.md`.

## D-42 — The guard is frozen before it is measured, and only ever cautions (S11)

`GUARD_VERSION` 1 was chosen on the main set and committed before the unseen sets were run; it is not tuned on
their results. If it is ever made active it adds a caution to V1's card and does not remove the bottle: V1's text
names the wines it chose, and a removed card would leave a sentence about a bottle no longer shown.

## D-43 — Comparisons draw dishes, not runs or scenarios (S11)

Repeated runs of a scenario are averaged inside it, and the bootstrap resamples dishes, because scenarios about one
dish are not independent either (the 88 unseen scenarios are 44 dishes; the human holdout's 200 will be 100).
`stats.ts`. S10's conclusion was re-checked this way and stands.

## D-44 — The human holdout is held in escrow (S11)

Never in the repository: read from the owner's path and checked against a committed seal. The S10 expert sheet is
a label audit of the development set, not the independent panel (`HUMAN_EVALUATION_PROTOCOL.md`).

## D-45 — Social stays engine-only until the owner chooses A or B (S11)

No friend's name, taste, cellar or question reaches a model (D-14, D-29, D-39 unchanged). Option B (V1's model picks
from the asker's cellar for the dish only, code applies the friend's consented taste and cellar) relaxes D-39 and
needs the owner's approval and new consent wording. `V1PLUS_ARCHITECTURE.md` §7.

# Sommelier 3.0 — risk register

Open risks, most serious first. A risk leaves this table only with the evidence that closed it (it then moves to the
closed list at the bottom).

| ID   | Risk                                                                                                                                                                                | Likelihood | Impact | Mitigation                                                                                                                                                             | Owner | State |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----- |
| R-01 | The food and pairing knowledge was written by an AI agent and has not been checked by a wine professional. Wrong labels make a confident wrong recommendation.                      | Medium     | High   | Provenance and `reviewed: false` on every entry (D-11); conservative rules; the benchmark; switches off until a human review. The benchmark's labels share this limit. | Owner | Open  |
| R-02 | A deployment has `CELLR_FEATURES=all`. Since D-19 that turns on **none** of the five sommelier switches (tested); what remains is someone naming a switch in the wrong environment. | Low        | High   | Owner confirms the value for Production and Preview in Vercel before each merge (this tooling cannot read it).                                                         | Owner | Open  |
| R-03 | Migration order: PR #88 adds `20261124000047`. A later-numbered migration of this work applied first would make 0047 unappliable (the CLI refuses an older version).                | Medium     | Medium | This work's migrations are numbered after 0047 and released after it; `RELEASE_PLAN.md` states the order. If #88 is abandoned, nothing changes for this work.          | Owner | Open  |
| R-04 | V1's AI path (the one most people use) is not measured: no model key is available here, and using one is a cost the owner must approve.                                             | Certain    | Medium | The baseline measures V1 without AI and says so. `server/ai/live.test.ts` and the benchmark can run with the owner's key later.                                        | Owner | Open  |
| R-05 | No approved retailer data source exists. Live discovery cannot be delivered, only the architecture and an honest fallback.                                                          | Certain    | Medium | D-07; provider interface, validation and tests with fixtures; the feature reports "no shop connected".                                                                 | Owner | Open  |
| R-06 | Friend data reaching a model prompt, a log or a stored answer after sharing was withdrawn.                                                                                          | Low        | High   | D-08, D-09; permission read per request; no friend text in logs or analytics; cross-user tests; an independent security review in S5.                                  | Agent | Open  |
| R-07 | Alcohol marketing and age rules for showing offers and retailer links (Netherlands and EU).                                                                                         | Certain    | Medium | No offers are shown (R-05). Before a provider is switched on: legal check by the owner, age statement, no promotion to minors, no affiliate ranking.                   | Owner | Open  |
| R-08 | The new engine ranks differently from Tonight for the same cellar; people notice changed picks.                                                                                     | Certain    | Low    | Behind `sommelier_engine`; the benchmark compares both; differences are listed in `progress/S2.md`.                                                                    | Agent | Open  |
| R-09 | Parallel work touches the same files (`server/services.ts`, `features.ts`, the architecture registry, `ci.yml`).                                                                    | Medium     | Low    | Small, additive edits; each PR is rebased on `main` before review; the registry test catches a missed registration.                                                    | Agent | Open  |
| R-10 | `main`'s end-to-end run is red on the known 3D tests; a new end-to-end failure of this work could hide among them.                                                                  | Medium     | Medium | Run the sommelier, Tonight and taste specs locally for every phase and list each failing spec by name.                                                                 | Agent | Open  |

## Closed

None yet.

## R-11 — Four thresholds of S0 are missed

**What.** Against the thresholds set in S0 before any engine existed (`BASELINE.md` §4), at the final state, in
the app:

| Threshold                          | Needed | Engines alone (S2) | In the app (final) | V1 without AI |
| ---------------------------------- | -----: | -----------------: | -----------------: | ------------: |
| The first bottle is labelled right |    80% |                68% |      73% (116/159) |           32% |
| No offered bottle is a poor match  |    90% |                73% |      72% (102/141) |            8% |
| Says "nothing" when nothing suits  |    90% |          86% (6/7) |        89% (16/18) |           14% |
| Pairing scenarios passed           |    70% |                  — |       54% (80/148) |   7% (10/148) |

Met: the dish understood (92%, needed 90%), the outcome (88%, needed 85%), no invented wine (100%), latency.
Earlier versions of this entry and of `BASELINE.md` §7 said "two": they counted only the two S2 thresholds.

**Why it matters.** The thresholds were set before the engine existed as the bar for "better than a competent
guess". Missing them means the claim "the first bottle is the right one" is not yet supported.

**What is known.** Part is ties (a labelled-good wine at the same score), part is labels that call sound wines poor
(only three to five wines per dish are listed as good), part is real weaknesses of the rules (`progress/S2.md`).
The benchmark cannot separate these without a wine professional's judgement.

**Mitigation.** The textbook test (46 classics, 15 clashes) holds on the real knowledge; hard clashes are never
offered (reviewed and attacked); the engine says "nothing suits" rather than force a bottle.
**Owner decision.** Have a wine professional review the 107 dish cards and the 3,210 pair labels (or a sample), then
re-measure. Until then the switch should not be turned on in Production.

## R-12 — Named-only switches

**What.** `CELLR_FEATURES=all` does not turn on the five sommelier switches; each must be named.
**Why.** A deployment set to `all` for an earlier epic must not start this one by accident (R-02).
**Residual.** Someone who expects `all` to mean all will find the sommelier still off. `docs` and the registry say so.

## R-13 — Outcome signals are sparse and self-reported

**What.** Most people will not say what came of a bottle; those who do are not a sample.
**Why it matters.** A share on a page looks like a measure.
**Handled.** The report shows counts next to every share and says that small numbers prove nothing; nothing is fed
back automatically (D-26).
**Residual.** Someone may still read 3 of 4 as 75%.

## R-14 — An applied migration is live in the database whatever the app's switches say

**What.** Migrations 0048 and 0049 grant their functions to every signed-in person. Once applied they can be
called through the API directly, also while the app's switches are off.
**What that allows.** 0048: turning one's own consent on or off; asking about one's own accepted friends, which
returns taste signals only for a friend who turned their own consent on (off by default for everyone). 0049:
recording one's own outcome for a bottle one's own kept plan offered (no plan is kept while the engine is off).
No other person's data in either case; both limited per person.
**Why it matters.** "Off until the owner switches it on" holds for the app, not for the database: applying a
migration is itself a release step.
**Handled.** Said in both migration headers and in `RELEASE_PLAN.md`; the migrations are applied only when the
owner decides, right before the switch that needs them.
**Residual.** A person with their own token could set their consent before the screen for it exists. It would
have no effect until a friend's sommelier asks, which needs the app's switch.

## R-15 — The main benchmark flatters the engine (found in S9)

**What.** The engine has been developed against the 246 scenarios of the main set since S1. On 88 new scenarios
about dishes it had never seen, it understands 72% of the dishes (92% on the main set) and passes 43% (69%).
The rise of "first bottle" on the main set in S9 (73% → 83%) did not appear on the new scenarios at all.
**Why it matters.** Every number in `FINAL_REPORT.md` is from the main set. Read alone they overstate what a
person with their own dinner will get.
**Handled.** A holdout set, half of it blind, pinned in the tests (`progress/S9.md` §2.4); both sets are reported
side by side from now on; S9 stopped tuning when further changes moved only the main set.
**Residual.** The blind half is 43 scenarios by one author: a small sample, and blind only until someone tunes on
it. A second holdout, written by a person, is needed before more tuning. The switch should not be on in
Production while recognition of unseen dishes is at this level.

## R-16 — A friend's cellar in someone else's answer (S9)

**What.** With `sommelier_social` on and migration 0050 applied, a person's wines can appear in a friend's
sommelier answer.
**Why it matters.** It is the first time 3.0 shows one person's possessions to another. A wrong default or a
missed check is a privacy breach, not a bad recommendation.
**Handled.** Three conditions, all checked by the database in every request: accepted friendship, the cellar
shown to that friend under the existing sharing rules, and a separate consent that is off by default. Wine
identity only: no counts, places, ratings or notes. Nothing that names or uses a friend is kept or sent to a
model. SQL tests for each condition, withdrawal, strangers, pending and ended friendships; a browser test with
two accounts; an independent review (`progress/S9.md` §7).
**Residual.** "Not among the wines they share" still tells the asker something about a friend who consented: that
is the feature, and the consent text says so. The consent wording needs the owner's approval. The answer compares
by style and appellation, so a wine the engine cannot place excludes nothing.

## R-17 — A routine `db push` after merging this stack releases its migrations (S9)

**What.** When S9 was written `main` held migration 0047 unapplied. The owner has since applied it: Production
records 0001–0047 (checked read-only, 2026-11-20) and `main` is level with it. The risk that remains is this
work's own: once #94, #97 or #100 is merged, a `db push` from `main` applies 0048, 0049 or 0050.
**Handled.** Said at the top of `RELEASE_PLAN.md` and in `docs/MIGRATIONS.md`.
**Residual.** Someone who merges the stack and runs a routine `db push` releases up to three migrations at once.

## R-04, closed in S9 — V1's AI path is measured

Run on 2026-11-20 (`AI_COMPARISON.md` §8–§9). The risk it stood for has become a finding: 3.0 is not shown to be
better than today's sommelier with AI, and on unseen dishes the model offers far fewer poor bottles and better
first bottles. Turning the engine on for everyone today would, on unfamiliar dishes, replace better advice with
worse advice that is cheaper and faster. That is the first reason for the NO-GO in `RELEASE_PLAN.md` §7.

## R-18 — A model's reading of a dish (S10)

**What.** With `sommelier_dish_ai` on, a model describes dishes the parser could not place, and the engines pair
on that description.
**Why it matters.** A wrong reading gives a wrong pairing; a model's reading could also carry text the person
wrote to a provider.
**Handled.** The model sees the dish phrase only (no names, numbers, prices or words about the people, the
occasion or the budget) and never a question that names a friend; it answers in closed lists and fixed scales,
checked by code; it never names a wine; its reading is never "sure", so the answer never sounds certain; any
failure is the parser's reading. Budget mode closed, its own rate limit, usage recorded.
**Residual.** The phrase is built from the food and its neighbours, without names, numbers or personal words
(tested on every input an independent review tried); a name written in lower case right next to the food word can
still pass. V1 sends the whole question today. 2–5% of questions are misread by the parser with confidence and never
reach the model. The value of C is not measured yet (paid run).

## R-19 — Shared dish readings (S10)

**What.** A reading may be given to the next person who asks about the same dish phrase.
**Handled.** `DISH_CACHE.md`: the value has no text and is a function of the phrase alone; the key is a hash of
every version and the phrase; TTLs; in memory only, no table.
**Residual.** Timing tells that someone asked about the same phrase before. A store shared by every instance needs
an HMAC key and a migration (designed, not built).

## R-20 — A model's second opinion (S10, experiment)

**What.** With `sommelier_second_opinion` on, a model may reorder or leave out the engine's picks in a close call.
**Handled.** It sees styles only; its answer is checked against the refs it was given; it can only take away.
**Residual.** It could leave out a good bottle or say "none" where something suits; whether it helps at all is
what the paid run measures. Not to be switched on before that.

## R-15, update (S10)

The S10 upper bound shows that on unseen dishes a perfect dish reading does not raise "first bottle right". The
gap to V1 with AI is in the pairing judgement; widening the dish knowledge alone will not close it.

# Sommelier 3.0 — risk register

Open risks, most serious first. A risk leaves this table only with the evidence that closed it (it then moves to the
closed list at the bottom).

| ID   | Risk                                                                                                                                                                 | Likelihood | Impact | Mitigation                                                                                                                                                             | Owner | State |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----- |
| R-01 | The food and pairing knowledge was written by an AI agent and has not been checked by a wine professional. Wrong labels make a confident wrong recommendation.       | Medium     | High   | Provenance and `reviewed: false` on every entry (D-11); conservative rules; the benchmark; switches off until a human review. The benchmark's labels share this limit. | Owner | Open  |
| R-02 | A deployment has `CELLR_FEATURES=all`: every new switch would be on there the moment the code is deployed.                                                           | Low        | High   | Owner confirms the value for Production and Preview in Vercel before each merge (this tooling cannot read it).                                                         | Owner | Open  |
| R-03 | Migration order: PR #88 adds `20261124000047`. A later-numbered migration of this work applied first would make 0047 unappliable (the CLI refuses an older version). | Medium     | Medium | This work's migrations are numbered after 0047 and released after it; `RELEASE_PLAN.md` states the order. If #88 is abandoned, nothing changes for this work.          | Owner | Open  |
| R-04 | V1's AI path (the one most people use) is not measured: no model key is available here, and using one is a cost the owner must approve.                              | Certain    | Medium | The baseline measures V1 without AI and says so. `server/ai/live.test.ts` and the benchmark can run with the owner's key later.                                        | Owner | Open  |
| R-05 | No approved retailer data source exists. Live discovery cannot be delivered, only the architecture and an honest fallback.                                           | Certain    | Medium | D-07; provider interface, validation and tests with fixtures; the feature reports "no shop connected".                                                                 | Owner | Open  |
| R-06 | Friend data reaching a model prompt, a log or a stored answer after sharing was withdrawn.                                                                           | Low        | High   | D-08, D-09; permission read per request; no friend text in logs or analytics; cross-user tests; an independent security review in S5.                                  | Agent | Open  |
| R-07 | Alcohol marketing and age rules for showing offers and retailer links (Netherlands and EU).                                                                          | Certain    | Medium | No offers are shown (R-05). Before a provider is switched on: legal check by the owner, age statement, no promotion to minors, no affiliate ranking.                   | Owner | Open  |
| R-08 | The new engine ranks differently from Tonight for the same cellar; people notice changed picks.                                                                      | Certain    | Low    | Behind `sommelier_engine`; the benchmark compares both; differences are listed in `progress/S2.md`.                                                                    | Agent | Open  |
| R-09 | Parallel work touches the same files (`server/services.ts`, `features.ts`, the architecture registry, `ci.yml`).                                                     | Medium     | Low    | Small, additive edits; each PR is rebased on `main` before review; the registry test catches a missed registration.                                                    | Agent | Open  |
| R-10 | `main`'s end-to-end run is red on the known 3D tests; a new end-to-end failure of this work could hide among them.                                                   | Medium     | Medium | Run the sommelier, Tonight and taste specs locally for every phase and list each failing spec by name.                                                                 | Agent | Open  |

## Closed

None yet.

## R-11 — Two pairing thresholds of S0 are missed

**What.** On the benchmark the engines put a labelled-right bottle first in 68% of scenarios (threshold 80%) and
offer no labelled-poor bottle in 73% (threshold 90%). V1 without AI: 32% and 8%.

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

**What.** `CELLR_FEATURES=all` does not turn on the four sommelier switches; each must be named.
**Why.** A deployment set to `all` for an earlier epic must not start this one by accident (R-02).
**Residual.** Someone who expects `all` to mean all will find the sommelier still off. `docs` and the registry say so.

## R-13 — Outcome signals are sparse and self-reported

**What.** Most people will not say what came of a bottle; those who do are not a sample.
**Why it matters.** A share on a page looks like a measure.
**Handled.** The report shows counts next to every share and says that small numbers prove nothing; nothing is fed
back automatically (D-26).
**Residual.** Someone may still read 3 of 4 as 75%.

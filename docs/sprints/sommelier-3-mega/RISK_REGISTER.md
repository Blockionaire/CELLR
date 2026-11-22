# Sommelier — risk register

Since 2026-11-22 the project is Sommelier V1+ (D-46, `SOMMELIER_CLOSEOUT.md`); risks that the new plan makes moot
say so.

Open risks, most serious first. A risk leaves this table only with the evidence that closed it (it then moves to the
closed list at the bottom).

| ID   | Risk                                                                                                                                                                                    | Likelihood | Impact | Mitigation                                                                                                                                                                                            | Owner | State            |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ---------------- |
| R-01 | The food and pairing knowledge was written by an AI agent and has not been checked by a wine professional. Wrong labels make a confident wrong recommendation.                          | Medium     | High   | Provenance and `reviewed: false` on every entry (D-11); conservative rules; the benchmark; switches off until a human review. The benchmark's labels share this limit.                                | Owner | Open             |
| R-02 | A deployment has `CELLR_FEATURES=all`: every new switch would be on there the moment the code is deployed.                                                                              | Low        | High   | Owner confirms the value for Production and Preview in Vercel before each merge (this tooling cannot read it).                                                                                        | Owner | Open             |
| R-03 | Migration order: PR #88 adds `20261124000047`. A later-numbered migration of this work applied first would make 0047 unappliable (the CLI refuses an older version).                    | Medium     | Medium | V1+ needs no migration (D-48). The deferred 0051–0053 follow `SOMMELIER_CLOSEOUT.md` §6.2: a read-only check of the hosted history against `docs/MIGRATIONS.md` and the owner's approval before each. | Owner | Moot for V1+     |
| R-04 | V1's AI path (the one most people use) is not measured: no model key is available here, and using one is a cost the owner must approve.                                                 | Certain    | Medium | Measured on the S9 and S10 branches with a real model ($0.36 in total; `COST_REPORT.md`). P2 brings the harness to `main`; further paid runs need the owner's budget (D-51).                          | Owner | Partly closed    |
| R-05 | No approved retailer data source exists. Live discovery cannot be delivered, only the architecture and an honest fallback.                                                              | Certain    | Medium | D-07; provider interface, validation and tests with fixtures; the feature reports "no shop connected".                                                                                                | Owner | Open             |
| R-06 | Friend data reaching a model prompt, a log or a stored answer after sharing was withdrawn.                                                                                              | Low        | High   | D-08, D-09; permission read per request; no friend text in logs or analytics; cross-user tests; an independent security review in S5.                                                                 | Agent | Open             |
| R-07 | Alcohol marketing and age rules for showing offers and retailer links (Netherlands and EU).                                                                                             | Certain    | Medium | No offers are shown (R-05). Before a provider is switched on: legal check by the owner, age statement, no promotion to minors, no affiliate ranking.                                                  | Owner | Open             |
| R-08 | The new engine ranks differently from Tonight for the same cellar; people notice changed picks.                                                                                         | Certain    | Low    | V1's model keeps choosing (D-46); the engines only answer when V1 has no model, and only after D-49's review.                                                                                         | Agent | Moot for V1+     |
| R-09 | Parallel work touches the same files (`server/services.ts`, `features.ts`, the architecture registry, `ci.yml`).                                                                        | Medium     | Low    | Small, additive edits; each PR is rebased on `main` before review; the registry test catches a missed registration.                                                                                   | Agent | Open             |
| R-10 | `main`'s end-to-end run is red on the known 3D tests; a new end-to-end failure of this work could hide among them.                                                                      | Medium     | Medium | #113 runs the 3D specs as their own suite with their own shards; the coverage guard proves every test runs once.                                                                                      | Agent | Mitigated (#113) |
| R-13 | V1's buy suggestions show a producer and a price the model made up (`BuySuggestion.price`, prompt rule "about €20"); only "prices are rough" warns. This is on `main` and active today. | Certain    | Medium | P3 (`check`): a budget band or "price not known" instead of the model's number; 0 unverified prices is a release condition (closeout §5).                                                             | Agent | Open             |
| R-14 | V1's answer text is not checked against the cellar: only the cards are, so a sentence may name a wine that is not offered or not owned.                                                 | Possible   | Medium | P3 (`check`): the text is checked against the digest, and falls back to a card-only sentence when it fails.                                                                                           | Agent | Open             |
| R-15 | Eight interdependent sommelier switches; `sommelier_social` and `sommelier_experiences` are read nowhere on `main`, so turning them on would look like a launch and change nothing.     | Certain    | Low    | One configuration, `CELLR_SOMMELIER`, with independent parts (D-52, P2); P2 documents what happens to each existing switch.                                                                           | Agent | Open             |

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

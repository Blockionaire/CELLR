# Sommelier 3.0 — master brief (agreed scope)

> **Superseded in part (2026-11-22).** This file describes Sommelier 3.0, in which the engine chooses the wine. The
> project now is Sommelier V1+: V1's model chooses, code adds facts, checks and a fallback (D-46). What still holds,
> what is void and what is built where: [`SOMMELIER_CLOSEOUT.md`](SOMMELIER_CLOSEOUT.md). Kept as history.

Source: the owner's brief of 2026-11-19 ("CELLR — Sommelier 3.0 mega sprint"). This file is the scope the work is
measured against; [`ACCEPTANCE_MATRIX.md`](ACCEPTANCE_MATRIX.md) turns it into checks. A new session starts from
[`STATUS.md`](STATUS.md), not from here.

## Product promise

"CELLR knows your wines, understands your taste, and helps you decide what to drink, what to buy, and why."

One coherent intelligence architecture on top of what exists: the cellar inventory, the wine database, Wine
Intelligence, personal taste, friendships and Sommelier V1. Not a generic chatbot, and not a rewrite of systems that
work.

## Phases

| Phase | What                                           | Gate                                                                                  |
| ----- | ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| S0    | Baseline, architecture, evaluation framework   | Architecture independently reviewed; baseline reproducible; main risks recorded       |
| S1    | Food Intelligence Engine                       | Tested food representation; quality-controlled data; reproducible parsing tests       |
| S2    | Advanced Pairing Engine                        | Compared with the S0 baseline and a hard set; regressions investigated                |
| S3    | Deep Wine Intelligence integration             | Inventory accuracy, ranking regression, source reliability, household isolation tests |
| S4    | Conversational Buying Intelligence + discovery | Multi-turn tests, constraints kept, retailer data validation, stale stock, privacy    |
| S5    | Social Sommelier                               | Independent security review; cross-user and revoked-consent regression tests          |
| S6    | Premium experiences                            | Mobile and desktop end-to-end, accessibility, responsive, UX regression               |
| S7    | Learning, analytics, AI optimisation           | Measured quality and cost; no material regression; authorisation-safe caching tested  |
| S8    | Validation and release readiness               | Final independent review; P0/P1 closed; GO / NO-GO                                    |

## Rules that hold in every phase

1. **Food suitability comes first.** Personal taste orders suitable wines; it never turns an unsuitable pairing into a
   good one.
2. **Three honest outcomes:** a good match, an acceptable compromise, or no suitable wine. No forced positive answer.
3. **No invented precision.** A ranking score is not shown as a measured compatibility percentage. Confidence is
   stated in words and follows from the evidence.
4. **Evidence tiers for wine facts:** exact wine or vintage → appellation → regional or style estimate → unknown. A
   regional estimate is never presented as a property of the exact wine.
5. **Owned means owned.** A bottle described as owned exists in the authorised inventory. Reserved bottles, bottles
   that are not ready and bottles past their window are named as such.
6. **Never fabricate** an offer, a product URL, a price, a stock status or a retailer. Four levels are kept apart: a
   style recommendation, a concrete product, a verified online offer, verified local availability.
7. **A mention is an id.** `@friend` resolves on the server to an accepted friend's internal user id. Friend data is
   used only under the sharing permissions of that moment, checked again on every request.
8. **A thumbs-up is not a pairing outcome.** Useful answer, bottle opened, pairing experienced, pairing enjoyed and
   stated taste are five different signals.
9. **Everything new ships off.** No new behaviour in Production or Preview until the owner switches it on.

## Safety boundaries (owner's rules)

- Work on feature branches; never on `main`. No merge, no deploy, no production write, no `db push` without the
  owner's explicit authorisation.
- Applied migrations are never edited (`docs/MIGRATIONS.md`). A database change is a new migration.
- No paid services, accounts, API commitments or secret changes without approval.
- No production user data in fixtures, external evaluations or unapproved AI calls.
- CI, tests and security checks are not weakened to pass a phase.
- Parallel work (system monitoring, PR #88; the 3D cellar) is not touched.

## When the work stops and asks

A production or deployment write; credentials or a commercial agreement; a material change to user-facing privacy
defaults; a legal or licensing uncertainty about a data source; an unresolved critical security or data-integrity
problem; the environment cannot continue. Ordinary bugs, failing tests, conflicts and design decisions are solved,
not asked.

## Deliverables

The documents in this directory (`ARCHITECTURE`, `ACCEPTANCE_MATRIX`, `BASELINE`, `DECISIONS`, `RISK_REGISTER`,
`COST_REPORT`, `STATUS`, `FINAL_REPORT`, `RELEASE_PLAN`, `progress/S0.md` … `S8.md`), a tracking issue, and a chain of
reviewable pull requests, one per phase or coherent group of phases.

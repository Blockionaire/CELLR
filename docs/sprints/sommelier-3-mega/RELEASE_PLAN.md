# Sommelier V1+ — release plan

Nothing here has been released. Every step is the owner's to authorise. The agent does not merge, deploy, push a
migration, change a setting or make a paid model call.

**The plan that stood here before is void (D-46, D-47).** That plan merged the S0–S8 chain and turned on
`sommelier_engine`, `sommelier_buying`, `sommelier_experiences` and `sommelier_social` one by one. It would have put
the measured-weaker engine in front of V1, so it is not carried forward. Its history is in git.

The plan itself, with acceptance criteria, is [`SOMMELIER_CLOSEOUT.md`](SOMMELIER_CLOSEOUT.md) §6–§7. This file keeps
the order and the owner checks.

## Order

1. **P1, documents.** Inventory, corrected decisions and plans. No code.
2. **P2, the gate and the release configuration.** V1-with-AI evaluation on `main`, dish-clustered statistics, and
   `CELLR_SOMMELIER` (empty: V1 exactly as today).
3. **P3–P6, the parts:**
   - `check`: the answer text and buying claims;
   - `annotate`: facts on V1's cards;
   - `quantities`;
   - `menu`.
4. **P7, `fallback`:** built, **not activated** without a quality measurement and a wine expert's review (D-49).
5. **P8, release:** Preview with the parts on, a walkthrough in the real UI, then the owner's production decision.

No migration is part of this release. 0051, 0052 and 0053 belong to the deferred social and learning projects (D-48).

## Owner checks before any part is on in Production

| Check                                                                                                | Why                                                        | State                      |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------- |
| `CELLR_SOMMELIER` is unset on Production until the decision; `CELLR_FEATURES` names no engine switch | Nothing turns on by deployment (R-02)                      | read-only check per step   |
| Budget for paid evaluation runs                                                                      | D-51; the gate in §5 of the closeout needs V1-with-AI runs | **pending** (proposed: $3) |
| Gate thresholds of closeout §5                                                                       | D-50; the numbers are a proposal                           | **pending**                |
| Human holdout and wine expert(s) named                                                               | Definitive quality claims (D-50)                           | **pending**                |
| A wine professional reviews the knowledge the fallback uses                                          | R-01; before `fallback` is active anywhere (D-49)          | open                       |
| Alcohol marketing and age rules for buying advice                                                    | R-07                                                       | open                       |
| A licensed retailer source, before any live offer                                                    | R-05; without it buying advice stays at a style and a band | blocked                    |

## Rollback

Remove a part from `CELLR_SOMMELIER`, or unset the variable: V1 answers exactly as before. The parts add facts to an
answer and store nothing new, so a conversation kept while a part was on still opens.

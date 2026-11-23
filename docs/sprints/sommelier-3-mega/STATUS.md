# Sommelier V1+ — status (resume from here)

A new session reads this file first, then [`SOMMELIER_CLOSEOUT.md`](SOMMELIER_CLOSEOUT.md) (the plan),
[`DECISIONS.md`](DECISIONS.md) from D-46 on (D-53 says which of them are confirmed, approved directions or proposals), `git log --oneline -15`, the open pull requests and the newest CI runs. It
then continues at **Next action**.

## Resume block

```text
UPDATED:     2026-11-22
PROJECT:     Sommelier V1+ (D-46): V1 with AI chooses; code adds facts, checks, limits and a no-model fallback.
             Replaces the Sommelier 3.0 sprint plan (S0–S11) as the way forward.
PLAN:        SOMMELIER_CLOSEOUT.md §6: P1 docs → P2 gate and release config → P3 check → P4 annotate →
             P5 quantities → P6 menu → P7 fallback (built, not activated: D-49) → P8 release.
OPEN PRs:    at most two new Sommelier PRs at a time, each from main, none stacked (D-47).
OLD STACK:   #94 (S5) ← #95 ← #97 ← #98 ← #100 ← #104 ← #106 (S11): drafts, not a merge order. Kept until their
             code is taken over or postponed in writing (closeout §6.1). #94 and #97 stay unmerged drafts.
MIGRATIONS:  V1+ needs none. 0051–0053 exist only on the stack; never applied automatically (closeout §6.2).
SWITCHES:    nothing new is on anywhere. On main, sommelier_engine, sommelier_buying, sommelier_social and
             sommelier_experiences are named-only and off. V1+ uses CELLR_SOMMELIER (D-52, P2), empty by default.
PAID CALLS:  none without the owner's budget approval (D-51). Proposed total: $3, not approved.
PRODUCTION:  not touched. No merge, deploy, db push, flag change or production write by the agent.
```

## Where things are

| What                                                           | Where                                                                                   |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Inventory of `main` and of the seven PRs, checked against code | `SOMMELIER_CLOSEOUT.md` §2                                                              |
| Outdated decisions and plans                                   | `SOMMELIER_CLOSEOUT.md` §3                                                              |
| V1+ architecture and what it reuses                            | `SOMMELIER_CLOSEOUT.md` §4                                                              |
| Quality gate                                                   | `SOMMELIER_CLOSEOUT.md` §5 (thresholds are a proposal, D-50)                            |
| PR order and what happens to each original PR                  | `SOMMELIER_CLOSEOUT.md` §6                                                              |
| Definition of done, GO/NO-GO, open owner decisions             | `SOMMELIER_CLOSEOUT.md` §7                                                              |
| Measurements of V1 with AI (S9, S10)                           | the S9 and S10 branches, `scripts/sommelier-eval/results/`; summary in `COST_REPORT.md` |
| Phase reports S0–S4                                            | `progress/S0.md` … `progress/S4.md` (history; S5–S11 reports are on their branches)     |

## Next action

1. **P1** (this documentation) is merged by the owner.
2. **P2**, a branch from the current `main`:
   - port the V1-with-AI evaluation (`engines/v1-ai.ts`, `paid.ts`), the dish-clustered statistics (`stats.ts`,
     `compare.ts`) and the holdout sets from #100, #104 and #106;
   - add `CELLR_SOMMELIER` (parts, fails closed, empty = V1 unchanged);
   - run the free evaluation and write a checkable cost estimate for the paid baseline.
   - No paid run.
3. P3–P8 are not started before P2 is merged.

## Rules for whoever continues

- Never merge, deploy, `db push`, change a switch or write to production. Never edit an applied migration.
- No paid model call without the owner's budget approval (D-51).
- Every new table, route, `src/server` file and switch is registered in `apps/web/src/server/system/registry.ts`, in
  the same PR (`CLAUDE.md`: `pnpm architecture:inventory`, `pnpm architecture:impact`,
  `vitest run src/server/system`).
- Analytics events must be on the allow-list in `packages/domain/src/analytics.ts`. Never log typed text, wine names,
  friend data or prices (`docs/METRICS.md`).
- The benchmark's reference answers are never changed to make an engine pass. A wrong label is corrected with a note
  in `BASELINE.md` ("label corrections"), and the baseline is run again.
- The repository is public: no production observations, identifiers or user data in docs or code.

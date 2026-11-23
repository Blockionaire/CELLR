# Sommelier V1+ — status (resume from here)

A new session reads this file first, then [`SOMMELIER_CLOSEOUT.md`](SOMMELIER_CLOSEOUT.md) (the plan),
[`DECISIONS.md`](DECISIONS.md) from D-46 on (D-53 says which of them are confirmed, approved directions or proposals), `git log --oneline -15`, the open pull requests and the newest CI runs. It
then continues at **Next action**.

## Resume block

```text
UPDATED:     2026-11-23
PROJECT:     Sommelier V1+ (D-46): V1 with AI chooses; code adds facts, checks, limits and a no-model fallback.
PLAN:        SOMMELIER_CLOSEOUT.md §6. P1 (#122) and P2 (#123) are on main. P3 to P7 are built, combined, reviewed
             by an independent agent and fixed: V1PLUS_REPORT.md has the evidence, what is not met, and GO/NO-GO.
OPEN PRs:    #128 P3 `check` (claude/sommelier-v1plus-p3), #129 P4+P5 `annotate`, `quantities`
             (claude/sommelier-v1plus-p45). Both from main, not stacked. At most two open (D-47).
PREPARED:    P6 `menu` (claude/sommelier-v1plus-p6) and P7 `fallback` (claude/sommelier-v1plus-p7): complete and
             green alone, pushed, no pull request yet. Opened when one of the two above is merged.
INTEGRATION: claude/lucid-knuth-ck7ge0 = all four merged, plus the tests of every combination, the journey in a
             browser, the free benchmarks and V1PLUS_REPORT.md. A rehearsal of the merges, not a merge order.
OLD STACK:   #98 closed by the owner. #100, #104, #106: proposed to close now; #95 after P6. #94 and #97 stay
             unmerged drafts (V1PLUS_REPORT.md §6).
MIGRATIONS:  V1+ needs none and adds none.
SWITCHES:    nothing new is on anywhere. CELLR_SOMMELIER is empty by default; every part is off.
PAID CALLS:  none made. None without the owner's budget approval (D-51).
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

1. The owner merges **#128** (P3), then **#129** (P4+P5). After each merge: merge `main` into the next branch
   (the conflicts are in `server/sommelier/service.ts`, `service.test.ts`, `server/system/registry.ts`,
   `sommelier-screen.tsx`, `playwright.config.ts` and the two domain type files; the integration branch shows every
   resolution), set the register's version to the next minor, rerun the checks and the browser tests.
2. Open **P6**, then **P7**, one at a time as a slot frees.
3. When P3 to P7 are on `main`: one small pull request from the integration branch with the combined tests, the
   journey test, the benchmarks and the report. Then P8 (V1PLUS_REPORT.md §8).
4. Waiting on the owner: the budget for the paid runs, the gate's thresholds, the human holdout and the wine
   expert, and closing the original pull requests (V1PLUS_REPORT.md §6 and §8).

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

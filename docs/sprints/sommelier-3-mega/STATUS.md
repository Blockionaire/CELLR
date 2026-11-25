# Sommelier V1+ — status (resume from here)

A new session reads this file first, then [`SOMMELIER_CLOSEOUT.md`](SOMMELIER_CLOSEOUT.md) (the plan),
[`DECISIONS.md`](DECISIONS.md) from D-46 on (D-53 says which of them are confirmed, approved directions or proposals), `git log --oneline -15`, the open pull requests and the newest CI runs. It
then continues at **Next action**.

## Resume block

```text
UPDATED:     2026-11-25
PROJECT:     Sommelier V1+ (D-46): V1 with AI chooses; code adds facts, checks, limits and a no-model fallback.
ON MAIN:     P1 (#122), P2 (#123), P3 `check` (#128, merged 2026-11-24). Every part is off by default.
OPEN PRs:    #129 P4+P5 `annotate`, `quantities` (claude/sommelier-v1plus-p45, head 38a1fd0 = main with P3 merged
             in): full CI green, mergeable; GO to merge with the parts off.
             #133 P6 `menu` (claude/sommelier-v1plus-p6, head 7d1a3fe = main with P3 merged in): full CI green;
             needs main merged in again after #129, then its full CI again.
PREPARED:    P7 `fallback` (claude/sommelier-v1plus-p7, head 77ac487 = main with P3 merged in): green locally,
             pushed, no pull request yet (at most two open, D-47). Opened when a slot frees.
INTEGRATION: claude/lucid-knuth-ck7ge0 = all parts merged together, the tests of every combination, the journey in a
             browser, the free benchmarks, the P8 preparation and V1PLUS_REPORT.md. A rehearsal of the merges and
             the source of the final small pull request; never merged as a whole.
P8 PREP:     P8_MEASUREMENT_PLAN.md (paid runs prepared, NOT run; fits the provisional $5: $3.86 reserved),
             P8_POWER_ANALYSIS.md, P8_RESULTS_TEMPLATE.md, review/ (forms for one wine professional and three to
             five users, the human holdout in two series of 40 and 60). Owner's provisional points: plan §0.
OLD STACK:   #98 closed by the owner. #100, #104, #106: proposed to close now; #95 after P6. #94 and #97 stay
             unmerged drafts (V1PLUS_REPORT.md §6). Nothing is closed by the agent.
MIGRATIONS:  V1+ needs none and adds none.
SWITCHES:    nothing new is on anywhere. CELLR_SOMMELIER is empty by default; every part is off.
PAID CALLS:  none made. None without the owner's explicit approval (D-51); the $5 is provisional.
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

1. The owner merges **#129**. Then, without force-push: merge `origin/main` into `claude/sommelier-v1plus-p6`
   (#133) and into `claude/sommelier-v1plus-p7`. The conflicts are in `server/sommelier/service.ts`,
   `service.test.ts`, `sommelier-screen.tsx`, `server/system/registry.ts`, `playwright.config.ts` and the two domain
   type files; the integration branch shows every resolution (read each again; `git rerere` replays some, and a
   replayed comment or register note must be checked for the combination at hand). Set the register's version to the
   next minor (P6 1.8.0, P7 1.9.0) and `reviewedOn`, run `pnpm architecture:inventory`, the checks, the sommelier
   browser tests, and the full CI by hand (`workflow_dispatch`). Open the P7 pull request when only one is open.
2. After P3 to P7 are on `main`: one small pull request from a new branch off `main` with only what is missing there:
   `service-v1plus.test.ts`, `e2e/sommelier-journey.spec.ts`, the benchmarks and P8 scripts under
   `scripts/sommelier-eval/`, the results and review files, the P8 documents, `V1PLUS_REPORT.md` and this file. Never
   the integration branch as a whole. Then the P8 acceptance matrix (GO/NO-GO per part; technical validation, AI
   measurement and human assessment kept apart).
3. Waiting on the owner: the explicit approval of the paid runs, the gate's thresholds (the power analysis shows what
   each set can support), the people (one wine professional, three to five users, the holdout's authors), and
   closing the original pull requests.

Known unrelated flakes in CI: `e2e/scan-records.spec.ts:430` (the route announcer; #116 is open for it) and
`src/features/cellar/storage3d/premium-look.test.ts` (timing under load). A run that fails only on one of them is
started again; neither is skipped or changed here.

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

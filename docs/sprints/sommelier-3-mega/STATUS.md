# Sommelier 3.0 — status (resume from here)

A new session reads this file first, then `git log --oneline -15`, the open pull requests and the newest CI runs, and
continues at **Next action**. Scope: [`MASTER_BRIEF.md`](MASTER_BRIEF.md). Design: [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Resume block

```text
UPDATED:        2026-11-19 (S0, S1, S2 complete; S3 in progress)
PHASE:          S3 — wine intelligence integration (orchestrator, plan contract, switch)
BRANCHES:       claude/sommelier-3-s0-foundation   (from main 07bc80c)   S0        PR #90
                claude/sommelier-3-s2-food-pairing (from the S0 branch)  S1 + S2   PR: see table
                claude/sommelier-3-s3-wine         (from the S2 branch)  S3 + S4   in progress, worktree /home/user/CELLR-s3
                claude/sommelier-3-s1-food         work-in-progress checkpoints of everything written ahead (S4–S6
                                                   domain modules, the S5 migration draft). NOT a pull request branch:
                                                   later branches take their files from it.
TRACKING ISSUE: #89
MAIN:           07bc80c; all 46 migrations are in production (docs/MIGRATIONS.md). PR #88 (system monitoring) is open
                and adds migration 20261124000047: this work's migrations must be numbered and released after it.
SWITCHES:       sommelier_engine, sommelier_buying, sommelier_social, sommelier_experiences (added in S3). None is
                turned on by `all`; each must be named in CELLR_FEATURES. Nothing is on anywhere.
AI KEY:         none available to the agent. V1's AI path is NOT measured (RISK R-04). No model call was made.
PRODUCTION:     not touched. No merge, deploy, db push or production write by the agent.
```

## Pull requests

| Phase   | Branch                               | Base                               | Pull request                                         | State |
| ------- | ------------------------------------ | ---------------------------------- | ---------------------------------------------------- | ----- |
| S0      | `claude/sommelier-3-s0-foundation`   | `main`                             | [#90](https://github.com/Blockionaire/CELLR/pull/90) | open  |
| S1 + S2 | `claude/sommelier-3-s2-food-pairing` | `claude/sommelier-3-s0-foundation` | see the tracking issue                               | open  |

## Done

- **S0** (`progress/S0.md`): design, benchmark of 246 scenarios, observed baseline of V1 without AI (13 / 246),
  independent architecture review.
- **S1** (`progress/S1.md`): food intelligence engine; 331 ingredients, 31 techniques, 82 sauces, 360 dish
  templates in English and Dutch; "dish understood" 95% (gate 90%).
- **S2** (`progress/S2.md`): pairing engine; 566 wine style rules; three outcomes; independent review (approve with
  changes, 11 findings, all dispositioned). Benchmark 79 / 246; outcome 90%, first bottle 68%, no poor bottle 73%.
  Two S0 thresholds missed and reported (R-11).

## In progress

- **S3 + S4** in the worktree `/home/user/CELLR-s3` (branch `claude/sommelier-3-s3-wine`): the orchestrator
  `apps/web/src/server/sommelier/intelligence.ts`, the plan contract `packages/domain/src/sommelier-plan.ts`, the
  conversation state, style advice, offer checks, the named-only switches, and the benchmark adapter `v3-app`
  (first run: 108 / 246). Not yet: the review fixes of S2 merged in, the screen, the registry entries, tests of
  the orchestrator, the independent review.

## Next action

1. In `/home/user/CELLR-s3`: commit, then `git rebase claude/sommelier-3-s2-food-pairing` (the food and pairing
   files there are newer; take them). Fix what the new level "neutral" and the new `closest` change.
2. Finish S3 + S4: recommend a style when nothing reaches "acceptable"; "around €40" is a ceiling of 40; a shop
   word alone is not a wish to buy; unit tests for the orchestrator and the service; the screen (plan sentences in
   English and Dutch); registry (`pnpm architecture:inventory`); analytics events; independent review; PR.
3. S5 from the migration draft and domain files on `claude/sommelier-3-s1-food` (`supabase/migrations/
20261129000051_social_sommelier.sql`, `supabase/tests/99_social_sommelier.test.sql`, `social.ts`).
4. S6 (experiences), S7 (signals, routing, caching), S8 (final review, `FINAL_REPORT.md`, `RELEASE_PLAN.md`).

## Rules for whoever continues

- Never merge, deploy, `db push` or write to production. Never edit an applied migration.
- Every new table, route, `src/server` directory and switch is registered in `apps/web/src/server/system/registry.ts`
  (`pnpm architecture:inventory`, then `pnpm test`).
- Analytics events must be on the allow-list in `packages/domain/src/analytics.ts`; never log typed text, wine names,
  friend data or prices (`docs/METRICS.md`).
- Reference answers of the benchmark are never changed to make an engine pass. A wrong label is corrected with a note
  in `BASELINE.md` ("label corrections"), and the baseline is run again.

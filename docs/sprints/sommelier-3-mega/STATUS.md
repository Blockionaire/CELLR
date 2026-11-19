# Sommelier 3.0 — status (resume from here)

A new session reads this file first, then `git log --oneline -15`, the open pull requests and the newest CI runs, and
continues at **Next action**. Scope: [`MASTER_BRIEF.md`](MASTER_BRIEF.md). Design: [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Resume block

```text
UPDATED:        2026-11-19 (S0 complete; S1 started)
PHASE:          S1 — Food Intelligence Engine
BRANCHES:       claude/sommelier-3-s0-foundation  (from main 07bc80c)  S0, pull request open
                claude/sommelier-3-s1-food        (from the S0 branch) S1, in progress
PR CHAIN:       #90 (S0) ← S1 ← …; see "Pull requests" below
TRACKING ISSUE: #89
MAIN:           07bc80c; all 46 migrations are in production (docs/MIGRATIONS.md). PR #88 (system monitoring) is open
                and adds migration 20261124000047: this work's migrations must be numbered and released after it.
SWITCHES:       none added yet (planned: sommelier_engine, sommelier_buying, sommelier_social, sommelier_experiences)
AI KEY:         none available to the agent. V1's AI path is NOT measured (RISK R-04). No model call was made.
PRODUCTION:     not touched. No merge, deploy, db push or production write by the agent.
```

## Pull requests

| Phase | Branch                             | Base   | Pull request | State |
| ----- | ---------------------------------- | ------ | ------------ | ----- |
| S0    | `claude/sommelier-3-s0-foundation` | `main` | (see issue)  | open  |

## Working tree (recovery note, 2026-11-19)

Branch `claude/sommelier-3-s1-food`. Uncommitted, written ahead while the knowledge was being authored; each goes
on the branch of its own phase, in this order:

| Phase | Files (all under `packages/domain/src/` unless said)                                                                                                                                                                                                                                                                         | State                                         |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| S1    | `food/{types,compose,parse}.ts`, `food/knowledge/*` (agent), `food/*.test.ts` (agent), `intelligence.ts` and `entries.test.ts` (parked in the session scratchpad until both knowledge sets exist), `package.json` export `./intelligence`, `apps/web/eslint.config.mjs` + `src/test/architecture.test.ts` (server-only rule) | knowledge in progress                         |
| S2    | `pairing-engine/{wine,assess,decide,taste}.ts`, `assess.test.ts` (26 pass), `pairing-engine/knowledge/*` (agent); `scripts/sommelier-eval/engines/v3.ts`, `matrix.ts`                                                                                                                                                        | rules written, not yet tuned on the benchmark |
| S4    | `buying/{state,styles,recommend,offers}.ts` + tests (66 pass)                                                                                                                                                                                                                                                                | domain only; no server wiring yet             |
| S5    | `social.ts`, `social.test.ts` (9 pass); `pairing-engine/taste.ts`                                                                                                                                                                                                                                                            | domain only                                   |
| S6    | `experiences/{serving,quantity}.ts` + test (16 pass)                                                                                                                                                                                                                                                                         | domain only                                   |

## Done

- **S0** (gate passed, `progress/S0.md`): systems mapped; master brief, architecture, 18 decisions, 10 risks,
  acceptance matrix; benchmark of 246 scenarios (`pnpm sommelier:eval`); observed baseline of V1 without AI
  (13 / 246, `BASELINE.md`); independent architecture review (approve with changes, 12 findings, all dispositioned);
  one V1 bug fixed (a long answer broke later questions).

## In progress

- **S1**: `packages/domain/src/food/` — types, composition, parser (written); knowledge (ingredients, techniques,
  sauces, about 250 dish templates) and tests being authored.

## Next action

1. S1: finish the knowledge and its tests; add the server-only entry `@cellr/domain/intelligence` with its three
   guards (ESLint rule for client code, architecture test, domain test); add the `v3` engine adapter to the benchmark
   and reach "dish understood ≥ 90%"; independent review; `progress/S1.md`; pull request on top of S0.
2. S2: `packages/domain/src/pairing-engine/` (wine profile, rules, three outcomes), held to the gates in
   `BASELINE.md` §4.

## Rules for whoever continues

- Never merge, deploy, `db push` or write to production. Never edit an applied migration.
- Every new table, route, `src/server` directory and switch is registered in `apps/web/src/server/system/registry.ts`
  (`pnpm architecture:inventory`, then `pnpm test`).
- Analytics events must be on the allow-list in `packages/domain/src/analytics.ts`; never log typed text, wine names,
  friend data or prices (`docs/METRICS.md`).
- Reference answers of the benchmark are never changed to make an engine pass. A wrong label is corrected with a note
  in `BASELINE.md` ("label corrections"), and the baseline is run again.

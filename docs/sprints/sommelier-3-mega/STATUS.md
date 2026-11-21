# Sommelier 3.0 — status (resume from here)

A new session reads this file first, then `git log --oneline -15`, the open pull requests and the newest CI runs, and
continues at **Next action**. Scope: [`MASTER_BRIEF.md`](MASTER_BRIEF.md). Design: [`ARCHITECTURE.md`](ARCHITECTURE.md).
The end state of S0–S8 is in [`FINAL_REPORT.md`](FINAL_REPORT.md); S9 is in [`progress/S9.md`](progress/S9.md);
what exists against the brief is in [`PRODUCT_STATUS.md`](PRODUCT_STATUS.md); what the owner has to decide, and
the GO / NO-GO, is in [`RELEASE_PLAN.md`](RELEASE_PLAN.md).

## Resume block

```text
UPDATED:        2026-11-21 (S11 written; #90 and #91 merged by the owner; nothing released or switched on)
PHASE:          S11 — done (preparatory): V1+ proposal, variant E in shadow (off), statistics by dish, escrow
TRACKING ISSUE: #89
MAIN:           4ffa39f (#90 S0, #91 S1+S2 merged 2026-11-21). #93 (S3+S4) was merged into its stale base branch
                claude/sommelier-3-s2-food-pairing, NOT into main (progress/S11.md §6.2): to be re-landed by the owner.
                main also holds 20261128000050 (r27, #101, not applied). Production records 0001–0047.
                This work's migrations: 0051, 0052, 0053 (renumbered in S11); none on main, none applied.
SWITCHES:       sommelier_engine, _buying, _social, _experiences, _learning, _dish_ai, _second_opinion,
                and sommelier_v1_guard (S11, shadow, needs nothing else). None is turned on by `all`.
                Nothing is on anywhere.
AI:             No paid call in S11. Proposed: the guard's shadow on V1 with AI, cap $0.25 (progress/S11.md §3.3).
                The key lives in the cloud environment's secret store (api.openai.com), never in the repository.
RETAILER:       no source. Live offers are built, validated and off (`offers: null`); buying advice is styles.
QUALITY:        V1 with AI stays the sommelier (S10). The guard flags 0 good or acceptable wines on every set.
PRODUCTION:     not touched by the agent. No merge, deploy, db push, setting or production write.
WORKTREES:      /home/user/CELLR-s3 (S11 branch). Ephemeral: only what is pushed lasts.
```

## Pull requests (a stack: review and merge top to bottom)

| Phase   | Branch                               | Base                                 | Pull request                                           |
| ------- | ------------------------------------ | ------------------------------------ | ------------------------------------------------------ |
| S0      | `claude/sommelier-3-s0-foundation`   | `main`                               | [#90](https://github.com/Blockionaire/CELLR/pull/90)   |
| S1 + S2 | `claude/sommelier-3-s2-food-pairing` | `claude/sommelier-3-s0-foundation`   | [#91](https://github.com/Blockionaire/CELLR/pull/91)   |
| S3 + S4 | `claude/sommelier-3-s3-wine`         | `claude/sommelier-3-s2-food-pairing` | [#93](https://github.com/Blockionaire/CELLR/pull/93)   |
| S5      | `claude/sommelier-3-s5-social`       | `claude/sommelier-3-s3-wine`         | [#94](https://github.com/Blockionaire/CELLR/pull/94)   |
| S6      | `claude/sommelier-3-s6-experiences`  | `claude/sommelier-3-s5-social`       | [#95](https://github.com/Blockionaire/CELLR/pull/95)   |
| S7      | `claude/sommelier-3-s7-learning`     | `claude/sommelier-3-s6-experiences`  | [#97](https://github.com/Blockionaire/CELLR/pull/97)   |
| S8      | `claude/sommelier-3-s8-release`      | `claude/sommelier-3-s7-learning`     | [#98](https://github.com/Blockionaire/CELLR/pull/98)   |
| S9      | `claude/sommelier-3-s9-quality`      | `claude/sommelier-3-s8-release`      | [#100](https://github.com/Blockionaire/CELLR/pull/100) |
| S10     | `claude/sommelier-3-s10-hybrid`      | `claude/sommelier-3-s9-quality`      | [#104](https://github.com/Blockionaire/CELLR/pull/104) |
| S11     | `claude/sommelier-3-s11-v1plus`      | `claude/sommelier-3-s10-hybrid`      | [#106](https://github.com/Blockionaire/CELLR/pull/106) |

#90 and #91 are merged into `main`. #93 is marked merged but went into `claude/sommelier-3-s2-food-pairing`
(`RELEASE_PLAN.md` §1).

`claude/sommelier-3-s1-food` holds early work-in-progress checkpoints only. It is not a pull request branch and
can be deleted once the stack is merged.

When a lower pull request changes after review, the change is merged into each branch above it (D-28): no branch
with an open pull request is rebased or force-pushed.

## Done

Each phase's record is `progress/S<n>.md`: scope, choices, test commands and their actual results, the independent
review's findings and what was done about each, limitations.

- **S0**: design, benchmark of 246 scenarios, observed baseline of V1 without AI (13 / 246).
- **S1**: food engine; 331 ingredients, 31 techniques, 82 sauces, 360 dish templates (English and Dutch).
- **S2**: pairing engine; 566 wine style rules; three honest outcomes. Engines alone: 79 / 246.
- **S3 + S4**: the engines in the app (a plan, no model call), buying advice as styles with a conversation that
  keeps its state, offer validation with no source connected. In the app: 131 / 246.
- **S5**: friends named in a question, with their own consent (off by default); migration 0051 (draft).
- **S6**: serving, keeping, wine-to-food, menus, quantities; the plan in a real browser (phone and desktop, WCAG
  2.1 AA by axe). 140 / 246.
- **S7**: what came of a bottle, apart from the thumb; the admin's report; migration 0052 (draft).
- **S8**: final review, classification of what is open, `FINAL_REPORT.md`, `RELEASE_PLAN.md`.
- **S9**: the 106 failures sorted and a blind second opinion on the disagreements; engine recalibrated (main set
  140 → 170; unseen dishes 34 → 38 of 88); a blind holdout; a friend's cellar and presents not already owned
  (migration 0053, draft); friends kept across follow-ups; the comparison with V1's AI (run: 3.0 not shown to be better);
  the brief against what exists; GO / NO-GO.
- **S10**: does the parser know when it misread a dish (a router, measured); a model reads the dish the
  parser could not place (C) and a bounded second opinion in close calls (D), both behind new named-only
  switches; fewer, surer bottles; per-bottle measures, an upper bound and the four variants on the same
  scenarios; a shared store of dish readings; the frame for a human holdout and a blind expert review sheet.
  Paid comparison run with approval ($0.26): V1 with AI stays the default (`HYBRID_EVALUATION.md` §7).
- **S11**: V1+ architecture (V1's model chooses; code supplies facts, rules and a guard); variant E's guard in
  shadow behind `sommelier_v1_guard` (0 good or acceptable wines flagged on any set); the plans for buying and
  social with V1; the human holdout in escrow and the panel's protocol; comparisons clustered by dish; the
  migrations renumbered after `main`'s 0050; which pull requests can be merged (`progress/S11.md`).

## Next action

Nothing for the agent without the owner. The owner's decisions are listed in `progress/S11.md` §9: re-land S3+S4 on
`main` and retarget #94; option 1 or 2 for the rest of the stack (§6.3); the paid shadow run (cap $0.25); social A or
B; whether the engines-as-fallback proposal is worth a sprint; people for the human holdout and the panel.
A session that resumes: read the pull requests' review comments and CI, fix what is asked on the branch it
belongs to, merge it into each branch above it (D-28: never rebase or force-push a branch with an open pull
request), and update the phase's `progress` file.
